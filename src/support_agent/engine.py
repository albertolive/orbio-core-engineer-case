from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable, Mapping
from time import perf_counter
from uuid import UUID, uuid4

from openai import OpenAIError

from support_agent.domain import (
    CLOSED_REPLIES,
    GREETINGS,
    RETRY_REPLIES,
    TERMINAL_PHASES,
    ConversationSession,
    ConversationSummary,
    ConversationTurn,
    Language,
    LlmTurnOutput,
    OrderInfo,
    TurnMetrics,
    apply_turn,
    build_prompt,
    fallback_summary,
    utc_now_iso,
)
from support_agent.rag import RagIndex
from support_agent.store import JsonConversationStore, check_idempotency, sha256_bytes

logger = logging.getLogger(__name__)

MIN_AUDIO_BYTES = 256

type ParseTurnFn = Callable[[str], Awaitable[tuple[LlmTurnOutput | None, int, int, str | None]]]
type SummarizeFn = Callable[[ConversationSession], Awaitable[ConversationSummary | None]]
type TranscribeFn = Callable[[str, bytes, str], Awaitable[str]]
type SynthesizeFn = Callable[[str, Language], Awaitable[tuple[bytes | None, str, str | None]]]


class EmptyTranscriptError(ValueError):
    pass


class UpstreamSpeechError(RuntimeError):
    pass


class TurnNotFoundError(LookupError):
    pass


def _log_telemetry(payload: dict[str, object]) -> None:
    logger.info("%s", json.dumps(payload, separators=(",", ":")))


class ConversationEngine:
    def __init__(
        self,
        *,
        store: JsonConversationStore,
        rag: RagIndex,
        orders: Mapping[str, OrderInfo],
        parse_turn_fn: ParseTurnFn,
        summarize_fn: SummarizeFn,
        transcribe_fn: TranscribeFn,
        synthesize_fn: SynthesizeFn,
        tts_configured: bool = False,
    ) -> None:
        self._store = store
        self._rag = rag
        self._orders = orders
        self._parse_turn_fn = parse_turn_fn
        self._summarize_fn = summarize_fn
        self._transcribe_fn = transcribe_fn
        self._synthesize_fn = synthesize_fn
        self.tts_configured = tts_configured

    def start_session(self, language: Language = Language.EN) -> ConversationSession:
        now = utc_now_iso()
        greeting = ConversationTurn(
            turn_id="t0",
            created_at=now,
            reply_text=GREETINGS[language],
            language=language,
        )
        session = ConversationSession(
            session_id=uuid4(),
            created_at=now,
            updated_at=now,
            language=language,
            turns=[greeting],
        )
        self._store.save(session)
        return session

    def get_session(self, session_id: UUID) -> ConversationSession:
        return self._store.load(session_id)

    async def handle_text(
        self,
        session_id: UUID,
        *,
        client_turn_id: str,
        text: str,
    ) -> ConversationSession:
        cleaned = text.strip()
        if not cleaned:
            raise EmptyTranscriptError("Message text cannot be empty")
        digest = sha256_bytes(cleaned.encode("utf-8"))
        async with self._store.lock_for(session_id):
            session = self._store.load(session_id)
            if check_idempotency(session, client_turn_id, digest) is not None:
                return session
            return await self._run_turn_pipeline(
                session,
                user_text=cleaned,
                client_turn_id=client_turn_id,
                payload_sha256=digest,
                stt_ms=None,
            )

    async def handle_voice(
        self,
        session_id: UUID,
        *,
        client_turn_id: str,
        filename: str,
        audio_bytes: bytes,
        mime_type: str,
    ) -> ConversationSession:
        if len(audio_bytes) < MIN_AUDIO_BYTES:
            raise EmptyTranscriptError("Audio clip is too short or empty")
        digest = sha256_bytes(audio_bytes)
        async with self._store.lock_for(session_id):
            session = self._store.load(session_id)
            if check_idempotency(session, client_turn_id, digest) is not None:
                return session
            if session.phase in TERMINAL_PHASES:
                return self._append_closed_turn(
                    session,
                    user_text="[voice message]",
                    client_turn_id=client_turn_id,
                    payload_sha256=digest,
                )
            t_stt = perf_counter()
            try:
                transcript = await self._transcribe_fn(filename, audio_bytes, mime_type)
            except OpenAIError as exc:
                raise UpstreamSpeechError("Speech transcription temporarily unavailable") from exc
            stt_ms = round((perf_counter() - t_stt) * 1000, 1)
            if not transcript.strip():
                raise EmptyTranscriptError("No speech detected in audio clip")
            return await self._run_turn_pipeline(
                session,
                user_text=transcript.strip(),
                client_turn_id=client_turn_id,
                payload_sha256=digest,
                stt_ms=stt_ms,
            )

    async def finalize_session(self, session_id: UUID) -> ConversationSession:
        async with self._store.lock_for(session_id):
            session = self._store.load(session_id)
            if session.phase in TERMINAL_PHASES and session.summary is not None:
                return session
            summary = await self._summarize_fn(session) or fallback_summary(session)
            updated = session.model_copy(update={"summary": summary, "updated_at": utc_now_iso()})
            self._store.save(updated)
            return updated

    async def synthesize_turn_audio(
        self,
        session_id: UUID,
        turn_id: str,
    ) -> tuple[bytes | None, str, str | None]:
        session = self._store.load(session_id)
        target = next((t for t in session.turns if t.turn_id == turn_id), None)
        if target is None:
            raise TurnNotFoundError(f"turn {turn_id!r} not found")

        t0 = perf_counter()
        audio, provider, degraded = await self._synthesize_fn(target.reply_text, target.language)
        tts_ms = round((perf_counter() - t0) * 1000, 1)
        _log_telemetry(
            {
                "event": "turn_audio",
                "session_ref": str(session_id)[:8],
                "turn_id": turn_id,
                "tts_ms": tts_ms,
                "provider": provider,
                "degraded": degraded,
            }
        )
        return audio, provider, degraded

    def _append_closed_turn(
        self,
        session: ConversationSession,
        *,
        user_text: str,
        client_turn_id: str,
        payload_sha256: str,
    ) -> ConversationSession:
        now = utc_now_iso()
        turn = ConversationTurn(
            turn_id=f"t{len(session.turns)}",
            client_turn_id=client_turn_id,
            payload_sha256=payload_sha256,
            created_at=now,
            user_text=user_text,
            reply_text=CLOSED_REPLIES[session.language],
            language=session.language,
        )
        updated = session.model_copy(update={"updated_at": now, "turns": [*session.turns, turn]})
        self._store.save(updated)
        return updated

    async def _run_turn_pipeline(
        self,
        session: ConversationSession,
        *,
        user_text: str,
        client_turn_id: str,
        payload_sha256: str,
        stt_ms: float | None,
    ) -> ConversationSession:
        if session.phase in TERMINAL_PHASES:
            return self._append_closed_turn(
                session,
                user_text=user_text,
                client_turn_id=client_turn_id,
                payload_sha256=payload_sha256,
            )

        t_rag = perf_counter()
        chunks = await self._rag.retrieve(user_text)
        rag_ms = round((perf_counter() - t_rag) * 1000, 1)

        prompt = build_prompt(session, user_text, chunks, self._orders)
        t_llm = perf_counter()
        parsed, in_tok, out_tok, err = await self._parse_turn_fn(prompt)
        llm_ms = round((perf_counter() - t_llm) * 1000, 1)

        metrics = TurnMetrics(
            stt_ms=stt_ms,
            rag_ms=rag_ms,
            llm_ms=llm_ms,
            input_tokens=in_tok,
            output_tokens=out_tok,
        )
        turn_id = f"t{len(session.turns)}"

        if parsed is None:
            now = utc_now_iso()
            error_turn = ConversationTurn(
                turn_id=turn_id,
                client_turn_id=client_turn_id,
                payload_sha256=payload_sha256,
                created_at=now,
                user_text=user_text,
                reply_text=RETRY_REPLIES[session.language],
                language=session.language,
                retrieved_chunks=chunks,
                metrics=metrics,
                error_note=err,
            )
            failed_session = session.model_copy(
                update={"updated_at": now, "turns": [*session.turns, error_turn]}
            )
            self._store.save(failed_session)
            _log_telemetry(
                {
                    "event": "turn_error",
                    "session_ref": str(session.session_id)[:8],
                    "turn_id": turn_id,
                    "phase": failed_session.phase.value,
                    "error": err,
                    "stt_ms": stt_ms,
                    "rag_ms": rag_ms,
                    "llm_ms": llm_ms,
                }
            )
            return failed_session

        updated = apply_turn(
            session,
            user_text,
            parsed,
            chunks,
            self._orders,
            turn_id=turn_id,
            client_turn_id=client_turn_id,
            payload_sha256=payload_sha256,
            metrics=metrics,
        )

        if updated.phase in TERMINAL_PHASES:
            summary = await self._summarize_fn(updated) or fallback_summary(updated)
            updated = updated.model_copy(update={"summary": summary, "updated_at": utc_now_iso()})

        self._store.save(updated)
        _log_telemetry(
            {
                "event": "turn_completed",
                "session_ref": str(updated.session_id)[:8],
                "turn_id": turn_id,
                "phase": updated.phase.value,
                "language": updated.language.value,
                "stt_ms": stt_ms,
                "rag_ms": rag_ms,
                "llm_ms": llm_ms,
                "tokens_in": in_tok,
                "tokens_out": out_tok,
            }
        )
        return updated

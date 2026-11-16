from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path
from uuid import uuid4

import httpx
from openai import APIConnectionError

from support_agent.api import create_app
from support_agent.domain import (
    ConversationSession,
    ConversationSummary,
    Language,
    LlmTurnOutput,
    ProblemCategory,
    UrgencyLevel,
    load_orders,
)
from support_agent.engine import ConversationEngine
from support_agent.rag import RagIndex, parse_kb_directory
from support_agent.store import JsonConversationStore

DATA_DIR = Path(__file__).resolve().parents[1] / "data"


class _StubBackend:
    def __init__(self) -> None:
        self.stt_calls = 0
        self.tts_calls = 0
        self.summary_calls = 0
        self.fail_stt = False
        self.empty_stt = False
        self.fail_llm = False
        self.degrade_tts = False
        self.next_llm = LlmTurnOutput(
            reply_text="Got it, tell me more.",
            kb_answer=None,
            language=Language.EN,
            order_number="ORD-48291",
            problem_category=ProblemCategory.DAMAGED_ITEM,
            problem_description="Espresso machine arrived cracked.",
            urgency_level=UrgencyLevel.HIGH,
            frustration_score=20,
            cited_kb_ids=[],
            customer_confirmed=False,
            customer_canceled=False,
            requests_human=False,
        )

    async def embed(self, texts: list[str]) -> list[list[float]]:
        return [[0.5, 0.5, 0.5] for _ in texts]

    async def parse_turn(self, _prompt: str) -> tuple[LlmTurnOutput | None, int, int, str | None]:
        if self.fail_llm:
            return None, 0, 0, "RateLimitError"
        return self.next_llm, 100, 30, None

    async def summarize(self, session: ConversationSession) -> ConversationSummary | None:
        self.summary_calls += 1
        return ConversationSummary(
            summary="Damaged espresso machine ticket submitted.",
            key_points=["Order ORD-48291", "Damaged item", "High urgency"],
            outcome=session.phase,
            escalation_reason=session.escalation_reason,
            generated_by="llm",
        )

    async def transcribe(self, _fname: str, _raw: bytes, _mime: str) -> str:
        self.stt_calls += 1
        if self.fail_stt:
            raise APIConnectionError(request=None)  # type: ignore[arg-type]
        if self.empty_stt:
            return "   "
        return "My order ORD-48291 arrived cracked, high urgency."

    async def synthesize(self, _text: str, _lang: Language) -> tuple[bytes | None, str, str | None]:
        self.tts_calls += 1
        if self.degrade_tts:
            return None, "browser_speech_synthesis", "elevenlabs_http_402"
        return b"ID3-mp3-audio", "eleven_v4_turbo", None


def _build_test_app(tmp_path: Path) -> tuple[httpx.AsyncBaseTransport, _StubBackend]:
    stub = _StubBackend()
    orders = load_orders(DATA_DIR / "orders.json")
    chunks = parse_kb_directory(DATA_DIR / "kb")
    rag = RagIndex(chunks, stub.embed)
    store = JsonConversationStore(tmp_path / "sessions")
    engine = ConversationEngine(
        store=store,
        rag=rag,
        orders=orders,
        parse_turn_fn=stub.parse_turn,
        summarize_fn=stub.summarize,
        transcribe_fn=stub.transcribe,
        synthesize_fn=stub.synthesize,
        tts_configured=True,
    )
    fastapi_app = create_app(engine, max_audio_bytes=4096)
    return httpx.ASGITransport(app=fastapi_app), stub


async def test_voice_idempotency_runs_stt_once_and_rejects_modified_audio(
    tmp_path: Path,
) -> None:
    transport, stub = _build_test_app(tmp_path)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        start = await client.post("/api/sessions", json={"language": "en"})
        assert start.status_code == 200
        sid = start.json()["session_id"]

        clip = b"webm-audio-payload-" * 30
        r1 = await client.post(
            f"/api/sessions/{sid}/voice",
            data={"client_turn_id": "turn-a"},
            files={"audio": ("blob", clip, "audio/webm;codecs=opus")},
        )
        assert r1.status_code == 200
        assert r1.json()["phase"] == "confirming"
        assert stub.stt_calls == 1

        r_retry = await client.post(
            f"/api/sessions/{sid}/voice",
            data={"client_turn_id": "turn-a"},
            files={"audio": ("blob", clip, "audio/webm;codecs=opus")},
        )
        assert r_retry.status_code == 200
        assert stub.stt_calls == 1
        assert len(r_retry.json()["turns"]) == 2

        r_conflict = await client.post(
            f"/api/sessions/{sid}/voice",
            data={"client_turn_id": "turn-a"},
            files={"audio": ("blob", clip + b"changed", "audio/webm;codecs=opus")},
        )
        assert r_conflict.status_code == 409


async def test_audio_endpoint_headers_and_degraded_204(tmp_path: Path) -> None:
    transport, stub = _build_test_app(tmp_path)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        sid = (await client.post("/api/sessions", json={"language": "ca"})).json()["session_id"]

        a1 = await client.get(f"/api/sessions/{sid}/turns/t0/audio")
        assert a1.status_code == 200
        assert a1.headers["content-type"] == "audio/mpeg"
        assert a1.headers["x-tts-provider"] == "eleven_v4_turbo"
        assert a1.headers["cache-control"] == "private, max-age=3600"
        assert stub.tts_calls == 1

        stub.degrade_tts = True
        await client.post(
            f"/api/sessions/{sid}/turn",
            json={"client_turn_id": "c1", "text": "My order ORD-48291 arrived broken"},
        )
        a_deg = await client.get(f"/api/sessions/{sid}/turns/t1/audio")
        assert a_deg.status_code == 204
        assert a_deg.headers["cache-control"] == "no-store"
        assert a_deg.headers["x-tts-degraded"] == "elevenlabs_http_402"


async def test_voice_upload_validation_and_stt_error_codes(tmp_path: Path) -> None:
    transport, stub = _build_test_app(tmp_path)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        assert (await client.get(f"/api/sessions/{uuid4()}")).status_code == 404
        sid = (await client.post("/api/sessions", json={"language": "en"})).json()["session_id"]

        r_415 = await client.post(
            f"/api/sessions/{sid}/voice",
            data={"client_turn_id": "v1"},
            files={"audio": ("x.txt", b"x" * 400, "text/plain")},
        )
        assert r_415.status_code == 415

        r_413_field = await client.post(
            f"/api/sessions/{sid}/voice",
            data={"client_turn_id": "v2"},
            files={"audio": ("x.webm", b"x" * 5000, "audio/webm")},
        )
        assert r_413_field.status_code == 413

        r_413_middleware = await client.post(
            f"/api/sessions/{sid}/voice",
            data={"client_turn_id": "v2b"},
            files={"audio": ("x.webm", b"x" * 80_000, "audio/webm")},
        )
        assert r_413_middleware.status_code == 413

        sent_chunks = 0

        async def streamed_voice_chunks() -> AsyncIterator[bytes]:
            nonlocal sent_chunks
            yield (
                b'--xyz\r\nContent-Disposition: form-data; name="audio"; filename="x.webm"\r\n'
                b"Content-Type: audio/webm\r\n\r\n"
            )
            for _ in range(30):
                sent_chunks += 1
                yield b"a" * 8192

        r_stream_voice = await client.post(
            f"/api/sessions/{sid}/voice",
            headers={"Content-Type": "multipart/form-data; boundary=xyz"},
            content=streamed_voice_chunks(),
        )
        assert r_stream_voice.status_code == 413
        assert sent_chunks < 20

        async def streamed_json_chunks() -> AsyncIterator[bytes]:
            for _ in range(20):
                yield b"x" * 8192

        r_stream_turn = await client.post(
            f"/api/sessions/{sid}/turn",
            headers={"Content-Type": "application/json"},
            content=streamed_json_chunks(),
        )
        assert r_stream_turn.status_code == 413

        r_short = await client.post(
            f"/api/sessions/{sid}/voice",
            data={"client_turn_id": "v3"},
            files={"audio": ("x.webm", b"tiny", "audio/webm")},
        )
        assert r_short.status_code == 422

        stub.fail_stt = True
        r_503 = await client.post(
            f"/api/sessions/{sid}/voice",
            data={"client_turn_id": "v4"},
            files={"audio": ("x.webm", b"x" * 400, "audio/webm")},
        )
        assert r_503.status_code == 503
        stub.fail_stt = False

        stub.empty_stt = True
        r_blank = await client.post(
            f"/api/sessions/{sid}/voice",
            data={"client_turn_id": "v5"},
            files={"audio": ("x.webm", b"x" * 400, "audio/webm")},
        )
        assert r_blank.status_code == 422


async def test_llm_recovery_early_finalize_refresh_and_closed_session(tmp_path: Path) -> None:
    transport, stub = _build_test_app(tmp_path)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        sid = (await client.post("/api/sessions", json={"language": "en"})).json()["session_id"]

        stub.fail_llm = True
        r_llm_err = await client.post(
            f"/api/sessions/{sid}/turn",
            json={"client_turn_id": "t_err", "text": "Hello support"},
        )
        assert r_llm_err.status_code == 200
        assert r_llm_err.json()["turns"][-1]["error_note"] == "RateLimitError"
        assert r_llm_err.json()["phase"] == "collecting"
        stub.fail_llm = False

        r_conf = await client.post(
            f"/api/sessions/{sid}/turn",
            json={"client_turn_id": "t_fill", "text": "Order ORD-48291 arrived cracked"},
        )
        assert r_conf.json()["phase"] == "confirming"

        r_early_fin = await client.post(f"/api/sessions/{sid}/finalize")
        assert r_early_fin.status_code == 200
        assert r_early_fin.json()["summary"]["outcome"] == "confirming"
        assert stub.summary_calls == 1

        stub.next_llm = stub.next_llm.model_copy(
            update={"order_number": None, "customer_confirmed": True}
        )
        r_done = await client.post(
            f"/api/sessions/{sid}/turn",
            json={"client_turn_id": "t_yes", "text": "Yes please submit"},
        )
        body_done = r_done.json()
        assert body_done["phase"] == "completed"
        assert body_done["summary"]["outcome"] == "completed"
        assert body_done["summary"]["generated_by"] == "llm"
        assert stub.summary_calls == 2

        r_after_close = await client.post(
            f"/api/sessions/{sid}/turn",
            json={"client_turn_id": "t_after", "text": "One more thing"},
        )
        assert "already closed" in r_after_close.json()["turns"][-1]["reply_text"]

        r_fin = await client.post(f"/api/sessions/{sid}/finalize")
        assert r_fin.status_code == 200
        assert r_fin.json()["summary"] == body_done["summary"]
        assert stub.summary_calls == 2

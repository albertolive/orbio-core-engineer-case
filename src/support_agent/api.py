from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated
from uuid import UUID

import httpx
from fastapi import FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from openai import AsyncOpenAI
from pydantic import BaseModel, ConfigDict, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from support_agent.domain import (
    SYSTEM_INSTRUCTIONS,
    ConversationSession,
    Language,
    load_orders,
)
from support_agent.engine import (
    ConversationEngine,
    EmptyTranscriptError,
    TurnNotFoundError,
    UpstreamSpeechError,
)
from support_agent.providers import (
    embed_texts,
    parse_turn,
    summarize_session,
    synthesize_speech,
    transcribe_audio,
)
from support_agent.rag import RagIndex, parse_kb_directory
from support_agent.store import (
    IdempotencyConflictError,
    JsonConversationStore,
    SessionNotFoundError,
)

STATIC_INDEX = Path(__file__).resolve().parent / "static" / "index.html"
DEFAULT_DATA_DIR = Path(__file__).resolve().parents[2] / "data"
DEFAULT_MAX_AUDIO_BYTES = 10 * 1024 * 1024
MULTIPART_OVERHEAD_BYTES = 65_536

ALLOWED_AUDIO_MIMES: dict[str, str] = {
    "audio/webm": ".webm",
    "audio/mp4": ".mp4",
    "audio/x-m4a": ".m4a",
    "audio/m4a": ".m4a",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/ogg": ".ogg",
    "audio/flac": ".flac",
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    openai_api_key: SecretStr
    openai_model: str = "gpt-5.6-luna"
    elevenlabs_api_key: SecretStr | None = None
    elevenlabs_voice_id: str = "cjVigY5qzO86Huf0OWal"
    max_audio_bytes: int = DEFAULT_MAX_AUDIO_BYTES
    data_dir: Path = DEFAULT_DATA_DIR


class CreateSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    language: Language = Language.EN


class TextTurnRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_turn_id: str = Field(min_length=1, max_length=128)
    text: str = Field(min_length=1, max_length=4000)


class _RequestBodyLimitMiddleware:
    def __init__(self, app: ASGIApp, state_holder: FastAPI) -> None:
        self._app = app
        self._state_holder = state_holder

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("method") != "POST":
            await self._app(scope, receive, send)
            return

        is_voice = str(scope.get("path", "")).endswith("/voice")
        limit = (
            int(getattr(self._state_holder.state, "max_audio_bytes", DEFAULT_MAX_AUDIO_BYTES))
            + MULTIPART_OVERHEAD_BYTES
            if is_voice
            else MULTIPART_OVERHEAD_BYTES
        )
        for raw_name, raw_val in scope.get("headers", ()):
            if raw_name == b"content-length":
                text_val = raw_val.decode("latin-1").strip()
                if text_val.isdigit() and int(text_val) > limit:
                    resp = JSONResponse(
                        status_code=413,
                        content={"detail": "Request body exceeds maximum byte size"},
                    )
                    await resp(scope, receive, send)
                    return

        seen = 0

        async def limited_receive() -> Message:
            nonlocal seen
            msg = await receive()
            if msg["type"] == "http.request":
                seen += len(msg.get("body", b""))
                if seen > limit:
                    raise HTTPException(
                        status_code=413,
                        detail="Request body exceeds maximum byte size",
                    )
            return msg

        await self._app(scope, limited_receive, send)


def _get_engine(request: Request) -> ConversationEngine:
    engine: ConversationEngine | None = getattr(request.app.state, "engine", None)
    if engine is None:
        raise HTTPException(status_code=503, detail="Engine is not initialized")
    return engine


async def build_live_engine(
    settings: Settings,
    oa_client: AsyncOpenAI,
    http_client: httpx.AsyncClient,
    *,
    sessions_dir: Path | None = None,
) -> ConversationEngine:
    el_key = (
        settings.elevenlabs_api_key.get_secret_value().strip()
        if settings.elevenlabs_api_key is not None
        else None
    ) or None
    orders = load_orders(settings.data_dir / "orders.json")
    chunks = parse_kb_directory(settings.data_dir / "kb")
    rag = RagIndex(chunks, lambda texts: embed_texts(oa_client, texts))
    await rag.warm()
    store = JsonConversationStore(sessions_dir or (settings.data_dir / "sessions"))
    return ConversationEngine(
        store=store,
        rag=rag,
        orders=orders,
        parse_turn_fn=lambda prompt: parse_turn(
            oa_client,
            model=settings.openai_model,
            instructions=SYSTEM_INSTRUCTIONS,
            prompt=prompt,
        ),
        summarize_fn=lambda sess: summarize_session(
            oa_client,
            model=settings.openai_model,
            session=sess,
        ),
        transcribe_fn=lambda fname, raw, mime: transcribe_audio(
            oa_client,
            filename=fname,
            audio_bytes=raw,
            mime_type=mime,
        ),
        synthesize_fn=lambda text, lang: synthesize_speech(
            http_client,
            api_key=el_key,
            voice_id=settings.elevenlabs_voice_id,
            text=text,
            language=lang,
        ),
        tts_configured=el_key is not None,
    )


def create_app(
    engine: ConversationEngine | None = None,
    *,
    max_audio_bytes: int = DEFAULT_MAX_AUDIO_BYTES,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        logging.basicConfig(level=logging.INFO, format="%(message)s")
        if engine is not None:
            yield
            return

        settings = Settings()
        oa_key = settings.openai_api_key.get_secret_value()
        if not oa_key.strip():
            raise RuntimeError("OPENAI_API_KEY is required")

        oa_client = AsyncOpenAI(api_key=oa_key, max_retries=1, timeout=15.0)
        http_client = httpx.AsyncClient(timeout=12.0)
        app.state.max_audio_bytes = settings.max_audio_bytes
        app.state.engine = await build_live_engine(settings, oa_client, http_client)
        try:
            yield
        finally:
            await http_client.aclose()
            await oa_client.close()

    app = FastAPI(title="NovaMart Support Agent", lifespan=lifespan)
    app.state.engine = engine
    app.state.max_audio_bytes = max_audio_bytes
    app.add_middleware(_RequestBodyLimitMiddleware, state_holder=app)

    def _register_error(exc_type: type[Exception], status_code: int) -> None:
        async def _handler(_req: Request, exc: Exception) -> JSONResponse:
            return JSONResponse(status_code=status_code, content={"detail": str(exc)})

        app.add_exception_handler(exc_type, _handler)

    _register_error(SessionNotFoundError, 404)
    _register_error(TurnNotFoundError, 404)
    _register_error(IdempotencyConflictError, 409)
    _register_error(EmptyTranscriptError, 422)
    _register_error(UpstreamSpeechError, 503)

    @app.get("/", include_in_schema=False)
    async def index() -> FileResponse:
        if not STATIC_INDEX.is_file():
            raise HTTPException(status_code=404, detail="UI bundle missing")
        return FileResponse(STATIC_INDEX, media_type="text/html")

    from fastapi.staticfiles import StaticFiles

    app.mount("/assets", StaticFiles(directory=STATIC_INDEX.parent / "assets", check_dir=False))

    @app.get("/api/health")
    async def health(request: Request) -> dict[str, object]:
        eng = _get_engine(request)
        return {
            "status": "ok",
            "tts_provider": "eleven_v4_turbo" if eng.tts_configured else "browser_speech_synthesis",
        }

    @app.post("/api/sessions")
    async def start_session(
        body: CreateSessionRequest,
        request: Request,
    ) -> ConversationSession:
        return _get_engine(request).start_session(body.language)

    @app.get("/api/sessions/{session_id}")
    async def get_session(session_id: UUID, request: Request) -> ConversationSession:
        return _get_engine(request).get_session(session_id)

    @app.post("/api/sessions/{session_id}/turn")
    async def post_text_turn(
        session_id: UUID,
        body: TextTurnRequest,
        request: Request,
    ) -> ConversationSession:
        return await _get_engine(request).handle_text(
            session_id,
            client_turn_id=body.client_turn_id,
            text=body.text,
        )

    @app.post("/api/sessions/{session_id}/voice")
    async def post_voice_turn(
        session_id: UUID,
        request: Request,
        client_turn_id: Annotated[str, Form(min_length=1, max_length=128)],
        audio: Annotated[UploadFile, File()],
    ) -> ConversationSession:
        limit: int = request.app.state.max_audio_bytes
        base_mime = (audio.content_type or "").split(";")[0].strip().lower()
        ext = ALLOWED_AUDIO_MIMES.get(base_mime)
        if ext is None:
            raise HTTPException(
                status_code=415,
                detail=f"Unsupported audio MIME type: {base_mime or 'unknown'}",
            )

        raw = await audio.read(limit + 1)
        if len(raw) > limit:
            raise HTTPException(status_code=413, detail="Audio upload exceeds maximum byte size")

        return await _get_engine(request).handle_voice(
            session_id,
            client_turn_id=client_turn_id,
            filename=f"turn{ext}",
            audio_bytes=raw,
            mime_type=base_mime,
        )

    @app.post("/api/sessions/{session_id}/finalize")
    async def finalize_session(session_id: UUID, request: Request) -> ConversationSession:
        return await _get_engine(request).finalize_session(session_id)

    @app.get("/api/sessions/{session_id}/turns/{turn_id}/audio")
    async def get_turn_audio(
        session_id: UUID,
        turn_id: str,
        request: Request,
    ) -> Response:
        audio_bytes, provider, degraded = await _get_engine(request).synthesize_turn_audio(
            session_id, turn_id
        )
        if audio_bytes is None:
            return Response(
                status_code=204,
                headers={
                    "Cache-Control": "no-store",
                    "X-TTS-Provider": provider,
                    "X-TTS-Degraded": degraded or "unavailable",
                },
            )
        return Response(
            content=audio_bytes,
            media_type="audio/mpeg",
            headers={
                "Cache-Control": "private, max-age=3600",
                "X-TTS-Provider": provider,
            },
        )

    return app


app = create_app()

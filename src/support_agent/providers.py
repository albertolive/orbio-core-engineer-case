from __future__ import annotations

import logging

import httpx
from openai import AsyncOpenAI, OpenAIError
from pydantic import ValidationError

from support_agent.domain import (
    ConversationSession,
    ConversationSummary,
    Language,
    LlmSummaryOutput,
    LlmTurnOutput,
)

logger = logging.getLogger(__name__)

ELEVENLABS_DIALOGUE_URL = "https://api.elevenlabs.io/v1/text-to-dialogue/stream"


async def parse_turn(
    client: AsyncOpenAI,
    *,
    model: str,
    instructions: str,
    prompt: str,
) -> tuple[LlmTurnOutput | None, int, int, str | None]:
    try:
        response = await client.responses.parse(
            model=model,
            instructions=instructions,
            input=prompt,
            store=False,
            reasoning={"effort": "none"},
            text_format=LlmTurnOutput,
        )
    except (OpenAIError, ValidationError) as exc:
        logger.warning("OpenAI parse_turn failed (%s)", exc.__class__.__name__)
        return None, 0, 0, exc.__class__.__name__

    in_tokens = response.usage.input_tokens if response.usage else 0
    out_tokens = response.usage.output_tokens if response.usage else 0
    if response.output_parsed is None:
        return None, in_tokens, out_tokens, "refusal_or_incomplete"
    return response.output_parsed, in_tokens, out_tokens, None


SUMMARY_INSTRUCTIONS = (
    "Summarize this customer support intake conversation concisely in English. "
    "Include a 1-2 sentence summary and 3-5 concrete key points covering the order, "
    "issue, urgency, policy guidance given, and outcome."
)


async def summarize_session(
    client: AsyncOpenAI,
    *,
    model: str,
    session: ConversationSession,
) -> ConversationSummary | None:
    lines = [f"Outcome: {session.phase.value}", f"Draft: {session.draft.model_dump_json()}"]
    if session.validated_ticket is not None:
        lines.append(f"Ticket: {session.validated_ticket.model_dump_json()}")
    if session.escalation_reason is not None:
        lines.append(f"Escalation: {session.escalation_reason.value}")
    for turn in session.turns:
        if turn.user_text is not None:
            lines.append(f"Customer: {turn.user_text}")
        lines.append(f"Agent: {turn.reply_text}")

    try:
        response = await client.responses.parse(
            model=model,
            instructions=SUMMARY_INSTRUCTIONS,
            input="\n".join(lines),
            store=False,
            reasoning={"effort": "none"},
            text_format=LlmSummaryOutput,
        )
    except (OpenAIError, ValidationError) as exc:
        logger.warning("OpenAI summarize_session failed (%s)", exc.__class__.__name__)
        return None

    parsed = response.output_parsed
    if parsed is None or not parsed.summary.strip():
        return None
    return ConversationSummary(
        summary=parsed.summary.strip(),
        key_points=[pt.strip() for pt in parsed.key_points if pt.strip()],
        outcome=session.phase,
        escalation_reason=session.escalation_reason,
        generated_by="llm",
    )


async def embed_texts(
    client: AsyncOpenAI,
    texts: list[str],
    *,
    model: str = "text-embedding-3-small",
) -> list[list[float]]:
    response = await client.embeddings.create(model=model, input=texts)
    return [item.embedding for item in response.data]


async def transcribe_audio(
    client: AsyncOpenAI,
    *,
    filename: str,
    audio_bytes: bytes,
    mime_type: str,
) -> str:
    response = await client.audio.transcriptions.create(
        model="gpt-transcribe",
        file=(filename, audio_bytes, mime_type),
        languages=["en", "es", "ca"],
        keywords=["ORD-", "NovaMart"],
    )
    return response.text.strip()


async def synthesize_speech(
    http_client: httpx.AsyncClient,
    *,
    api_key: str | None,
    voice_id: str,
    text: str,
    language: Language,
) -> tuple[bytes | None, str, str | None]:
    if not api_key:
        return None, "browser_speech_synthesis", "elevenlabs_key_unset"
    try:
        response = await http_client.post(
            ELEVENLABS_DIALOGUE_URL,
            params={"output_format": "mp3_44100_128"},
            headers={"xi-api-key": api_key, "Content-Type": "application/json"},
            json={
                "inputs": [{"text": text, "voice_id": voice_id}],
                "model_id": "eleven_v4_turbo",
                "language_code": language.value,
            },
        )
    except httpx.HTTPError as exc:
        logger.warning("ElevenLabs request failed (%s)", exc.__class__.__name__)
        return None, "browser_speech_synthesis", exc.__class__.__name__

    if response.status_code != 200 or not response.content:
        logger.warning("ElevenLabs returned HTTP %s", response.status_code)
        return None, "browser_speech_synthesis", f"elevenlabs_http_{response.status_code}"

    return response.content, "eleven_v4_turbo", None

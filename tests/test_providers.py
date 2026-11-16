from __future__ import annotations

import json

import httpx
import httpx2
from openai import AsyncOpenAI

from support_agent.domain import Language
from support_agent.providers import (
    ELEVENLABS_DIALOGUE_URL,
    parse_turn,
    synthesize_speech,
    transcribe_audio,
)


async def test_parse_turn_sends_store_false_and_reasoning_none() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx2.Request) -> httpx2.Response:
        captured["body"] = json.loads(request.content.decode("utf-8"))
        out_json = json.dumps(
            {
                "reply_text": "What happened with order ORD-48291?",
                "kb_answer": None,
                "language": "en",
                "order_number": "ORD-48291",
                "problem_category": None,
                "problem_description": None,
                "urgency_level": None,
                "frustration_score": 10,
                "cited_kb_ids": [],
                "customer_confirmed": False,
                "customer_canceled": False,
                "requests_human": False,
            }
        )
        return httpx2.Response(
            200,
            json={
                "id": "resp_1",
                "object": "response",
                "created_at": 1700000000,
                "model": "gpt-5.6-luna",
                "status": "completed",
                "output": [
                    {
                        "id": "msg_1",
                        "type": "message",
                        "role": "assistant",
                        "status": "completed",
                        "content": [{"type": "output_text", "text": out_json, "annotations": []}],
                    }
                ],
                "usage": {
                    "input_tokens": 120,
                    "input_tokens_details": {"cached_tokens": 0},
                    "output_tokens": 45,
                    "output_tokens_details": {"reasoning_tokens": 0},
                    "total_tokens": 165,
                },
            },
        )

    http_client = httpx2.AsyncClient(transport=httpx2.MockTransport(handler))
    client = AsyncOpenAI(api_key="test-key", max_retries=0, http_client=http_client)
    parsed, in_tok, out_tok, err = await parse_turn(
        client,
        model="gpt-5.6-luna",
        instructions="sys",
        prompt="hello",
    )
    await client.close()

    assert err is None
    assert parsed is not None
    assert parsed.order_number == "ORD-48291"
    assert in_tok == 120
    assert out_tok == 45
    body = captured["body"]
    assert isinstance(body, dict)
    assert body["store"] is False
    assert body["reasoning"] == {"effort": "none"}


async def test_parse_turn_handles_refusal_and_api_errors() -> None:
    def refusal_handler(_request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(
            200,
            json={
                "id": "resp_refuse",
                "object": "response",
                "created_at": 1700000000,
                "model": "gpt-5.6-luna",
                "status": "completed",
                "output": [
                    {
                        "id": "msg_1",
                        "type": "message",
                        "role": "assistant",
                        "status": "completed",
                        "content": [{"type": "refusal", "refusal": "Cannot comply"}],
                    }
                ],
            },
        )

    client = AsyncOpenAI(
        api_key="test-key",
        max_retries=0,
        http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(refusal_handler)),
    )
    parsed, _, _, err = await parse_turn(
        client, model="gpt-5.6-luna", instructions="sys", prompt="hi"
    )
    await client.close()
    assert parsed is None
    assert err == "refusal_or_incomplete"

    def truncated_json_handler(_request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(
            200,
            json={
                "id": "resp_trunc",
                "object": "response",
                "created_at": 1700000000,
                "model": "gpt-5.6-luna",
                "status": "completed",
                "output": [
                    {
                        "id": "msg_1",
                        "type": "message",
                        "role": "assistant",
                        "status": "completed",
                        "content": [
                            {
                                "type": "output_text",
                                "text": '{"reply_text": "oops',
                                "annotations": [],
                            }
                        ],
                    }
                ],
            },
        )

    trunc_client = AsyncOpenAI(
        api_key="test-key",
        max_retries=0,
        http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(truncated_json_handler)),
    )
    parsed_trunc, _, _, err_trunc = await parse_turn(
        trunc_client, model="gpt-5.6-luna", instructions="sys", prompt="hi"
    )
    await trunc_client.close()
    assert parsed_trunc is None
    assert err_trunc == "ValidationError"


async def test_transcribe_audio_forwards_filename_and_languages() -> None:
    raw_content = b""

    def stt_handler(request: httpx2.Request) -> httpx2.Response:
        nonlocal raw_content
        raw_content = request.content
        return httpx2.Response(200, json={"text": "Order ORD-48291 is damaged"})

    client = AsyncOpenAI(
        api_key="test-key",
        max_retries=0,
        http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(stt_handler)),
    )
    transcript = await transcribe_audio(
        client,
        filename="turn.webm",
        audio_bytes=b"fake-webm-bytes" * 30,
        mime_type="audio/webm",
    )
    await client.close()

    assert transcript == "Order ORD-48291 is damaged"
    assert b'filename="turn.webm"' in raw_content
    assert b"gpt-transcribe" in raw_content
    for lang_code in (b"\r\n\r\nen\r\n", b"\r\n\r\nes\r\n", b"\r\n\r\nca\r\n"):
        assert lang_code in raw_content


async def test_synthesize_speech_uses_dialogue_endpoint_and_degrades_on_402() -> None:
    seen_url = ""
    seen_json: dict[str, object] = {}

    def ok_handler(request: httpx.Request) -> httpx.Response:
        nonlocal seen_url, seen_json
        seen_url = str(request.url)
        seen_json = json.loads(request.content.decode("utf-8"))
        return httpx.Response(200, content=b"ID3-mp3-bytes")

    async with httpx.AsyncClient(transport=httpx.MockTransport(ok_handler)) as hc:
        audio, provider, reason = await synthesize_speech(
            hc,
            api_key="el-key",
            voice_id="voice-1",
            text="Hola, com et puc ajudar?",
            language=Language.CA,
        )
    assert audio == b"ID3-mp3-bytes"
    assert provider == "eleven_v4_turbo"
    assert reason is None
    assert seen_url.startswith(ELEVENLABS_DIALOGUE_URL)
    assert seen_json == {
        "inputs": [{"text": "Hola, com et puc ajudar?", "voice_id": "voice-1"}],
        "model_id": "eleven_v4_turbo",
        "language_code": "ca",
    }

    def quota_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(402, json={"detail": "quota_exceeded"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(quota_handler)) as hc:
        audio2, provider2, reason2 = await synthesize_speech(
            hc,
            api_key="el-key",
            voice_id="voice-1",
            text="Hello",
            language=Language.EN,
        )
    assert audio2 is None
    assert provider2 == "browser_speech_synthesis"
    assert reason2 == "elevenlabs_http_402"

    async with httpx.AsyncClient(transport=httpx.MockTransport(ok_handler)) as hc:
        audio3, provider3, reason3 = await synthesize_speech(
            hc,
            api_key=None,
            voice_id="voice-1",
            text="Hello",
            language=Language.EN,
        )
    assert audio3 is None
    assert provider3 == "browser_speech_synthesis"
    assert reason3 == "elevenlabs_key_unset"

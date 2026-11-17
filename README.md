# NovaMart Conversational Support Agent

Conversational voice and text intake agent for **NovaMart**, a fictional e-commerce store. It interviews customers to collect and validate support ticket fields, answers policy questions from a local markdown knowledge base, tracks frustration, saves structured JSON sessions atomically, and generates an end-of-call summary.

Built with Python 3.12, FastAPI, Pydantic v2, OpenAI (`gpt-5.6-luna`, `text-embedding-3-small`, `gpt-transcribe`), and ElevenLabs (`eleven_v4_turbo`).

## Demo video

- **Walkthrough video:** `TODO: paste Loom or screen-recording URL before sending`
- **Sample persisted output:** [`examples/sample_completed_session.json`](examples/sample_completed_session.json)

## Capabilities

- **Structured slot collection and validation.** Collects `order_number`, `problem_category`, `problem_description`, and `urgency_level`. Spoken order codes in English, Spanish, or Catalan normalize to `ORD-48291` and check against [`data/orders.json`](data/orders.json).
- **Two-step confirmation and cancellation.** Once all four fields validate, the agent reads back the normalized ticket in `confirming` phase. It creates a `ValidatedTicket` only after explicit confirmation, re-confirms if the customer edits a detail, and closes cleanly on cancellation.
- **Multi-turn context memory.** `build_prompt` passes the last 10 turns, the accumulated `TicketDraft`, missing-slot list, and matched catalog item on every turn so customers can supply details across several messages.
- **Knowledge base RAG.** Splits [`data/kb/*.md`](data/kb/) by heading, embeds all sections in one batch call, and ranks top matches by cosine similarity (`>= 0.40`) across English, Spanish, and Catalan questions.
- **Frustration guardrails.** Scores frustration (`0` to `100`) per turn and escalates in Python when the customer asks for a person, hits `>= 70` frustration, stays `>= 60` for two turns, or gives three invalid order numbers.
- **Multilingual voice and text.** Supports English (`en`), Spanish (`es`), and Catalan (`ca`) with sticky language switching so short replies such as `"Sí"` do not flip the active language.
- **Atomic JSON storage and summary.** Saves every turn atomically under `data/sessions/<session_id>.json` and attaches an LLM `ConversationSummary` with a deterministic Python fallback.

## Model and provider choices

- **Turn parsing and summaries (`gpt-5.6-luna` through `responses.parse` with `reasoning={"effort": "none"}`).** Intake turns need strict JSON schema adherence and fast time-to-complete rather than multi-step reasoning chains. In [`examples/sample_completed_session.json`](examples/sample_completed_session.json), structured turns complete in `1.85` to `2.49 s`, while terminal summary generation adds roughly `2` to `3 s` on the closing turn only.
- **Knowledge base embeddings (`text-embedding-3-small`).** Embeds the 13 policy sections in one startup request and scores cross-lingual EN/ES/CA queries in `~225 ms` without a vector database service.
- **Speech-to-text (`gpt-transcribe`).** Uses OpenAI's current non-deprecated transcription model with `languages=["en", "es", "ca"]` and domain `keywords=["ORD-", "NovaMart"]` on the same `OPENAI_API_KEY`.
- **Text-to-speech (`eleven_v4_turbo` on `/v1/text-to-dialogue/stream`).** Produces natural English, Spanish, and Catalan speech (`~1.4 s` per short reply). When `ELEVENLABS_API_KEY` is unset or degraded, the audio endpoint returns HTTP `204` and the UI falls back to browser `speechSynthesis` with a visible status badge.

## Quick start

### Prerequisites

- Python 3.12+ and [`uv`](https://docs.astral.sh/uv/)
- `OPENAI_API_KEY` (required for structured turns, RAG embeddings, and `gpt-transcribe` STT)
- `ELEVENLABS_API_KEY` (optional; enables `eleven_v4_turbo` TTS)

### Install and run

```bash
uv sync
cp .env.example .env
# Set OPENAI_API_KEY (and optional ELEVENLABS_API_KEY) in .env

uv run uvicorn support_agent.api:app --reload --port 8000
```

Open `http://127.0.0.1:8000` in Chrome. The left panel is the conversation with Nova. Hold `Space` or click the microphone button to speak, or type in the message box. The right panel is the specialist console. It shows the ticket draft, the handoff and summary, the frustration score, the retrieved RAG sources with their cosine scores, turn latencies, and the persisted JSON payload. The built UI is committed in `src/support_agent/static/`, so running the app needs no Node.

### Run checks and tests

```bash
# Offline unit, API, and scripted scenario suite (zero API keys needed)
uv run pytest

# Live prompt and EN/ES/CA RAG regression evals against OpenAI
uv run pytest -m live

# Lint and strict type check
uv run ruff check .
uv run mypy src tests
```

Changing the UI needs Node 22.13 or newer. The build writes into `src/support_agent/static/`, so commit that folder with the source.

```bash
cd frontend
npm install
npm run build   # tsc --noEmit, then vite build
npm test        # Vitest, offline
npm run lint
```

## System architecture

```text
Browser UI (React: MediaRecorder + WebAudio + Blob audio cache + specialist console)
   │
   ├── POST /api/sessions/{id}/voice ──► ASGI byte-limit + MIME guard ──► gpt-transcribe (STT)
   ├── POST /api/sessions/{id}/turn  ───────────────────────────────────┐      │
   │                                                                    ▼      ▼
   │                                                          ConversationEngine (engine.py)
   │                                                            1. Per-session lock + SHA-256 idempotency
   │                                                            2. RagIndex.retrieve() cosine top-3 (rag.py)
   │                                                            3. build_prompt() + parse_turn() (providers.py)
   │                                                            4. Pure apply_turn() reducer (domain.py)
   │                                                            5. Terminal summary + atomic JSON save (store.py)
   │
   └── GET /api/sessions/{id}/turns/{turn_id}/audio ──► ElevenLabs eleven_v4_turbo (or 204 fallback)
```

### Module layout

| File | Responsibility |
|---|---|
| `src/support_agent/domain.py` | Pydantic v2 models, `Phase` state machine, spoken order normalization, `build_prompt`, pure `apply_turn` reducer, localized EN/ES/CA templates, and fallback summary. |
| `src/support_agent/store.py` | Per-session `asyncio.Lock` table, `client_turn_id` payload-hash idempotency check, and same-directory `mkstemp` + `fsync` + `os.replace` JSON persistence. |
| `src/support_agent/rag.py` | Markdown `##` section splitter, lazy-resilient batch embedding index, short non-question skip, and stdlib `math` cosine ranking. |
| `src/support_agent/providers.py` | Plain async functions calling OpenAI Responses (`store=False`, `reasoning={"effort": "none"}`), `text-embedding-3-small`, `gpt-transcribe`, and ElevenLabs `/v1/text-to-dialogue/stream`. |
| `src/support_agent/engine.py` | Orchestrates voice and text turns, error recovery, terminal summarization, and structured JSON turn logs. |
| `src/support_agent/api.py` | `Settings` validation, ASGI upload-size limit middleware, FastAPI `lifespan`, exception handlers (`404`, `409`, `413`, `415`, `422`, `503`), and static UI serving. |
| `frontend/` | Vite, React, TypeScript, Tailwind v4 and shadcn/ui source for the browser UI. `npm run build` writes the bundle into `src/support_agent/static/`. Design notes are in [`frontend/DESIGN.md`](frontend/DESIGN.md). |

## Key design decisions

- **Python owns state transitions and safety replies.** One `responses.parse` call per turn extracts candidate slots, `kb_answer`, `frustration_score`, and conversational `reply_text`. `apply_turn` then validates fields in Python and renders localized templates whenever a slot fails validation or the session enters `confirming`, `completed`, `canceled`, or `escalated`.
- **Separate `kb_answer` keeps policy answers grounded.** Policy facts are allowed only in `kb_answer` with retrieved `chunk_id` citations. `apply_turn` drops uncited claims, strips trailing questions, and prepends `kb_answer` to the state reply so policy answers survive transitions into `confirming`.
- **Pre-STT byte-hash idempotency.** Voice turns enforce an ASGI streaming byte cap before multipart disk spooling and hash raw audio bytes under the session lock before calling `gpt-transcribe`. Network retries replay the saved session without paying for STT twice.
- **Decoupled `GET .../audio` synthesis.** Serving TTS on a separate GET route returns the updated JSON state without waiting on ElevenLabs synthesis and avoids lost-update races on the session file. The browser deduplicates concurrent fetches into a session-scoped `Blob` URL map (`Cache-Control: private, max-age=3600`), so replays stay local without issuing extra HTTP requests.
- **Non-identifying catalog and `store=False` on Responses.** [`data/orders.json`](data/orders.json) contains only item summaries and shipping states, uses one uniform error message for malformed or unknown codes, and sets `store=False` on OpenAI Responses calls so prompt and turn outputs are not stored in OpenAI response logs.
- **One command at review time.** The React build is committed under `src/support_agent/static/`. `api.py` serves `index.html` at `/` and the hashed bundle at `/assets` with one `StaticFiles` mount, so `uv run uvicorn` stays the only command and reviewers run no Node.
- **The browser never shows a stale answer.** Each response checks that its `session_id` is still the open session before it touches the screen. The audio cache is keyed by session and turn, and a retry after a network failure reuses the same `client_turn_id`.

## Production improvements

1. **Full-duplex telephony and barge-in.** Push-to-talk HTTP keeps local evaluation simple with one command and one API key. For phone lines and sub-second interruptions, attach a WebRTC or SIP worker (LiveKit Agents with Silero VAD and turn detection) calling `engine.handle_text` while keeping `domain.py` unchanged.
2. **Multi-worker persistence without long row locks.** Replace `JsonConversationStore` and its single-process `asyncio.Lock` map with PostgreSQL. Reserve `(session_id, client_turn_id)` with a unique index before calling OpenAI, commit state updates with an optimistic `version` check so database connections are never held open during LLM calls, and move end-of-call summarization to a background job.
3. **Transactional outbox for downstream tickets.** Write the `ValidatedTicket` and an outbox row in the same database transaction, then dispatch CRM creation (Zendesk, Salesforce, or webhook sync) from background workers with idempotency keys and dead-letter queues.
4. **Caller verification before order disclosure.** Production order lookups that expose personal data should verify caller identity first (such as an authenticated session token or SMS one-time code) instead of accepting an order number alone.
5. **Observability and CI eval gates.** Ship the per-turn JSON logs (`stt_ms`, `rag_ms`, `llm_ms`, `tts_ms`, token counts, escalation rate) to OpenTelemetry, Sentry, and Langfuse, alert on `p95` latency or TTS fallback spikes, and run `pytest -m live` on prompt or model pull requests.


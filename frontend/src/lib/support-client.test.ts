import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SupportClient } from "@/lib/support-client"
import type { ConversationSession, ConversationTurn } from "@/lib/types"

const turn = (over: Partial<ConversationTurn> = {}): ConversationTurn => ({
  turn_id: "t0",
  client_turn_id: null,
  created_at: "",
  user_text: null,
  reply_text: "Hi, welcome to NovaMart support.",
  language: "en",
  frustration_score: null,
  cited_kb_ids: [],
  retrieved_chunks: [],
  metrics: {
    stt_ms: null,
    rag_ms: 0,
    llm_ms: 0,
    input_tokens: 0,
    output_tokens: 0,
  },
  error_note: null,
  ...over,
})

const session = (
  id: string,
  over: Partial<ConversationSession> = {}
): ConversationSession => ({
  session_id: id,
  created_at: "",
  updated_at: "",
  phase: "collecting",
  language: "en",
  draft: {
    order_number: null,
    problem_category: null,
    urgency_level: null,
    problem_description: null,
    field_errors: {},
  },
  validated_ticket: null,
  escalation_reason: null,
  invalid_order_attempts: 0,
  summary: null,
  turns: [turn()],
  ...over,
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })

type Handler = () => Response | Promise<Response>

const fetchMock = vi.fn<typeof fetch>()
let handlers: Record<string, Handler[]> = {}

// Responses are queued per "METHOD /url"; an unmocked call fails the test loudly.
function mockApi(next: Record<string, Handler[]>) {
  handlers = next
  fetchMock.mockImplementation(async (input, init) => {
    const key = `${init?.method ?? "GET"} ${String(input)}`
    const handler = handlers[key]?.shift()
    if (!handler) throw new Error(`unmocked request: ${key}`)
    return handler()
  })
}

// client_turn_ids sent to POST /turn, in order.
const turnIds = () =>
  fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith("/turn"))
    .map(
      ([, init]) =>
        (JSON.parse(String(init?.body)) as { client_turn_id: string })
          .client_turn_id
    )

class FakeAudio {
  src: string
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  duration = 3
  currentTime = 0
  constructor(src: string) {
    this.src = src
  }
  play = vi.fn(() => Promise.resolve())
  pause = vi.fn()
}

class FakeUtterance {
  text: string
  lang = ""
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(text: string) {
    this.text = text
  }
}

const speech = { cancel: vi.fn(), speak: vi.fn() }

async function startedClient(
  sid = "s1",
  over: Partial<ConversationSession> = {}
) {
  const client = new SupportClient()
  mockApi({ "POST /api/sessions": [() => json(session(sid, over))] })
  await client.newSession()
  return client
}

beforeEach(() => {
  fetchMock.mockReset()
  speech.cancel.mockReset()
  speech.speak.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  vi.stubGlobal("Audio", FakeAudio)
  vi.stubGlobal("speechSynthesis", speech)
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance)
  let n = 0
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:test/${++n}`)
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("text turns", () => {
  it("reuses client_turn_id when retrying a network-failed turn, then rotates it", async () => {
    const client = await startedClient()
    const reply = session("s1", {
      turns: [turn(), turn({ turn_id: "t1", user_text: "hello" })],
    })
    mockApi({
      "POST /api/sessions/s1/turn": [
        () => Promise.reject(new TypeError("network down")),
        () => json(reply),
        () => json(reply),
      ],
    })

    expect(await client.sendText("hello")).toBe(false)
    expect(client.getSnapshot().banner?.text).toMatch(/retry safely/)
    expect(await client.sendText("hello")).toBe(true)
    expect(await client.sendText("hello")).toBe(true)

    const [failed, retried, next] = turnIds()
    expect(failed).toEqual(expect.any(String))
    expect(retried).toBe(failed)
    expect(next).not.toBe(failed)
  })

  it("uses a fresh client_turn_id when the retried text differs", async () => {
    const client = await startedClient()
    mockApi({
      "POST /api/sessions/s1/turn": [
        () => Promise.reject(new TypeError("network down")),
        () => Promise.reject(new TypeError("network down")),
      ],
    })
    await client.sendText("first")
    await client.sendText("second")
    const [first, second] = turnIds()
    expect(first).toEqual(expect.any(String))
    expect(second).toEqual(expect.any(String))
    expect(second).not.toBe(first)
  })

  it("ignores a reply that arrives after the session changed", async () => {
    const client = await startedClient("s1")
    let release!: (res: Response) => void
    const pending = new Promise<Response>((resolve) => (release = resolve))
    mockApi({
      "POST /api/sessions/s1/turn": [() => pending],
      "POST /api/sessions": [() => json(session("s2"))],
    })

    const inFlight = client.sendText("hello")
    await client.newSession()
    release(
      json(
        session("s1", {
          turns: [turn(), turn({ turn_id: "t1", user_text: "hello" })],
        })
      )
    )

    expect(await inFlight).toBe(false)
    const state = client.getSnapshot()
    expect(state.session?.session_id).toBe("s2")
    expect(state.busy).toBeNull()
    expect(state.banner).toBeNull()
  })

  it("formats string and array FastAPI details", async () => {
    const client = await startedClient()
    mockApi({
      "POST /api/sessions/s1/turn": [
        () => json({ detail: "Order not found" }, 404),
        () => json({ detail: [{ msg: "too long" }, { loc: ["body"] }] }, 422),
        () => json({}, 500),
      ],
    })
    await client.sendText("a")
    expect(client.getSnapshot().banner?.text).toBe("Order not found")
    await client.sendText("b")
    expect(client.getSnapshot().banner?.text).toBe('too long; {"loc":["body"]}')
    await client.sendText("c")
    expect(client.getSnapshot().banner?.text).toBe("HTTP 500")
  })

  it.each(["completed", "escalated", "canceled"] as const)(
    "does not send in a %s session",
    async (phase) => {
      const client = await startedClient("s1", {
        phase,
        escalation_reason: phase === "escalated" ? "user_requested" : null,
      })
      expect(await client.sendText("hello")).toBe(false)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  )
})

describe("turn audio", () => {
  const withReply = (language: "en" | "es" = "en") =>
    turn({ turn_id: "t1", user_text: "hi", reply_text: "Hola", language })

  it("shares one request between concurrent plays and revokes the Blob URL on a new session", async () => {
    const client = await startedClient()
    mockApi({
      "GET /api/sessions/s1/turns/t1/audio": [
        () =>
          new Response(new Blob(["mp3"]), {
            headers: { "X-TTS-Provider": "eleven_v4_turbo" },
          }),
      ],
      "POST /api/sessions": [() => json(session("s2"))],
    })

    await Promise.all([
      client.playTurnAudio(withReply()),
      client.playTurnAudio(withReply()),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2) // session create + exactly one audio request
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(client.getSnapshot().tts).toMatchObject({
      status: "ok",
      provider: "eleven_v4_turbo",
    })

    await client.newSession()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test/1")
  })

  it("falls back to browser speech on HTTP 204 and shows the TTS headers", async () => {
    const client = await startedClient()
    mockApi({
      "GET /api/sessions/s1/turns/t1/audio": [
        () =>
          new Response(null, {
            status: 204,
            headers: {
              "X-TTS-Provider": "browser_speech_synthesis",
              "X-TTS-Degraded": "elevenlabs_key_unset",
            },
          }),
      ],
    })

    await client.playTurnAudio(withReply("es"))
    expect(speech.speak).toHaveBeenCalledTimes(1)
    expect((speech.speak.mock.calls[0]?.[0] as FakeUtterance).lang).toBe(
      "es-ES"
    )
    expect(client.getSnapshot().tts).toMatchObject({
      status: "fallback",
      provider: "browser_speech_synthesis",
      degraded: "elevenlabs_key_unset",
    })
    expect(client.getSnapshot().playback?.mode).toBe("browser")
  })

  it("speaks the browser fallback when the audio request fails", async () => {
    const client = await startedClient()
    mockApi({
      "GET /api/sessions/s1/turns/t1/audio": [
        () => Promise.reject(new TypeError("offline")),
      ],
    })
    await client.playTurnAudio(withReply())
    expect(speech.speak).toHaveBeenCalledTimes(1)
    expect(client.getSnapshot().tts.degraded).toBe("offline")
  })

  it("drops audio that finishes downloading after the session changed", async () => {
    const client = await startedClient("s1")
    let release!: (res: Response) => void
    const pending = new Promise<Response>((resolve) => (release = resolve))
    mockApi({
      "GET /api/sessions/s1/turns/t1/audio": [() => pending],
      "POST /api/sessions": [() => json(session("s2"))],
    })

    const playing = client.playTurnAudio(withReply())
    await client.newSession()
    release(
      new Response(new Blob(["mp3"]), {
        headers: { "X-TTS-Provider": "eleven_v4_turbo" },
      })
    )
    await playing

    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(client.getSnapshot().playback).toBeNull()
  })

  it("flags audioLoading until the audio is audible", async () => {
    const client = await startedClient()
    let release!: (res: Response) => void
    const slow = new Promise<Response>((resolve) => (release = resolve))
    mockApi({ "GET /api/sessions/s1/turns/t1/audio": [() => slow] })

    const playing = client.playTurnAudio(withReply())
    expect(client.getSnapshot().audioLoading).toBe(true)
    release(new Response(new Blob(["mp3"])))
    await playing
    expect(client.getSnapshot()).toMatchObject({
      audioLoading: false,
      playback: { mode: "elevenlabs" },
    })
  })

  it("lets only the newest request own audioLoading, and stop clears it", async () => {
    const client = await startedClient()
    let releaseOlder!: (res: Response) => void
    let releaseNewer!: (res: Response) => void
    const older = new Promise<Response>((resolve) => (releaseOlder = resolve))
    const newer = new Promise<Response>((resolve) => (releaseNewer = resolve))
    mockApi({
      "GET /api/sessions/s1/turns/t1/audio": [() => older],
      "GET /api/sessions/s1/turns/t2/audio": [() => newer],
    })

    const playingOlder = client.playTurnAudio(withReply())
    const playingNewer = client.playTurnAudio(turn({ turn_id: "t2" }))
    releaseOlder(new Response(new Blob(["mp3"])))
    await playingOlder
    expect(client.getSnapshot().audioLoading).toBe(true) // the newer one is still loading

    client.stopPlayback()
    expect(client.getSnapshot().audioLoading).toBe(false)
    releaseNewer(new Response(new Blob(["mp3"])))
    await playingNewer
    expect(client.getSnapshot()).toMatchObject({
      audioLoading: false,
      playback: null,
    })
  })

  it("cancels playback with playSeq when a newer play starts", async () => {
    const client = await startedClient()
    let release!: (res: Response) => void
    const slow = new Promise<Response>((resolve) => (release = resolve))
    mockApi({
      "GET /api/sessions/s1/turns/t1/audio": [() => slow],
      "GET /api/sessions/s1/turns/t2/audio": [
        () => new Response(null, { status: 204 }),
      ],
    })

    const first = client.playTurnAudio(withReply())
    await client.playTurnAudio(turn({ turn_id: "t2", reply_text: "second" }))
    release(new Response(new Blob(["mp3"])))
    await first

    // Only the newer turn is spoken; the older one was cancelled.
    expect(speech.speak).toHaveBeenCalledTimes(1)
    expect((speech.speak.mock.calls[0]?.[0] as FakeUtterance).text).toBe(
      "second"
    )
  })
})

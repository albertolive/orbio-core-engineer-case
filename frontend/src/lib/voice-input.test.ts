import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { VoiceInput, pickMimeType } from "@/lib/voice-input"

class FakeRecorder {
  static instances: FakeRecorder[] = []
  static supported: string[] = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ]
  static isTypeSupported = (type: string) =>
    FakeRecorder.supported.includes(type)

  state: "inactive" | "recording" = "inactive"
  stream: unknown
  mimeType: string
  ondataavailable: ((ev: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor(stream: unknown, options?: { mimeType?: string }) {
    this.stream = stream
    this.mimeType = options?.mimeType ?? ""
    FakeRecorder.instances.push(this)
  }
  start() {
    this.state = "recording"
  }
  stop() {
    this.state = "inactive"
    this.ondataavailable?.({ data: new Blob(["voice"]) })
    this.onstop?.()
  }
}

const track = { stop: vi.fn() }
const stream = { getTracks: () => [track] }
const getUserMedia = vi.fn()

const handlers = () => ({
  canStart: () => true,
  onClip: vi.fn(),
  onChange: vi.fn(),
  onError: vi.fn(),
})

// Lets a pending getUserMedia promise settle before asserting.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  FakeRecorder.instances = []
  FakeRecorder.supported = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
  track.stop.mockReset()
  getUserMedia.mockReset()
  vi.stubGlobal("MediaRecorder", FakeRecorder)
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("pickMimeType", () => {
  it("prefers webm/opus, then webm, then mp4", () => {
    expect(pickMimeType()).toBe("audio/webm;codecs=opus")
    FakeRecorder.supported = ["audio/webm", "audio/mp4"]
    expect(pickMimeType()).toBe("audio/webm")
    FakeRecorder.supported = ["audio/mp4"]
    expect(pickMimeType()).toBe("audio/mp4")
    FakeRecorder.supported = []
    expect(pickMimeType()).toBe("")
  })
})

describe("hold-to-talk race guard", () => {
  it("drops a stream that arrives after Space was released", async () => {
    let grant!: (s: unknown) => void
    getUserMedia.mockReturnValue(new Promise((resolve) => (grant = resolve)))
    const h = handlers()
    const voice = new VoiceInput(h)

    voice.spaceDown()
    voice.spaceUp() // released before the permission prompt resolved
    grant(stream)
    await settle()

    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(FakeRecorder.instances).toHaveLength(0)
    expect(h.onChange).not.toHaveBeenCalled()
  })

  it("records while Space is held and uploads one clip on release", async () => {
    getUserMedia.mockResolvedValue(stream)
    const h = handlers()
    const voice = new VoiceInput(h)

    voice.spaceDown()
    await settle()
    expect(voice.recording).toBe(true)
    expect(h.onChange).toHaveBeenCalledWith({ recording: true, stream })

    voice.spaceUp()
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(h.onClip).toHaveBeenCalledTimes(1)
    expect(h.onClip.mock.calls[0]?.[1]).toBe("audio/webm;codecs=opus")
  })

  it("ignores re-entry while the permission prompt is open", async () => {
    let grant!: (s: unknown) => void
    getUserMedia.mockReturnValue(new Promise((resolve) => (grant = resolve)))
    const voice = new VoiceInput(handlers())

    void voice.toggle()
    void voice.toggle()
    grant(stream)
    await settle()

    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })

  it("cancel() during the prompt releases the mic and never records", async () => {
    let grant!: (s: unknown) => void
    getUserMedia.mockReturnValue(new Promise((resolve) => (grant = resolve)))
    const voice = new VoiceInput(handlers())

    void voice.toggle()
    voice.cancel()
    grant(stream)
    await settle()

    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(FakeRecorder.instances).toHaveLength(0)
  })

  it("cancel() while recording discards the clip", async () => {
    getUserMedia.mockResolvedValue(stream)
    const h = handlers()
    const voice = new VoiceInput(h)

    await voice.toggle()
    voice.cancel()

    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(h.onClip).not.toHaveBeenCalled()
  })

  it("does not start when the session cannot take a turn", async () => {
    const h = { ...handlers(), canStart: () => false }
    await new VoiceInput(h).toggle()
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it("reports a denied permission", async () => {
    getUserMedia.mockRejectedValue(
      new DOMException("denied", "NotAllowedError")
    )
    const h = handlers()
    await new VoiceInput(h).toggle()
    expect(h.onError).toHaveBeenCalledWith("Microphone permission denied.")
  })
})

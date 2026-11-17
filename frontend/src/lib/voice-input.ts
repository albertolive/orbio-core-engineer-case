export const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
] as const

export function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return ""
  for (const candidate of MIME_CANDIDATES) {
    if (
      !MediaRecorder.isTypeSupported ||
      MediaRecorder.isTypeSupported(candidate)
    ) {
      return candidate
    }
  }
  return ""
}

export interface VoiceInputHandlers {
  canStart: () => boolean
  onClip: (blob: Blob, mimeType: string) => void
  onChange: (change: { recording: boolean; stream: MediaStream | null }) => void
  onError: (message: string) => void
}

const stopTracks = (stream: MediaStream) =>
  stream.getTracks().forEach((track) => track.stop())

const isPermissionError = (err: unknown) =>
  err instanceof DOMException &&
  (err.name === "NotAllowedError" || err.name === "SecurityError")

// Click-to-toggle and hold-to-talk (Space) recording on one MediaRecorder.
// `startingMic` ignores re-entry while the permission prompt is open, and
// `spaceHeld` + `generation` drop a stream that arrives after the key was
// released or the recording was cancelled, so the mic never stays open.
export class VoiceInput {
  private handlers: VoiceInputHandlers
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private startingMic = false
  private spaceHeld = false
  private discarding = false
  private generation = 0

  constructor(handlers: VoiceInputHandlers) {
    this.handlers = handlers
  }

  get recording(): boolean {
    return this.recorder?.state === "recording"
  }

  get spacePressed(): boolean {
    return this.spaceHeld
  }

  async toggle({
    fromSpace = false,
  }: { fromSpace?: boolean } = {}): Promise<void> {
    if (this.recorder?.state === "recording") {
      this.recorder.stop()
      return
    }
    if (this.startingMic || !this.handlers.canStart()) return
    if (!navigator.mediaDevices?.getUserMedia) {
      this.handlers.onError(
        "Microphone access is not available in this browser."
      )
      return
    }

    this.startingMic = true
    const generation = this.generation
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if ((fromSpace && !this.spaceHeld) || generation !== this.generation) {
        stopTracks(stream)
        return
      }
      this.start(stream)
    } catch (err) {
      this.handlers.onError(
        isPermissionError(err)
          ? "Microphone permission denied."
          : "Could not access the microphone."
      )
    } finally {
      this.startingMic = false
    }
  }

  spaceDown(): void {
    this.spaceHeld = true
    if (!this.recording) void this.toggle({ fromSpace: true })
  }

  spaceUp(): void {
    this.spaceHeld = false
    if (this.recording) this.recorder?.stop()
  }

  // Stops any recording without uploading it (new session, unmount).
  cancel(): void {
    this.spaceHeld = false
    this.generation += 1
    if (this.recording) {
      this.discarding = true
      this.recorder?.stop()
    }
  }

  private start(stream: MediaStream): void {
    const mimeType = pickMimeType()
    let recorder: MediaRecorder
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)
    } catch {
      stopTracks(stream)
      this.handlers.onError("Recording is not supported in this browser.")
      return
    }

    this.chunks = []
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) this.chunks.push(ev.data)
    }
    recorder.onstop = () => {
      stopTracks(stream)
      this.recorder = null
      this.handlers.onChange({ recording: false, stream: null })
      const actualMime = recorder.mimeType || mimeType || "audio/webm"
      if (this.discarding) {
        this.discarding = false
        return
      }
      this.handlers.onClip(
        new Blob(this.chunks, { type: actualMime }),
        actualMime
      )
    }
    this.recorder = recorder
    recorder.start()
    this.handlers.onChange({ recording: true, stream })
  }
}

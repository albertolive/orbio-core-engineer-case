export interface AudioTap {
  stream: MediaStream
  dispose: () => void
}

let context: AudioContext | null = null

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

// Routes a playing <audio> element through WebAudio so the visualizers receive
// a real MediaStream. Resolves to null when WebAudio is unavailable or the
// context cannot start: playback must never depend on the tap.
export async function tapAudioElement(
  audio: HTMLAudioElement
): Promise<AudioTap | null> {
  try {
    context ??= new AudioContext()
    if (context.state === "suspended") {
      await Promise.race([context.resume(), wait(150)])
    }
    if (context.state !== "running") return null

    const source = context.createMediaElementSource(audio)
    const tap = context.createMediaStreamDestination()
    source.connect(context.destination)
    source.connect(tap)
    return {
      stream: tap.stream,
      dispose: () => {
        source.disconnect()
        tap.disconnect()
      },
    }
  } catch {
    return null
  }
}

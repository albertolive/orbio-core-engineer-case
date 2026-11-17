// Session-scoped cache of ElevenLabs audio, keyed by `${sessionId}:${turnId}`.
// Concurrent requests for one turn share a single in-flight promise.
export class TurnAudioCache {
  private audioBlobs = new Map<string, string>()
  private audioInFlight = new Map<string, Promise<string | null>>()

  async resolve(
    sessionId: string,
    turnId: string,
    load: () => Promise<Blob | null>,
    isCurrent: () => boolean
  ): Promise<string | null> {
    const cacheKey = `${sessionId}:${turnId}`
    const cached = this.audioBlobs.get(cacheKey)
    if (cached) return cached
    const pending = this.audioInFlight.get(cacheKey)
    if (pending) return pending

    const promise = (async () => {
      const blob = await load()
      // The session changed while the audio was downloading: drop it.
      if (!blob || !isCurrent()) return null
      const url = URL.createObjectURL(blob)
      this.audioBlobs.set(cacheKey, url)
      return url
    })()

    this.audioInFlight.set(cacheKey, promise)
    try {
      return await promise
    } finally {
      this.audioInFlight.delete(cacheKey)
    }
  }

  clear(): void {
    for (const url of this.audioBlobs.values()) URL.revokeObjectURL(url)
    this.audioBlobs.clear()
    this.audioInFlight.clear()
  }
}

import { api } from "@/lib/api"
import { tapAudioElement, type AudioTap } from "@/lib/audio-tap"
import { newClientId } from "@/lib/ids"
import { SPEECH_LOCALES } from "@/lib/languages"
import { TurnAudioCache } from "@/lib/turn-audio-cache"
import {
  isClosed,
  latestTurn,
  type ConversationSession,
  type ConversationTurn,
  type Language,
} from "@/lib/types"
import { VoiceInput } from "@/lib/voice-input"

const SESSION_KEY = "novamart_session_id"

export type FlightKind = "text" | "voice" | "summary"

export interface Banner {
  kind: "warn" | "err"
  text: string
}

export interface Playback {
  turnId: string
  mode: "elevenlabs" | "browser"
  audio: HTMLAudioElement | null
  stream: MediaStream | null
}

export interface TtsInfo {
  status: "checking" | "ok" | "fallback"
  provider: string | null
  degraded: string | null
  fetchMs: number | null
}

export interface SupportState {
  ready: boolean
  creating: boolean
  session: ConversationSession | null
  /** Request in flight for the current session, if any. */
  busy: FlightKind | null
  /** Text of the user message being sent, shown until the reply arrives. */
  pending: string | null
  recording: boolean
  micStream: MediaStream | null
  banner: Banner | null
  playback: Playback | null
  /** The turn's audio is being fetched; nothing is audible yet. */
  audioLoading: boolean
  voiceReply: boolean
  startLanguage: Language
  tts: TtsInfo
}

interface Flight {
  sid: string
  kind: FlightKind
  text?: string
}

const INITIAL_TTS: TtsInfo = {
  status: "checking",
  provider: null,
  degraded: null,
  fetchMs: null,
}

export class SupportClient {
  private state: SupportState = {
    ready: false,
    creating: false,
    session: null,
    busy: null,
    pending: null,
    recording: false,
    micStream: null,
    banner: null,
    playback: null,
    audioLoading: false,
    voiceReply: true,
    startLanguage: "en",
    tts: INITIAL_TTS,
  }
  private listeners = new Set<() => void>()
  private flight: Flight | null = null
  private pendingRetry: { sid: string; text: string; turnId: string } | null =
    null
  private audio = new TurnAudioCache()
  private playSeq = 0
  private createSeq = 0
  private activeAudio: HTMLAudioElement | null = null
  private tap: AudioTap | null = null
  private utterance: SpeechSynthesisUtterance | null = null
  private initPromise: Promise<void> | null = null

  readonly voice = new VoiceInput({
    canStart: () => {
      const { session, busy } = this.state
      return session !== null && !isClosed(session) && busy === null
    },
    onClip: (blob, mimeType) => void this.sendVoice(blob, mimeType),
    onChange: ({ recording, stream }) =>
      this.patch({ recording, micStream: stream }),
    onError: (text) => this.setBanner(text, "err"),
  })

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): SupportState => this.state

  init(): Promise<void> {
    this.initPromise ??= this.load()
    return this.initPromise
  }

  async newSession(): Promise<void> {
    this.voice.cancel()
    this.stopPlayback()
    this.audio.clear()
    this.pendingRetry = null
    const seq = ++this.createSeq
    this.patch({
      banner: null,
      creating: true,
      tts: { ...this.state.tts, fetchMs: null },
    })
    try {
      const result = await api.createSession(this.state.startLanguage)
      if (seq !== this.createSeq) return
      if (!result.ok) {
        this.setBanner("Could not create session.", "err")
        return
      }
      this.renderSession(result.data, false)
    } catch {
      if (seq === this.createSeq)
        this.setBanner("Could not create session.", "err")
    } finally {
      if (seq === this.createSeq) this.patch({ creating: false })
    }
  }

  /** Resolves true when the reply was received and rendered. */
  async sendText(text: string): Promise<boolean> {
    const session = this.state.session
    if (!session || isClosed(session) || this.state.busy) return false

    this.stopPlayback()
    const reqSid = session.session_id
    // A retry of the same text in the same session reuses its client_turn_id,
    // so the server returns the saved turn instead of running it twice.
    const retry = this.pendingRetry
    const clientTurnId =
      retry && retry.sid === reqSid && retry.text === text
        ? retry.turnId
        : newClientId()
    this.pendingRetry = { sid: reqSid, text, turnId: clientTurnId }
    const flight = this.beginFlight(reqSid, "text", text)
    this.patch({ banner: null })

    try {
      const result = await api.postTurn(reqSid, clientTurnId, text)
      if (!this.isCurrent(reqSid)) return false
      this.pendingRetry = null
      if (!result.ok) {
        this.setBanner(result.message, "err")
        return false
      }
      this.flight = null
      this.renderSession(result.data, true)
      return true
    } catch {
      if (this.isCurrent(reqSid)) {
        this.setBanner(
          "Network error sending turn. Submit again to retry safely.",
          "err"
        )
      }
      return false
    } finally {
      this.endFlight(flight)
    }
  }

  async finalize(): Promise<void> {
    const session = this.state.session
    if (!session || this.state.busy) return

    const reqSid = session.session_id
    const flight = this.beginFlight(reqSid, "summary")
    try {
      const result = await api.finalize(reqSid)
      if (!this.isCurrent(reqSid)) return
      if (!result.ok) {
        this.setBanner(result.message, "err")
        return
      }
      this.flight = null
      this.renderSession(result.data, false)
    } catch {
      if (this.isCurrent(reqSid))
        this.setBanner("Network error generating summary.", "err")
    } finally {
      this.endFlight(flight)
    }
  }

  toggleMic(): void {
    this.stopPlayback()
    void this.voice.toggle()
  }

  spaceDown(): void {
    if (!this.voice.recording) this.stopPlayback()
    this.voice.spaceDown()
  }

  spaceUp(): void {
    this.voice.spaceUp()
  }

  async playTurnAudio(turn: ConversationTurn): Promise<void> {
    const session = this.state.session
    if (!session) return

    this.stopPlayback()
    const seq = this.playSeq
    const reqSid = session.session_id
    const stale = () => seq !== this.playSeq || !this.isCurrent(reqSid)
    this.patch({ audioLoading: true })
    try {
      const url = await this.audio.resolve(
        reqSid,
        turn.turn_id,
        () => this.loadTurnAudio(reqSid, turn.turn_id),
        () => this.isCurrent(reqSid)
      )
      if (stale()) return
      if (url) await this.playBlobUrl(url, turn.turn_id, stale)
      else this.speakFallback(turn)
    } catch {
      if (stale()) return
      this.patchTts({
        status: "fallback",
        provider: "browser_speech_synthesis",
        degraded: "offline",
      })
      this.speakFallback(turn)
    } finally {
      // A newer play or a stop already reset the flag for its own request.
      if (seq === this.playSeq) this.patch({ audioLoading: false })
    }
  }

  stopPlayback(): void {
    this.playSeq += 1
    this.releaseAudio()
    this.utterance = null
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel()
    if (this.state.playback || this.state.audioLoading) {
      this.patch({ playback: null, audioLoading: false })
    }
  }

  seek(time: number): void {
    const audio = this.activeAudio
    if (!audio) return
    audio.currentTime = Math.min(
      Math.max(time, 0),
      Number.isFinite(audio.duration) ? audio.duration : 0
    )
  }

  setVoiceReply(voiceReply: boolean): void {
    if (!voiceReply) this.stopPlayback()
    this.patch({ voiceReply })
  }

  setStartLanguage(startLanguage: Language): void {
    this.patch({ startLanguage })
  }

  dismissBanner(): void {
    this.patch({ banner: null })
  }

  private async load(): Promise<void> {
    void this.checkHealth()
    const saved = readStoredSessionId()
    if (saved) {
      try {
        const result = await api.getSession(saved)
        if (result.ok) {
          this.renderSession(result.data, false)
          this.patch({ ready: true })
          return
        }
      } catch {
        // Fall through and start a fresh session.
      }
    }
    await this.newSession()
    this.patch({ ready: true })
  }

  private async checkHealth(): Promise<void> {
    try {
      const result = await api.health()
      if (!result.ok) return
      this.patchTts({
        status:
          result.data.tts_provider === "eleven_v4_turbo" ? "ok" : "fallback",
        provider: result.data.tts_provider,
      })
    } catch {
      // The badge stays on "checking"; session calls surface the outage.
    }
  }

  private async sendVoice(blob: Blob, mimeType: string): Promise<void> {
    const session = this.state.session
    if (!session) return
    if (this.state.busy) {
      this.setBanner(
        "Still working on the last message. Try again in a moment.",
        "warn"
      )
      return
    }

    const reqSid = session.session_id
    const flight = this.beginFlight(reqSid, "voice")
    this.patch({ banner: null })
    const form = new FormData()
    form.append("client_turn_id", newClientId())
    form.append(
      "audio",
      blob,
      `turn.${mimeType.includes("mp4") ? "mp4" : "webm"}`
    )

    try {
      const result = await api.postVoice(reqSid, form)
      if (!this.isCurrent(reqSid)) return
      if (!result.ok) {
        this.setBanner(result.message, "err")
        return
      }
      this.flight = null
      this.renderSession(result.data, true)
    } catch {
      if (this.isCurrent(reqSid))
        this.setBanner("Network error uploading audio.", "err")
    } finally {
      this.endFlight(flight)
    }
  }

  private async loadTurnAudio(
    sid: string,
    turnId: string
  ): Promise<Blob | null> {
    const t0 = performance.now()
    const res = await api.turnAudio(sid, turnId)
    const current = this.isCurrent(sid)
    if (current) this.patchTts({ fetchMs: Math.round(performance.now() - t0) })
    const provider = res.headers.get("X-TTS-Provider") || "unknown"
    const degraded = res.headers.get("X-TTS-Degraded")
    if (res.status === 200) {
      if (current) this.patchTts({ status: "ok", provider, degraded: null })
      return res.blob()
    }
    if (current) {
      this.patchTts({
        status: "fallback",
        provider,
        degraded: degraded || "fallback",
      })
    }
    return null
  }

  private async playBlobUrl(
    url: string,
    turnId: string,
    stale: () => boolean
  ): Promise<void> {
    const audio = new Audio(url)
    this.activeAudio = audio
    this.patch({
      playback: { turnId, mode: "elevenlabs", audio, stream: null },
    })
    audio.onended = () => this.finishAudio(audio)
    audio.onerror = () => this.finishAudio(audio)

    const tap = await tapAudioElement(audio)
    if (stale() || this.activeAudio !== audio) {
      tap?.dispose()
      return
    }
    if (tap) {
      this.tap = tap
      this.patch({
        playback: { turnId, mode: "elevenlabs", audio, stream: tap.stream },
      })
    }
    try {
      await audio.play()
    } catch {
      if (this.activeAudio !== audio) return
      this.finishAudio(audio)
      this.setBanner(
        "The browser blocked audio playback. Use Play audio to listen.",
        "warn"
      )
    }
  }

  private speakFallback(turn: ConversationTurn): void {
    if (typeof speechSynthesis === "undefined") return
    speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(turn.reply_text)
    utterance.lang = SPEECH_LOCALES[turn.language]
    const done = () => {
      if (this.utterance !== utterance) return
      this.utterance = null
      this.patch({ playback: null })
    }
    utterance.onend = done
    utterance.onerror = done
    this.utterance = utterance
    this.patch({
      playback: {
        turnId: turn.turn_id,
        mode: "browser",
        audio: null,
        stream: null,
      },
    })
    speechSynthesis.speak(utterance)
  }

  private finishAudio(audio: HTMLAudioElement): void {
    if (this.activeAudio !== audio) return
    this.releaseAudio()
    this.patch({ playback: null })
  }

  private releaseAudio(): void {
    this.activeAudio?.pause()
    this.activeAudio = null
    this.tap?.dispose()
    this.tap = null
  }

  private renderSession(
    session: ConversationSession,
    speakLatest: boolean
  ): void {
    this.patch({ session })
    try {
      sessionStorage.setItem(SESSION_KEY, session.session_id)
    } catch {
      // Storage can be blocked (private mode); the session just won't be restored.
    }
    const latest = latestTurn(session)
    if (speakLatest && latest && this.state.voiceReply)
      void this.playTurnAudio(latest)
  }

  private isCurrent(sid: string): boolean {
    return this.state.session?.session_id === sid
  }

  private beginFlight(sid: string, kind: FlightKind, text?: string): Flight {
    const flight: Flight = { sid, kind, text }
    this.flight = flight
    this.patch({})
    return flight
  }

  private endFlight(flight: Flight): void {
    if (this.flight !== flight) return
    this.flight = null
    this.patch({})
  }

  private setBanner(text: string, kind: Banner["kind"]): void {
    this.patch({ banner: { kind, text } })
  }

  private patchTts(change: Partial<TtsInfo>): void {
    this.patch({ tts: { ...this.state.tts, ...change } })
  }

  private patch(change: Partial<SupportState>): void {
    const next = { ...this.state, ...change }
    // `busy` and `pending` only apply to the session they were started for.
    const active =
      this.flight?.sid === next.session?.session_id ? this.flight : null
    this.state = {
      ...next,
      busy: active?.kind ?? null,
      pending: active?.text ?? null,
    }
    for (const listener of this.listeners) listener()
  }
}

function readStoredSessionId(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

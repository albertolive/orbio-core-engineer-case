import type { ConversationSession, Health, Language } from "@/lib/types"

export type ApiResult<T> =
  { ok: true; data: T } | { ok: false; status: number; message: string }

// FastAPI returns `detail` as a string, or as a list of validation errors.
export function formatErrorDetail(payload: unknown, status: number): string {
  const detail = (payload as { detail?: unknown } | null | undefined)?.detail
  if (typeof detail === "string") return detail
  if (Array.isArray(detail)) {
    return detail
      .map((item: { msg?: string }) => item.msg || JSON.stringify(item))
      .join("; ")
  }
  return `HTTP ${status}`
}

async function parse<T>(res: Response): Promise<ApiResult<T>> {
  if (res.ok) return { ok: true, data: (await res.json()) as T }
  const body: unknown = await res.json().catch(() => ({}))
  return {
    ok: false,
    status: res.status,
    message: formatErrorDetail(body, res.status),
  }
}

const post = (url: string, init: RequestInit = {}) =>
  fetch(url, { method: "POST", ...init })

const postJson = (url: string, body: unknown) =>
  post(url, {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

// Network failures reject; HTTP errors resolve as `{ ok: false }`.
export const api = {
  health: () => fetch("/api/health").then(parse<Health>),
  createSession: (language: Language) =>
    postJson("/api/sessions", { language }).then(parse<ConversationSession>),
  getSession: (sessionId: string) =>
    fetch(`/api/sessions/${sessionId}`).then(parse<ConversationSession>),
  postTurn: (sessionId: string, clientTurnId: string, text: string) =>
    postJson(`/api/sessions/${sessionId}/turn`, {
      client_turn_id: clientTurnId,
      text,
    }).then(parse<ConversationSession>),
  postVoice: (sessionId: string, form: FormData) =>
    post(`/api/sessions/${sessionId}/voice`, { body: form }).then(
      parse<ConversationSession>
    ),
  finalize: (sessionId: string) =>
    post(`/api/sessions/${sessionId}/finalize`).then(
      parse<ConversationSession>
    ),
  turnAudio: (sessionId: string, turnId: string) =>
    fetch(`/api/sessions/${sessionId}/turns/${turnId}/audio`),
}

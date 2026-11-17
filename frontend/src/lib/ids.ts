// crypto.randomUUID only exists in secure contexts (HTTPS or localhost); the
// server accepts any 1 to 128 character id, so a LAN preview over HTTP still works.
export const newClientId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`

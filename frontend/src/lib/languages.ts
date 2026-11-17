import type { Language } from "@/lib/types"

export const LANGUAGE_OPTIONS: readonly { value: Language; label: string }[] = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "ca", label: "Català" },
]

export const SPEECH_LOCALES: Record<Language, string> = {
  en: "en-US",
  es: "es-ES",
  ca: "ca-ES",
}

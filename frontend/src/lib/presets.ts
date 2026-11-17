export interface Preset {
  readonly label: string
  readonly prompt: string
}

export const PRESETS: readonly Preset[] = [
  {
    label: "Damaged ORD-48291",
    prompt:
      "Hi, my order ORD-48291 arrived with a cracked water tank and it is leaking. High urgency.",
  },
  {
    label: "RAG policy question",
    prompt: "What is your return window and replacement SLA for damaged items?",
  },
  { label: "Invalid order", prompt: "My order is ORD-00000" },
  {
    label: "Spanish ORD-51904",
    prompt:
      "Hola, mi pedido ORD-51904 lleva días de retraso y lo necesito con urgencia media.",
  },
  {
    label: "Catalan RAG",
    prompt:
      "Bon dia, quina garantia tenen els productes electrònics a NovaMart?",
  },
  {
    label: "Frustrated escalation",
    prompt:
      "This is ridiculous, everything is broken and nobody helps me! Transfer me to a human now!",
  },
]

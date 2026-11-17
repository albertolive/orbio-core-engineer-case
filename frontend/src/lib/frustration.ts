// Mirrors FRUSTRATION_IMMEDIATE / FRUSTRATION_SUSTAINED in src/support_agent/domain.py.
export const FRUSTRATION_IMMEDIATE = 70
export const FRUSTRATION_SUSTAINED = 60
// domain.py escalates on the third invalid order number.
export const MAX_INVALID_ORDER_ATTEMPTS = 3

export type FrustrationTone = "calm" | "elevated" | "critical"

export function frustrationTone(score: number): FrustrationTone {
  if (score >= FRUSTRATION_IMMEDIATE) return "critical"
  if (score >= FRUSTRATION_SUSTAINED) return "elevated"
  return "calm"
}

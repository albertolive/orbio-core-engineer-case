import { describe, expect, it } from "vitest"

import { agentStatus } from "@/lib/agent-status"
import { formatErrorDetail } from "@/lib/api"
import { frustrationTone } from "@/lib/frustration"
import { LANGUAGE_OPTIONS, SPEECH_LOCALES } from "@/lib/languages"
import { PRESETS } from "@/lib/presets"
import {
  TICKET_SLOTS,
  humanize,
  slotStatus,
  type TicketDraft,
} from "@/lib/ticket-slots"
import type { ConversationSession } from "@/lib/types"

describe("agentStatus", () => {
  const idle = {
    recording: false,
    busy: null,
    playback: null,
    audioLoading: false,
    session: null,
  } as const

  it("stays thinking while the reply audio loads, then speaks, so the agent never flashes idle", () => {
    expect(agentStatus({ ...idle, busy: "text" })).toBe("thinking")
    expect(agentStatus({ ...idle, audioLoading: true })).toBe("thinking")
    expect(
      agentStatus({
        ...idle,
        playback: {
          turnId: "t1",
          mode: "elevenlabs",
          audio: null,
          stream: null,
        },
      })
    ).toBe("speaking")
    expect(agentStatus(idle)).toBe("idle")
  })

  it("lets live activity win over the resting escalated phase", () => {
    const escalated = { phase: "escalated" } as ConversationSession
    expect(agentStatus({ ...idle, session: escalated })).toBe("escalated")
    expect(agentStatus({ ...idle, session: escalated, recording: true })).toBe(
      "listening"
    )
  })
})

describe("frustrationTone", () => {
  it("matches the domain.py thresholds (>= 60 amber, >= 70 red)", () => {
    expect([0, 59].map(frustrationTone)).toEqual(["calm", "calm"])
    expect([60, 69].map(frustrationTone)).toEqual(["elevated", "elevated"])
    expect([70, 100].map(frustrationTone)).toEqual(["critical", "critical"])
  })
})

describe("formatErrorDetail", () => {
  it("handles string, array, empty and missing payloads", () => {
    expect(formatErrorDetail({ detail: "nope" }, 400)).toBe("nope")
    expect(
      formatErrorDetail({ detail: [{ msg: "a" }, { msg: "b" }] }, 422)
    ).toBe("a; b")
    expect(formatErrorDetail({}, 500)).toBe("HTTP 500")
    expect(formatErrorDetail(null, 502)).toBe("HTTP 502")
  })
})

describe("ticket slots", () => {
  it("covers every field of the backend draft, each key once", () => {
    const keys = TICKET_SLOTS.map((slot) => slot.key)
    expect(keys).toEqual(
      expect.arrayContaining([
        "order_number",
        "problem_category",
        "urgency_level",
        "problem_description",
      ])
    )
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("reads a slot the backend does not send as pending", () => {
    expect(slotStatus({ field_errors: {} }, "order_number")).toBe("pending")
  })

  it("reports pending, filled and invalid", () => {
    const draft: TicketDraft = {
      order_number: "ORD-48291",
      problem_category: null,
      urgency_level: "high",
      problem_description: null,
      field_errors: { urgency_level: "Unknown urgency" },
    }
    expect(slotStatus(draft, "order_number")).toBe("filled")
    expect(slotStatus(draft, "problem_category")).toBe("pending")
    expect(slotStatus(draft, "urgency_level")).toBe("invalid")
  })

  it("humanizes snake_case values only", () => {
    expect(humanize("damaged_item")).toBe("Damaged item")
    expect(humanize("high")).toBe("High")
    expect(humanize("ORD-48291")).toBe("ORD-48291")
    expect(humanize("The tank is cracked.")).toBe("The tank is cracked.")
  })
})

describe("presets and languages", () => {
  it("ships the six sample prompts with Spanish and Catalan accents", () => {
    expect(PRESETS).toHaveLength(6)
    const prompts = PRESETS.map((preset) => preset.prompt)
    expect(prompts.join(" ")).toContain("días")
    expect(prompts.join(" ")).toContain("electrònics")
    for (const prompt of prompts) expect(prompt).toBe(prompt.normalize("NFC"))
  })

  it("offers English, Español and Català with matching speech locales", () => {
    expect(LANGUAGE_OPTIONS.map((option) => option.label)).toEqual([
      "English",
      "Español",
      "Català",
    ])
    expect(SPEECH_LOCALES).toEqual({ en: "en-US", es: "es-ES", ca: "ca-ES" })
  })
})

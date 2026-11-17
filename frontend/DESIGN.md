# DESIGN.md

Design notes for the NovaMart support UI in `frontend/`. The look comes from orbioai.co. The voice and chat parts come from elevenlabs/ui. Every Orbio value below was read from the live site's CSS and computed styles, then cross-checked in a local clone built with ai-website-cloner-template.

## Surfaces

The page has two surfaces on one token scale.

**Customer, light.** The `:root` tokens. Cream page, white cards, ink text, 1px hairlines.

**Specialist, dark.** The `.dark` tokens. Orbio's deep forest green with sage secondary text and lime accents. The class sits on the console panel, on the voice dock while it is live, and on the agent card while Nova is on a call. The page has no user theme toggle.

## Tokens

Raw palette, all in `src/index.css`:

| Token | Value | Use |
| --- | --- | --- |
| `--cream` | `#f2f8ea` | Page |
| `--cream-50` | `#f9fcf4` | Text on dark |
| `--paper` | `#ffffff` | Cards |
| `--ink` | `#222c18` | Text, number tiles |
| `--ink-soft` | `#3d4a31` | Secondary text |
| `--ink-muted` | `#6b775d` | Captions on white |
| `--line` | `#222c1821` | Every hairline on light |
| `--green` | `#2f3f22` | Buttons |
| `--brand-deep` | `#1a2312` | Button hover |
| `--green-deep` | `#222c18` | Specialist panel |
| `--forest-950` | `#1a2014` | Cards on the panel |
| `--sage` | `#c4d0b0` | Secondary text on dark |
| `--sage-dim` | `#939f82` | Captions on dark |
| `--vivid` | `#54de21` | Live dots, waveform bars |
| `--lime` | `#a9f36b` | Digits on ink tiles |
| `--lime-bright` | `#8fe86a` | Accents on dark |
| `--lime-deep` | `#3fa818` | Accents on light, never body text |
| `--green-700` | `#3d7254` | Emphasis words on light |

Orbio's `--forest-700/800/900` and `--sage-200/300` ramps are in the file too. `--sage-dim` is the one value that is ours: sage at 70% over `--green-deep`, the dimmest sage that keeps 5.2:1.

Semantic roles flip between the two surfaces:

| Role | Light | Dark |
| --- | --- | --- |
| `--background` | cream | green-deep |
| `--foreground` | ink | cream-50 |
| `--card` | paper | forest-950 |
| `--primary` | green | lime-bright |
| `--secondary`, `--muted` | sage-200 | forest-800 |
| `--muted-foreground` | ink-soft | sage |
| `--subtle` | ink-muted | sage-dim |
| `--border` | `#222c1821` | `#c4d0b029` |
| `--signal` | lime-deep | lime-bright |
| `--emphasis` | green-700 | lime-bright |
| `--destructive` | `#b3261e` | `#ff8a7a` |
| `--warn` | `#8a5a00` | `#f2b84b` |

## Type

| Role | Font | Where |
| --- | --- | --- |
| Display | Geist Variable 600, tracking -0.024em | Headings, agent name, tile values, numerals |
| Body | IBM Plex Sans Variable | Copy, buttons, inputs |
| Labels | IBM Plex Mono 400 and 500, 11px, tracking 0.12em, uppercase | Voice captions, session id, TTS headers |

All three ship as woff2 in `static/assets/`. The latin and latin-ext subsets cover English, Spanish and Catalan. Sizes in use: 24px console headline, 20px page title, 17px agent name, 16px card titles and tile values, 15px bubbles, 11px meta lines.

Measured on the live site, Orbio declares Geist for its display text but loads it only for the hero headline, so its other headings paint in `system-ui`. Here Geist carries all display text, as the brief asked. Body copy is Plex Sans, which is the font Orbio loads for it.

Orbio uses tracked mono labels only inside its phone mock. Here they appear on the live voice captions and nowhere else.

## Radii

Orbio's scale. 16px for panels and chat bubbles, with a 4px tail corner on each bubble. 8px for cards, buttons, inputs and the dock. 6px for tiles, pills and the avatar. Full radius for citation pills, the closing chip and badges.

Nested radii follow outer = inner + inset where the layout allows it. The citation pill is 14px around a 10px badge at a 4px inset, and 16px around a 12px badge on mobile. The two panels keep Orbio's 16px, so their 8px cards sit at a 16px inset and the corner gap runs about 20% wider than the edge gap. Making the panels 24px would be exactly concentric and would move them away from Orbio's 16px hero card.

## Shadows

Orbio's card recipe is `0 30px 60px -36px #222c1873` plus `inset 0 1px #fff9`. The "on" card uses `0 40px 80px -36px #222c18bf`. The two panels use the same recipe at other sizes (`--shadow-paper`, `--shadow-panel`).

## Motion

One easing from Orbio, `cubic-bezier(0.16, 1, 0.3, 1)`.

| Motion | Value |
| --- | --- |
| Buttons | 180ms on background, color, border, shadow and scale. Press scales to 0.96. |
| Card and dock flip | 400ms on background, border and shadow. Text color swaps at 200ms. |
| New message | 450ms from `translateY(10px) scale(0.98)` |
| Cited source | 700ms ring, then the card stays highlighted |
| Status dot | 1.4s opacity pulse while active |
| Typing dots | 1.1s, 0.15s apart, 3px lift |

`prefers-reduced-motion: reduce` zeroes every animation and transition. The components add their own cases: status text and the "Transcribing" label drop the shimmer, the transcript and the source card scroll without easing, and the visualizer keeps only bars driven by real audio.

## Orbio's product rules in the UI

**Transparent identity.** The agent card reads "Nova · AI Support Specialist" and "You're talking to an AI. A person is one request away." The status line shows idle, listening, transcribing, thinking, speaking or escalated. Speaking adds the voice source, ElevenLabs or browser voice. Precedence lives in `lib/agent-status.ts`: recording, voice upload, text request, playback, audio loading, escalated, idle.

**Every claim shows its source.** A cited KB badge in a Nova message shows a number, the title and the cosine score. Clicking it highlights the matching card under Retrieved sources, scrolls to it and replays the ring. On a phone the click also switches to the Specialist tab.

**Agents act, people decide.** The console opens with "Agents act. People decide.", then the Ticket draft and the Specialist handoff and summary. Guardrails, sources and telemetry follow in one container, split by a label and a hairline like Orbio's Trust Center. The raw session JSON sits in a collapsed drawer, and Download JSON sits in the header.

## Components

ElevenLabs UI (MIT, `ui.elevenlabs.io/r/<name>.json`), in `src/components/ui/`:

| Component | Used for |
| --- | --- |
| `bar-visualizer` | Dock bars, driven by the mic stream or the playing audio |
| `live-waveform` | Waveform inside the mic button while recording |
| `voice-button` | Mic button |
| `conversation` | Transcript scroll container and its scroll-to-bottom button |
| `message` | Bubble layout |
| `shimmering-text` | Status text while active, "Transcribing" label |
| `scrub-bar` | Playback scrubber |

Skipped: `orb`, which needs WebGL and three.js for one decorative element, and `audio-player`, which `scrub-bar` already covers.

shadcn/ui (nova preset, radix base): button, badge, card, switch, toggle, toggle-group, progress, alert, kbd, collapsible, input, input-group, textarea, avatar.

Local components: `agent/*` for the left panel, `console/*` for the right panel, `number-badge.tsx` and `source-focus.tsx`.

### Local patches

- `bar-visualizer`: a `barClassName` prop for the 3px bars, and named transition properties instead of `transition-all`.
- `live-waveform`: a `mediaStream` prop so the caller owns the stream, and a `cancelled` flag. Upstream leaves the microphone open when the component unmounts during the permission prompt. The flag releases it.
- `voice-button`: forwards `mediaStream`, and centers the fixed 20px waveform in the icon size. Upstream pins it to the top of the taller button.
- `button`, `card`, `toggle`: Orbio's radii, weights and 180ms transition. The card title is an `h3`.
- `progress`: forwards `value` to Radix.
- `conversation`, `message`, `scrub-bar`, `shimmering-text`: formatting, plus one type-only import.

## Client invariants

Carried over from the original `index.html` and kept in plain TypeScript, outside React.

| Invariant | Where |
| --- | --- |
| Blob cache keyed `${sessionId}:${turnId}`, in-flight dedupe, `revokeObjectURL` on New session | `lib/turn-audio-cache.ts` |
| `playSeq` cancels older playback | `lib/support-client.ts` |
| Stale-response guards on turn, voice, finalize and audio | `lib/support-client.ts` |
| `client_turn_id` reused when a network-failed text turn is retried | `lib/support-client.ts` |
| Space hold-to-talk with the `spaceHeld` and `startingMic` race guard | `lib/voice-input.ts`, `hooks/use-support.ts` |
| MIME fallback `audio/webm;codecs=opus`, `audio/webm`, `audio/mp4` | `lib/voice-input.ts` |
| `speechSynthesis` fallback in `en-US`, `es-ES`, `ca-ES` on HTTP 204 | `lib/support-client.ts`, `lib/languages.ts` |
| String and array FastAPI `detail` formatting | `lib/api.ts` |
| Frustration bar at `>= 70` red and `>= 60` amber, as in `domain.py` | `lib/frustration.ts` |
| Closed phases (`completed`, `escalated`, `canceled`) disable the composer | `lib/types.ts`, `components/agent/composer.tsx` |

Changes from the original: `busy` is tracked per session, New session cancels an open recording, microphone permission errors read differently from other errors, a blocked autoplay shows a banner, and the user's text appears as soon as it is sent.

32 Vitest tests cover these. The guards for retry id, stale response, dedupe, revoke on clear, stale audio, `playSeq`, the Space race and `audioLoading` were each broken on purpose once to confirm a test fails.

## Accessibility

A script walked every visible text node, composited its real background and computed WCAG contrast. Result: 0 failures against 4.5:1 for body text and 3:1 for large text.

| State | Viewport | Text nodes | Lowest ratio |
| --- | --- | --- | --- |
| Empty session | 1440 | 81 | 4.75 |
| Ticket completed | 1440 | 113 | 4.75 |
| Escalated | 1440 | 107 | 4.75 |
| Escalated, chat tab | 390 | 39 | 4.75 |
| Escalated, specialist tab | 390 | 73 | 5.06 |

The audit caught three misses, all fixed: pending tile digits at 2.8:1, a separator dot at 4.1:1 and the mobile tab counter at 4.4:1. Disabled controls are exempt and sit at about 3:1. `--ink-muted` is 4.75:1 on white and 4.39:1 on cream, so it is used on white and on the dark panel only.

Other points:

- The transcript is `role="log"`. The agent status is `role="status"`. Pending bubbles use `aria-live="polite"`.
- Language and view switches are labelled radio groups.
- Space belongs to the focused control when you type in a field or have tabbed onto a button.
- Focus rings use `--ring`.
- Tap targets measured at 390px: mic and Send 44px, view tabs 40px, buttons, language toggles and the Voice reply label 36px, preset chips, citation pills and Play audio 32px. All clear the 24px minimum in WCAG 2.2. The switch glyph is 32 by 18, so its 109 by 36 label is the target.

## Extending

**A fifth ticket slot is one line** in `TICKET_SLOTS` (`lib/ticket-slots.ts`). Checked: with a fifth line added, `tsc`, the 32 tests, ESLint and `vite build` pass, the grid renders five cells with the odd last cell spanning both columns, and the pill reads "0 of 5 fields". The slot stays Pending until the backend sends the field.

**A language** is one row in each of `LANGUAGE_OPTIONS` and `SPEECH_LOCALES` (`lib/languages.ts`).

**A sample chip** is one object in `lib/presets.ts`.

## Build and serve

```bash
cd frontend
npm install
npm run build   # tsc --noEmit, then vite build into ../src/support_agent/static/
npm run dev     # Vite on :5173, /api proxied to :8000
```

`vite build` empties and refills `src/support_agent/static/`. That folder is committed, so reviewing needs no Node. FastAPI serves `index.html` at `/` through the existing route and the hashed bundle at `/assets` through one `StaticFiles` mount in `api.py`. The folder is 756 KB.

## Decisions to review

- **Plex Sans for body copy.** The brief says Geist. Orbio's CSS says Plex Sans for body copy and Geist for display, so that is the split used.
- **16px panels.** Orbio's hero card radius. Exact concentricity needs 24px.
- **Mono labels cut back.** The first pass put a tracked mono eyebrow above every card. Orbio does not do that, and it read as a generic dashboard, so the eyebrows are gone.

## Known limits

- Tested in Chrome on macOS only. Safari and Firefox are untested for this UI.
- The automation tool sends key events with an empty `code`. Space hold-to-talk was driven with dispatched `KeyboardEvent`s carrying `code: "Space"`. The click-to-toggle path used the real mic button.
- Chrome's fake audio device returned silence from a WAV file. The recording tests replaced `getUserMedia` with a WebAudio stream playing real speech. That clip went through the real MediaRecorder, `gpt-transcribe` and the engine, and came back as "Hi, my espresso machine from order ORD-48291 arrived with a crack."
- The ElevenLabs registry sits behind a Vercel bot check. `curl` and `npx shadcn add` got HTTP 429, so the component JSON was fetched in a browser session and installed from disk. Adding another ElevenLabs component later needs the same step.
- The 204 fallback was checked on a second server started with an empty `ELEVENLABS_API_KEY`.
- Text turns retry safely with the same `client_turn_id`. A failed voice upload shows "Network error uploading audio." and the customer records again. The API can replay a repeated voice upload, but this UI never resends one.
- `GET /` sends `ETag` and `Last-Modified` but no `Cache-Control`. After a rebuild, a browser can keep showing the previous UI until a hard refresh. A first visit is not affected. The fix is a `Cache-Control` header on the `/` route in `api.py`.
- Nothing checks that `src/support_agent/static/` matches `frontend/src`. Rebuild and commit the folder after every UI change. A CI step that runs `npm run build` and fails on a diff would close this.

import { useEffect, useSyncExternalStore } from "react"

import { SupportClient, type SupportState } from "@/lib/support-client"

export const supportClient = new SupportClient()

export const useSupport = (): SupportState =>
  useSyncExternalStore(supportClient.subscribe, supportClient.getSnapshot)

// Space belongs to the control when the user is typing in a field or has
// keyboard-focused a widget. After a mouse click focus-visible is false, so
// Space still means push-to-talk.
function spaceBelongsToTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target.matches("input, textarea, select"))
    return true
  return (
    target.matches("button, a[href], summary, [role]") &&
    target.matches(":focus-visible")
  )
}

export function useSpaceToTalk(): void {
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.code !== "Space" || ev.ctrlKey || ev.metaKey || ev.altKey) return
      if (spaceBelongsToTarget(ev.target)) return
      ev.preventDefault()
      if (!ev.repeat) supportClient.spaceDown()
    }
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.code !== "Space" || !supportClient.voice.spacePressed) return
      ev.preventDefault()
      supportClient.spaceUp()
    }
    // A key released while the window is unfocused never fires keyup.
    const release = () => {
      if (supportClient.voice.spacePressed) supportClient.spaceUp()
    }
    const onVisibility = () => {
      if (document.hidden) release()
    }

    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    window.addEventListener("blur", release)
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
      window.removeEventListener("blur", release)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [])
}

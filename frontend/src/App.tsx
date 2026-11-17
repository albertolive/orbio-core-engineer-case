import { useEffect, useState } from "react"

import { ConversationPanel } from "@/components/agent/conversation-panel"
import { ConsolePanel } from "@/components/console/console-panel"
import { SourceFocusProvider } from "@/components/source-focus"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { supportClient, useSpaceToTalk, useSupport } from "@/hooks/use-support"
import { TICKET_SLOTS, filledSlotCount } from "@/lib/ticket-slots"
import { cn } from "@/lib/utils"

type View = "chat" | "console"

export function App() {
  const { session } = useSupport()
  const [view, setView] = useState<View>("chat")
  useSpaceToTalk()

  useEffect(() => {
    void supportClient.init()
  }, [])

  return (
    // A citation click reveals its source card, which on small screens lives in the other view.
    <SourceFocusProvider onCite={() => setView("console")}>
      <div className="mx-auto flex h-dvh max-w-[1440px] flex-col gap-3 p-3 md:p-5">
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={0}
          value={view}
          onValueChange={(next) => {
            if (next) setView(next as View)
          }}
          aria-label="View"
          className="w-full shrink-0 lg:hidden"
        >
          <ToggleGroupItem value="chat" className="h-10 flex-1">
            Conversation
          </ToggleGroupItem>
          <ToggleGroupItem value="console" className="h-10 flex-1">
            Specialist
            {session && (
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {filledSlotCount(session.draft)}/{TICKET_SLOTS.length}
              </span>
            )}
          </ToggleGroupItem>
        </ToggleGroup>

        <main className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(24rem,1fr)]">
          <ConversationPanel
            className={cn(view !== "chat" && "max-lg:hidden")}
          />
          <ConsolePanel className={cn(view !== "console" && "max-lg:hidden")} />
        </main>
      </div>
    </SourceFocusProvider>
  )
}

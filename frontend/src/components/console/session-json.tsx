import { useState } from "react"
import { ChevronDownIcon } from "lucide-react"

import { Card } from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import type { ConversationSession } from "@/lib/types"
import { cn } from "@/lib/utils"

export function SessionJson({ session }: { session: ConversationSession }) {
  const [open, setOpen] = useState(false)
  return (
    <Card className="gap-0 py-0">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between gap-3 px-(--card-spacing) py-3.5 text-left font-heading text-sm font-semibold tracking-[-0.01em]">
          Persisted session JSON
          <ChevronDownIcon
            className={cn(
              "size-4 transition-transform duration-200",
              open && "rotate-180"
            )}
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="max-h-72 scroll-thin overflow-auto border-t bg-background/60 p-(--card-spacing) font-mono text-[0.6875rem] leading-relaxed">
            {JSON.stringify(session, null, 2)}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

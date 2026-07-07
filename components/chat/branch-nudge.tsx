"use client"

import { X } from "lucide-react"
import { Button } from "@/components/ui/button"

export function BranchNudge({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="ml-1 mt-2 max-w-[80%] rounded-lg border border-border/50 border-l-2 border-l-thread bg-accent-soft/40 px-3.5 py-3 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Branch
          </p>
          <p className="mt-1 text-sm leading-relaxed text-foreground">
            Hover this reply → Branch from here. Tell the branch a secret, close
            it with merge ON, then ask the main chat about the secret.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground"
          onClick={onDismiss}
          aria-label="Dismiss branch hint"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

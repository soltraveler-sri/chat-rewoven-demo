"use client"

import { cn } from "@/lib/utils"

interface TypingIndicatorProps {
  className?: string
}

export function TypingIndicator({ className }: TypingIndicatorProps) {
  return (
    <div
      className={cn(
        "flex justify-start w-full animate-message-in",
        className
      )}
    >
      <div className="bg-card border border-border/40 shadow-sm rounded-2xl rounded-bl-md px-4 py-3">
        <div className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-typing-dot" />
          <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-typing-dot animation-delay-150" />
          <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-typing-dot animation-delay-300" />
        </div>
      </div>
    </div>
  )
}

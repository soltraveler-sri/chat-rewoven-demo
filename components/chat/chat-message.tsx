"use client"

import { GitBranch, GitMerge } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { MarkdownContent } from "@/components/ui/markdown-content"
import { BranchChip } from "./branch-chip"
import type { ChatMessage, BranchThread } from "@/lib/types"

interface ChatMessageProps {
  message: ChatMessage
  onBranch?: (localId: string, responseId: string) => void
  branches?: BranchThread[]
  onOpenBranch?: (branchId: string) => void
}

export function ChatMessageBubble({
  message,
  onBranch,
  branches = [],
  onOpenBranch,
}: ChatMessageProps) {
  const isUser = message.role === "user"
  const isAssistant = message.role === "assistant"
  const isContext = message.role === "context"

  const handleBranch = () => {
    if (isAssistant && message.responseId && onBranch) {
      onBranch(message.localId, message.responseId)
    }
  }

  const handleOpenBranch = (branchId: string) => {
    if (onOpenBranch) {
      onOpenBranch(branchId)
    }
  }

  // Render compact context indicator for merged branch content
  if (isContext && message.contextMeta) {
    const { branchTitle } = message.contextMeta

    return (
      <div className="flex w-full justify-center animate-chip-in">
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
          <GitMerge className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
          <span className="text-xs text-emerald-700 dark:text-emerald-300">
            Branch &ldquo;{branchTitle}&rdquo; context added
          </span>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "group flex flex-col w-full animate-message-in",
        isUser ? "items-end" : "items-start"
      )}
    >
      <div className="flex w-full" style={{ justifyContent: isUser ? "flex-end" : "flex-start" }}>
        <div
          className={cn(
            "relative max-w-[80%] rounded-2xl px-4 py-2.5",
            isUser
              ? "bg-primary text-primary-foreground rounded-br-md"
              : "bg-muted text-foreground rounded-bl-md"
          )}
        >
          {isUser ? (
            <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
              {message.text}
            </p>
          ) : (
            <MarkdownContent content={message.text} />
          )}

          {/* Branch button for assistant messages */}
          {isAssistant && message.responseId && (
            <div className="absolute -right-1 top-1/2 -translate-y-1/2 translate-x-full opacity-0 group-hover:opacity-100 transition-opacity">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={handleBranch}
                  >
                    <GitBranch className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>Branch from here</p>
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>
      </div>

      {/* Branch chips below assistant messages */}
      {isAssistant && branches.length > 0 && (
        <div className="mt-1.5 ml-1">
          <BranchChip branches={branches} onOpenBranch={handleOpenBranch} />
        </div>
      )}
    </div>
  )
}

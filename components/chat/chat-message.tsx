"use client"

import { GitBranch, GitMerge } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { MarkdownContent } from "@/components/ui/markdown-content"
import { BranchChip } from "./branch-chip"
import { AudioPlayer, type TTSStreamConfig } from "./audio-player"
import type { ChatMessage, BranchThread } from "@/lib/types"

interface ChatMessageProps {
  message: ChatMessage
  onBranch?: (localId: string, responseId: string) => void
  branches?: BranchThread[]
  onOpenBranch?: (branchId: string) => void
  /** Streaming TTS config — passed through to AudioPlayer for progressive playback */
  audioStreamConfig?: TTSStreamConfig
  onAudioPlaybackStart?: () => void
}

export function ChatMessageBubble({
  message,
  onBranch,
  branches = [],
  onOpenBranch,
  audioStreamConfig,
  onAudioPlaybackStart,
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
      <div className="flex w-full justify-start animate-chip-in">
        <div className="inline-flex items-center gap-2 rounded-md border-l-2 border-l-thread bg-success/10 px-3 py-1.5">
          <GitMerge className="h-3.5 w-3.5 shrink-0 text-success" />
          <span className="text-xs font-medium text-success">
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
              ? "bg-accent-soft text-foreground rounded-br-md"
              : "bg-card text-foreground rounded-bl-md border border-border/40 shadow-sm"
          )}
        >
          {isUser ? (
            <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
              {message.text}
            </p>
          ) : (
            <MarkdownContent content={message.text} />
          )}

          {/* Audio player for doc-read messages (streaming or static) */}
          {isAssistant && (message.audioUrl || audioStreamConfig) && (
            <AudioPlayer
              audioUrl={message.audioUrl}
              streamConfig={audioStreamConfig}
              filename={message.audioMeta?.filename}
              voice={message.audioMeta?.voice}
              onPlaybackStart={onAudioPlaybackStart}
              className="mt-2"
            />
          )}

        </div>
      </div>

      {/* Branch affordance + existing branch chips below assistant messages.
          Always visible — branching is a core move, not a hover secret. */}
      {isAssistant && message.responseId && (
        <div className="ml-1 mt-1.5 flex flex-wrap items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleBranch}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-secondary/40 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors duration-200 hover:border-thread/40 hover:bg-accent-soft hover:text-primary"
              >
                <GitBranch className="h-3 w-3" />
                Branch
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Open a side thread from this reply</p>
            </TooltipContent>
          </Tooltip>
          {branches.length > 0 && (
            <BranchChip branches={branches} onOpenBranch={handleOpenBranch} />
          )}
        </div>
      )}
    </div>
  )
}

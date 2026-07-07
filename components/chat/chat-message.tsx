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

          {/* Branch button for assistant messages */}
          {isAssistant && message.responseId && (
            <div className="absolute -right-1 top-1/2 -translate-y-1/2 translate-x-full opacity-0 group-hover:opacity-100 transition-opacity">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-primary"
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

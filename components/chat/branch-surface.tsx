"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import {
  GitBranch,
  Zap,
  Brain,
  MoreHorizontal,
  Check,
  FileText,
  List,
  Loader2,
  Send,
  X,
} from "lucide-react"
import { toast } from "sonner"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { MarkdownContent } from "@/components/ui/markdown-content"
import { TypingIndicator } from "./typing-indicator"
import { cn } from "@/lib/utils"
import type { BranchThread, ChatMessage, RespondResponse } from "@/lib/types"

function generateId(): string {
  return crypto.randomUUID()
}

/**
 * Result of closing a branch - returned to parent for merge handling
 */
export interface BranchCloseResult {
  /** The branch that was closed */
  branch: BranchThread
  /** Whether to merge into main */
  shouldMerge: boolean
  /** If merging, the mode to use */
  mergeMode?: "summary" | "full"
}

/**
 * Decide how a branch should close and notify the parent.
 *
 * Shared by every way out of a branch — the ✕ button, the Escape key, and
 * clicking the dimmed main chat — so merge semantics can't drift between
 * exits. Returns true when the close will trigger a merge.
 */
export function requestBranchClose(
  branch: BranchThread,
  onClose: (result?: BranchCloseResult) => void
): boolean {
  // Nothing to merge — close quietly (with a note if content stays separate)
  if (branch.messages.length === 0 || !branch.includeInMain) {
    if (branch.messages.length > 0 && !branch.includeInMain) {
      toast.info("Branch kept separate", {
        description: "Side thread was not merged into main.",
      })
    }
    onClose({ branch, shouldMerge: false })
    return false
  }

  // Already merged — just close
  if (branch.mergedIntoMain) {
    onClose({ branch, shouldMerge: false })
    return false
  }

  onClose({ branch, shouldMerge: true, mergeMode: branch.includeMode })
  return true
}

interface BranchSurfaceProps {
  branch: BranchThread
  parentMessageText: string
  onClose: (result?: BranchCloseResult) => void
  onUpdateBranch: (updatedBranch: BranchThread) => void
}

/**
 * The branch as a second writing surface.
 *
 * Not a side panel and not a modal: when a branch opens it takes over the
 * right side as its own page, the main chat stays faintly visible on the
 * left, and the only border between them is a single quiet seam with a
 * small knot marking the point where the thread splits.
 */
export function BranchSurface({
  branch,
  parentMessageText,
  onClose,
  onUpdateBranch,
}: BranchSurfaceProps) {
  const [inputValue, setInputValue] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [isClosing, setIsClosing] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const shouldAutoScroll = useRef(true)
  /** Set when the branch title is still the auto-truncation of message one */
  const pendingTitleRef = useRef(false)

  // Reset transient state when a different branch opens
  useEffect(() => {
    setInputValue("")
    shouldAutoScroll.current = true
    setIsClosing(false)
    textareaRef.current?.focus()
  }, [branch.id])

  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const { scrollTop, scrollHeight, clientHeight } = container
    shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 100
  }, [])

  useEffect(() => {
    if (shouldAutoScroll.current && branch.messages.length) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [branch.messages, isLoading])

  // Auto-resize the composer textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = "auto"
      textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`
    }
  }, [inputValue])

  const handleModeChange = (mode: "fast" | "deep") => {
    onUpdateBranch({ ...branch, mode, updatedAt: Date.now() })
  }

  const handleIncludeToggle = () => {
    if (branch.mergedIntoMain) return
    onUpdateBranch({
      ...branch,
      includeInMain: !branch.includeInMain,
      updatedAt: Date.now(),
    })
  }

  const handleIncludeModeChange = (mode: "summary" | "full") => {
    onUpdateBranch({ ...branch, includeMode: mode, updatedAt: Date.now() })
  }

  const handleClose = () => {
    if (isClosing) return
    const willMerge = requestBranchClose(branch, onClose)
    if (willMerge) setIsClosing(true)
  }

  // Escape closes the branch (same semantics as every other exit)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch, isClosing])

  /**
   * Give the branch a real title once the first exchange exists.
   * The instant truncation stays as a fallback if the title call fails.
   */
  const generateBranchTitle = useCallback(
    async (base: BranchThread, userText: string, assistantText: string) => {
      try {
        const res = await fetch("/api/chats/generate-title", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userMessage: userText.slice(0, 500),
            assistantMessage: assistantText.slice(0, 500),
          }),
        })
        if (!res.ok) return
        const data = (await res.json()) as { title?: string }
        if (data.title && pendingTitleRef.current) {
          pendingTitleRef.current = false
          onUpdateBranch({ ...base, title: data.title, updatedAt: Date.now() })
        }
      } catch {
        // Fallback truncation title stays
      }
    },
    [onUpdateBranch]
  )

  const handleSend = async () => {
    const userText = inputValue.trim()
    if (!userText || isLoading || isClosing) return

    const userMessage: ChatMessage = {
      localId: generateId(),
      role: "user",
      text: userText,
      createdAt: Date.now(),
    }

    const isFirstMessage = branch.messages.length === 0
    if (isFirstMessage) pendingTitleRef.current = true

    const updatedBranchWithUser: BranchThread = {
      ...branch,
      messages: [...branch.messages, userMessage],
      updatedAt: Date.now(),
      title: isFirstMessage
        ? userText.slice(0, 40) + (userText.length > 40 ? "…" : "")
        : branch.title,
    }
    onUpdateBranch(updatedBranchWithUser)
    setInputValue("")
    setIsLoading(true)
    shouldAutoScroll.current = true

    try {
      // Chain from the branch's own head, or fork from the parent reply
      const previousResponseId =
        branch.lastResponseId || branch.parentAssistantResponseId

      const res = await fetch("/api/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: userText,
          previous_response_id: previousResponseId,
          mode: branch.mode,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || "Failed to get response")
      }
      const responseData = data as RespondResponse

      const assistantMessage: ChatMessage = {
        localId: generateId(),
        role: "assistant",
        text: responseData.output_text,
        createdAt: Date.now(),
        responseId: responseData.id,
      }

      const updatedBranchWithAssistant: BranchThread = {
        ...updatedBranchWithUser,
        messages: [...updatedBranchWithUser.messages, assistantMessage],
        lastResponseId: responseData.id,
        updatedAt: Date.now(),
      }
      onUpdateBranch(updatedBranchWithAssistant)

      if (isFirstMessage) {
        generateBranchTitle(updatedBranchWithAssistant, userText, responseData.output_text)
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Something went wrong"
      toast.error(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    }
  }

  const truncatedParentText =
    parentMessageText.length > 90
      ? parentMessageText.slice(0, 90) + "…"
      : parentMessageText

  const includeHint = branch.includeInMain && !branch.mergedIntoMain
    ? branch.includeMode === "summary"
      ? "A summary will be woven into the main chat when you close this branch."
      : "The full transcript will be woven into the main chat when you close this branch."
    : null

  return (
    <section
      aria-label="Branch side thread"
      className="relative flex h-full w-[58%] min-w-0 shrink-0 flex-col bg-background animate-message-in"
    >
      {/* The seam: a single quiet line marking where the thread splits */}
      <div aria-hidden className="absolute inset-y-0 left-0 w-px bg-thread/30" />
      <div
        aria-hidden
        className="absolute left-0 top-[38%] -translate-x-1/2 rounded-full bg-background p-1 text-thread/80"
      >
        <GitBranch className="h-3 w-3" />
      </div>

      {/* Header: eyebrow + controls, title, provenance */}
      <header className="shrink-0 px-8 pb-4 pt-6 lg:px-10">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.1em] text-thread">
            <span aria-hidden className="h-px w-5 bg-thread/50" />
            <GitBranch className="h-3 w-3" />
            Branch
          </span>

          <div className="flex items-center gap-2">
            {/* Fast / Deep */}
            <div className="flex items-center gap-0.5 rounded-lg bg-secondary/70 p-0.5">
              <button
                onClick={() => handleModeChange("fast")}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors duration-200",
                  branch.mode === "fast"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Zap className="h-3 w-3" />
                Fast
              </button>
              <button
                onClick={() => handleModeChange("deep")}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors duration-200",
                  branch.mode === "deep"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Brain className="h-3 w-3" />
                Deep
              </button>
            </div>

            {/* Include-in-main pill (click to toggle) */}
            <button
              type="button"
              onClick={handleIncludeToggle}
              disabled={branch.mergedIntoMain}
              aria-pressed={branch.includeInMain}
              aria-label="Include in main context"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-200",
                branch.mergedIntoMain
                  ? "border-success/25 bg-success/10 text-success"
                  : branch.includeInMain
                    ? "border-success/25 bg-success/10 text-success hover:bg-success/15"
                    : "border-border/60 bg-secondary/50 text-muted-foreground hover:text-foreground"
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  branch.mergedIntoMain || branch.includeInMain
                    ? "bg-success"
                    : "border border-muted-foreground/60"
                )}
              />
              {branch.mergedIntoMain
                ? "Merged into main"
                : branch.includeInMain
                  ? "Including main context"
                  : "Kept separate"}
            </button>

            {/* Merge-mode menu (only meaningful when including) */}
            {branch.includeInMain && !branch.mergedIntoMain && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    aria-label="Merge options"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem
                    onClick={() => handleIncludeModeChange("summary")}
                    className="flex cursor-pointer items-center gap-2"
                  >
                    <List className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="flex-1">Include as summary</span>
                    {branch.includeMode === "summary" && (
                      <Check className="h-3.5 w-3.5 text-primary" />
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleIncludeModeChange("full")}
                    className="flex cursor-pointer items-center gap-2"
                  >
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="flex-1">Include full transcript</span>
                    {branch.includeMode === "full" && (
                      <Check className="h-3.5 w-3.5 text-primary" />
                    )}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={handleClose}
              aria-label="Close branch"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <h2 className="font-display mt-5 text-3xl font-medium leading-tight text-foreground/95">
          {branch.title}
        </h2>
        <p className="mt-2 line-clamp-1 text-xs italic text-muted-foreground/70">
          Branched from: &ldquo;{truncatedParentText}&rdquo;
        </p>
        {includeHint && (
          <p className="mt-1.5 text-[11px] text-muted-foreground/60">{includeHint}</p>
        )}
      </header>

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        {branch.messages.length === 0 && !isLoading ? (
          <div className="flex h-full flex-col items-center justify-center px-8 pb-16 text-center">
            <p className="font-display text-lg text-foreground/80">
              A fresh side thread
            </p>
            <p className="mt-2 max-w-[280px] text-xs leading-relaxed text-muted-foreground">
              Explore here without touching the main conversation — it can be
              woven back in when you&rsquo;re done.
            </p>
            <p className="mt-3 max-w-[280px] text-xs leading-relaxed text-muted-foreground/70">
              Try it: tell this branch a secret, close it with the context pill
              set to{" "}
              <span className="font-medium text-success">including</span>, then
              ask the main chat about the secret.
            </p>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-2xl space-y-5 px-8 py-4 lg:px-10">
            {branch.messages.map((message) => (
              <BranchMessage key={message.localId} message={message} />
            ))}
            {isLoading && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Composer: a real page composer, not a utility strip */}
      <div className="shrink-0 px-8 pb-6 pt-2 lg:px-10">
        <div className="mx-auto flex w-full max-w-2xl items-end gap-2 rounded-xl border border-border/60 bg-card/70 p-2 shadow-[0_2px_16px_rgba(0,0,0,0.04)] focus-within:border-ring/50">
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Continue this side thread…"
            disabled={isLoading || isClosing}
            rows={1}
            className="max-h-[160px] min-h-[38px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground/70 disabled:opacity-60"
          />
          <Button
            onClick={handleSend}
            disabled={isLoading || isClosing || !inputValue.trim()}
            size="icon"
            className="h-9 w-9 shrink-0"
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Merge-in-progress veil while the parent performs the merge */}
      {isClosing && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70 backdrop-blur-[2px]">
          <div className="flex min-w-[260px] flex-col items-center gap-3 rounded-xl border border-border/60 bg-card p-6 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <div className="space-y-1 text-center">
              <h3 className="text-sm font-medium text-foreground">
                Weaving this branch back in
              </h3>
              <p className="text-xs text-muted-foreground">
                {branch.includeMode === "summary"
                  ? "Summarizing the side thread…"
                  : "Carrying the full transcript across…"}
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * Branch messages: same material as the main chat, with quiet role labels
 * that make the surface read as its own page.
 */
function BranchMessage({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user"
  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })

  return (
    <div className={cn("flex w-full flex-col animate-message-in", isUser ? "items-end" : "items-start")}>
      <span className="mb-1 px-1 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
        {isUser ? "You" : "Assistant"}
      </span>
      <div
        className={cn(
          "relative max-w-[88%] rounded-2xl px-4 py-2.5",
          isUser
            ? "bg-accent-soft text-foreground rounded-br-md"
            : "bg-card text-foreground rounded-bl-md border border-border/40 shadow-sm"
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {message.text}
          </p>
        ) : (
          <MarkdownContent content={message.text} />
        )}
      </div>
      <span className="mt-1 px-1 text-[10px] tabular-nums text-muted-foreground/50">
        {time}
      </span>
    </div>
  )
}

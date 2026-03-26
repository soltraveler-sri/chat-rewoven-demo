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
  PanelRight,
  Maximize2,
  Loader2,
} from "lucide-react"
import { toast } from "sonner"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetDescription,
} from "@/components/ui/sheet"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { MarkdownContent } from "@/components/ui/markdown-content"
import { Composer } from "./composer"
import { TypingIndicator } from "./typing-indicator"
import { cn } from "@/lib/utils"
import type { BranchThread, ChatMessage, RespondResponse } from "@/lib/types"

function generateId(): string {
  return crypto.randomUUID()
}

// View mode type for branch viewer
type BranchViewMode = "panel" | "overlay"

// localStorage key for persisting view mode preference
const VIEW_MODE_STORAGE_KEY = "branchViewMode"

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

interface BranchOverlayProps {
  branch: BranchThread | null
  parentMessageText: string
  isOpen: boolean
  onClose: (result?: BranchCloseResult) => void
  onUpdateBranch: (updatedBranch: BranchThread) => void
}

/**
 * Animated merge progress overlay component
 * Shows a polished, clearly-animated loading state during merge operations
 */
function MergeProgressOverlay({ mergeMode }: { mergeMode: "summary" | "full" }) {
  return (
    <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-xl p-6 shadow-xl flex flex-col items-center gap-4 min-w-[280px]">
        {/* Animated spinner using Loader2 with animate-spin */}
        <div className="relative">
          <Loader2 className="h-10 w-10 text-primary animate-spin" />
        </div>

        {/* Title and subtitle */}
        <div className="text-center space-y-1">
          <h3 className="text-sm font-medium text-foreground">
            Adding to main context
          </h3>
          <p className="text-xs text-muted-foreground">
            {mergeMode === "summary"
              ? "Summarizing this side thread…"
              : "Preparing full transcript…"}
          </p>
        </div>

        {/* Animated shimmer progress bar */}
        <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
          <div className="h-full w-1/2 bg-gradient-to-r from-transparent via-primary/50 to-transparent animate-shimmer" />
        </div>

        {/* Timing hint */}
        <p className="text-[10px] text-muted-foreground/60">
          Usually takes 5–10 seconds
        </p>
      </div>
    </div>
  )
}

export function BranchOverlay({
  branch,
  parentMessageText,
  isOpen,
  onClose,
  onUpdateBranch,
}: BranchOverlayProps) {
  const [inputValue, setInputValue] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [isClosing, setIsClosing] = useState(false)

  // View mode state with localStorage persistence
  const [viewMode, setViewMode] = useState<BranchViewMode>(() => {
    if (typeof window === "undefined") return "panel"
    const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY)
    return (stored === "overlay" ? "overlay" : "panel") as BranchViewMode
  })

  // Persist view mode changes to localStorage
  const handleViewModeChange = useCallback((mode: BranchViewMode) => {
    setViewMode(mode)
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode)
  }, [])

  // Refs for autoscroll behavior
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const shouldAutoScroll = useRef(true)

  // Reset input when branch changes
  useEffect(() => {
    setInputValue("")
    shouldAutoScroll.current = true
    setIsClosing(false)
  }, [branch?.id])

  // Track if user has scrolled away from bottom
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const { scrollTop, scrollHeight, clientHeight } = container
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight
    shouldAutoScroll.current = distanceFromBottom < 100
  }, [])

  // Autoscroll to bottom when new messages arrive
  useEffect(() => {
    if (shouldAutoScroll.current && branch?.messages.length) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [branch?.messages, isLoading])

  // Handle mode toggle
  const handleModeChange = (mode: "fast" | "deep") => {
    if (!branch) return
    onUpdateBranch({
      ...branch,
      mode,
      updatedAt: Date.now(),
    })
  }

  // Handle include in main toggle
  const handleIncludeInMainChange = (checked: boolean) => {
    if (!branch) return
    onUpdateBranch({
      ...branch,
      includeInMain: checked,
      updatedAt: Date.now(),
    })
  }

  // Handle include mode change (advanced)
  const handleIncludeModeChange = (mode: "summary" | "full") => {
    if (!branch) return
    onUpdateBranch({
      ...branch,
      includeMode: mode,
      updatedAt: Date.now(),
    })
  }

  // Handle closing the sheet/dialog
  const handleContainerClose = async () => {
    if (!branch || isClosing) return

    // If no messages or not including in main, just close
    if (branch.messages.length === 0 || !branch.includeInMain) {
      if (branch.messages.length > 0 && !branch.includeInMain) {
        toast.info("Branch kept separate", {
          description: "Side thread was not merged into main.",
        })
      }
      onClose({
        branch,
        shouldMerge: false,
      })
      return
    }

    // Already merged - just close
    if (branch.mergedIntoMain) {
      onClose({
        branch,
        shouldMerge: false,
      })
      return
    }

    // Need to merge - signal parent to handle it
    setIsClosing(true)
    onClose({
      branch,
      shouldMerge: true,
      mergeMode: branch.includeMode,
    })
  }

  // Handle sending a message in the branch
  const handleSend = async () => {
    if (!branch) return

    const userText = inputValue.trim()
    if (!userText || isLoading) return

    // Create user message
    const userMessage: ChatMessage = {
      localId: generateId(),
      role: "user",
      text: userText,
      createdAt: Date.now(),
    }

    // Immediately update branch with user message
    const updatedBranchWithUser: BranchThread = {
      ...branch,
      messages: [...branch.messages, userMessage],
      updatedAt: Date.now(),
      // Update title if this is the first message
      title:
        branch.messages.length === 0
          ? userText.slice(0, 30) + (userText.length > 30 ? "..." : "")
          : branch.title,
    }
    onUpdateBranch(updatedBranchWithUser)
    setInputValue("")
    setIsLoading(true)
    shouldAutoScroll.current = true

    try {
      // Determine previous_response_id for chaining
      // If branch has messages, use branch's lastResponseId
      // Otherwise, fork from parent assistant message
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

      // Create assistant message with responseId
      const assistantMessage: ChatMessage = {
        localId: generateId(),
        role: "assistant",
        text: responseData.output_text,
        createdAt: Date.now(),
        responseId: responseData.id,
      }

      // Update branch with assistant message and lastResponseId
      const updatedBranchWithAssistant: BranchThread = {
        ...updatedBranchWithUser,
        messages: [...updatedBranchWithUser.messages, assistantMessage],
        lastResponseId: responseData.id,
        updatedAt: Date.now(),
      }
      onUpdateBranch(updatedBranchWithAssistant)
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Something went wrong"
      toast.error(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  if (!branch) return null

  const truncatedParentText =
    parentMessageText.length > 60
      ? parentMessageText.slice(0, 60) + "..."
      : parentMessageText

  // Shared header content for both modes
  const headerContent = (
    <>
      <div className="flex items-center justify-between pr-8">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
          {/* View mode toggle: Side panel vs Overlay */}
          <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
            <button
              onClick={() => handleViewModeChange("panel")}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all duration-200",
                viewMode === "panel"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title="Side panel view"
            >
              <PanelRight className="h-3 w-3" />
              <span className="hidden sm:inline">Panel</span>
            </button>
            <button
              onClick={() => handleViewModeChange("overlay")}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all duration-200",
                viewMode === "overlay"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title="Overlay view"
            >
              <Maximize2 className="h-3 w-3" />
              <span className="hidden sm:inline">Overlay</span>
            </button>
          </div>
          {branch.mergedIntoMain && (
            <span className="text-[10px] bg-green-500/10 text-green-600 dark:text-green-400 px-1.5 py-0.5 rounded-full font-medium">
              merged
            </span>
          )}
        </div>
        {/* Fast/Deep segmented control */}
        <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
          <button
            onClick={() => handleModeChange("fast")}
            className={cn(
              "flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all duration-200",
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
              "flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all duration-200",
              branch.mode === "deep"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Brain className="h-3 w-3" />
            Deep
          </button>
        </div>
      </div>
    </>
  )

  // Shared description content
  const descriptionContent = (
    <span className="text-xs text-muted-foreground/70 line-clamp-1 text-left italic">
      Branched from: &ldquo;{truncatedParentText}&rdquo;
    </span>
  )

  // Include in main toggle section
  const includeToggleSection = (
    <div className="px-4 py-2.5 border-b border-border shrink-0 bg-muted/30">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Label
            htmlFor="include-in-main"
            className="text-xs text-muted-foreground cursor-pointer"
          >
            Include in main context
          </Label>
          {/* Advanced options dropdown - only show when include is enabled */}
          {branch.includeInMain && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 text-muted-foreground hover:text-foreground"
                >
                  <MoreHorizontal className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuItem
                  onClick={() => handleIncludeModeChange("summary")}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <List className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="flex-1">Include as summary</span>
                  {branch.includeMode === "summary" && (
                    <Check className="h-3.5 w-3.5 text-primary" />
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleIncludeModeChange("full")}
                  className="flex items-center gap-2 cursor-pointer"
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
        </div>
        <Switch
          id="include-in-main"
          checked={branch.includeInMain}
          onCheckedChange={handleIncludeInMainChange}
          disabled={branch.mergedIntoMain}
        />
      </div>
      {branch.includeInMain && !branch.mergedIntoMain && (
        <p className="text-[10px] text-muted-foreground/60 mt-1">
          {branch.includeMode === "summary"
            ? "Summary will be added to main chat when closed"
            : "Full transcript will be added to main chat when closed"}
        </p>
      )}
    </div>
  )

  // Messages area content
  const messagesContent = (
    <div
      ref={messagesContainerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto"
    >
      {branch.messages.length === 0 && !isLoading ? (
        // Empty state
        <div className="flex flex-col items-center justify-center h-full text-center p-6">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
            <GitBranch className="h-5 w-5 text-muted-foreground" />
          </div>
          <h3 className="text-sm font-medium mb-1">Start a side thread</h3>
          <p className="text-xs text-muted-foreground max-w-[200px]">
            Explore alternate ideas without affecting the main conversation.
          </p>
        </div>
      ) : (
        // Messages list
        <div className="p-4 space-y-3">
          {branch.messages.map((message) => (
            <BranchMessage key={message.localId} message={message} />
          ))}
          {isLoading && <TypingIndicator />}
          <div ref={messagesEndRef} />
        </div>
      )}
    </div>
  )

  // Composer section
  const composerSection = (
    <Composer
      value={inputValue}
      onChange={setInputValue}
      onSend={handleSend}
      disabled={isLoading || isClosing}
      placeholder="Continue side thread..."
      className="border-t"
    />
  )

  // Merge progress overlay (shown during closing/merging)
  const mergeOverlay = isClosing && (
    <MergeProgressOverlay mergeMode={branch.includeMode} />
  )

  // Render side panel (Sheet) mode
  if (viewMode === "panel") {
    return (
      <Sheet open={isOpen} onOpenChange={(open) => !open && handleContainerClose()}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md flex flex-col p-0 gap-0"
        >
          <SheetHeader className="px-4 py-3 border-b border-border shrink-0">
            {headerContent}
            <SheetDescription asChild>{descriptionContent}</SheetDescription>
          </SheetHeader>
          {includeToggleSection}
          {messagesContent}
          {composerSection}
          {mergeOverlay}
        </SheetContent>
      </Sheet>
    )
  }

  // Render overlay (Dialog) mode
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleContainerClose()}>
      <DialogContent
        hideCloseButton={false}
        className="w-full max-w-[900px] h-[80vh] flex flex-col p-0 gap-0"
      >
        <DialogHeader className="px-4 py-3 border-b border-border shrink-0">
          {headerContent}
          <DialogDescription asChild>{descriptionContent}</DialogDescription>
        </DialogHeader>
        {includeToggleSection}
        {messagesContent}
        {composerSection}
        {mergeOverlay}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Simplified message component for branch (no branch button - no nesting allowed)
 * NOTE: "No nesting" means you cannot create a branch from inside a branch.
 */
function BranchMessage({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user"

  return (
    <div
      className={cn(
        "flex w-full animate-message-in",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "relative max-w-[85%] rounded-2xl px-3 py-2",
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
      </div>
    </div>
  )
}

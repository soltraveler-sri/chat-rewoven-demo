"use client"

import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { RotateCcw, MessageSquare, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { TooltipProvider } from "@/components/ui/tooltip"
import {
  ChatMessageBubble,
  TypingIndicator,
  Composer,
  BranchSurface,
  requestBranchClose,
} from "@/components/chat"
import type { BranchCloseResult } from "@/components/chat"
import type {
  ChatMessage,
  MainThreadState,
  RespondResponse,
  BranchThread,
  SummarizeResponse,
} from "@/lib/types"
import { cn } from "@/lib/utils"
import { SessionChatCache } from "@/lib/session-cache"

function generateId(): string {
  return crypto.randomUUID()
}

// =============================================================================
// PERSISTENCE HELPERS (fire-and-forget, best-effort)
// These functions mirror main thread messages to the store for Demo 2/3.
// They MUST NOT block or affect Demo 1 behavior.
// =============================================================================

/**
 * Create a new stored thread (fire-and-forget)
 * Returns the thread ID or null if failed
 */
async function createStoredThread(title?: string): Promise<string | null> {
  try {
    const res = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title || "New Chat", category: "recent" }),
    })
    if (!res.ok) {
      // Server failed — create locally in session cache so /find still works
      const localThread = {
        id: generateId(),
        title: title || "New Chat",
        category: "recent" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
      }
      SessionChatCache.saveThread(localThread)
      SessionChatCache.trackEvent("localOnlyThreads")
      return localThread.id
    }
    const data = await res.json()
    const threadId = data.thread?.id ?? null
    // Write-through: cache the server-created thread locally
    if (data.thread) {
      SessionChatCache.saveThread(data.thread)
    }
    return threadId
  } catch {
    // Network error — create locally in session cache
    const localThread = {
      id: generateId(),
      title: title || "New Chat",
      category: "recent" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    }
    SessionChatCache.saveThread(localThread)
    SessionChatCache.trackEvent("localOnlyThreads")
    return localThread.id
  }
}

/**
 * Append a message to stored thread (fire-and-forget)
 */
function persistMessage(
  threadId: string,
  message: { id: string; role: string; text: string; createdAt: number; responseId?: string }
): void {
  // Write-through: always cache locally (immediate, synchronous)
  SessionChatCache.appendMessage(threadId, {
    id: message.id,
    role: message.role as "user" | "assistant" | "context",
    text: message.text,
    createdAt: message.createdAt,
    responseId: message.responseId,
  })
  // Fire and forget to server - don't await
  fetch(`/api/chats/${threadId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  }).catch(() => {
    // Silently ignore - session cache already has the data
  })
}

/**
 * Update stored thread metadata (fire-and-forget)
 */
function updateStoredThread(
  threadId: string,
  updates: { title?: string; lastResponseId?: string | null }
): void {
  // Write-through: always cache locally (immediate, synchronous)
  SessionChatCache.updateThread(threadId, updates)
  // Fire and forget to server - don't await
  fetch(`/api/chats/${threadId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  }).catch(() => {
    // Silently ignore - session cache already has the data
  })
}

// =============================================================================

export default function BranchesDemo() {
  // Main thread state
  const [state, setState] = useState<MainThreadState>({
    messages: [],
    lastResponseId: null,
  })
  const [inputValue, setInputValue] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [isMerging, setIsMerging] = useState(false)

  // Branch state management
  const [branchesByParentLocalId, setBranchesByParentLocalId] = useState<
    Record<string, BranchThread[]>
  >({})
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null)

  // Stored thread ID for persistence (Demo 2/3 feature - does not affect Demo 1)
  const storedThreadIdRef = useRef<string | null>(null)

  // Refs for autoscroll behavior
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const shouldAutoScroll = useRef(true)

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
    if (shouldAutoScroll.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [state.messages, isLoading])

  // Get the active branch object
  const activeBranch = useMemo(() => {
    if (!activeBranchId) return null
    for (const branches of Object.values(branchesByParentLocalId)) {
      const branch = branches.find((b) => b.id === activeBranchId)
      if (branch) return branch
    }
    return null
  }, [activeBranchId, branchesByParentLocalId])

  // Get parent message text for the active branch
  const parentMessageText = useMemo(() => {
    if (!activeBranch) return ""
    const parentMessage = state.messages.find(
      (m) => m.localId === activeBranch.parentAssistantLocalId
    )
    return parentMessage?.text || ""
  }, [activeBranch, state.messages])

  // Handle sending a message in main thread
  const handleSend = async () => {
    const userText = inputValue.trim()
    if (!userText || isLoading || isMerging) return

    const userMessage: ChatMessage = {
      localId: generateId(),
      role: "user",
      text: userText,
      createdAt: Date.now(),
    }

    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, userMessage],
    }))
    setInputValue("")
    setIsLoading(true)
    shouldAutoScroll.current = true

    // --- PERSISTENCE (await thread creation to prevent race) ---
    if (!storedThreadIdRef.current) {
      const id = await createStoredThread()
      if (id) {
        storedThreadIdRef.current = id
        persistMessage(id, {
          id: userMessage.localId,
          role: userMessage.role,
          text: userMessage.text,
          createdAt: userMessage.createdAt,
        })
      }
    } else {
      persistMessage(storedThreadIdRef.current, {
        id: userMessage.localId,
        role: userMessage.role,
        text: userMessage.text,
        createdAt: userMessage.createdAt,
      })
    }
    // --- END PERSISTENCE ---

    try {
      const res = await fetch("/api/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: userText,
          previous_response_id: state.lastResponseId,
          mode: "deep",
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

      setState((prev) => ({
        messages: [...prev.messages, assistantMessage],
        lastResponseId: responseData.id,
      }))

      // --- PERSISTENCE (fire-and-forget, best-effort) ---
      // Persist assistant message and update lastResponseId
      if (storedThreadIdRef.current) {
        persistMessage(storedThreadIdRef.current, {
          id: assistantMessage.localId,
          role: assistantMessage.role,
          text: assistantMessage.text,
          createdAt: assistantMessage.createdAt,
          responseId: assistantMessage.responseId,
        })
        updateStoredThread(storedThreadIdRef.current, {
          lastResponseId: responseData.id,
        })
      }
      // --- END PERSISTENCE ---
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Something went wrong"
      toast.error(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  // Handle creating a new branch from an assistant message
  const handleBranch = (localId: string, responseId: string) => {
    // Count existing branches for this parent
    const existingBranches = branchesByParentLocalId[localId] || []
    const branchNumber = existingBranches.length + 1

    // Create new branch
    const newBranch: BranchThread = {
      id: generateId(),
      parentAssistantLocalId: localId,
      parentAssistantResponseId: responseId,
      title: `Branch ${branchNumber}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      mode: "fast", // Default to fast mode
      includeInMain: false, // Default OFF
      includeMode: "summary",
      messages: [],
      lastResponseId: null,
      mergedIntoMain: false,
    }

    // Add to branches map
    setBranchesByParentLocalId((prev) => ({
      ...prev,
      [localId]: [...(prev[localId] || []), newBranch],
    }))

    // Open the new branch
    setActiveBranchId(newBranch.id)
  }

  // Handle opening an existing branch
  const handleOpenBranch = (branchId: string) => {
    setActiveBranchId(branchId)
  }

  // Threshold for skipping LLM summarization - short chats get embedded directly
  const SKIP_SUMMARIZATION_THRESHOLD = 10

  /**
   * Format branch messages as bullet points (looks like a summary but is the full content)
   * Used for short conversations where LLM summarization would be slower than helpful
   */
  const formatAsQuickSummary = (messages: BranchThread["messages"]): string => {
    const lines: string[] = []
    for (const m of messages) {
      const prefix = m.role === "user" ? "User asked:" : "Assistant:"
      // Truncate long messages for the visual "summary"
      const text = m.text.length > 150 ? m.text.slice(0, 147) + "..." : m.text
      lines.push(`• ${prefix} ${text}`)
    }
    return lines.join("\n")
  }

  // Perform merge operation: summarize or full transcript injection
  const performMerge = async (
    branch: BranchThread,
    mergeMode: "summary" | "full"
  ): Promise<{ contextText: string; newResponseId: string } | null> => {
    try {
      let contextInput: string

      if (mergeMode === "summary") {
        // For short conversations, skip LLM and embed full content directly
        // This looks identical to a summary in the UI but avoids API latency
        if (branch.messages.length <= SKIP_SUMMARIZATION_THRESHOLD) {
          const quickSummary = formatAsQuickSummary(branch.messages)
          contextInput = `Context from a side thread "${branch.title}" (summary):\n${quickSummary}`
        } else {
          // Longer conversations: use LLM summarization
          const summarizeRes = await fetch("/api/summarize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              branchMessages: branch.messages.map((m) => ({
                role: m.role as "user" | "assistant",
                text: m.text,
              })),
            }),
          })

          const summarizeData = await summarizeRes.json()

          if (!summarizeRes.ok) {
            throw new Error(summarizeData.error || "Failed to summarize")
          }

          const summary = (summarizeData as SummarizeResponse).summary
          contextInput = `Context from a side thread "${branch.title}" (summary):\n${summary}`
        }
      } else {
        // Full transcript
        const transcript = branch.messages
          .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
          .join("\n\n")
        contextInput = `Context from a side thread "${branch.title}" (full transcript):\n${transcript}`
      }

      // Ingest into main chain by calling /api/respond
      const respondRes = await fetch("/api/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: contextInput,
          previous_response_id: state.lastResponseId,
          mode: "deep", // Use deep mode for context ingestion
        }),
      })

      const respondData = await respondRes.json()

      if (!respondRes.ok) {
        throw new Error(respondData.error || "Failed to ingest context")
      }

      return {
        contextText:
          mergeMode === "summary"
            ? contextInput.replace(
                `Context from a side thread "${branch.title}" (summary):\n`,
                ""
              )
            : `Full transcript from "${branch.title}" merged`,
        newResponseId: respondData.id,
      }
    } catch (error) {
      console.error("Merge error:", error)
      throw error
    }
  }

  // Handle closing the branch overlay
  const handleCloseBranch = async (result?: BranchCloseResult) => {
    if (!result) {
      setActiveBranchId(null)
      return
    }

    const { branch, shouldMerge, mergeMode } = result

    if (!shouldMerge) {
      setActiveBranchId(null)
      return
    }

    // Perform the merge
    setIsMerging(true)
    shouldAutoScroll.current = true

    try {
      const mergeResult = await performMerge(branch, mergeMode || "summary")

      if (mergeResult) {
        // Create context card message for UI
        const contextMessage: ChatMessage = {
          localId: generateId(),
          role: "context",
          text: mergeResult.contextText,
          createdAt: Date.now(),
          contextMeta: {
            branchId: branch.id,
            branchTitle: branch.title,
            mergeType: mergeMode || "summary",
          },
        }

        // Update main state with context message and new response ID
        // NOTE: We hide the assistant ack message - just update the chain ID
        setState((prev) => ({
          messages: [...prev.messages, contextMessage],
          lastResponseId: mergeResult.newResponseId,
        }))

        // --- PERSISTENCE (fire-and-forget, best-effort) ---
        // Persist context message and update lastResponseId
        if (storedThreadIdRef.current) {
          persistMessage(storedThreadIdRef.current, {
            id: contextMessage.localId,
            role: contextMessage.role,
            text: contextMessage.text,
            createdAt: contextMessage.createdAt,
          })
          updateStoredThread(storedThreadIdRef.current, {
            lastResponseId: mergeResult.newResponseId,
          })
        }
        // --- END PERSISTENCE ---

        // Mark branch as merged
        const updatedBranch: BranchThread = {
          ...branch,
          mergedIntoMain: true,
          mergedAs: mergeMode || "summary",
          mergedAt: Date.now(),
          updatedAt: Date.now(),
        }

        setBranchesByParentLocalId((prev) => {
          const parentId = branch.parentAssistantLocalId
          const branches = prev[parentId] || []
          const updatedBranches = branches.map((b) =>
            b.id === branch.id ? updatedBranch : b
          )
          return {
            ...prev,
            [parentId]: updatedBranches,
          }
        })

        toast.success(
          mergeMode === "summary"
            ? "Branch merged into main (summary)"
            : "Branch merged into main (full transcript)",
          {
            description: `Context from "${branch.title}" is now available in the main chat.`,
          }
        )
      }
    } catch (error) {
      // Graceful failure: revert the includeInMain toggle to off
      const revertedBranch: BranchThread = {
        ...branch,
        includeInMain: false,
        updatedAt: Date.now(),
      }

      setBranchesByParentLocalId((prev) => {
        const parentId = branch.parentAssistantLocalId
        const branches = prev[parentId] || []
        const updatedBranches = branches.map((b) =>
          b.id === branch.id ? revertedBranch : b
        )
        return {
          ...prev,
          [parentId]: updatedBranches,
        }
      })

      // Show failure toast
      const isTimeout = error instanceof Error && error.message.includes("timed out")
      toast.error("Summarization failed", {
        description: isTimeout
          ? "The request took too long. You can retry by toggling again."
          : error instanceof Error
          ? error.message
          : "Failed to merge branch. You can retry by toggling again.",
      })
    } finally {
      setIsMerging(false)
      setActiveBranchId(null)
    }
  }

  // Handle updating a branch (from overlay)
  const handleUpdateBranch = (updatedBranch: BranchThread) => {
    setBranchesByParentLocalId((prev) => {
      const parentId = updatedBranch.parentAssistantLocalId
      const branches = prev[parentId] || []
      const updatedBranches = branches.map((b) =>
        b.id === updatedBranch.id ? updatedBranch : b
      )
      return {
        ...prev,
        [parentId]: updatedBranches,
      }
    })
  }

  // Reset chat state
  const handleReset = () => {
    setState({
      messages: [],
      lastResponseId: null,
    })
    setBranchesByParentLocalId({})
    setActiveBranchId(null)
    setInputValue("")
    // Clear stored thread ID so a new thread is created on next message
    storedThreadIdRef.current = null
    toast.success("Chat cleared")
  }

  const hasMessages = state.messages.length > 0
  const branchIsOpen = !!activeBranchId && !!activeBranch

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full">
        {/* Main chat: dims behind the branch surface; click it to return */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          {branchIsOpen && (
            <button
              type="button"
              aria-label="Return to the main chat"
              className="absolute inset-0 z-20 cursor-pointer bg-transparent"
              onClick={() => {
                if (activeBranch && !isMerging) {
                  requestBranchClose(activeBranch, handleCloseBranch)
                }
              }}
            />
          )}
          <div
            className={cn(
              "flex min-w-0 flex-1 flex-col transition-opacity duration-300",
              branchIsOpen && "pointer-events-none opacity-40 select-none"
            )}
            aria-hidden={branchIsOpen}
          >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-muted-foreground" />
            <span className="font-medium">Chat</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={!hasMessages && !inputValue}
            className="gap-1.5"
          >
            <RotateCcw className="h-4 w-4" />
            New chat
          </Button>
        </div>

        {/* Messages area */}
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto"
        >
          {!hasMessages && !isLoading ? (
            // Empty state
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <MessageSquare className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium mb-2">Start a conversation</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Send a message to begin chatting. Your conversation will be
                tracked using OpenAI&apos;s Responses API with response chaining.
              </p>
            </div>
          ) : (
            // Messages list
            <div className="p-4 space-y-4">
              {state.messages.map((message) => (
                <ChatMessageBubble
                  key={message.localId}
                  message={message}
                  onBranch={handleBranch}
                  branches={branchesByParentLocalId[message.localId] || []}
                  onOpenBranch={handleOpenBranch}
                />
              ))}
              {isLoading && <TypingIndicator />}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Composer */}
        <Composer
          value={inputValue}
          onChange={setInputValue}
          onSend={handleSend}
          disabled={isLoading || isMerging}
          placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
        />
          </div>
        </div>

        {/* The branch as its own writing surface, right of the seam */}
        {branchIsOpen && activeBranch && (
          <BranchSurface
            branch={activeBranch}
            parentMessageText={parentMessageText}
            onClose={handleCloseBranch}
            onUpdateBranch={handleUpdateBranch}
          />
        )}

        {/* Merging overlay - animated and polished */}
        {isMerging && (
          <div className="fixed inset-0 bg-background/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-card border border-border rounded-xl p-6 shadow-xl flex flex-col items-center gap-4 min-w-[280px]">
              {/* Animated spinner using Loader2 */}
              <Loader2 className="h-10 w-10 text-primary animate-spin" />

              {/* Title and subtitle */}
              <div className="text-center space-y-1">
                <h3 className="text-sm font-medium text-foreground">
                  Adding to main context
                </h3>
                <p className="text-xs text-muted-foreground">
                  Merging branch into main conversation…
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
        )}
      </div>
    </TooltipProvider>
  )
}

"use client"

import { useState, useRef, useEffect, useCallback, KeyboardEvent } from "react"
import {
  Send,
  Loader2,
  Search,
  Sparkles,
  Eye,
  ArrowLeft,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { FinderOptionCard, type FinderOption } from "./finder-option-card"
import type { StoredChatThread } from "@/lib/store/types"
import { CATEGORY_LABELS, type StoredChatCategory } from "@/lib/store/types"
import { SessionChatCache } from "@/lib/session-cache"

/** Helper to build localThreads payload and log telemetry for /find */
function getLocalThreadsForFind(query: string) {
  void query
  const localThreads = SessionChatCache.listFullThreads().map((t) => ({
    id: t.id,
    title: t.title,
    summary: t.summary || "",
    category: t.category,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    messages: t.messages.map((m) => ({
      role: m.role,
      text: m.text,
    })),
  }))
  if (localThreads.length > 0) {
    SessionChatCache.trackEvent("findWithLocalThreads")
  }
  return localThreads
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IntentResponse {
  intent: "retrieve_chat" | "normal_chat"
  confidence: number
  rewrittenQuery: string
}

interface FindResponse {
  query: string
  options: Array<{
    chatId: string
    title: string
    summary: string
    updatedAt: number
    confidence: number
    why: string
  }>
}

// For normal chat messages (persisted)
interface Demo2Message {
  id: string
  role: "user" | "assistant"
  text: string
  createdAt: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return crypto.randomUUID()
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  if (seconds > 10) return `${seconds}s ago`
  return "just now"
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

/**
 * Determine if we should auto-open based on confidence.
 * Rules:
 * - If only one option and confidence >= 0.75, auto-open
 * - If top.confidence >= 0.85 AND (top - second) >= 0.15, auto-open
 */
function shouldAutoOpen(options: FinderOption[]): boolean {
  if (options.length === 0) return false
  if (options.length === 1) {
    return options[0].confidence >= 0.75
  }
  const top = options[0].confidence
  const second = options[1].confidence
  return top >= 0.85 && top - second >= 0.15
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FinderViewProps {
  /**
   * Currently selected chat ID (from URL) - used only for external navigation
   */
  currentChatId: string | null
  /**
   * Current chat data (null if no chat selected or loading)
   */
  currentChat: StoredChatThread | null
  /**
   * Callback when a chat should be opened (handles both replace and push)
   */
  onOpenChat: (chatId: string, useReplace: boolean) => void
  /**
   * Whether the current chat is being loaded
   */
  isLoadingChat?: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FinderView({
  currentChatId,
  onOpenChat,
}: FinderViewProps) {
  // Composer state - what user is currently typing
  const [inputValue, setInputValue] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Request ID counter for race condition prevention
  const requestIdRef = useRef(0)

  // Submitted query state (drives search, NOT input typing)
  const [submittedQuery, setSubmittedQuery] = useState<string | null>(null)

  // Finder results state
  const [finderPending, setFinderPending] = useState(false)
  const [finderOptions, setFinderOptions] = useState<FinderOption[]>([])

  // Preview state - when user clicks "Open" we show transcript preview
  const [previewChatId, setPreviewChatId] = useState<string | null>(null)
  const [previewChatData, setPreviewChatData] = useState<StoredChatThread | null>(null)
  const [isLoadingPreview] = useState(false)

  // Opening state for transition effect
  const [openingChatId, setOpeningChatId] = useState<string | null>(null)

  // Normal chat state (for when intent is normal_chat)
  const [messages, setMessages] = useState<Demo2Message[]>([])
  const [isResponding, setIsResponding] = useState(false)
  const [lastResponseId, setLastResponseId] = useState<string | null>(null)

  // Refs for autoscroll
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

  // Autoscroll to bottom when new content arrives
  useEffect(() => {
    if (shouldAutoScroll.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages, finderOptions, finderPending, isResponding, previewChatData])

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = "auto"
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
    }
  }, [inputValue])

  // Determine session state (for auto-open logic)
  const isEmptySession = !currentChatId && messages.length === 0

  // ---------------------------------------------------------------------------
  // Handle opening a chat (shows transcript preview)
  // ---------------------------------------------------------------------------
  const handleOpenChat = useCallback(async (chatId: string) => {
    setOpeningChatId(chatId)

    try {
      // Use parent navigation for true URL-based resume (not local preview)
      onOpenChat(chatId, false)
      setFinderOptions([])
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to load chat"
      toast.error(errorMessage)
    } finally {
      setOpeningChatId(null)
    }
  }, [onOpenChat])

  // ---------------------------------------------------------------------------
  // Handle going back from preview to search
  // ---------------------------------------------------------------------------
  const handleBackFromPreview = useCallback(() => {
    setPreviewChatId(null)
    setPreviewChatData(null)
    // Keep the submittedQuery so user can re-search easily
  }, [])

  // ---------------------------------------------------------------------------
  // Handle sending a message (search query)
  // ---------------------------------------------------------------------------
  const handleSend = async () => {
    const userText = inputValue.trim()
    if (!userText || finderPending || isResponding) return

    setInputValue("")
    shouldAutoScroll.current = true

    // Clear any existing preview when starting a new search
    setPreviewChatId(null)
    setPreviewChatData(null)

    // Check for /find command shortcut
    if (userText.startsWith("/find ")) {
      const query = userText.slice(6).trim()
      if (!query) {
        toast.error("Please provide a search query after /find")
        return
      }
      await handleFindCommand(query)
      return
    }

    // Step 1: Call intent detection API
    setFinderPending(true)
    setSubmittedQuery(userText)

    // Increment request ID to prevent race conditions
    const currentRequestId = ++requestIdRef.current

    try {
      const intentRes = await fetch("/api/chats/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userText,
          context: {
            isEmptySession,
            isMidChat: messages.length > 0,
          },
        }),
      })

      // Check if this request is still the latest
      if (requestIdRef.current !== currentRequestId) {
        return // Newer request was made, discard this one
      }

      if (!intentRes.ok) {
        const data = await intentRes.json()
        throw new Error(data.error || "Failed to detect intent")
      }

      const intentData: IntentResponse = await intentRes.json()

      if (intentData.intent === "retrieve_chat") {
        // User wants to find a past chat
        await handleRetrieveChat(userText, intentData.rewrittenQuery, currentRequestId)
      } else {
        // Normal chat - proceed with regular response
        setFinderPending(false)
        await handleNormalChat(userText)
      }
    } catch (error) {
      // Only update state if this is still the current request
      if (requestIdRef.current === currentRequestId) {
        setFinderPending(false)
        const errorMessage =
          error instanceof Error ? error.message : "Something went wrong"
        toast.error(errorMessage)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Handle /find command (direct search, skip intent detection)
  // ---------------------------------------------------------------------------
  const handleFindCommand = async (query: string) => {
    setFinderPending(true)
    setSubmittedQuery(query)

    // Clear preview when searching
    setPreviewChatId(null)
    setPreviewChatData(null)

    // Increment request ID
    const currentRequestId = ++requestIdRef.current

    try {
      // Include local session threads as supplementary candidates
      const localThreads = getLocalThreadsForFind(query)

      const findRes = await fetch("/api/chats/find", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, localThreads }),
      })

      // Check if this request is still the latest
      if (requestIdRef.current !== currentRequestId) {
        return
      }

      if (!findRes.ok) {
        const data = await findRes.json()
        throw new Error(data.error || "Failed to find chats")
      }

      const findData: FindResponse = await findRes.json()

      // Map to FinderOption format
      const options: FinderOption[] = findData.options.map((opt) => ({
        chatId: opt.chatId,
        title: opt.title,
        summary: opt.summary,
        updatedAt: opt.updatedAt,
        confidence: opt.confidence,
        why: opt.why,
      }))

      setFinderOptions(options)
      setFinderPending(false)

      // Handle auto-open for empty session
      if (isEmptySession && shouldAutoOpen(options)) {
        await handleOpenChat(options[0].chatId)
      }
    } catch (error) {
      if (requestIdRef.current === currentRequestId) {
        setFinderPending(false)
        const errorMessage =
          error instanceof Error ? error.message : "Failed to search"
        toast.error(errorMessage)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Handle retrieve_chat intent
  // ---------------------------------------------------------------------------
  const handleRetrieveChat = async (
    originalQuery: string,
    rewrittenQuery: string,
    currentRequestId: number
  ) => {
    try {
      // Include local session threads as supplementary candidates
      const effectiveQuery = rewrittenQuery || originalQuery
      const localThreads = getLocalThreadsForFind(effectiveQuery)

      const findRes = await fetch("/api/chats/find", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: effectiveQuery, localThreads }),
      })

      // Check if this request is still the latest
      if (requestIdRef.current !== currentRequestId) {
        return
      }

      if (!findRes.ok) {
        const data = await findRes.json()
        throw new Error(data.error || "Failed to find chats")
      }

      const findData: FindResponse = await findRes.json()

      // Map to FinderOption format
      const options: FinderOption[] = findData.options.map((opt) => ({
        chatId: opt.chatId,
        title: opt.title,
        summary: opt.summary,
        updatedAt: opt.updatedAt,
        confidence: opt.confidence,
        why: opt.why,
      }))

      setFinderOptions(options)
      setFinderPending(false)

      if (options.length === 0) {
        toast.info("No matching chats found")
        return
      }

      // Handle auto-open for empty session
      if (isEmptySession && shouldAutoOpen(options)) {
        await handleOpenChat(options[0].chatId)
      }
    } catch (error) {
      if (requestIdRef.current === currentRequestId) {
        setFinderPending(false)
        const errorMessage =
          error instanceof Error ? error.message : "Failed to search"
        toast.error(errorMessage)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Handle normal chat (not a retrieval request)
  // ---------------------------------------------------------------------------
  const handleNormalChat = async (userText: string) => {
    // Create user message for UI
    const userMessage: Demo2Message = {
      id: generateId(),
      role: "user",
      text: userText,
      createdAt: Date.now(),
    }

    setMessages((prev) => [...prev, userMessage])
    setIsResponding(true)

    try {
      // Send to /api/respond
      const res = await fetch("/api/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: userText,
          previous_response_id: lastResponseId,
          mode: "deep",
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Failed to get response")
      }

      // Add assistant message to UI
      const assistantMessage: Demo2Message = {
        id: generateId(),
        role: "assistant",
        text: data.output_text,
        createdAt: Date.now(),
      }

      setMessages((prev) => [...prev, assistantMessage])
      setLastResponseId(data.id)
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Something went wrong"
      toast.error(errorMessage)
    } finally {
      setIsResponding(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Handle option card click
  // ---------------------------------------------------------------------------
  const handleOptionClick = async (option: FinderOption) => {
    await handleOpenChat(option.chatId)
  }

  // ---------------------------------------------------------------------------
  // Handle keyboard events
  // ---------------------------------------------------------------------------
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter adds newline
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (inputValue.trim() && !finderPending && !isResponding) {
        handleSend()
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Determine what to show
  // ---------------------------------------------------------------------------
  const showPreview = previewChatId !== null && previewChatData !== null
  const hasEphemeralContent = submittedQuery !== null || finderOptions.length > 0
  const hasMessages = messages.length > 0
  const showEmptyState = !showPreview && !hasEphemeralContent && !hasMessages && !finderPending && !isResponding

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="flex flex-col h-full">
      {/* Messages/Results/Preview area */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        {showPreview ? (
          // Transcript Preview Mode
          <div className="flex flex-col h-full">
            {/* Preview header */}
            <div className="p-4 border-b border-border bg-background sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleBackFromPreview}
                  className="gap-1.5"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to search
                </Button>
                <div className="h-4 w-px bg-border" />
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full">
                  <Eye className="h-3 w-3" />
                  Preview
                </span>
              </div>
              <div className="mt-3">
                <h2 className="font-semibold truncate">{previewChatData.title}</h2>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-xs text-muted-foreground">
                    {formatDate(previewChatData.createdAt)} &bull;{" "}
                    {previewChatData.messages.length} messages
                  </p>
                  <span className="text-[10px] px-1.5 py-0.5 bg-muted rounded text-muted-foreground">
                    {CATEGORY_LABELS[previewChatData.category as StoredChatCategory]}
                  </span>
                </div>
                {previewChatData.summary && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {previewChatData.summary}
                  </p>
                )}
              </div>
            </div>

            {/* Preview messages */}
            <div className="flex-1 p-4 space-y-4 bg-muted/30">
              {previewChatData.messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "flex",
                    message.role === "user" ? "justify-end" : "justify-start"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[80%] rounded-2xl px-4 py-3",
                      message.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-md"
                        : message.role === "context"
                        ? "bg-warning/10 text-foreground border border-warning/20 rounded-bl-md"
                        : "bg-card text-card-foreground border border-border rounded-bl-md"
                    )}
                  >
                    {message.role === "context" && (
                      <div className="text-[10px] uppercase tracking-[0.08em] text-warning-foreground dark:text-warning font-medium mb-1">
                        CONTEXT
                      </div>
                    )}
                    <p className="text-sm whitespace-pre-wrap">{message.text}</p>
                    <p
                      className={cn(
                        "text-[10px] mt-1",
                        message.role === "user"
                          ? "text-primary-foreground/70"
                          : "text-muted-foreground/70"
                      )}
                    >
                      {formatRelativeTime(message.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : showEmptyState ? (
          // Empty state
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Search className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-medium mb-2">Find a Conversation</h3>
            <p className="text-sm text-muted-foreground max-w-sm mb-4">
              Type naturally to find a past chat, or just start a new conversation.
            </p>
            <div className="text-xs text-muted-foreground/70 max-w-sm p-3 bg-muted rounded-lg space-y-2">
              <p>
                <strong>Examples:</strong>
              </p>
              <p>&quot;Find my conversation about React hooks&quot;</p>
              <p>&quot;Where did we discuss the API design?&quot;</p>
              <p>&quot;/find travel planning&quot; (direct search)</p>
            </div>
          </div>
        ) : (
          // Content area (search results or normal chat)
          <div className="p-4 space-y-4">
            {/* Ephemeral finder query (user bubble) */}
            {submittedQuery && finderOptions.length === 0 && !finderPending && messages.length === 0 && (
              <div className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-md px-4 py-2.5 bg-primary text-primary-foreground">
                  <div className="flex items-center gap-1 mb-1 text-[10px] text-primary-foreground/70">
                    <Search className="h-3 w-3" />
                    <span>Searched</span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                    {submittedQuery}
                  </p>
                </div>
              </div>
            )}

            {/* Finder pending state */}
            {finderPending && (
              <>
                {/* Show the query being searched */}
                {submittedQuery && (
                  <div className="flex justify-end">
                    <div className="max-w-[80%] rounded-2xl rounded-br-md px-4 py-2.5 bg-primary text-primary-foreground">
                      <div className="flex items-center gap-1 mb-1 text-[10px] text-primary-foreground/70">
                        <Search className="h-3 w-3" />
                        <span>Finding chat...</span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                        {submittedQuery}
                      </p>
                    </div>
                  </div>
                )}
                <div className="flex items-start">
                  <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Searching...
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Finder options (assistant bubble with cards) */}
            {!finderPending && finderOptions.length > 0 && (
              <>
                {/* Show the query that produced these results */}
                {submittedQuery && (
                  <div className="flex justify-end">
                    <div className="max-w-[80%] rounded-2xl rounded-br-md px-4 py-2.5 bg-primary text-primary-foreground">
                      <div className="flex items-center gap-1 mb-1 text-[10px] text-primary-foreground/70">
                        <Search className="h-3 w-3" />
                        <span>Searched</span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                        {submittedQuery}
                      </p>
                    </div>
                  </div>
                )}
                <div className="flex items-start">
                  <div className="max-w-[90%] space-y-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                      <Sparkles className="h-4 w-4" />
                      <span>
                        Found {finderOptions.length} matching{" "}
                        {finderOptions.length === 1 ? "chat" : "chats"}
                      </span>
                    </div>
                    {finderOptions.map((option) => (
                      <FinderOptionCard
                        key={option.chatId}
                        option={option}
                        onClick={() => handleOptionClick(option)}
                        isOpening={openingChatId === option.chatId}
                        disabled={openingChatId !== null || isLoadingPreview}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* No results message */}
            {!finderPending && submittedQuery && finderOptions.length === 0 && messages.length === 0 && (
              <div className="flex items-start">
                <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                  <p className="text-sm text-muted-foreground">
                    No matching chats found. Try a different search or start a
                    new conversation.
                  </p>
                </div>
              </div>
            )}

            {/* Normal chat messages */}
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex",
                  message.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-4 py-2.5",
                    message.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-md"
                      : "bg-muted text-foreground rounded-bl-md"
                  )}
                >
                  <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                    {message.text}
                  </p>
                  <p
                    className={cn(
                      "text-[10px] mt-1",
                      message.role === "user"
                        ? "text-primary-foreground/60"
                        : "text-muted-foreground/60"
                    )}
                  >
                    {formatRelativeTime(message.createdAt)}
                  </p>
                </div>
              </div>
            ))}

            {/* Responding state */}
            {isResponding && (
              <div className="flex items-start">
                <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Thinking...
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Loading preview indicator */}
            {isLoadingPreview && (
              <div className="flex items-start">
                <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Loading chat...
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Composer - always the "find chat" input */}
      <div className="border-t border-border bg-card/50">
        <div className="flex items-end gap-2 p-4">
          <Textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask to find a previous chat…"
            disabled={finderPending || isResponding || isLoadingPreview}
            rows={1}
            className="min-h-[44px] max-h-[200px] resize-none bg-background"
          />
          <Button
            onClick={handleSend}
            disabled={finderPending || isResponding || isLoadingPreview || !inputValue.trim()}
            size="icon"
            className="h-[44px] w-[44px] shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

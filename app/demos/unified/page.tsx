"use client"

import { useState, useRef, useEffect, useCallback, useMemo, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Loader2,
  Send,
  Search,
  Sparkles,
  Zap,
  Plus,
  MessageSquare,
  Paperclip,
  FileAudio,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { TooltipProvider } from "@/components/ui/tooltip"
import {
  ChatMessageBubble,
  TypingIndicator,
  BranchOverlay,
  FileAttachmentChip,
} from "@/components/chat"
import type { BranchCloseResult } from "@/components/chat"
import { TaskCard } from "@/components/codex"
import { AssistantLauncher, AssistantTaskCard } from "@/components/assistant"
import { FinderOptionCard, type FinderOption } from "@/components/history"
import { StorageWarningBanner } from "@/components/ui/storage-warning-banner"
import type {
  ChatMessage,
  MainThreadState,
  RespondResponse,
  BranchThread,
  SummarizeResponse,
} from "@/lib/types"
import type { CodexTask, WorkspaceSnapshot } from "@/lib/codex/types"
import type { StoredChatThread, StoredChatThreadMeta } from "@/lib/store/types"
import type {
  AssistantChatThreadInput,
  AssistantRunResponse,
  AssistantTaskResult,
} from "@/lib/assistant/types"
import { ScrollArea } from "@/components/ui/scroll-area"
import { logAuditClient, flushAuditTelemetry } from "@/lib/telemetry"
import { SessionChatCache } from "@/lib/session-cache"
import { createAssistantDemoThreads } from "@/lib/assistant/demo-seed"

// =============================================================================
// HELPERS
// =============================================================================

function generateId(): string {
  return crypto.randomUUID()
}

/**
 * Check if a message is a @codex command
 */
function isCodexCommand(text: string): boolean {
  return text.trim().toLowerCase().startsWith("@codex ")
}

/**
 * Extract the prompt from a @codex command
 */
function extractCodexPrompt(text: string): string {
  return text.trim().slice(7).trim() // Remove "@codex "
}

/**
 * Check if a message is an @assistant command
 */
function isAssistantCommand(text: string): boolean {
  return text.trim().toLowerCase().startsWith("@assistant ")
}

/**
 * Extract the prompt from an @assistant command
 */
function extractAssistantPrompt(text: string): string {
  return text.trim().slice(11).trim() // Remove "@assistant "
}

/**
 * Check if message is a find command
 */
function isFindCommand(text: string): boolean {
  return text.trim().toLowerCase().startsWith("/find ")
}

/**
 * Extract query from /find command
 */
function extractFindQuery(text: string): string {
  return text.trim().slice(6).trim()
}

/**
 * Build a FULL context string from a completed codex task.
 *
 * Includes the complete file contents so the model has the same knowledge
 * it would have if it had actually written the code. This is a demo-only
 * approach — in production you'd use a smarter context window strategy.
 */
function buildTaskContextInput(task: CodexTask): string | null {
  const summary = task.contextSummary
  if (!summary) return null

  const lines: string[] = [
    `I just completed the coding task "${summary.title}". Here is exactly what I did:`,
    "",
  ]

  // Include the implementation plan so the model understands the "why"
  if (task.planMarkdown) {
    lines.push("## Implementation Plan")
    lines.push(task.planMarkdown)
    lines.push("")
  }

  // Include FULL file contents for every changed file
  if (task.changes.length > 0) {
    lines.push("## Files Created/Modified")
    lines.push("")
    for (const change of task.changes) {
      lines.push(`### ${change.path}`)
      lines.push("```")
      lines.push(change.after)
      lines.push("```")
      lines.push("")
    }
  }

  if (summary.languages.length > 0) {
    lines.push(`Languages used: ${summary.languages.join(", ")}`)
  }

  return lines.join("\n")
}

function buildAssistantContextInput(task: AssistantTaskResult): string | null {
  if (task.status !== "ready" && task.status !== "no_results") return null

  const lines: string[] = [
    "Assistant output added to this chat's hidden context.",
    "",
    `Original Assistant request: ${task.requestText}`,
    `Interpreted goal: ${task.interpretedGoal}`,
    "",
    "## Result",
    task.resultSummary,
    "",
  ]

  if (task.artifact) {
    const maxArtifactChars = 14000
    const content =
      task.artifact.content.length > maxArtifactChars
        ? `${task.artifact.content.slice(0, maxArtifactChars).trim()}\n\n[Artifact truncated for chat context.]`
        : task.artifact.content
    lines.push(`## Artifact: ${task.artifact.filename}`)
    lines.push(content)
    lines.push("")
  }

  if (task.openLoops?.length) {
    lines.push("## Open Loops")
    for (const item of task.openLoops) {
      lines.push(`- ${item.chatTitle}: ${item.reason} Next action: ${item.nextAction}`)
    }
    lines.push("")
  }

  if (task.sources.length > 0) {
    lines.push("## Sources Used")
    for (const source of task.sources.slice(0, 8)) {
      lines.push(`- ${source.title} (${source.chatId}): ${source.reason}`)
      if (source.snippet) {
        lines.push(`  Snippet: ${source.snippet}`)
      }
    }
    lines.push("")
  }

  if (task.missingInfo?.length) {
    lines.push("## Missing or Ambiguous Information")
    for (const item of task.missingInfo) {
      lines.push(`- ${item}`)
    }
    lines.push("")
  }

  return lines.join("\n").trim()
}

// =============================================================================
// Extended Chat Message Type (with task support)
// =============================================================================

interface UnifiedMessage extends ChatMessage {
  /** Optional task ID if this is a task card message */
  taskId?: string
  /** Whether this is a task card (renders TaskCard instead of bubble) */
  isTaskCard?: boolean
  /** Optional Assistant task ID if this is an Assistant card message */
  assistantTaskId?: string
  /** Whether this is an Assistant card (renders AssistantTaskCard instead of bubble) */
  isAssistantTaskCard?: boolean
}

// =============================================================================
// PERSISTENCE HELPERS (awaitable, errors surfaced)
// =============================================================================

async function createStoredThread(title?: string): Promise<string | null> {
  try {
    const res = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title || "New Chat", category: "recent" }),
    })
    if (!res.ok) {
      console.error("[Persist] createStoredThread failed:", res.status)
      // Fallback: create locally in session cache
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
    // Write-through: cache locally for resilience
    if (data.thread) {
      SessionChatCache.saveThread(data.thread)
    }
    return threadId
  } catch (err) {
    console.error("[Persist] createStoredThread error:", err)
    // Fallback: create locally in session cache
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

async function persistMessage(
  threadId: string,
  message: {
    id: string
    role: string
    text: string
    createdAt: number
    responseId?: string
    taskId?: string
    isTaskCard?: boolean
    contextMeta?: { branchId: string; branchTitle: string; mergeType: "summary" | "full" }
  }
): Promise<boolean> {
  // Write-through: always cache locally (immediate, synchronous)
  SessionChatCache.appendMessage(threadId, {
    id: message.id,
    role: message.role as "user" | "assistant" | "context",
    text: message.text,
    createdAt: message.createdAt,
    responseId: message.responseId,
  })
  try {
    const res = await fetch(`/api/chats/${threadId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    })
    if (!res.ok) {
      console.error("[Persist] persistMessage failed:", res.status, threadId)
    }
    return res.ok
  } catch (err) {
    console.error("[Persist] persistMessage error:", err)
    return false
  }
}

async function updateStoredThread(
  threadId: string,
  updates: { title?: string; summary?: string; lastResponseId?: string | null }
): Promise<boolean> {
  // Write-through: update session cache immediately
  SessionChatCache.updateThread(threadId, updates)
  try {
    const res = await fetch(`/api/chats/${threadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    })
    if (!res.ok) {
      console.error("[Persist] updateStoredThread failed:", res.status, threadId)
    }
    return res.ok
  } catch (err) {
    console.error("[Persist] updateStoredThread error:", err)
    return false
  }
}

// =============================================================================
// FIND TYPES
// =============================================================================

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

function createPendingAssistantTask(id: string, requestText: string): AssistantTaskResult {
  const now = Date.now()
  return {
    id,
    createdAt: now,
    updatedAt: now,
    status: "searching",
    requestText,
    interpretedGoal: "Review workspace context and prepare a product-level Assistant result.",
    taskKind: "clarification",
    progress: ["queued", "interpreting", "searching"],
    sources: [],
    resultSummary: "Reviewing available chat context...",
    proposedActions: [],
    reviewedChatCount: 0,
  }
}

function createFailedAssistantTask(
  id: string,
  requestText: string,
  message: string
): AssistantTaskResult {
  return {
    ...createPendingAssistantTask(id, requestText),
    status: "failed",
    updatedAt: Date.now(),
    resultSummary: message,
    error: message,
  }
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function UnifiedDemoContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // URL-based chat ID (for loading a past chat)
  const urlChatId = searchParams.get("chatId")

  // ==========================================================================
  // CORE STATE: Chain Controller
  // ==========================================================================
  const [state, setState] = useState<MainThreadState>({
    messages: [],
    lastResponseId: null,
  })
  const [inputValue, setInputValue] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [isMerging, setIsMerging] = useState(false)

  // Ref for async operations to get current chain ID
  const lastResponseIdRef = useRef<string | null>(null)
  const chainQueueRef = useRef<Promise<void>>(Promise.resolve())
  const enqueueChain = useCallback(<T,>(operation: () => Promise<T>) => {
    const queued = chainQueueRef.current.then(operation, operation)
    chainQueueRef.current = queued.then(
      () => undefined,
      () => undefined
    )
    return queued
  }, [])

  // ==========================================================================
  // BRANCH STATE
  // ==========================================================================
  const [branchesByParentLocalId, setBranchesByParentLocalId] = useState<
    Record<string, BranchThread[]>
  >({})
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null)

  // ==========================================================================
  // CODEX STATE
  // ==========================================================================
  const [tasks, setTasks] = useState<Record<string, CodexTask>>({})
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null)
  const ingestedTaskIdsRef = useRef<Set<string>>(new Set())
  const isIngestingRef = useRef(false)

  // ==========================================================================
  // ASSISTANT STATE
  // ==========================================================================
  const [assistantTasks, setAssistantTasks] = useState<Record<string, AssistantTaskResult>>({})
  const [includedAssistantContextIds, setIncludedAssistantContextIds] = useState<Set<string>>(
    () => new Set()
  )

  // ==========================================================================
  // FIND STATE
  // ==========================================================================
  const [finderPending, setFinderPending] = useState(false)
  const [finderOptions, setFinderOptions] = useState<FinderOption[]>([])
  const [openingChatId, setOpeningChatId] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  // ==========================================================================
  // DOC-READ STATE
  // ==========================================================================
  const [attachedFile, setAttachedFile] = useState<File | null>(null)
  const [extractedDocText, setExtractedDocText] = useState<string | null>(null)
  const [isUploadingDoc, setIsUploadingDoc] = useState(false)
  const [isGeneratingTTS, setIsGeneratingTTS] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  /** Stores TTS stream configs keyed by message localId — AudioPlayer reads these for streaming */
  const ttsStreamConfigRef = useRef<Map<string, { text: string; voice: string; model: string }>>(new Map())

  // ==========================================================================
  // PERSISTENCE STATE
  // ==========================================================================
  const storedThreadIdRef = useRef<string | null>(null)
  /** Tracks chatIds we set ourselves via router.replace — skip loadChat for these */
  const selfSetChatIdRef = useRef<string | null>(null)

  // ==========================================================================
  // SIDEBAR STATE
  // ==========================================================================
  const [threads, setThreads] = useState<StoredChatThreadMeta[]>([])
  const [isLoadingThreads, setIsLoadingThreads] = useState(true)

  // ==========================================================================
  // CHAIN RECOVERY + OBSERVABILITY
  // ==========================================================================
  const resetChain = useCallback(() => {
    lastResponseIdRef.current = null
    setState((prev) => ({
      ...prev,
      lastResponseId: null,
    }))
    if (storedThreadIdRef.current) {
      updateStoredThread(storedThreadIdRef.current, {
        lastResponseId: null,
      })
    }
  }, [])

  // Fetch threads for sidebar, merging with session cache
  const fetchThreads = useCallback(async () => {
    try {
      let serverThreads: StoredChatThreadMeta[] = []
      try {
        const res = await fetch("/api/chats")
        if (res.ok) {
          const data = await res.json()
          serverThreads = data.threads || []
        }
      } catch {
        // Server unreachable — session cache will fill in
      }
      // Merge with session cache (union by ID, server wins)
      const localThreads = SessionChatCache.listThreads()
      const mergedMap = new Map<string, StoredChatThreadMeta>()
      for (const t of localThreads) mergedMap.set(t.id, t)
      for (const t of serverThreads) mergedMap.set(t.id, t)
      const merged = Array.from(mergedMap.values())
      merged.sort((a, b) => b.updatedAt - a.updatedAt)
      setThreads(merged)
    } catch (error) {
      console.error("[fetchThreads] Failed:", error)
    } finally {
      setIsLoadingThreads(false)
    }
  }, [])

  const buildAssistantLocalThreads = useCallback((): AssistantChatThreadInput[] => {
    return SessionChatCache.listFullThreads().map((thread) => ({
      id: thread.id,
      title: thread.title,
      summary: thread.summary,
      category: thread.category,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      messages: thread.messages.map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        createdAt: message.createdAt,
        taskId: message.taskId,
        isTaskCard: message.isTaskCard,
      })),
    }))
  }, [])

  const buildCurrentAssistantThread = useCallback(
    (messageList: UnifiedMessage[] = state.messages as UnifiedMessage[]): AssistantChatThreadInput | null => {
      const visibleMessages = messageList.filter(
        (message) =>
          !message.isAssistantTaskCard &&
          !message.text.trim().toLowerCase().startsWith("@assistant ")
      )
      if (visibleMessages.length === 0) return null

      const threadId = storedThreadIdRef.current || "current-chat"
      const threadMeta = threads.find((thread) => thread.id === threadId)
      const firstCreatedAt = visibleMessages[0]?.createdAt || Date.now()

      return {
        id: threadId,
        title: threadMeta?.title || "Current chat",
        summary: threadMeta?.summary,
        category: threadMeta?.category || "recent",
        createdAt: threadMeta?.createdAt || firstCreatedAt,
        updatedAt: Date.now(),
        messages: visibleMessages.map((message) => ({
          id: message.localId,
          role: message.role,
          text: message.text,
          createdAt: message.createdAt,
          taskId: message.taskId,
          isTaskCard: message.isTaskCard,
        })),
      }
    },
    [state.messages, threads]
  )

  const runAssistantTask = useCallback(
    async (
      request: string,
      options?: {
        taskId?: string
        previousTask?: AssistantTaskResult | null
        currentMessages?: UnifiedMessage[]
      }
    ): Promise<AssistantTaskResult> => {
      const taskId = options?.taskId || generateId()
      const res = await fetch("/api/assistant/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request,
          clientTaskId: taskId,
          localThreads: buildAssistantLocalThreads(),
          currentThread: buildCurrentAssistantThread(options?.currentMessages),
          previousTask: options?.previousTask || null,
        }),
      })

      const data = (await res.json()) as AssistantRunResponse | { error?: string }
      if (!res.ok || !("task" in data)) {
        const errorMessage = "error" in data ? data.error : undefined
        throw new Error(errorMessage || "Assistant failed to run")
      }

      setAssistantTasks((prev) => ({ ...prev, [data.task.id]: data.task }))
      return data.task
    },
    [buildAssistantLocalThreads, buildCurrentAssistantThread]
  )

  const handleLoadAssistantSampleWorkspace = useCallback(() => {
    const sampleThreads = createAssistantDemoThreads()
    for (const thread of sampleThreads) {
      SessionChatCache.saveThread(thread)
    }
    fetchThreads()
    toast.success("Sample Assistant workspace loaded", {
      description: "Demo chats were added to this browser session.",
    })
  }, [fetchThreads])

  const logRespondCall = useCallback(
    (params: {
      source: "ingestion" | "user"
      previousResponseId: string | null
      newResponseId: string | null
      status: number
      didRetry: boolean
    }) => {
      if (process.env.NODE_ENV !== "development") return
      const prevPreview = params.previousResponseId
        ? params.previousResponseId.slice(0, 8)
        : "none"
      const nextPreview = params.newResponseId
        ? params.newResponseId.slice(0, 8)
        : "none"
      const retryLabel = params.didRetry ? " retry" : ""
      console.log(
        `[Respond][Unified][${params.source}] prev=${prevPreview} new=${nextPreview} status=${params.status}${retryLabel}`
      )
    },
    []
  )

  const isChainBrokenResponse = useCallback(
    (status: number, payload?: { code?: string; message?: string; error?: string }) => {
      if (status === 409 && payload?.code === "chain_broken") return true
      const message = `${payload?.message ?? ""} ${payload?.error ?? ""}`.toLowerCase()
      return message.includes("previous_response_not_found")
    },
    []
  )

  const respondWithRetry = useCallback(
    async ({
      input,
      mode,
      source,
    }: {
      input: string
      mode: "fast" | "deep"
      source: "ingestion" | "user"
    }): Promise<RespondResponse> => {
      const attempt = async (
        previousResponseId: string | null,
        didRetry: boolean
      ): Promise<RespondResponse> => {
        const body: {
          input: string
          mode: "fast" | "deep"
          previous_response_id?: string | null
        } = { input, mode }
        if (previousResponseId) {
          body.previous_response_id = previousResponseId
        }

        const res = await fetch("/api/respond", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })

        let data: RespondResponse | { code?: string; message?: string; error?: string }
        try {
          data = await res.json()
        } catch {
          data = {}
        }

        logRespondCall({
          source,
          previousResponseId,
          newResponseId: res.ok ? (data as RespondResponse).id : null,
          status: res.status,
          didRetry,
        })

        if (res.ok) {
          return data as RespondResponse
        }

        const payload = data as { code?: string; message?: string; error?: string }
        if (isChainBrokenResponse(res.status, payload)) {
          logAuditClient("5.8", "chain_broken_detected", {
            source,
            status: res.status,
            previousResponseId,
            didRetry,
            code: payload.code,
          })
          resetChain()
          if (!didRetry) {
            const retryResult = await attempt(null, true)
            logAuditClient("5.8", "chain_broken_retry_success", { source })
            toast.info("Chain reset; continuing")
            return retryResult
          }
          logAuditClient("5.8", "chain_broken_retry_failed", { source })
          toast.error("Chain reset; please retry")
          throw new Error("CHAIN_RESET_RETRY_FAILED")
        }

        throw new Error(payload.error || payload.message || "Failed to get response")
      }

      return attempt(lastResponseIdRef.current, false)
    },
    [isChainBrokenResponse, logRespondCall, resetChain]
  )

  // ==========================================================================
  // UI REFS
  // ==========================================================================
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const shouldAutoScroll = useRef(true)

  // ==========================================================================
  // COMPUTED VALUES
  // ==========================================================================

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

  // Cast messages to UnifiedMessage for type safety
  const messages = state.messages as UnifiedMessage[]

  // ==========================================================================
  // EFFECTS
  // ==========================================================================

  // Track scroll position
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const { scrollTop, scrollHeight, clientHeight } = container
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight
    shouldAutoScroll.current = distanceFromBottom < 100
  }, [])

  // Autoscroll to bottom
  useEffect(() => {
    if (shouldAutoScroll.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [state.messages, isLoading, finderOptions])

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = "auto"
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
    }
  }, [inputValue])

  // Flush audit telemetry before unload and expose helpers on window
  useEffect(() => {
    if (typeof window !== "undefined") {
      // Expose flush and get for console use during testing
      // Usage: await window.__flushAuditTel__() or JSON.stringify(window.__AUDIT_TEL__, null, 2)
      (window as unknown as Record<string, unknown>).__flushAuditTel__ = flushAuditTelemetry
    }
    const handleUnload = () => {
      // Use sendBeacon for reliable delivery on unload
      const entries = typeof window !== "undefined" ? window.__AUDIT_TEL__ || [] : []
      if (entries.length > 0) {
        navigator.sendBeacon(
          "/api/telemetry",
          JSON.stringify({ entries })
        )
      }
    }
    window.addEventListener("beforeunload", handleUnload)
    return () => window.removeEventListener("beforeunload", handleUnload)
  }, [])

  // Fetch workspace on mount
  useEffect(() => {
    async function fetchWorkspace() {
      try {
        const res = await fetch("/api/codex/workspace")
        if (res.ok) {
          const data = await res.json()
          setWorkspace(data.workspace)
        }
      } catch (error) {
        console.error("Failed to fetch workspace:", error)
      }
    }
    fetchWorkspace()
  }, [])

  // Fetch threads for sidebar on mount
  useEffect(() => {
    fetchThreads()
  }, [fetchThreads])

  // Load chat from URL if chatId is present
  useEffect(() => {
    async function loadChat() {
      if (!urlChatId) return

      // Skip if we just set this chatId ourselves (thread already in local state)
      if (selfSetChatIdRef.current === urlChatId) {
        selfSetChatIdRef.current = null
        return
      }

      // Try server first, then fall back to session cache
      let thread: StoredChatThread | null = null
      let source = "server"

      try {
        const res = await fetch(`/api/chats/${urlChatId}`)
        if (res.ok) {
          const data = await res.json()
          thread = data.thread as StoredChatThread
        }
      } catch {
        // Server unreachable — will try session cache
      }

      // Fallback to session cache if server failed
      if (!thread) {
        const cached = SessionChatCache.getThread(urlChatId)
        if (cached) {
          thread = cached
          source = "session_cache"
          SessionChatCache.trackEvent("threadCacheFallbacks")
        }
      }

      if (!thread) {
        // Both sources failed — silently skip (no toast)
        // The thread may appear later when Redis recovers
        logAuditClient("5.9", "chat_load_both_failed", {
          chatId: urlChatId.slice(0, 8),
        })
        return
      }

      // Convert stored messages to ChatMessage format, preserving task/context metadata
      const loadedMessages: UnifiedMessage[] = thread.messages.map((m) => ({
        localId: m.id,
        role: m.role as "user" | "assistant" | "context",
        text: m.text,
        createdAt: m.createdAt,
        responseId: m.responseId,
        ...(m.taskId ? { taskId: m.taskId } : {}),
        ...(m.isTaskCard ? { isTaskCard: m.isTaskCard } : {}),
        ...(m.contextMeta ? { contextMeta: m.contextMeta } : {}),
      }))

      // Restore task objects for any task card messages
      const taskCardMessages = loadedMessages.filter((m) => m.isTaskCard && m.taskId)
      for (const msg of taskCardMessages) {
        if (msg.taskId && !msg.taskId.startsWith("placeholder_")) {
          try {
            const taskRes = await fetch(`/api/codex/tasks/${msg.taskId}`)
            if (taskRes.ok) {
              const taskData = await taskRes.json()
              setTasks((prev) => ({ ...prev, [msg.taskId!]: taskData.task }))
              logAuditClient("5.6", "task_card_restored_on_load", {
                taskId: msg.taskId,
                taskStatus: taskData.task?.status,
                restored: true,
              })
            } else {
              logAuditClient("5.6", "task_card_restore_failed", {
                taskId: msg.taskId,
                status: taskRes.status,
              })
            }
          } catch {
            logAuditClient("5.6", "task_card_restore_failed", {
              taskId: msg.taskId,
              error: "fetch_error",
            })
          }
        }
      }

      setState({
        messages: loadedMessages,
        lastResponseId: thread.lastResponseId || null,
      })
      lastResponseIdRef.current = thread.lastResponseId || null

      storedThreadIdRef.current = thread.id

      logAuditClient("5.5", "chat_loaded_from_url", {
        urlChatId,
        threadId: thread.id,
        source,
        messageCount: loadedMessages.length,
        lastResponseId: thread.lastResponseId || null,
        hasTaskCards: taskCardMessages.length,
        hasContextMeta: loadedMessages.filter((m) => m.contextMeta).length,
      })

      // Clear finder state
      setFinderOptions([])
    }

    loadChat()
  }, [urlChatId])

  // ==========================================================================
  // CODEX TASK INGESTION (Chain Controller Pattern)
  // ==========================================================================

  // Ingest a completed task's context into the chat chain
  const ingestTaskContext = useCallback(
    (task: CodexTask) => {
      const contextInput = buildTaskContextInput(task)
      if (!contextInput) return Promise.resolve()

      return enqueueChain(async () => {
        try {
          logAuditClient("5.8", "respond_with_retry_call", {
            caller: "ingestTaskContext",
            taskId: task.id,
            previousResponseId: lastResponseIdRef.current,
          })
          const responseData = await respondWithRetry({
            input: contextInput,
            mode: "deep",
            source: "ingestion",
          })

          // Update both ref (immediately) and state
          lastResponseIdRef.current = responseData.id
          setState((prev) => ({
            ...prev,
            lastResponseId: responseData.id,
          }))

          if (storedThreadIdRef.current) {
            await updateStoredThread(storedThreadIdRef.current, {
              lastResponseId: responseData.id,
            })
          }

          if (process.env.NODE_ENV === "development") {
            console.log(
              `[Unified:ingest] Task "${task.id.slice(0, 8)}..." ingested into chain`
            )
          }
        } catch (error) {
          console.error("Failed to ingest task context:", error)
        }
      })
    },
    [enqueueChain, respondWithRetry]
  )

  // Watch for completed tasks and ingest them
  useEffect(() => {
    async function ingestCompletedTasks() {
      if (isIngestingRef.current) return

      const completedTasks = Object.values(tasks)
        .filter(
          (t) =>
            t.contextSummary &&
            (t.status === "draft_ready" ||
              t.status === "applied" ||
              t.status === "pr_created") &&
            !ingestedTaskIdsRef.current.has(t.id)
        )
        .sort((a, b) => a.updatedAt - b.updatedAt)

      if (completedTasks.length === 0) return

      isIngestingRef.current = true

      try {
        for (const task of completedTasks) {
          ingestedTaskIdsRef.current.add(task.id)
          await ingestTaskContext(task)
        }
      } finally {
        isIngestingRef.current = false
      }
    }

    ingestCompletedTasks()
  }, [tasks, ingestTaskContext])

  // ==========================================================================
  // BRANCH MERGE (from Demo 1)
  // ==========================================================================

  // Threshold for skipping LLM summarization - short chats get embedded directly
  const SKIP_SUMMARIZATION_THRESHOLD = 10

  /**
   * Format branch messages as bullet points (looks like a summary but is the full content)
   * Used for short conversations where LLM summarization would be slower than helpful
   */
  const formatAsQuickSummary = (messages: BranchThread["messages"]): string => {
    // For very short conversations, just use a compact format
    const lines: string[] = []
    for (const m of messages) {
      const prefix = m.role === "user" ? "User asked:" : "Assistant:"
      // Truncate long messages for the visual "summary"
      const text = m.text.length > 150 ? m.text.slice(0, 147) + "..." : m.text
      lines.push(`• ${prefix} ${text}`)
    }
    return lines.join("\n")
  }

  /**
   * Perform branch merge - ingest context into the chain immediately
   * This ensures merged context survives reload/reopen (consistent with Codex ingestion model)
   */
  const performMerge = async (
    branch: BranchThread,
    mergeMode: "summary" | "full"
  ): Promise<{ contextText: string; newResponseId: string } | null> => {
    try {
      let contextInput: string
      let displayText: string

      if (mergeMode === "summary") {
        // For short conversations, skip LLM and embed full content directly
        if (branch.messages.length <= SKIP_SUMMARIZATION_THRESHOLD) {
          const quickSummary = formatAsQuickSummary(branch.messages)
          contextInput = `Context from branch "${branch.title}":\n${quickSummary}`
          displayText = quickSummary
        } else {
          // Longer conversations: use LLM summarization (only this part uses API)
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
          contextInput = `Context from branch "${branch.title}":\n${summary}`
          displayText = summary
        }
      } else {
        const transcript = branch.messages
          .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
          .join("\n\n")
        contextInput = `Context from branch "${branch.title}" (full):\n${transcript}`
        displayText = `Full transcript from "${branch.title}"`
      }

      // Ingest context into chain immediately (like standalone branches)
      // This ensures merged context survives reload/reopen
      const prevResponseId = lastResponseIdRef.current
      logAuditClient("5.2", "branch_merge_chain_ingest_start", {
        branchId: branch.id,
        branchTitle: branch.title,
        mergeMode,
        previousResponseId: prevResponseId,
        threadId: storedThreadIdRef.current,
        messageCount: branch.messages.length,
      })

      const responseData = await enqueueChain(async () => {
        return respondWithRetry({
          input: contextInput,
          mode: "deep",
          source: "ingestion",
        })
      })

      // Update chain state
      lastResponseIdRef.current = responseData.id
      setState((prev) => ({
        ...prev,
        lastResponseId: responseData.id,
      }))

      // Persist chain head
      if (storedThreadIdRef.current) {
        await updateStoredThread(storedThreadIdRef.current, {
          lastResponseId: responseData.id,
        })
      }

      logAuditClient("5.2", "branch_merge_chain_ingest_complete", {
        branchId: branch.id,
        previousResponseId: prevResponseId,
        newResponseId: responseData.id,
        threadId: storedThreadIdRef.current,
        chainHeadPersisted: !!storedThreadIdRef.current,
      })

      return {
        contextText: displayText,
        newResponseId: responseData.id,
      }
    } catch (error) {
      console.error("Merge error:", error)
      throw error
    }
  }

  // ==========================================================================
  // HANDLERS
  // ==========================================================================

  // Handle sending a message
  const handleSend = async () => {
    const userText = inputValue.trim()
    if (!userText || isLoading || isMerging || isGeneratingTTS) return

    setInputValue("")
    shouldAutoScroll.current = true

    // Clear finder results when sending a new message
    setFinderOptions([])

    // If a file is attached, route to doc-read flow
    if (attachedFile && extractedDocText) {
      await handleDocReadSend(userText)
      return
    }

    // Check for /find command
    if (isFindCommand(userText)) {
      const query = extractFindQuery(userText)
      if (!query) {
        toast.error("Please provide a search query after /find")
        return
      }
      await handleFindChat(query)
      return
    }

    // Check for @assistant command
    if (isAssistantCommand(userText)) {
      await handleAssistantCommand(userText)
      return
    }

    // Check for @codex command
    if (isCodexCommand(userText)) {
      await handleCodexCommand(userText)
      return
    }

    // Regular chat message
    await handleRegularChat(userText)
  }

  // Handle /find command
  const handleFindChat = async (query: string) => {
    setFinderPending(true)
    const currentRequestId = ++requestIdRef.current

    try {
      // Include local session threads as supplementary candidates
      const localThreads = SessionChatCache.listFullThreads().map((t) => ({
        id: t.id,
        title: t.title,
        summary: t.summary || "",
        category: t.category,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        messages: t.messages.map((m) => ({ role: m.role, text: m.text })),
      }))

      const res = await fetch("/api/chats/find", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, localThreads }),
      })

      if (requestIdRef.current !== currentRequestId) return

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to find chats")
      }

      const data: FindResponse = await res.json()

      const options: FinderOption[] = data.options.map((opt) => ({
        chatId: opt.chatId,
        title: opt.title,
        summary: opt.summary,
        updatedAt: opt.updatedAt,
        confidence: opt.confidence,
        why: opt.why,
      }))

      setFinderOptions(options)

      if (options.length === 0) {
        toast.info("No matching chats found")
      }
    } catch (error) {
      if (requestIdRef.current === currentRequestId) {
        const errorMessage =
          error instanceof Error ? error.message : "Failed to search"
        toast.error(errorMessage)
      }
    } finally {
      if (requestIdRef.current === currentRequestId) {
        setFinderPending(false)
      }
    }
  }

  // Handle opening a found chat (navigate to it)
  const handleOpenFoundChat = async (chatId: string) => {
    setOpeningChatId(chatId)

    try {
      // Save current chat state before navigating (if there are messages)
      if (state.messages.length > 0 && storedThreadIdRef.current) {
        updateStoredThread(storedThreadIdRef.current, {
          lastResponseId: lastResponseIdRef.current,
        })
      }

      // Navigate to the selected chat
      router.push(`/demos/unified?chatId=${chatId}`)
    } catch (error) {
      console.error("Failed to navigate to chat:", error)
      toast.error("Failed to open chat")
    } finally {
      setOpeningChatId(null)
    }
  }

  // Handle @assistant command
  const handleAssistantCommand = async (text: string) => {
    const prompt = extractAssistantPrompt(text)
    if (!prompt) {
      toast.error("Please provide a request after @assistant")
      return
    }

    const userMessage: UnifiedMessage = {
      localId: generateId(),
      role: "user",
      text,
      createdAt: Date.now(),
    }

    const assistantTaskId = generateId()
    const taskMessage: UnifiedMessage = {
      localId: generateId(),
      role: "assistant",
      text: "Assistant task",
      createdAt: Date.now(),
      assistantTaskId,
      isAssistantTaskCard: true,
    }

    const nextMessages = [...messages, userMessage, taskMessage]
    setAssistantTasks((prev) => ({
      ...prev,
      [assistantTaskId]: createPendingAssistantTask(assistantTaskId, prompt),
    }))
    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, userMessage, taskMessage],
    }))

    // Persist the visible command message only. Assistant cards are session-level
    // demo state and do not mutate existing chat history.
    if (!storedThreadIdRef.current) {
      const id = await createStoredThread(`@assistant: ${prompt.slice(0, 30)}...`)
      if (id) {
        storedThreadIdRef.current = id
        selfSetChatIdRef.current = id
        router.replace(`/demos/unified?chatId=${id}`, { scroll: false })
        await persistMessage(id, {
          id: userMessage.localId,
          role: userMessage.role,
          text: userMessage.text,
          createdAt: userMessage.createdAt,
        })
        fetchThreads()
      } else {
        toast.error("Failed to save chat - storage may be unavailable")
      }
    } else {
      await persistMessage(storedThreadIdRef.current, {
        id: userMessage.localId,
        role: userMessage.role,
        text: userMessage.text,
        createdAt: userMessage.createdAt,
      })
    }

    try {
      await runAssistantTask(prompt, {
        taskId: assistantTaskId,
        currentMessages: nextMessages,
      })
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Assistant failed to run"
      setAssistantTasks((prev) => ({
        ...prev,
        [assistantTaskId]: createFailedAssistantTask(assistantTaskId, prompt, errorMessage),
      }))
      toast.error(errorMessage)
    }
  }

  // Handle @codex command
  const handleCodexCommand = async (text: string) => {
    const prompt = extractCodexPrompt(text)

    // Create user message
    const userMessage: UnifiedMessage = {
      localId: generateId(),
      role: "user",
      text,
      createdAt: Date.now(),
    }

    // Create placeholder task immediately
    const placeholderId = `placeholder_${generateId()}`
    const placeholderTask: CodexTask = {
      id: placeholderId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      prompt,
      title: "",
      status: "queued",
      planMarkdown: "",
      changes: [],
      logs: [],
      diffUnified: "",
    }

    // Create task card message
    const taskMessage: UnifiedMessage = {
      localId: generateId(),
      role: "assistant",
      text: "",
      createdAt: Date.now(),
      taskId: placeholderId,
      isTaskCard: true,
    }

    // Update state immediately for instant feedback
    setTasks((prev) => ({ ...prev, [placeholderId]: placeholderTask }))
    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, userMessage, taskMessage],
    }))
    setIsLoading(true)

    // Persist user message — await thread creation AND message before proceeding
    if (!storedThreadIdRef.current) {
      const id = await createStoredThread(`@codex: ${prompt.slice(0, 30)}...`)
      if (id) {
        storedThreadIdRef.current = id
        // Mark as self-set so loadChat effect skips re-fetching
        selfSetChatIdRef.current = id
        router.replace(`/demos/unified?chatId=${id}`, { scroll: false })
        logAuditClient("5.5", "url_push_after_thread_create", {
          threadId: id,
          trigger: "codex_command",
          urlAfter: `/demos/unified?chatId=${id}`,
        })
        await persistMessage(id, {
          id: userMessage.localId,
          role: userMessage.role,
          text: userMessage.text,
          createdAt: userMessage.createdAt,
        })
        fetchThreads()
      } else {
        toast.error("Failed to save chat — storage may be unavailable")
      }
    } else {
      await persistMessage(storedThreadIdRef.current, {
        id: userMessage.localId,
        role: userMessage.role,
        text: userMessage.text,
        createdAt: userMessage.createdAt,
      })
    }

    try {
      const res = await fetch("/api/codex/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      })

      const data = await res.json()

      if (!res.ok) {
        // Update placeholder with error
        setTasks((prev) => ({
          ...prev,
          [placeholderId]: {
            ...placeholderTask,
            status: "failed",
            error: data.error || "Failed to create task",
            logs: ["Error: " + (data.error || "Failed to create task")],
          },
        }))
        throw new Error(data.error || "Failed to create task")
      }

      const task = data.task as CodexTask

      if (process.env.NODE_ENV === "development") {
        console.log(
          `[Unified:handleCodexCommand] Replacing placeholder task "${placeholderId}" with real task "${task.id}"`
        )
      }

      // Replace placeholder with real task
      setTasks((prev) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [placeholderId]: _removed, ...rest } = prev
        return { ...rest, [task.id]: task }
      })

      // Update message to reference real task ID
      setState((prev) => ({
        ...prev,
        messages: prev.messages.map((msg) => {
          const unifiedMsg = msg as UnifiedMessage
          return unifiedMsg.taskId === placeholderId
            ? { ...unifiedMsg, taskId: task.id }
            : msg
        }),
      }))

      // Persist the task card message so it survives reopen
      if (storedThreadIdRef.current) {
        const taskPersistOk = await persistMessage(storedThreadIdRef.current, {
          id: taskMessage.localId,
          role: taskMessage.role,
          text: taskMessage.text,
          createdAt: taskMessage.createdAt,
          taskId: task.id,
          isTaskCard: true,
        })
        logAuditClient("5.6", "task_card_persisted", {
          threadId: storedThreadIdRef.current,
          taskId: task.id,
          messageId: taskMessage.localId,
          persisted: taskPersistOk,
        })
      }

      // Track which task to use for ingestion (either the returned task or the refreshed one)
      let taskForIngestion: CodexTask = task

      // Poll for completion if still running
      if (task.status === "running" || task.status === "queued") {
        const refreshedTask = await refreshTask(task.id)
        if (refreshedTask) {
          taskForIngestion = refreshedTask
        }
      }

      // Await ingestion before re-enabling input to ensure chain state is persisted
      // This prevents reload/navigation from losing Codex context
      if (
        taskForIngestion.contextSummary &&
        !ingestedTaskIdsRef.current.has(taskForIngestion.id)
      ) {
        ingestedTaskIdsRef.current.add(taskForIngestion.id)
        const ingestionStart = Date.now()
        logAuditClient("5.1", "codex_ingestion_start", {
          taskId: taskForIngestion.id,
          threadId: storedThreadIdRef.current,
          lastResponseIdBefore: lastResponseIdRef.current,
          inputStillDisabled: true,
        })
        await ingestTaskContext(taskForIngestion)
        logAuditClient("5.1", "codex_ingestion_complete", {
          taskId: taskForIngestion.id,
          threadId: storedThreadIdRef.current,
          lastResponseIdAfter: lastResponseIdRef.current,
          durationMs: Date.now() - ingestionStart,
          inputStillDisabled: true, // isLoading is still true here
        })

        // Update thread title with the codex task's generated title
        if (storedThreadIdRef.current && taskForIngestion.title) {
          updateStoredThread(storedThreadIdRef.current, {
            title: `@codex: ${taskForIngestion.title}`,
          })
          fetchThreads()
        }
      }

      setIsLoading(false)
      logAuditClient("5.1", "codex_input_reenabled", {
        taskId: taskForIngestion.id,
        lastResponseIdAtReenable: lastResponseIdRef.current,
        threadId: storedThreadIdRef.current,
      })
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Something went wrong"
      toast.error(errorMessage)
      setIsLoading(false)
    }
  }

  // Handle regular chat message
  const handleRegularChat = async (userText: string) => {
    const actualInput = userText

    const userMessage: UnifiedMessage = {
      localId: generateId(),
      role: "user",
      text: userText, // Show original text to user
      createdAt: Date.now(),
    }

    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, userMessage],
    }))
    setIsLoading(true)

    // Persistence — await thread creation AND user message before proceeding
    if (!storedThreadIdRef.current) {
      const threadTitle = userText.length > 50 ? userText.slice(0, 50) + "..." : userText
      const id = await createStoredThread(threadTitle)
      if (id) {
        storedThreadIdRef.current = id
        // Mark as self-set so loadChat effect skips re-fetching
        selfSetChatIdRef.current = id
        router.replace(`/demos/unified?chatId=${id}`, { scroll: false })
        logAuditClient("5.5", "url_push_after_thread_create", {
          threadId: id,
          trigger: "regular_chat",
          urlAfter: `/demos/unified?chatId=${id}`,
        })
        await persistMessage(id, {
          id: userMessage.localId,
          role: userMessage.role,
          text: userMessage.text,
          createdAt: userMessage.createdAt,
        })
        fetchThreads()
      } else {
        toast.error("Failed to save chat — storage may be unavailable")
      }
    } else {
      await persistMessage(storedThreadIdRef.current, {
        id: userMessage.localId,
        role: userMessage.role,
        text: userMessage.text,
        createdAt: userMessage.createdAt,
      })
    }

    try {
      await enqueueChain(async () => {
        // Send with retry logic for chain recovery
        logAuditClient("5.8", "respond_with_retry_call", {
          caller: "handleRegularChat",
          previousResponseId: lastResponseIdRef.current,
        })
        const responseData = await respondWithRetry({
          input: actualInput,
          mode: "deep",
          source: "user",
        })

        const assistantMessage: UnifiedMessage = {
          localId: generateId(),
          role: "assistant",
          text: responseData.output_text,
          createdAt: Date.now(),
          responseId: responseData.id,
        }

        lastResponseIdRef.current = responseData.id
        setState((prev) => ({
          ...prev,
          messages: [...prev.messages, assistantMessage],
          lastResponseId: responseData.id,
        }))

        // Stop typing indicator immediately now that the response is visible
        setIsLoading(false)

        // Persist assistant message and update thread — await both
        const threadId = storedThreadIdRef.current
        if (threadId) {
          await persistMessage(threadId, {
            id: assistantMessage.localId,
            role: assistantMessage.role,
            text: assistantMessage.text,
            createdAt: assistantMessage.createdAt,
            responseId: assistantMessage.responseId,
          })
          // Build a rolling summary from recent exchanges for /find searchability
          // Include both first and latest exchanges so search can find later-message facts
          const allMsgs = [...state.messages, userMessage, assistantMessage]
          const firstExchange = allMsgs.slice(0, 2).map((m) => m.text).join(" | ")
          const lastExchange = `${userText} | ${responseData.output_text}`
          const summaryText = allMsgs.length <= 2
            ? lastExchange.slice(0, 300)
            : `${firstExchange.slice(0, 150)} ... ${lastExchange.slice(0, 150)}`
          await updateStoredThread(threadId, {
            lastResponseId: responseData.id,
            summary: summaryText,
          })

          // Auto-generate a clean title after the first exchange (fire-and-forget)
          if (allMsgs.length <= 2) {
            fetch("/api/chats/generate-title", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                userMessage: userText.slice(0, 500),
                assistantMessage: responseData.output_text.slice(0, 500),
              }),
            })
              .then((r) => r.json())
              .then((data) => {
                if (data.title) {
                  updateStoredThread(threadId, { title: data.title })
                  fetchThreads()
                }
              })
              .catch(() => {
                // Non-critical — title remains as first-message truncation
              })
          }

          // Refresh sidebar so the thread shows updated title/time
          fetchThreads()
        }
      })
    } catch (error) {
      if (error instanceof Error && error.message === "CHAIN_RESET_RETRY_FAILED") {
        return
      }
      const errorMessage =
        error instanceof Error ? error.message : "Something went wrong"
      toast.error(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  // ==========================================================================
  // DOC-READ HANDLERS
  // ==========================================================================

  const handleFileSelect = useCallback(async (file: File) => {
    const ext = file.name.toLowerCase().split(".").pop()
    if (ext !== "pdf" && ext !== "docx") {
      toast.error("Unsupported file type. Please upload a PDF or DOCX file.")
      return
    }

    setAttachedFile(file)
    setIsUploadingDoc(true)
    setExtractedDocText(null)

    try {
      const formData = new FormData()
      formData.append("file", file)

      const res = await fetch("/api/doc/upload", {
        method: "POST",
        body: formData,
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to process file")
      }

      const data = await res.json()
      setExtractedDocText(data.text)
      toast.success(`Extracted ${data.wordCount.toLocaleString()} words from ${file.name}`)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to process file"
      toast.error(errorMessage)
      setAttachedFile(null)
      setExtractedDocText(null)
    } finally {
      setIsUploadingDoc(false)
    }
  }, [])

  const handleRemoveAttachment = useCallback(() => {
    setAttachedFile(null)
    setExtractedDocText(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }, [])

  const handleDocReadSend = async (userText: string) => {
    if (!attachedFile || !extractedDocText) return

    const filename = attachedFile.name

    // Clear attachment state
    setAttachedFile(null)
    setExtractedDocText(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }

    // Add user message to UI
    const userMessage: UnifiedMessage = {
      localId: generateId(),
      role: "user",
      text: `📎 ${filename}\n${userText}`,
      createdAt: Date.now(),
    }

    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, userMessage],
    }))
    setIsLoading(true)

    // Persist thread if needed
    if (!storedThreadIdRef.current) {
      const threadTitle = `Doc: ${filename}`
      const id = await createStoredThread(threadTitle)
      if (id) {
        storedThreadIdRef.current = id
        selfSetChatIdRef.current = id
        router.replace(`/demos/unified?chatId=${id}`, { scroll: false })
        await persistMessage(id, {
          id: userMessage.localId,
          role: userMessage.role,
          text: userMessage.text,
          createdAt: userMessage.createdAt,
        })
        fetchThreads()
      }
    } else {
      await persistMessage(storedThreadIdRef.current, {
        id: userMessage.localId,
        role: userMessage.role,
        text: userMessage.text,
        createdAt: userMessage.createdAt,
      })
    }

    try {
      // Step 1: Determine if this is a "read aloud" request.
      // Use a keyword check first — if the user clearly wants TTS, skip the
      // LLM classifier entirely (it's unreliable for short, ambiguous prompts).
      const lowerText = userText.toLowerCase()
      const READ_KEYWORDS = [
        "read", "aloud", "listen", "narrate", "audio", "tts",
        "play", "speak", "voice", "out loud", "read it", "read this",
        "read me", "hear",
      ]
      const hasReadKeyword = READ_KEYWORDS.some((kw) => lowerText.includes(kw))

      // Analytical keywords that clearly indicate "discuss" intent
      const DISCUSS_KEYWORDS = [
        "summarize", "summary", "explain", "analyze", "what does",
        "what are", "key points", "tell me about", "describe",
        "compare", "extract", "list the", "how does", "why does",
      ]
      const hasDiscussKeyword = DISCUSS_KEYWORDS.some((kw) => lowerText.includes(kw))

      let isReadAloud: boolean

      if (hasReadKeyword && !hasDiscussKeyword) {
        // Clear read-aloud signal — skip classifier
        isReadAloud = true
        console.log(`[Doc:classify] Keyword match — skipping LLM classifier`)
      } else if (hasDiscussKeyword && !hasReadKeyword) {
        // Clear discuss signal — skip classifier
        isReadAloud = false
      } else {
        // Ambiguous — use LLM classifier as tiebreaker
        const classifyRes = await fetch("/api/doc/classify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userMessage: userText, filename }),
        })
        const classifyData = await classifyRes.json()
        isReadAloud = classifyData.intent === "read_aloud" && classifyData.confidence >= 0.3
      }

      if (isReadAloud) {
        // Step 2a: Stream TTS progressively — show message immediately,
        // AudioPlayer handles fetching and progressive playback via MediaSource
        setIsLoading(false)

        const msgId = generateId()

        // Store stream config for AudioPlayer to pick up
        ttsStreamConfigRef.current.set(msgId, {
          text: extractedDocText,
          voice: "nova",
          model: "tts-1",
        })

        const assistantMessage: UnifiedMessage = {
          localId: msgId,
          role: "assistant",
          text: `Here's the audio reading of "${filename}".`,
          createdAt: Date.now(),
          audioMeta: { voice: "nova", filename },
        }

        setState((prev) => ({
          ...prev,
          messages: [...prev.messages, assistantMessage],
        }))

        // Persist
        const threadId = storedThreadIdRef.current
        if (threadId) {
          await persistMessage(threadId, {
            id: assistantMessage.localId,
            role: assistantMessage.role,
            text: assistantMessage.text,
            createdAt: assistantMessage.createdAt,
          })
        }
      } else {
        // Step 2b: Normal chat with document as context
        await enqueueChain(async () => {
          const contextInput = `[Document: ${filename}]\n\n${extractedDocText.slice(0, 30000)}\n\n---\n\nUser question: ${userText}`
          const responseData = await respondWithRetry({
            input: contextInput,
            mode: "deep",
            source: "user",
          })

          const assistantMessage: UnifiedMessage = {
            localId: generateId(),
            role: "assistant",
            text: responseData.output_text,
            createdAt: Date.now(),
            responseId: responseData.id,
          }

          lastResponseIdRef.current = responseData.id
          setState((prev) => ({
            ...prev,
            messages: [...prev.messages, assistantMessage],
            lastResponseId: responseData.id,
          }))

          const threadId = storedThreadIdRef.current
          if (threadId) {
            await persistMessage(threadId, {
              id: assistantMessage.localId,
              role: assistantMessage.role,
              text: assistantMessage.text,
              createdAt: assistantMessage.createdAt,
              responseId: assistantMessage.responseId,
            })
          }
        })
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Something went wrong"
      toast.error(errorMessage)
    } finally {
      setIsLoading(false)
      setIsGeneratingTTS(false)
    }
  }

  // Handle creating a branch
  const handleBranch = (localId: string, responseId: string) => {
    const existingBranches = branchesByParentLocalId[localId] || []
    const branchNumber = existingBranches.length + 1

    const newBranch: BranchThread = {
      id: generateId(),
      parentAssistantLocalId: localId,
      parentAssistantResponseId: responseId,
      title: `Branch ${branchNumber}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      mode: "fast",
      includeInMain: false,
      includeMode: "summary",
      messages: [],
      lastResponseId: null,
      mergedIntoMain: false,
    }

    setBranchesByParentLocalId((prev) => ({
      ...prev,
      [localId]: [...(prev[localId] || []), newBranch],
    }))

    setActiveBranchId(newBranch.id)
  }

  // Handle opening an existing branch
  const handleOpenBranch = (branchId: string) => {
    setActiveBranchId(branchId)
  }

  // Handle closing branch overlay
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
        const contextMessage: UnifiedMessage = {
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

        // Add context message to UI immediately (no LLM call needed)
        setState((prev) => ({
          ...prev,
          messages: [...prev.messages, contextMessage],
        }))

        // Persist context message with metadata
        if (storedThreadIdRef.current) {
          const ctxPersistOk = await persistMessage(storedThreadIdRef.current, {
            id: contextMessage.localId,
            role: contextMessage.role,
            text: contextMessage.text,
            createdAt: contextMessage.createdAt,
            contextMeta: contextMessage.contextMeta,
          })
          logAuditClient("5.6", "context_meta_persisted", {
            threadId: storedThreadIdRef.current,
            messageId: contextMessage.localId,
            hasContextMeta: !!contextMessage.contextMeta,
            branchId: contextMessage.contextMeta?.branchId,
            persisted: ctxPersistOk,
          })
        }

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
          "Branch context merged",
          {
            description: `Context from "${branch.title}" has been ingested into the chat chain.`,
          }
        )
      }
    } catch (error) {
      // Revert includeInMain toggle on failure
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

      const isTimeout =
        error instanceof Error && error.message.includes("timed out")
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

  // Handle updating a branch
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

  // Codex task helpers
  // Returns the refreshed task so callers can use it for synchronous ingestion
  const refreshTask = async (taskId: string): Promise<CodexTask | null> => {
    try {
      if (taskId.startsWith("placeholder_")) {
        return null
      }
      const res = await fetch(`/api/codex/tasks/${taskId}`)
      if (res.ok) {
        const data = await res.json()
        const refreshedTask = data.task as CodexTask
        setTasks((prev) => ({ ...prev, [taskId]: refreshedTask }))
        return refreshedTask
      }
      return null
    } catch (error) {
      console.error("Failed to refresh task:", error)
      return null
    }
  }

  const applyTaskChanges = async (taskId: string) => {
    const res = await fetch(`/api/codex/tasks/${taskId}/apply`, {
      method: "POST",
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || "Failed to apply changes")
    }
    const data = await res.json()
    setTasks((prev) => ({ ...prev, [taskId]: data.task }))
    setWorkspace(data.workspace)
  }

  const createTaskPR = async (taskId: string) => {
    const res = await fetch(`/api/codex/tasks/${taskId}/pr`, {
      method: "POST",
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || "Failed to create PR")
    }
    const data = await res.json()
    setTasks((prev) => ({ ...prev, [taskId]: data.task }))
  }

  // Handle keyboard events
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (inputValue.trim() && !isLoading && !isMerging) {
        handleSend()
      }
    }
  }

  // Reset chat state
  const handleReset = useCallback(async () => {
    // Flush any pending persistence before switching
    const prevThreadId = storedThreadIdRef.current
    if (prevThreadId) {
      // Give pending fire-and-forget fetches a moment to land
      await new Promise((r) => setTimeout(r, 100))
    }

    // If we were viewing a specific chat, navigate back to clean URL
    if (urlChatId) {
      router.push("/demos/unified")
    }

    setState({
      messages: [],
      lastResponseId: null,
    })
    setBranchesByParentLocalId({})
    setActiveBranchId(null)
    setTasks({})
    setAssistantTasks({})
    setFinderOptions([])
    setInputValue("")
    setAttachedFile(null)
    setExtractedDocText(null)
    setIsGeneratingTTS(false)
    ttsStreamConfigRef.current.clear()
    storedThreadIdRef.current = null
    ingestedTaskIdsRef.current.clear()
    lastResponseIdRef.current = null
    chainQueueRef.current = Promise.resolve()

    // Refresh sidebar so past chats remain visible — await it
    await fetchThreads()
  }, [urlChatId, router, fetchThreads])

  const hasMessages = state.messages.length > 0
  const hasFinderResults = finderOptions.length > 0

  // Format relative time for sidebar
  const formatRelativeTime = (timestamp: number): string => {
    const now = Date.now()
    const diff = now - timestamp
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 1) return "Just now"
    if (minutes < 60) return `${minutes}m ago`
    if (hours < 24) return `${hours}h ago`
    if (days < 7) return `${days}d ago`
    return new Date(timestamp).toLocaleDateString()
  }

  // Handle clicking a thread in sidebar
  const handleSelectThread = (threadId: string) => {
    if (threadId === storedThreadIdRef.current) return
    router.push(`/demos/unified?chatId=${threadId}`)
  }

  const handleOpenAssistantChat = (chatId: string) => {
    if (!chatId || chatId === "current-chat") return
    handleSelectThread(chatId)
  }

  const handleInsertAssistantPrompt = (prompt: string) => {
    setInputValue(prompt)
    toast.success("Prompt inserted")
  }

  const handleIncludeAssistantContext = async (task: AssistantTaskResult) => {
    if (includedAssistantContextIds.has(task.id)) return

    const contextInput = buildAssistantContextInput(task)
    if (!contextInput) {
      toast.error("Assistant output is not ready to include yet")
      return
    }

    try {
      logAuditClient("assistant", "assistant_context_ingest_start", {
        taskId: task.id,
        threadId: storedThreadIdRef.current,
        previousResponseId: lastResponseIdRef.current,
      })

      const responseData = await enqueueChain(async () =>
        respondWithRetry({
          input: contextInput,
          mode: "deep",
          source: "ingestion",
        })
      )

      lastResponseIdRef.current = responseData.id
      setState((prev) => ({
        ...prev,
        lastResponseId: responseData.id,
      }))

      if (storedThreadIdRef.current) {
        await updateStoredThread(storedThreadIdRef.current, {
          lastResponseId: responseData.id,
        })
      }

      setIncludedAssistantContextIds((prev) => {
        const next = new Set(prev)
        next.add(task.id)
        return next
      })

      logAuditClient("assistant", "assistant_context_ingest_complete", {
        taskId: task.id,
        threadId: storedThreadIdRef.current,
        newResponseId: responseData.id,
      })
      toast.success("Assistant output added to chat context")
    } catch (error) {
      console.error("Failed to include Assistant context:", error)
      toast.error("Could not add Assistant output to chat context")
    }
  }

  const handleCloseAssistantTask = (taskId: string) => {
    setState((prev) => ({
      ...prev,
      messages: prev.messages.filter(
        (message) => (message as UnifiedMessage).assistantTaskId !== taskId
      ),
    }))
    setAssistantTasks((prev) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [taskId]: _removed, ...rest } = prev
      return rest
    })
    setIncludedAssistantContextIds((prev) => {
      if (!prev.has(taskId)) return prev
      const next = new Set(prev)
      next.delete(taskId)
      return next
    })
  }

  const handleAssistantFollowUp = async (text: string, parentTaskId: string) => {
    const previousTask = assistantTasks[parentTaskId] || null
    setAssistantTasks((prev) => ({
      ...prev,
      [parentTaskId]: createPendingAssistantTask(parentTaskId, text),
    }))

    try {
      await runAssistantTask(text, {
        taskId: parentTaskId,
        previousTask,
      })
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Assistant failed to run"
      setAssistantTasks((prev) => ({
        ...prev,
        [parentTaskId]: createFailedAssistantTask(parentTaskId, text, errorMessage),
      }))
      toast.error(errorMessage)
    }
  }

  // ==========================================================================
  // RENDER
  // ==========================================================================

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full">
        {/* Left Sidebar */}
        <div className="w-64 border-r border-border flex flex-col bg-muted/30">
          <div className="p-3 border-b border-border">
            <Button
              onClick={handleReset}
              className="w-full gap-2"
              variant="outline"
            >
              <Plus className="h-4 w-4" />
              New Chat
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {isLoadingThreads ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : threads.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No chats yet
                </div>
              ) : (
                threads.map((thread) => {
                  const isActive = thread.id === storedThreadIdRef.current || thread.id === urlChatId
                  return (
                    <button
                      key={thread.id}
                      onClick={() => handleSelectThread(thread.id)}
                      className={`w-full text-left p-2.5 rounded-lg transition-colors hover:bg-accent/50 ${
                        isActive ? "bg-accent" : ""
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <MessageSquare className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {thread.title || "New Chat"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatRelativeTime(thread.updatedAt)}
                          </div>
                        </div>
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col">
          {/* Storage warning banner */}
          <StorageWarningBanner className="m-2" />

          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-border">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              <span className="font-medium">Unified Chat</span>
            </div>
            <AssistantLauncher
              onRunTask={runAssistantTask}
              onLoadSampleWorkspace={handleLoadAssistantSampleWorkspace}
              onOpenChat={handleOpenAssistantChat}
              onInsertPrompt={handleInsertAssistantPrompt}
            />
          </div>

          {/* Messages area */}
          <div
            ref={messagesContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto"
          >
            {!hasMessages && !isLoading && !hasFinderResults && !finderPending ? (
              // Empty state
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <Zap className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-lg font-medium mb-2">Unified Chat</h3>
                <p className="text-sm text-muted-foreground max-w-sm mb-4">
                  All features in one place. Chat, branch, run Codex tasks, or
                  find past conversations.
                </p>
                <div className="text-xs text-muted-foreground/70 max-w-sm p-3 bg-muted rounded-lg space-y-2">
                  <p>
                    <strong>Features:</strong>
                  </p>
                  <p>
                    <code className="bg-background px-1 rounded">@assistant</code>{" "}
                    &mdash; Work across chats and recover unfinished work
                  </p>
                  <p>
                    <code className="bg-background px-1 rounded">@codex</code>{" "}
                    &mdash; Generate code with task cards
                  </p>
                  <p>
                    <code className="bg-background px-1 rounded">/find</code>{" "}
                    &mdash; Search past conversations
                  </p>
                  <p>
                    <span className="inline-flex items-center gap-1">
                      <Sparkles className="h-3 w-3" /> Branch
                    </span>{" "}
                    &mdash; Click branch on any assistant message
                  </p>
                  <p>
                    <span className="inline-flex items-center gap-1">
                      <FileAudio className="h-3 w-3" /> Doc Read
                    </span>{" "}
                    &mdash; Attach a PDF/DOCX and ask to read it aloud
                  </p>
                </div>
              </div>
            ) : (
              // Messages list
              <div className="p-4 space-y-4">
                {messages.map((message) => {
                  // Render AssistantTaskCard for Assistant card messages
                  if (message.isAssistantTaskCard && message.assistantTaskId) {
                    const task = assistantTasks[message.assistantTaskId]
                    if (!task) return null
                    return (
                      <AssistantTaskCard
                        key={`${message.localId}-${message.assistantTaskId}`}
                        task={task}
                        onFollowUp={handleAssistantFollowUp}
                        onClose={() => handleCloseAssistantTask(task.id)}
                        onOpenChat={handleOpenAssistantChat}
                        onInsertPrompt={handleInsertAssistantPrompt}
                        onIncludeInChatContext={handleIncludeAssistantContext}
                        isIncludedInChatContext={includedAssistantContextIds.has(task.id)}
                      />
                    )
                  }

                  // Render TaskCard for task messages
                  if (message.isTaskCard && message.taskId) {
                    const task = tasks[message.taskId]
                    if (!task) return null
                    return (
                      <TaskCard
                        key={`${message.localId}-${message.taskId}`}
                        task={task}
                        workspace={workspace || undefined}
                        onApplyChanges={() => applyTaskChanges(task.id)}
                        onCreatePR={() => createTaskPR(task.id)}
                        onRefresh={async () => { await refreshTask(task.id) }}
                      />
                    )
                  }

                  // Render regular message bubble
                  return (
                    <ChatMessageBubble
                      key={message.localId}
                      message={message}
                      onBranch={handleBranch}
                      branches={branchesByParentLocalId[message.localId] || []}
                      onOpenBranch={handleOpenBranch}
                      audioStreamConfig={ttsStreamConfigRef.current.get(message.localId)}
                    />
                  )
                })}

                {/* Finder pending state */}
                {finderPending && (
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
                )}

                {/* Finder results */}
                {!finderPending && hasFinderResults && (
                  <div className="flex items-start">
                    <div className="max-w-[90%] space-y-3">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                        <Search className="h-4 w-4" />
                        <span>
                          Found {finderOptions.length} matching{" "}
                          {finderOptions.length === 1 ? "chat" : "chats"}
                        </span>
                      </div>
                      {finderOptions.map((option) => (
                        <FinderOptionCard
                          key={option.chatId}
                          option={option}
                          onClick={() => handleOpenFoundChat(option.chatId)}
                          isOpening={openingChatId === option.chatId}
                          disabled={openingChatId !== null}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {isLoading && <TypingIndicator />}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="border-t border-border bg-card/50">
            {/* File attachment chip */}
            {attachedFile && (
              <div className="px-4 pt-3 pb-0">
                <FileAttachmentChip
                  filename={attachedFile.name}
                  isProcessing={isUploadingDoc}
                  onRemove={handleRemoveAttachment}
                />
              </div>
            )}

            {/* TTS generation indicator */}
            {isGeneratingTTS && (
              <div className="px-4 pt-3 pb-0">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-sm">
                  <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
                  <span className="text-xs text-primary font-medium">Generating audio...</span>
                </div>
              </div>
            )}

            <div className="flex items-end gap-2 p-4">
              {/* File attachment button */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleFileSelect(file)
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-[44px] w-[44px] shrink-0"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading || isMerging || isUploadingDoc || isGeneratingTTS}
              >
                <Paperclip className="h-4 w-4" />
              </Button>

              <Textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  attachedFile
                    ? "Ask about the doc, or say \"read this to me\"..."
                    : "Type a message, @assistant to use Assistant, @codex to run a task, or /find to search..."
                }
                disabled={isLoading || isMerging || isGeneratingTTS}
                rows={1}
                className="min-h-[44px] max-h-[200px] resize-none bg-background"
              />
              <Button
                onClick={handleSend}
                disabled={isLoading || isMerging || isGeneratingTTS || !inputValue.trim()}
                size="icon"
                className="h-[44px] w-[44px] shrink-0"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Branch Overlay */}
        <BranchOverlay
          branch={activeBranch}
          parentMessageText={parentMessageText}
          isOpen={!!activeBranchId}
          onClose={handleCloseBranch}
          onUpdateBranch={handleUpdateBranch}
        />

        {/* Merging overlay - only shown during LLM summarization for longer branches */}
        {isMerging && (
          <div className="fixed inset-0 bg-background/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-card border border-border rounded-xl p-6 shadow-xl flex flex-col items-center gap-4 min-w-[280px]">
              <Loader2 className="h-8 w-8 text-primary animate-spin" />
              <div className="text-center space-y-1">
                <h3 className="text-sm font-medium text-foreground">
                  Preparing branch context
                </h3>
                <p className="text-xs text-muted-foreground">
                  Summarizing conversation...
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}

// =============================================================================
// EXPORT WITH SUSPENSE BOUNDARY
// =============================================================================

export default function UnifiedDemo() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <UnifiedDemoContent />
    </Suspense>
  )
}

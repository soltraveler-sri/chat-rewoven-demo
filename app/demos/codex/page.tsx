"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import {
  RotateCcw,
  Loader2,
  Send,
  Terminal,
  FileCode,
  FolderOpen,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ScrollArea } from "@/components/ui/scroll-area"
import { MarkdownContent } from "@/components/ui/markdown-content"
import { cn } from "@/lib/utils"
import { TaskCard } from "@/components/codex"
import { StorageWarningBanner } from "@/components/ui/storage-warning-banner"
import type { CodexTask, WorkspaceSnapshot } from "@/lib/codex/types"
import { SessionChatCache } from "@/lib/session-cache"

/**
 * Message types for the Demo 3 chat
 */
type MessageType = "user" | "assistant" | "task"

interface ChatMessage {
  id: string
  type: MessageType
  text?: string
  taskId?: string
  createdAt: number
}

function generateId(): string {
  return crypto.randomUUID()
}

/**
 * Build a compact context string from a task's context summary
 * Used for ingesting task output into the chat chain
 */
function buildTaskContextInput(task: CodexTask): string | null {
  const summary = task.contextSummary
  if (!summary) return null
  
  const lines: string[] = [
    `Context from completed Codex task "${summary.title}":`,
    '',
    `Files generated: ${summary.filePaths.slice(0, 5).join(', ')}${summary.filePaths.length > 5 ? '...' : ''}`,
  ]
  
  if (summary.languages.length > 0) {
    lines.push(`Languages: ${summary.languages.join(', ')}`)
  }
  
  if (summary.bullets.length > 0) {
    lines.push('')
    lines.push('Summary of what was built:')
    for (const bullet of summary.bullets.slice(0, 4)) {
      lines.push(`- ${bullet}`)
    }
  }
  
  return lines.join('\n')
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

export default function CodexDemoPage() {
  // State
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [tasks, setTasks] = useState<Record<string, CodexTask>>({})
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null)
  const [inputValue, setInputValue] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [, setLastResponseId] = useState<string | null>(null)
  const [showWorkspace, setShowWorkspace] = useState(false)

  // Refs for autoscroll and task ingestion tracking
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const shouldAutoScroll = useRef(true)
  const ingestedTaskIdsRef = useRef<Set<string>>(new Set())
  const isIngestingRef = useRef(false)
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

  // Fetch initial workspace
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

  // Ingest a completed task's context into the chat chain
  // This makes the chat truly stateful - the model will remember task outputs
  const ingestTaskContext = useCallback(
    (task: CodexTask) => {
      const contextInput = buildTaskContextInput(task)
      if (!contextInput) return Promise.resolve()

      return enqueueChain(async () => {
        try {
          // Use ref to get the current chain ID (important for sequential ingestion)
          const currentResponseId = lastResponseIdRef.current

          const res = await fetch("/api/respond", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              input: contextInput,
              previous_response_id: currentResponseId,
              mode: "deep",
            }),
          })

          const data = await res.json()

          if (!res.ok) {
            console.error("Failed to ingest task context:", data.error)
            return
          }

          // Update both ref (immediately) and state (for UI/chain)
          // This ensures sequential ingestions use the correct chain ID
          lastResponseIdRef.current = data.id
          setLastResponseId(data.id)

          if (process.env.NODE_ENV === "development") {
            console.log(
              `[Codex:ingest] Task "${task.id.slice(0, 8)}..." ingested into chain, new responseId: ${data.id?.slice(0, 12)}...`
            )
          }
        } catch (error) {
          console.error("Failed to ingest task context:", error)
        }
      })
    },
    [enqueueChain]
  )

  // Watch for completed tasks and ingest them into the chat chain
  // This runs after each task state update to check for newly completed tasks
  useEffect(() => {
    async function ingestCompletedTasks() {
      // Prevent concurrent ingestion
      if (isIngestingRef.current) return
      
      // Find completed tasks that haven't been ingested yet
      const completedTasks = Object.values(tasks)
        .filter(t => 
          t.contextSummary &&
          (t.status === "draft_ready" || t.status === "applied" || t.status === "pr_created") &&
          !ingestedTaskIdsRef.current.has(t.id)
        )
        .sort((a, b) => a.updatedAt - b.updatedAt) // Oldest first to maintain chain order
      
      if (completedTasks.length === 0) return
      
      isIngestingRef.current = true
      
      try {
        // Ingest tasks sequentially to maintain chain order
        for (const task of completedTasks) {
          // Mark as ingested before the call to prevent double-ingestion
          ingestedTaskIdsRef.current.add(task.id)
          await ingestTaskContext(task)
        }
      } finally {
        isIngestingRef.current = false
      }
    }
    
    ingestCompletedTasks()
  }, [tasks, ingestTaskContext])

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
  }, [messages, isLoading])

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = "auto"
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
    }
  }, [inputValue])

  // Refresh a task - returns the refreshed task for synchronous ingestion
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
        // Write-through: cache task in session storage
        SessionChatCache.saveTask(refreshedTask)
        return refreshedTask
      }
      // Server returned non-OK — fall back to session cache
      const cached = SessionChatCache.getTask(taskId)
      if (cached) {
        setTasks((prev) => ({ ...prev, [taskId]: cached }))
        SessionChatCache.trackEvent("codexTaskCacheFallbacks")
        return cached
      }
      return null
    } catch (error) {
      console.error("Failed to refresh task:", error)
      // Fall back to session cache on network error
      const cached = SessionChatCache.getTask(taskId)
      if (cached) {
        setTasks((prev) => ({ ...prev, [taskId]: cached }))
        SessionChatCache.trackEvent("codexTaskCacheFallbacks")
        return cached
      }
      return null
    }
  }

  // Apply task changes
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

  // Create PR
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

  // Handle sending a message
  const handleSend = async () => {
    const text = inputValue.trim()
    if (!text || isLoading) return

    // Add user message
    const userMessage: ChatMessage = {
      id: generateId(),
      type: "user",
      text,
      createdAt: Date.now(),
    }
    setMessages((prev) => [...prev, userMessage])
    setInputValue("")
    setIsLoading(true)
    shouldAutoScroll.current = true

    try {
      if (isCodexCommand(text)) {
        // Handle @codex command
        const prompt = extractCodexPrompt(text)

        // Create placeholder task immediately for instant UI feedback
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

        // Store placeholder task and add task card message immediately
        setTasks((prev) => ({ ...prev, [placeholderId]: placeholderTask }))
        const taskMessage: ChatMessage = {
          id: generateId(),
          type: "task",
          taskId: placeholderId,
          createdAt: Date.now(),
        }
        setMessages((prev) => [...prev, taskMessage])

        // Now make the API call
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
        // Write-through: cache newly created task
        SessionChatCache.saveTask(task)

        if (process.env.NODE_ENV === "development") {
          console.log(
            `[Codex:handleSend] Replacing placeholder task "${placeholderId}" with real task "${task.id}"`
          )
        }

        // Replace placeholder with real task
        setTasks((prev) => {
          const { [placeholderId]: removedTask, ...rest } = prev
          void removedTask
          return { ...rest, [task.id]: task }
        })

        // Update message to reference real task ID
        setMessages((prev) =>
          prev.map((msg) =>
            msg.taskId === placeholderId ? { ...msg, taskId: task.id } : msg
          )
        )

        // Track which task to use for ingestion
        let taskForIngestion: CodexTask = task

        // Poll for completion if still running
        if (task.status === "running" || task.status === "queued") {
          const refreshedTask = await refreshTask(task.id)
          if (refreshedTask) {
            taskForIngestion = refreshedTask
          }
        }

        // Re-enable input immediately so user doesn't see "..." after task completes
        setIsLoading(false)

        // Start ingestion in background (serialized via chain queue)
        if (
          taskForIngestion.contextSummary &&
          !ingestedTaskIdsRef.current.has(taskForIngestion.id)
        ) {
          ingestedTaskIdsRef.current.add(taskForIngestion.id)
          ingestTaskContext(taskForIngestion)

          if (process.env.NODE_ENV === "development") {
            console.log(
              `[Codex:handleSend] Task "${taskForIngestion.id.slice(0, 8)}..." context ingestion started (background)`
            )
          }
        }
      } else {
        await enqueueChain(async () => {
          // Regular chat message - send to /api/respond
          // Context from completed tasks is already in the chain via ingestion,
          // so we just send the user's message directly
          const res = await fetch("/api/respond", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              input: text,
              previous_response_id: lastResponseIdRef.current,
              mode: "deep",
            }),
          })

          const data = await res.json()

          if (!res.ok) {
            throw new Error(data.error || "Failed to get response")
          }

          // Add assistant message
          const assistantMessage: ChatMessage = {
            id: generateId(),
            type: "assistant",
            text: data.output_text,
            createdAt: Date.now(),
          }
          lastResponseIdRef.current = data.id
          setLastResponseId(data.id)
          setMessages((prev) => [...prev, assistantMessage])
        })
      }
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

  // Handle keyboard events
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (inputValue.trim() && !isLoading) {
        handleSend()
      }
    }
  }

  // Reset chat
  const handleReset = () => {
    setMessages([])
    setTasks({})
    setLastResponseId(null)
    lastResponseIdRef.current = null
    setInputValue("")
    ingestedTaskIdsRef.current.clear()
    chainQueueRef.current = Promise.resolve()
    toast.success("Chat cleared")
  }

  const hasMessages = messages.length > 0

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col">
        {/* Storage warning banner */}
        <StorageWarningBanner className="m-2" />

        <div className="flex flex-1 overflow-hidden">
          {/* Main chat area */}
          <div className="flex-1 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border">
            <div className="flex items-center gap-2">
              <Terminal className="h-5 w-5 text-primary" />
              <span className="font-medium">Codex Demo</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowWorkspace(!showWorkspace)}
                className="gap-1.5"
              >
                <FolderOpen className="h-4 w-4" />
                Workspace
              </Button>
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
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <Terminal className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-lg font-medium mb-2">Codex Demo</h3>
                <p className="text-sm text-muted-foreground max-w-sm mb-4">
                  Type <code className="bg-muted px-1.5 py-0.5 rounded">@codex</code>{" "}
                  followed by a task description to generate code changes.
                </p>
                <div className="text-xs text-muted-foreground/70 max-w-sm p-3 bg-muted rounded-lg">
                  <strong>Example:</strong>{" "}
                  <code>@codex add a health check endpoint to the API</code>
                </div>
              </div>
            ) : (
              // Messages list
              <div className="p-4 space-y-4">
                {messages.map((message) => {
                  if (message.type === "task" && message.taskId) {
                    const task = tasks[message.taskId]
                    if (!task) return null
                    return (
                      <TaskCard
                        key={`${message.id}-${message.taskId}`}
                        task={task}
                        workspace={workspace || undefined}
                        onApplyChanges={() => applyTaskChanges(task.id)}
                        onCreatePR={() => createTaskPR(task.id)}
                        onRefresh={async () => { await refreshTask(task.id) }}
                      />
                    )
                  }

                  return (
                    <MessageBubble key={message.id} message={message} />
                  )
                })}
                {isLoading && (
                  <div className="flex items-start gap-3">
                    <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          Processing...
                        </span>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="flex items-end gap-2 p-4 border-t border-border bg-card/50">
            <Textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message or @codex to run a task..."
              disabled={isLoading}
              rows={1}
              className="min-h-[44px] max-h-[200px] resize-none bg-background"
            />
            <Button
              onClick={handleSend}
              disabled={isLoading || !inputValue.trim()}
              size="icon"
              className="h-[44px] w-[44px] shrink-0"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Workspace panel */}
        {showWorkspace && workspace && (
          <div className="w-80 border-l border-border flex flex-col">
            <div className="p-4 border-b border-border">
              <div className="flex items-center gap-2 font-medium">
                <FolderOpen className="h-4 w-4" />
                Workspace Files
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Demo project files
              </p>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-1">
                {Object.keys(workspace.files)
                  .sort()
                  .map((path) => (
                    <WorkspaceFileItem
                      key={path}
                      path={path}
                      content={workspace.files[path]}
                    />
                  ))}
              </div>
            </ScrollArea>
          </div>
        )}
        </div>
      </div>
    </TooltipProvider>
  )
}

/**
 * Message bubble component
 */
function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.type === "user"

  return (
    <div
      className={cn(
        "flex flex-col w-full",
        isUser ? "items-end" : "items-start"
      )}
    >
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
          <MarkdownContent content={message.text ?? ""} />
        )}
      </div>
    </div>
  )
}

/**
 * Workspace file item component
 */
function WorkspaceFileItem({
  path,
  content,
}: {
  path: string
  content: string
}) {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
      >
        <FileCode className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs font-mono flex-1 truncate">{path}</span>
      </button>
      {isExpanded && (
        <ScrollArea className="max-h-[200px]">
          <pre className="p-2 text-[10px] font-mono bg-muted/30 whitespace-pre-wrap">
            {content}
          </pre>
        </ScrollArea>
      )}
    </div>
  )
}

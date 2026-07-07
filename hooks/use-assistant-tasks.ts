"use client"

import { useCallback, useState } from "react"
import type { Dispatch, MutableRefObject, SetStateAction } from "react"
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime"
import { toast } from "sonner"
import { createAssistantDemoThreads } from "@/lib/assistant/demo-seed"
import type {
  AssistantChatThreadInput,
  AssistantRunResponse,
  AssistantTaskResult,
} from "@/lib/assistant/types"
import { SessionChatCache } from "@/lib/session-cache"
import type { StoredChatThreadMeta } from "@/lib/store/types"
import type { MainThreadState, RespondResponse, RespondWithRetryArgs } from "@/lib/types"
import {
  extractAssistantPrompt,
  generateId,
  type UnifiedMessage,
} from "@/lib/chat/unified"
import { updateStoredThread } from "@/hooks/use-thread-persistence"
import {
  createStoredThread,
  persistMessage,
} from "@/hooks/use-thread-persistence"
import { markThreadWoven } from "@/lib/onboarding/progress"

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

export function buildAssistantContextInput(task: AssistantTaskResult): string | null {
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

interface UseAssistantTasksArgs {
  router: AppRouterInstance
  state: MainThreadState
  setState: Dispatch<SetStateAction<MainThreadState>>
  threads: StoredChatThreadMeta[]
  storedThreadIdRef: MutableRefObject<string | null>
  selfSetChatIdRef: MutableRefObject<string | null>
  lastResponseIdRef: MutableRefObject<string | null>
  enqueueChain: <T>(operation: () => Promise<T>) => Promise<T>
  respondWithRetry: (args: RespondWithRetryArgs) => Promise<RespondResponse>
  fetchThreads: () => Promise<void>
}

export function useAssistantTasks({
  router,
  state,
  setState,
  threads,
  storedThreadIdRef,
  selfSetChatIdRef,
  lastResponseIdRef,
  enqueueChain,
  respondWithRetry,
  fetchThreads,
}: UseAssistantTasksArgs) {
  const [assistantTasks, setAssistantTasks] = useState<Record<string, AssistantTaskResult>>({})
  const [includedAssistantContextIds, setIncludedAssistantContextIds] = useState<Set<string>>(
    () => new Set()
  )

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
    [state.messages, storedThreadIdRef, threads]
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
      if (data.task.status === "ready" || data.task.status === "no_results") {
        markThreadWoven("assistant")
      }
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

  const handleIncludeAssistantContext = useCallback(async (task: AssistantTaskResult) => {
    if (includedAssistantContextIds.has(task.id)) return

    const contextInput = buildAssistantContextInput(task)
    if (!contextInput) {
      toast.error("Assistant output is not ready to include yet")
      return
    }

    try {
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

      toast.success("Assistant output added to chat context")
    } catch (error) {
      console.error("Failed to include Assistant context:", error)
      toast.error("Could not add Assistant output to chat context")
    }
  }, [
    enqueueChain,
    includedAssistantContextIds,
    lastResponseIdRef,
    respondWithRetry,
    setState,
    storedThreadIdRef,
  ])

  const handleCloseAssistantTask = useCallback((taskId: string) => {
    setState((prev) => ({
      ...prev,
      messages: prev.messages.filter(
        (message) => (message as UnifiedMessage).assistantTaskId !== taskId
      ),
    }))
    setAssistantTasks((prev) => {
      const { [taskId]: _removed, ...rest } = prev
      void _removed
      return rest
    })
    setIncludedAssistantContextIds((prev) => {
      if (!prev.has(taskId)) return prev
      const next = new Set(prev)
      next.delete(taskId)
      return next
    })
  }, [setState])

  const handleAssistantFollowUp = useCallback(async (text: string, parentTaskId: string) => {
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
  }, [assistantTasks, runAssistantTask])

  const handleAssistantCommand = useCallback(async (text: string) => {
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

    const nextMessages = [...(state.messages as UnifiedMessage[]), userMessage, taskMessage]
    setAssistantTasks((prev) => ({
      ...prev,
      [assistantTaskId]: createPendingAssistantTask(assistantTaskId, prompt),
    }))
    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, userMessage, taskMessage],
    }))

    if (!storedThreadIdRef.current) {
      const id = await createStoredThread(`@assistant: ${prompt.slice(0, 30)}...`)
      if (id) {
        storedThreadIdRef.current = id
        selfSetChatIdRef.current = id
        router.replace(`/?chatId=${id}`, { scroll: false })
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
        [assistantTaskId]: createFailedAssistantTask(
          assistantTaskId,
          prompt,
          errorMessage
        ),
      }))
      toast.error(errorMessage)
    }
  }, [
    fetchThreads,
    router,
    runAssistantTask,
    selfSetChatIdRef,
    setState,
    state.messages,
    storedThreadIdRef,
  ])

  return {
    assistantTasks,
    setAssistantTasks,
    includedAssistantContextIds,
    setIncludedAssistantContextIds,
    createPendingAssistantTask,
    createFailedAssistantTask,
    runAssistantTask,
    buildAssistantLocalThreads,
    buildCurrentAssistantThread,
    handleLoadAssistantSampleWorkspace,
    handleIncludeAssistantContext,
    handleCloseAssistantTask,
    handleAssistantFollowUp,
    handleAssistantCommand,
  }
}

"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { Dispatch, MutableRefObject, SetStateAction } from "react"
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime"
import { toast } from "sonner"
import type { CodexTask, WorkspaceSnapshot } from "@/lib/codex/types"
import { extractCodexPrompt, generateId, type UnifiedMessage } from "@/lib/chat/unified"
import type { MainThreadState, RespondResponse } from "@/lib/types"
import {
  createStoredThread,
  persistMessage,
  updateStoredThread,
} from "@/hooks/use-thread-persistence"

export function buildTaskContextInput(task: CodexTask): string | null {
  const summary = task.contextSummary
  if (!summary) return null

  const lines: string[] = [
    `I just completed the coding task "${summary.title}". Here is exactly what I did:`,
    "",
  ]

  if (task.planMarkdown) {
    lines.push("## Implementation Plan")
    lines.push(task.planMarkdown)
    lines.push("")
  }

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

interface UseCodexTasksArgs {
  router: AppRouterInstance
  tasks: Record<string, CodexTask>
  setTasks: Dispatch<SetStateAction<Record<string, CodexTask>>>
  setState: Dispatch<SetStateAction<MainThreadState>>
  storedThreadIdRef: MutableRefObject<string | null>
  selfSetChatIdRef: MutableRefObject<string | null>
  lastResponseIdRef: MutableRefObject<string | null>
  enqueueChain: <T>(operation: () => Promise<T>) => Promise<T>
  respondWithRetry: (args: {
    input: string
    mode: "fast" | "deep"
    source: "ingestion" | "user"
  }) => Promise<RespondResponse>
  fetchThreads: () => Promise<void>
  setIsLoading: Dispatch<SetStateAction<boolean>>
}

export function useCodexTasks({
  router,
  tasks,
  setTasks,
  setState,
  storedThreadIdRef,
  selfSetChatIdRef,
  lastResponseIdRef,
  enqueueChain,
  respondWithRetry,
  fetchThreads,
  setIsLoading,
}: UseCodexTasksArgs) {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null)
  const ingestedTaskIdsRef = useRef<Set<string>>(new Set())
  const isIngestingRef = useRef(false)

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
  }, [setTasks])

  const ingestTaskContext = useCallback(
    (task: CodexTask) => {
      const contextInput = buildTaskContextInput(task)
      if (!contextInput) return Promise.resolve()

      return enqueueChain(async () => {
        try {
          const responseData = await respondWithRetry({
            input: contextInput,
            mode: "deep",
            source: "ingestion",
          })

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
    [enqueueChain, lastResponseIdRef, respondWithRetry, setState, storedThreadIdRef]
  )

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

  const refreshTask = useCallback(async (taskId: string): Promise<CodexTask | null> => {
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
  }, [setTasks])

  const applyTaskChanges = useCallback(async (taskId: string) => {
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
  }, [setTasks])

  const createTaskPR = useCallback(async (taskId: string) => {
    const res = await fetch(`/api/codex/tasks/${taskId}/pr`, {
      method: "POST",
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || "Failed to create PR")
    }
    const data = await res.json()
    setTasks((prev) => ({ ...prev, [taskId]: data.task }))
  }, [setTasks])

  const handleCodexCommand = useCallback(async (text: string) => {
    const prompt = extractCodexPrompt(text)

    const userMessage: UnifiedMessage = {
      localId: generateId(),
      role: "user",
      text,
      createdAt: Date.now(),
    }

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

    const taskMessage: UnifiedMessage = {
      localId: generateId(),
      role: "assistant",
      text: "",
      createdAt: Date.now(),
      taskId: placeholderId,
      isTaskCard: true,
    }

    setTasks((prev) => ({ ...prev, [placeholderId]: placeholderTask }))
    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, userMessage, taskMessage],
    }))
    setIsLoading(true)

    if (!storedThreadIdRef.current) {
      const id = await createStoredThread(`@codex: ${prompt.slice(0, 30)}...`)
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

      setTasks((prev) => {
        const { [placeholderId]: _removed, ...rest } = prev
        void _removed
        return { ...rest, [task.id]: task }
      })

      setState((prev) => ({
        ...prev,
        messages: prev.messages.map((msg) => {
          const unifiedMsg = msg as UnifiedMessage
          return unifiedMsg.taskId === placeholderId
            ? { ...unifiedMsg, taskId: task.id }
            : msg
        }),
      }))

      if (storedThreadIdRef.current) {
        await persistMessage(storedThreadIdRef.current, {
          id: taskMessage.localId,
          role: taskMessage.role,
          text: taskMessage.text,
          createdAt: taskMessage.createdAt,
          taskId: task.id,
          isTaskCard: true,
        })
      }

      let taskForIngestion: CodexTask = task

      if (task.status === "running" || task.status === "queued") {
        const refreshedTask = await refreshTask(task.id)
        if (refreshedTask) {
          taskForIngestion = refreshedTask
        }
      }

      if (
        taskForIngestion.contextSummary &&
        !ingestedTaskIdsRef.current.has(taskForIngestion.id)
      ) {
        ingestedTaskIdsRef.current.add(taskForIngestion.id)
        await ingestTaskContext(taskForIngestion)

        if (storedThreadIdRef.current && taskForIngestion.title) {
          updateStoredThread(storedThreadIdRef.current, {
            title: `@codex: ${taskForIngestion.title}`,
          })
          fetchThreads()
        }
      }

      setIsLoading(false)
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Something went wrong"
      toast.error(errorMessage)
      setIsLoading(false)
    }
  }, [
    fetchThreads,
    ingestTaskContext,
    refreshTask,
    router,
    selfSetChatIdRef,
    setIsLoading,
    setState,
    setTasks,
    storedThreadIdRef,
  ])

  return {
    tasks,
    setTasks,
    workspace,
    setWorkspace,
    ingestedTaskIdsRef,
    ingestTaskContext,
    refreshTask,
    applyTaskChanges,
    createTaskPR,
    handleCodexCommand,
  }
}

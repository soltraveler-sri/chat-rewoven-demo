"use client"

import { useCallback, useEffect, useState } from "react"
import type { Dispatch, MutableRefObject, SetStateAction } from "react"
import type { FinderOption } from "@/components/history"
import type { CodexTask } from "@/lib/codex/types"
import { SessionChatCache } from "@/lib/session-cache"
import type { StoredChatThread, StoredChatThreadMeta } from "@/lib/store/types"
import type { MainThreadState } from "@/lib/types"
import { generateId, type UnifiedMessage } from "@/lib/chat/unified"

type TTSStreamConfig = { text: string; autoStart?: boolean }

export async function createStoredThread(title?: string): Promise<string | null> {
  try {
    const res = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title || "New Chat", category: "recent" }),
    })
    if (!res.ok) {
      console.error("[Persist] createStoredThread failed:", res.status)
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
    if (data.thread) {
      SessionChatCache.saveThread(data.thread)
    }
    return threadId
  } catch (err) {
    console.error("[Persist] createStoredThread error:", err)
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

export async function persistMessage(
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
    audioMeta?: { filename: string; docText?: string }
  }
): Promise<boolean> {
  SessionChatCache.appendMessage(threadId, {
    id: message.id,
    role: message.role as "user" | "assistant" | "context",
    text: message.text,
    createdAt: message.createdAt,
    responseId: message.responseId,
    ...(message.taskId ? { taskId: message.taskId } : {}),
    ...(message.isTaskCard ? { isTaskCard: message.isTaskCard } : {}),
    ...(message.contextMeta ? { contextMeta: message.contextMeta } : {}),
    ...(message.audioMeta ? { audioMeta: message.audioMeta } : {}),
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

export async function updateStoredThread(
  threadId: string,
  updates: { title?: string; summary?: string; lastResponseId?: string | null }
): Promise<boolean> {
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

interface UseThreadPersistenceArgs {
  urlChatId: string | null
  setState: Dispatch<SetStateAction<MainThreadState>>
  lastResponseIdRef: MutableRefObject<string | null>
  storedThreadIdRef: MutableRefObject<string | null>
  selfSetChatIdRef: MutableRefObject<string | null>
  setTasks: Dispatch<SetStateAction<Record<string, CodexTask>>>
  setFinderOptions: Dispatch<SetStateAction<FinderOption[]>>
  ttsStreamConfigRef: MutableRefObject<Map<string, TTSStreamConfig>>
}

export function useThreadPersistence({
  urlChatId,
  setState,
  lastResponseIdRef,
  storedThreadIdRef,
  selfSetChatIdRef,
  setTasks,
  setFinderOptions,
  ttsStreamConfigRef,
}: UseThreadPersistenceArgs) {
  const [threads, setThreads] = useState<StoredChatThreadMeta[]>([])
  const [isLoadingThreads, setIsLoadingThreads] = useState(true)

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
      }
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

  useEffect(() => {
    fetchThreads()
  }, [fetchThreads])

  useEffect(() => {
    async function loadChat() {
      if (!urlChatId) return

      if (selfSetChatIdRef.current === urlChatId) {
        selfSetChatIdRef.current = null
        return
      }

      let thread: StoredChatThread | null = null

      try {
        const res = await fetch(`/api/chats/${urlChatId}`)
        if (res.ok) {
          const data = await res.json()
          thread = data.thread as StoredChatThread
        }
      } catch {
      }

      if (!thread) {
        const cached = SessionChatCache.getThread(urlChatId)
        if (cached) {
          thread = cached
          SessionChatCache.trackEvent("threadCacheFallbacks")
        }
      }

      if (!thread) {
        return
      }

      ttsStreamConfigRef.current.clear()
      const loadedMessages: UnifiedMessage[] = thread.messages.map((m) => {
        if (m.audioMeta?.docText) {
          ttsStreamConfigRef.current.set(m.id, {
            text: m.audioMeta.docText,
            autoStart: false,
          })
        }

        return {
          localId: m.id,
          role: m.role as "user" | "assistant" | "context",
          text: m.text,
          createdAt: m.createdAt,
          responseId: m.responseId,
          ...(m.taskId ? { taskId: m.taskId } : {}),
          ...(m.isTaskCard ? { isTaskCard: m.isTaskCard } : {}),
          ...(m.contextMeta ? { contextMeta: m.contextMeta } : {}),
          ...(m.audioMeta ? { audioMeta: m.audioMeta } : {}),
        }
      })

      const taskCardMessages = loadedMessages.filter((m) => m.isTaskCard && m.taskId)
      for (const msg of taskCardMessages) {
        if (msg.taskId && !msg.taskId.startsWith("placeholder_")) {
          try {
            const taskRes = await fetch(`/api/codex/tasks/${msg.taskId}`)
            if (taskRes.ok) {
              const taskData = await taskRes.json()
              setTasks((prev) => ({ ...prev, [msg.taskId!]: taskData.task }))
            }
          } catch {
          }
        }
      }

      setState({
        messages: loadedMessages,
        lastResponseId: thread.lastResponseId || null,
      })
      lastResponseIdRef.current = thread.lastResponseId || null

      storedThreadIdRef.current = thread.id

      setFinderOptions([])
    }

    loadChat()
  }, [
    urlChatId,
    lastResponseIdRef,
    selfSetChatIdRef,
    setFinderOptions,
    setState,
    setTasks,
    storedThreadIdRef,
    ttsStreamConfigRef,
  ])

  return {
    storedThreadIdRef,
    selfSetChatIdRef,
    threads,
    isLoadingThreads,
    fetchThreads,
  }
}

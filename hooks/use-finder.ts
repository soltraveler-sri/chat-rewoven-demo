"use client"

import { useCallback, useRef, useState } from "react"
import type { MutableRefObject } from "react"
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime"
import { toast } from "sonner"
import type { FinderOption } from "@/components/history"
import { SessionChatCache } from "@/lib/session-cache"
import type { MainThreadState } from "@/lib/types"
import type { FindResponse } from "@/lib/chat/unified"
import { updateStoredThread } from "@/hooks/use-thread-persistence"
import { markThreadWoven } from "@/lib/onboarding/progress"

interface UseFinderArgs {
  router: AppRouterInstance
  state: MainThreadState
  storedThreadIdRef: MutableRefObject<string | null>
  lastResponseIdRef: MutableRefObject<string | null>
}

export function useFinder({
  router,
  state,
  storedThreadIdRef,
  lastResponseIdRef,
}: UseFinderArgs) {
  const [finderPending, setFinderPending] = useState(false)
  const [finderOptions, setFinderOptions] = useState<FinderOption[]>([])
  const [openingChatId, setOpeningChatId] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const handleFindChat = useCallback(async (query: string) => {
    setFinderPending(true)
    const currentRequestId = ++requestIdRef.current

    try {
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

      if (options.length > 0) {
        markThreadWoven("find")
      }

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
  }, [])

  const handleOpenFoundChat = useCallback(async (chatId: string) => {
    setOpeningChatId(chatId)

    try {
      if (state.messages.length > 0 && storedThreadIdRef.current) {
        updateStoredThread(storedThreadIdRef.current, {
          lastResponseId: lastResponseIdRef.current,
        })
      }

      router.push(`/?chatId=${chatId}`)
      markThreadWoven("find")
    } catch (error) {
      console.error("Failed to navigate to chat:", error)
      toast.error("Failed to open chat")
    } finally {
      setOpeningChatId(null)
    }
  }, [lastResponseIdRef, router, state.messages.length, storedThreadIdRef])

  return {
    finderPending,
    finderOptions,
    openingChatId,
    setFinderOptions,
    handleFindChat,
    handleOpenFoundChat,
  }
}

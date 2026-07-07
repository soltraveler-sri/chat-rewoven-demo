"use client"

import { useCallback, useRef } from "react"
import type { Dispatch, MutableRefObject, SetStateAction } from "react"
import { toast } from "sonner"
import type { MainThreadState, RespondResponse } from "@/lib/types"
import { updateStoredThread } from "@/hooks/use-thread-persistence"

interface UseChainControllerArgs {
  setState: Dispatch<SetStateAction<MainThreadState>>
  storedThreadIdRef: MutableRefObject<string | null>
}

export function useChainController({ setState, storedThreadIdRef }: UseChainControllerArgs) {
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
  }, [setState, storedThreadIdRef])

  const resetChainQueue = useCallback(() => {
    chainQueueRef.current = Promise.resolve()
  }, [])

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
          resetChain()
          if (!didRetry) {
            const retryResult = await attempt(null, true)
            toast.info("Chain reset; continuing")
            return retryResult
          }
          toast.error("Chain reset; please retry")
          throw new Error("CHAIN_RESET_RETRY_FAILED")
        }

        throw new Error(payload.error || payload.message || "Failed to get response")
      }

      return attempt(lastResponseIdRef.current, false)
    },
    [isChainBrokenResponse, logRespondCall, resetChain]
  )

  return {
    enqueueChain,
    respondWithRetry,
    resetChain,
    resetChainQueue,
    lastResponseIdRef,
  }
}


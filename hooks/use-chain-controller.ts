"use client"

import { useCallback, useRef } from "react"
import type { Dispatch, MutableRefObject, SetStateAction } from "react"
import { toast } from "sonner"
import type {
  MainThreadState,
  RespondResponse,
  RespondWithRetryArgs,
} from "@/lib/types"
import { updateStoredThread } from "@/hooks/use-thread-persistence"

interface UseChainControllerArgs {
  setState: Dispatch<SetStateAction<MainThreadState>>
  storedThreadIdRef: MutableRefObject<string | null>
}

type RespondErrorPayload = {
  code?: string
  message?: string
  error?: string
}

type RespondStreamFrame =
  | { type: "delta"; text: string }
  | { type: "done"; id: string; output_text: string }
  | ({ type: "error" } & RespondErrorPayload)

function findSSEFrameBoundary(buffer: string): { index: number; length: number } | null {
  const boundaries = ["\r\n\r\n", "\n\n", "\r\r"]
    .map((marker) => ({ index: buffer.indexOf(marker), length: marker.length }))
    .filter((boundary) => boundary.index !== -1)
    .sort((a, b) => a.index - b.index)

  return boundaries[0] ?? null
}

function parseSSEFrame(frame: string): RespondStreamFrame | null {
  const dataLines: string[] = []

  for (const line of frame.split(/\r\n|\n|\r/)) {
    if (line === "" || line.startsWith(":")) continue
    if (!line.startsWith("data:")) continue

    const value = line.startsWith("data: ")
      ? line.slice("data: ".length)
      : line.slice("data:".length)
    dataLines.push(value)
  }

  if (dataLines.length === 0) return null

  return JSON.parse(dataLines.join("\n")) as RespondStreamFrame
}

function isRespondErrorPayload(
  payload: RespondResponse | RespondErrorPayload
): payload is RespondErrorPayload {
  return "code" in payload || "message" in payload || "error" in payload
}

async function readJSONPayload(res: Response): Promise<RespondResponse | RespondErrorPayload> {
  try {
    return (await res.json()) as RespondResponse | RespondErrorPayload
  } catch {
    return {}
  }
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
      if (payload?.code === "chain_broken") return true
      const message = `${payload?.message ?? ""} ${payload?.error ?? ""}`.toLowerCase()
      return status === 409 && message.includes("previous_response_not_found")
    },
    []
  )

  const respondWithRetry = useCallback(
    async ({
      input,
      mode,
      source,
      onDelta,
    }: RespondWithRetryArgs): Promise<RespondResponse> => {
      const attempt = async (
        previousResponseId: string | null,
        didRetry: boolean
      ): Promise<RespondResponse> => {
        const body: {
          input: string
          mode: "fast" | "deep"
          previous_response_id?: string | null
          stream?: boolean
        } = { input, mode }
        if (previousResponseId) {
          body.previous_response_id = previousResponseId
        }
        if (onDelta) {
          body.stream = true
        }

        const res = await fetch("/api/respond", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })

        let data: RespondResponse | RespondErrorPayload

        if (onDelta && res.ok) {
          const reader = res.body?.getReader()
          if (!reader) {
            throw new Error("Streaming response body is unavailable")
          }

          const decoder = new TextDecoder()
          let buffer = ""
          let doneFrame: RespondResponse | null = null
          let errorFrame: RespondErrorPayload | null = null

          const handleFrame = (frame: RespondStreamFrame | null) => {
            if (!frame) return
            if (frame.type === "delta") {
              onDelta(frame.text)
              return
            }
            if (frame.type === "done") {
              doneFrame = {
                id: frame.id,
                output_text: frame.output_text,
              }
              return
            }
            errorFrame = {
              code: frame.code,
              message: frame.message,
              error: frame.error,
            }
          }

          try {
            while (true) {
              const { value, done } = await reader.read()
              if (done) break

              buffer += decoder.decode(value, { stream: true })

              let boundary = findSSEFrameBoundary(buffer)
              while (boundary) {
                const rawFrame = buffer.slice(0, boundary.index)
                buffer = buffer.slice(boundary.index + boundary.length)
                handleFrame(parseSSEFrame(rawFrame))
                boundary = findSSEFrameBoundary(buffer)
              }
            }

            buffer += decoder.decode()
            if (buffer.trim()) {
              handleFrame(parseSSEFrame(buffer))
            }
          } finally {
            reader.releaseLock()
          }

          data = errorFrame ?? doneFrame ?? {
            error: "Streaming response ended before completion",
          }
        } else {
          data = await readJSONPayload(res)
        }

        logRespondCall({
          source,
          previousResponseId,
          newResponseId: res.ok ? (data as RespondResponse).id : null,
          status: res.status,
          didRetry,
        })

        if (res.ok) {
          const payload = data as RespondResponse | RespondErrorPayload
          if (onDelta && isRespondErrorPayload(payload)) {
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
            throw new Error(
              payload.error ||
              payload.message ||
              "Failed to get response"
            )
          }
          return data as RespondResponse
        }

        const payload = data as RespondErrorPayload
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

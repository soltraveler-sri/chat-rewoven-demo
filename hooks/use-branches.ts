"use client"

import { useCallback, useMemo } from "react"
import type { Dispatch, MutableRefObject, SetStateAction } from "react"
import { toast } from "sonner"
import type { BranchCloseResult } from "@/components/chat"
import { generateId, type UnifiedMessage } from "@/lib/chat/unified"
import type { BranchThread, MainThreadState, RespondResponse, SummarizeResponse } from "@/lib/types"
import {
  persistMessage,
  updateStoredThread,
} from "@/hooks/use-thread-persistence"

export const SKIP_SUMMARIZATION_THRESHOLD = 10

export function formatAsQuickSummary(messages: BranchThread["messages"]): string {
  const lines: string[] = []
  for (const m of messages) {
    const prefix = m.role === "user" ? "User asked:" : "Assistant:"
    const text = m.text.length > 150 ? m.text.slice(0, 147) + "..." : m.text
    lines.push(`• ${prefix} ${text}`)
  }
  return lines.join("\n")
}

interface UseBranchesArgs {
  state: MainThreadState
  setState: Dispatch<SetStateAction<MainThreadState>>
  branchesByParentLocalId: Record<string, BranchThread[]>
  setBranchesByParentLocalId: Dispatch<SetStateAction<Record<string, BranchThread[]>>>
  activeBranchId: string | null
  setActiveBranchId: Dispatch<SetStateAction<string | null>>
  setIsMerging: Dispatch<SetStateAction<boolean>>
  shouldAutoScroll: MutableRefObject<boolean>
  storedThreadIdRef: MutableRefObject<string | null>
  lastResponseIdRef: MutableRefObject<string | null>
  enqueueChain: <T>(operation: () => Promise<T>) => Promise<T>
  respondWithRetry: (args: {
    input: string
    mode: "fast" | "deep"
    source: "ingestion" | "user"
  }) => Promise<RespondResponse>
}

export function useBranches({
  state,
  setState,
  branchesByParentLocalId,
  setBranchesByParentLocalId,
  activeBranchId,
  setActiveBranchId,
  setIsMerging,
  shouldAutoScroll,
  storedThreadIdRef,
  lastResponseIdRef,
  enqueueChain,
  respondWithRetry,
}: UseBranchesArgs) {
  const activeBranch = useMemo(() => {
    if (!activeBranchId) return null
    for (const branches of Object.values(branchesByParentLocalId)) {
      const branch = branches.find((b) => b.id === activeBranchId)
      if (branch) return branch
    }
    return null
  }, [activeBranchId, branchesByParentLocalId])

  const parentMessageText = useMemo(() => {
    if (!activeBranch) return ""
    const parentMessage = state.messages.find(
      (m) => m.localId === activeBranch.parentAssistantLocalId
    )
    return parentMessage?.text || ""
  }, [activeBranch, state.messages])

  const performMerge = useCallback(async (
    branch: BranchThread,
    mergeMode: "summary" | "full"
  ): Promise<{ contextText: string; newResponseId: string } | null> => {
    try {
      let contextInput: string
      let displayText: string

      if (mergeMode === "summary") {
        if (branch.messages.length <= SKIP_SUMMARIZATION_THRESHOLD) {
          const quickSummary = formatAsQuickSummary(branch.messages)
          contextInput = `Context from branch "${branch.title}":\n${quickSummary}`
          displayText = quickSummary
        } else {
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

      const responseData = await enqueueChain(async () => {
        return respondWithRetry({
          input: contextInput,
          mode: "deep",
          source: "ingestion",
        })
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

      return {
        contextText: displayText,
        newResponseId: responseData.id,
      }
    } catch (error) {
      console.error("Merge error:", error)
      throw error
    }
  }, [enqueueChain, lastResponseIdRef, respondWithRetry, setState, storedThreadIdRef])

  const handleBranch = useCallback((localId: string, responseId: string) => {
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
  }, [branchesByParentLocalId, setActiveBranchId, setBranchesByParentLocalId])

  const handleOpenBranch = useCallback((branchId: string) => {
    setActiveBranchId(branchId)
  }, [setActiveBranchId])

  const handleCloseBranch = useCallback(async (result?: BranchCloseResult) => {
    if (!result) {
      setActiveBranchId(null)
      return
    }

    const { branch, shouldMerge, mergeMode } = result

    if (!shouldMerge) {
      setActiveBranchId(null)
      return
    }

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

        setState((prev) => ({
          ...prev,
          messages: [...prev.messages, contextMessage],
        }))

        if (storedThreadIdRef.current) {
          await persistMessage(storedThreadIdRef.current, {
            id: contextMessage.localId,
            role: contextMessage.role,
            text: contextMessage.text,
            createdAt: contextMessage.createdAt,
            contextMeta: contextMessage.contextMeta,
          })
        }

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
  }, [
    performMerge,
    setActiveBranchId,
    setBranchesByParentLocalId,
    setIsMerging,
    setState,
    shouldAutoScroll,
    storedThreadIdRef,
  ])

  const handleUpdateBranch = useCallback((updatedBranch: BranchThread) => {
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
  }, [setBranchesByParentLocalId])

  return {
    activeBranch,
    parentMessageText,
    handleBranch,
    handleOpenBranch,
    handleCloseBranch,
    handleUpdateBranch,
    performMerge,
  }
}


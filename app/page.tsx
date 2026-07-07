"use client"

import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Loader2,
  Paperclip,
  Search,
  Send,
  Zap,
} from "lucide-react"
import { toast } from "sonner"
import { AssistantLauncher, AssistantTaskCard } from "@/components/assistant"
import {
  BranchNudge,
  BranchOverlay,
  ChatMessageBubble,
  FileAttachmentChip,
  LooseThreadsRail,
  TypingIndicator,
} from "@/components/chat"
import {
  MergingOverlay,
  UnifiedEmptyState,
  UnifiedSidebar,
} from "@/components/chat/unified-demo-panels"
import { TaskCard } from "@/components/codex"
import { FinderOptionCard, type FinderOption } from "@/components/history"
import { Button } from "@/components/ui/button"
import { StorageWarningBanner } from "@/components/ui/storage-warning-banner"
import { Textarea } from "@/components/ui/textarea"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAssistantTasks } from "@/hooks/use-assistant-tasks"
import { useBranches } from "@/hooks/use-branches"
import { useChainController } from "@/hooks/use-chain-controller"
import { useCodexTasks } from "@/hooks/use-codex-tasks"
import { useDocRead } from "@/hooks/use-doc-read"
import { useFinder } from "@/hooks/use-finder"
import {
  createStoredThread,
  persistMessage,
  updateStoredThread,
  useThreadPersistence,
} from "@/hooks/use-thread-persistence"
import type { CodexTask } from "@/lib/codex/types"
import { seedLooseThreadsIfNeeded } from "@/lib/onboarding/seeds"
import type { StoredChatThreadMeta } from "@/lib/store/types"
import {
  extractFindQuery,
  generateId,
  isAssistantCommand,
  isCodexCommand,
  isFindCommand,
  type UnifiedMessage,
} from "@/lib/chat/unified"
import type { BranchThread, MainThreadState } from "@/lib/types"

const BRANCH_STARTER_PROMPT = "Plan a 3-day Kyoto trip focused on food"
const CODEX_STARTER_PROMPT = "@codex add a dark-mode toggle to the settings page"
const ASSISTANT_STARTER_PROMPT = "@assistant what did I leave unfinished this week?"
const FIND_STARTER_PROMPT = "/find the chat about the telescope"
const FIND_PREREQ_NOTICE =
  "You'll need a few chats in history first — have a couple of conversations, then try /find."
const BRANCH_NUDGE_STORAGE_KEY = "cr:nudge:branch"
const SAMPLE_DOCUMENT_PATH = "/samples/a-short-history-of-weaving.pdf"

function UnifiedDemoContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlChatId = searchParams.get("chatId")

  const [state, setState] = useState<MainThreadState>({
    messages: [],
    lastResponseId: null,
  })
  const [inputValue, setInputValue] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [isMerging, setIsMerging] = useState(false)
  const [branchesByParentLocalId, setBranchesByParentLocalId] = useState<
    Record<string, BranchThread[]>
  >({})
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null)
  const [tasks, setTasks] = useState<Record<string, CodexTask>>({})
  const [branchNudgeTargetLocalId, setBranchNudgeTargetLocalId] = useState<string | null>(null)
  const [branchNudgeDismissed, setBranchNudgeDismissed] = useState(false)
  const [prereqNotice, setPrereqNotice] = useState<string | null>(null)
  const [sampleDocPendingSubmit, setSampleDocPendingSubmit] = useState(false)

  const storedThreadIdRef = useRef<string | null>(null)
  const selfSetChatIdRef = useRef<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const ttsStreamConfigRef = useRef<Map<string, { text: string; autoStart?: boolean }>>(new Map())
  const shouldAutoScroll = useRef(true)
  const branchNudgeArmedRef = useRef(false)
  const prereqNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const submitTextRef = useRef<(text: string) => void | Promise<void>>(() => {})
  const seedAttemptedRef = useRef(false)

  const {
    enqueueChain,
    respondWithRetry,
    resetChainQueue,
    lastResponseIdRef,
  } = useChainController({ setState, storedThreadIdRef })

  const finder = useFinder({
    router,
    state,
    storedThreadIdRef,
    lastResponseIdRef,
  })

  const { threads, isLoadingThreads, fetchThreads } = useThreadPersistence({
    urlChatId,
    setState,
    lastResponseIdRef,
    storedThreadIdRef,
    selfSetChatIdRef,
    setTasks,
    setFinderOptions: finder.setFinderOptions,
    ttsStreamConfigRef,
  })

  const codex = useCodexTasks({
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
  })

  const assistant = useAssistantTasks({
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
  })

  const docRead = useDocRead({
    router,
    setState,
    setIsLoading,
    storedThreadIdRef,
    selfSetChatIdRef,
    lastResponseIdRef,
    enqueueChain,
    respondWithRetry,
    fetchThreads,
    ttsStreamConfigRef,
  })

  const branches = useBranches({
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
  })

  const messages = state.messages as UnifiedMessage[]
  const hasMessages = state.messages.length > 0
  const hasFinderResults = finder.finderOptions.length > 0

  useEffect(() => {
    if (typeof window === "undefined") return
    setBranchNudgeDismissed(
      window.localStorage.getItem(BRANCH_NUDGE_STORAGE_KEY) === "1"
    )
  }, [])

  useEffect(() => {
    if (isLoadingThreads || typeof window === "undefined") return
    if (window.localStorage.getItem("cr:seeded")) return
    if (seedAttemptedRef.current) return
    seedAttemptedRef.current = true

    let cancelled = false

    async function seedIfEmpty() {
      try {
        const response = await fetch("/api/chats")
        if (!response.ok) return
        const data = (await response.json()) as { threads?: unknown[] }
        const serverThreads = Array.isArray(data.threads) ? data.threads : []
        const seeded = await seedLooseThreadsIfNeeded(
          serverThreads as StoredChatThreadMeta[]
        )
        if (seeded && !cancelled) {
          await fetchThreads()
        }
      } catch (error) {
        console.error("[Onboarding] Starter chat seeding failed:", error)
      }
    }

    seedIfEmpty()

    return () => {
      cancelled = true
    }
  }, [fetchThreads, isLoadingThreads])

  useEffect(() => {
    if (!prereqNotice) return
    if (prereqNoticeTimerRef.current) {
      clearTimeout(prereqNoticeTimerRef.current)
    }
    prereqNoticeTimerRef.current = setTimeout(() => {
      setPrereqNotice(null)
      prereqNoticeTimerRef.current = null
    }, 6000)

    return () => {
      if (prereqNoticeTimerRef.current) {
        clearTimeout(prereqNoticeTimerRef.current)
        prereqNoticeTimerRef.current = null
      }
    }
  }, [prereqNotice])

  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const { scrollTop, scrollHeight, clientHeight } = container
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight
    shouldAutoScroll.current = distanceFromBottom < 100
  }, [])

  useEffect(() => {
    if (shouldAutoScroll.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [state.messages, isLoading, finder.finderOptions])

  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = "auto"
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
    }
  }, [inputValue])

  const handleRegularChat = async (userText: string) => {
    const actualInput = userText
    const userMessage: UnifiedMessage = {
      localId: generateId(),
      role: "user",
      text: userText,
      createdAt: Date.now(),
    }

    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, userMessage],
    }))
    setIsLoading(true)

    if (!storedThreadIdRef.current) {
      const threadTitle = userText.length > 50 ? userText.slice(0, 50) + "..." : userText
      const id = await createStoredThread(threadTitle)
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

    let pendingAssistantLocalId: string | null = null

    try {
      await enqueueChain(async () => {
        const assistantLocalId = generateId()
        pendingAssistantLocalId = assistantLocalId
        let assistantCreatedAt = Date.now()
        let assistantMessageCreated = false
        let streamedText = ""

        const responseData = await respondWithRetry({
          input: actualInput,
          mode: "deep",
          source: "user",
          onDelta: (text) => {
            if (!text) return
            streamedText += text
            setIsLoading(false)

            if (!assistantMessageCreated) {
              assistantMessageCreated = true
              assistantCreatedAt = Date.now()
              setState((prev) => ({
                ...prev,
                messages: [
                  ...prev.messages,
                  {
                    localId: assistantLocalId,
                    role: "assistant",
                    text: streamedText,
                    createdAt: assistantCreatedAt,
                  },
                ],
              }))
              return
            }

            setState((prev) => ({
              ...prev,
              messages: prev.messages.map((message) =>
                message.localId === assistantLocalId
                  ? { ...message, text: streamedText }
                  : message
              ),
            }))
          },
        })

        const assistantMessage: UnifiedMessage = {
          localId: assistantLocalId,
          role: "assistant",
          text: responseData.output_text,
          createdAt: assistantCreatedAt,
          responseId: responseData.id,
        }

        if (branchNudgeArmedRef.current) {
          branchNudgeArmedRef.current = false
          if (
            typeof window !== "undefined" &&
            window.localStorage.getItem(BRANCH_NUDGE_STORAGE_KEY) !== "1"
          ) {
            setBranchNudgeTargetLocalId(assistantMessage.localId)
            setBranchNudgeDismissed(false)
          }
        }

        lastResponseIdRef.current = responseData.id
        setState((prev) => {
          const hasDraftMessage = prev.messages.some(
            (message) => message.localId === assistantLocalId
          )

          return {
            ...prev,
            messages: hasDraftMessage
              ? prev.messages.map((message) =>
                  message.localId === assistantLocalId
                    ? assistantMessage
                    : message
                )
              : [...prev.messages, assistantMessage],
            lastResponseId: responseData.id,
          }
        })

        setIsLoading(false)

        const threadId = storedThreadIdRef.current
        if (threadId) {
          await persistMessage(threadId, {
            id: assistantMessage.localId,
            role: assistantMessage.role,
            text: assistantMessage.text,
            createdAt: assistantMessage.createdAt,
            responseId: assistantMessage.responseId,
          })
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
              })
          }

          fetchThreads()
        }
      })
    } catch (error) {
      branchNudgeArmedRef.current = false
      if (error instanceof Error && error.message === "CHAIN_RESET_RETRY_FAILED") {
        return
      }
      const errorMessage =
        error instanceof Error ? error.message : "Something went wrong"
      toast.error(errorMessage)
      if (pendingAssistantLocalId) {
        setState((prev) => ({
          ...prev,
          messages: prev.messages.filter(
            (message) => message.localId !== pendingAssistantLocalId
          ),
        }))
      }
    } finally {
      setIsLoading(false)
    }
  }

  async function handleSubmitText(text: string) {
    const userText = text.trim()
    if (!userText || isLoading || isMerging || docRead.isGeneratingTTS) return

    setInputValue("")
    shouldAutoScroll.current = true
    finder.setFinderOptions([])

    if (docRead.attachedFile && docRead.extractedDocText) {
      await docRead.handleDocReadSend(userText)
      return
    }

    if (isFindCommand(userText)) {
      const query = extractFindQuery(userText)
      if (!query) {
        toast.error("Please provide a search query after /find")
        return
      }
      await finder.handleFindChat(query)
      return
    }

    if (isAssistantCommand(userText)) {
      await assistant.handleAssistantCommand(userText)
      return
    }

    if (isCodexCommand(userText)) {
      await codex.handleCodexCommand(userText)
      return
    }

    await handleRegularChat(userText)
  }

  submitTextRef.current = handleSubmitText

  const handleSend = async () => {
    await handleSubmitText(inputValue)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (inputValue.trim() && !isLoading && !isMerging) {
        handleSend()
      }
    }
  }

  const handleReset = useCallback(async () => {
    const prevThreadId = storedThreadIdRef.current
    if (prevThreadId) {
      await new Promise((r) => setTimeout(r, 100))
    }

    if (urlChatId) {
      router.push("/")
    }

    setState({
      messages: [],
      lastResponseId: null,
    })
    setBranchesByParentLocalId({})
    setActiveBranchId(null)
    setTasks({})
    assistant.setAssistantTasks({})
    finder.setFinderOptions([])
    setInputValue("")
    docRead.setAttachedFile(null)
    docRead.setExtractedDocText(null)
    docRead.setIsGeneratingTTS(false)
    docRead.ttsStreamConfigRef.current.clear()
    storedThreadIdRef.current = null
    codex.ingestedTaskIdsRef.current.clear()
    lastResponseIdRef.current = null
    resetChainQueue()

    await fetchThreads()
  }, [
    assistant,
    codex.ingestedTaskIdsRef,
    docRead,
    fetchThreads,
    finder,
    lastResponseIdRef,
    resetChainQueue,
    router,
    urlChatId,
  ])

  const handleSelectThread = (threadId: string) => {
    if (threadId === storedThreadIdRef.current) return
    router.push(`/?chatId=${threadId}`)
  }

  const handleOpenAssistantChat = (chatId: string) => {
    if (!chatId || chatId === "current-chat") return
    handleSelectThread(chatId)
  }

  const handleInsertAssistantPrompt = (prompt: string) => {
    setInputValue(prompt)
    toast.success("Prompt inserted")
  }

  const showPrereqNotice = useCallback(() => {
    setPrereqNotice(FIND_PREREQ_NOTICE)
  }, [])

  const dismissBranchNudge = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(BRANCH_NUDGE_STORAGE_KEY, "1")
    }
    setBranchNudgeDismissed(true)
    setBranchNudgeTargetLocalId(null)
  }, [])

  const handleBranchFromMessage = useCallback(
    (localId: string, responseId: string) => {
      dismissBranchNudge()
      branches.handleBranch(localId, responseId)
    },
    [branches, dismissBranchNudge]
  )

  const stagePromptSubmit = useCallback((prompt: string) => {
    setInputValue(prompt)
    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (textarea) {
        textarea.focus()
        const end = textarea.value.length
        textarea.setSelectionRange(end, end)
      }
      setTimeout(() => {
        submitTextRef.current(prompt)
      }, 0)
    })
  }, [])

  const stageBranchStarter = useCallback(() => {
    branchNudgeArmedRef.current = true
    stagePromptSubmit(BRANCH_STARTER_PROMPT)
  }, [stagePromptSubmit])

  const stageFindStarter = useCallback(() => {
    if (threads.length === 0) {
      showPrereqNotice()
      return
    }
    stagePromptSubmit(FIND_STARTER_PROMPT)
  }, [showPrereqNotice, stagePromptSubmit, threads.length])

  const stageAssistantStarter = useCallback(() => {
    if (threads.length === 0) {
      assistant.handleLoadAssistantSampleWorkspace()
    }
    stagePromptSubmit(ASSISTANT_STARTER_PROMPT)
  }, [assistant, stagePromptSubmit, threads.length])

  const stageSampleDocument = useCallback(async () => {
    try {
      const response = await fetch(SAMPLE_DOCUMENT_PATH)
      if (!response.ok) {
        throw new Error("Sample document could not be loaded")
      }
      const blob = await response.blob()
      const file = new File([blob], "a-short-history-of-weaving.pdf", {
        type: "application/pdf",
      })
      setSampleDocPendingSubmit(true)
      await docRead.handleFileSelect(file)
    } catch (error) {
      setSampleDocPendingSubmit(false)
      const message =
        error instanceof Error ? error.message : "Sample document could not be loaded"
      toast.error(message)
    }
  }, [docRead])

  const handleSelectExample = useCallback(
    (action: "branch" | "codex" | "assistant" | "find") => {
      if (action === "branch") {
        stageBranchStarter()
        return
      }
      if (action === "codex") {
        stagePromptSubmit(CODEX_STARTER_PROMPT)
        return
      }
      if (action === "assistant") {
        stageAssistantStarter()
        return
      }
      stageFindStarter()
    },
    [stageAssistantStarter, stageBranchStarter, stageFindStarter, stagePromptSubmit]
  )

  const handleRailStage = useCallback(
    (action: "branch" | "find" | "codex" | "doc" | "assistant") => {
      if (action === "branch") {
        const latestAssistantReply = [...messages]
          .reverse()
          .find((message) => message.role === "assistant" && message.responseId)
        if (
          latestAssistantReply &&
          typeof window !== "undefined" &&
          window.localStorage.getItem(BRANCH_NUDGE_STORAGE_KEY) !== "1"
        ) {
          setBranchNudgeTargetLocalId(latestAssistantReply.localId)
          setBranchNudgeDismissed(false)
          return
        }
        stageBranchStarter()
        return
      }
      if (action === "find") {
        stageFindStarter()
        return
      }
      if (action === "codex") {
        stagePromptSubmit(CODEX_STARTER_PROMPT)
        return
      }
      if (action === "doc") {
        stageSampleDocument()
        return
      }
      stageAssistantStarter()
    },
    [
      messages,
      stageAssistantStarter,
      stageBranchStarter,
      stageFindStarter,
      stagePromptSubmit,
      stageSampleDocument,
    ]
  )

  useEffect(() => {
    if (!sampleDocPendingSubmit) return
    if (!docRead.attachedFile || !docRead.extractedDocText || docRead.isUploadingDoc) {
      return
    }

    setSampleDocPendingSubmit(false)
    stagePromptSubmit("read this to me")
  }, [
    docRead.attachedFile,
    docRead.extractedDocText,
    docRead.isUploadingDoc,
    sampleDocPendingSubmit,
    stagePromptSubmit,
  ])

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full">
        <UnifiedSidebar
          threads={threads}
          isLoadingThreads={isLoadingThreads}
          activeThreadId={storedThreadIdRef.current}
          urlChatId={urlChatId}
          onReset={handleReset}
          onSelectThread={handleSelectThread}
        />

        <div className="flex-1 flex flex-col">
          <StorageWarningBanner className="m-2" />

          <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">Unified Chat</span>
            </div>
            <div className="flex items-center gap-2">
              <LooseThreadsRail
                onStage={handleRailStage}
                prereqNotice={prereqNotice}
                onDismissPrereqNotice={() => setPrereqNotice(null)}
              />
              <AssistantLauncher
                onRunTask={assistant.runAssistantTask}
                onLoadSampleWorkspace={assistant.handleLoadAssistantSampleWorkspace}
                onOpenChat={handleOpenAssistantChat}
                onInsertPrompt={handleInsertAssistantPrompt}
              />
            </div>
          </div>

          <div
            ref={messagesContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto"
          >
            {!hasMessages && !isLoading && !hasFinderResults && !finder.finderPending ? (
              <UnifiedEmptyState
                onSelectExample={handleSelectExample}
                onUseSampleDocument={stageSampleDocument}
                prereqNotice={prereqNotice}
                onDismissPrereqNotice={() => setPrereqNotice(null)}
              />
            ) : (
              <div className="mx-auto w-full max-w-3xl px-4 py-6 space-y-4">
                {messages.map((message) => {
                  if (message.isAssistantTaskCard && message.assistantTaskId) {
                    const task = assistant.assistantTasks[message.assistantTaskId]
                    if (!task) return null
                    return (
                      <AssistantTaskCard
                        key={`${message.localId}-${message.assistantTaskId}`}
                        task={task}
                        onFollowUp={assistant.handleAssistantFollowUp}
                        onClose={() => assistant.handleCloseAssistantTask(task.id)}
                        onOpenChat={handleOpenAssistantChat}
                        onInsertPrompt={handleInsertAssistantPrompt}
                        onIncludeInChatContext={assistant.handleIncludeAssistantContext}
                        isIncludedInChatContext={assistant.includedAssistantContextIds.has(task.id)}
                      />
                    )
                  }

                  if (message.isTaskCard && message.taskId) {
                    const task = tasks[message.taskId]
                    if (!task) return null
                    return (
                      <TaskCard
                        key={`${message.localId}-${message.taskId}`}
                        task={task}
                        workspace={codex.workspace || undefined}
                        onApplyChanges={() => codex.applyTaskChanges(task.id)}
                        onCreatePR={() => codex.createTaskPR(task.id)}
                        onRefresh={async () => { await codex.refreshTask(task.id) }}
                      />
                    )
                  }

                  return (
                    <div key={message.localId}>
                      <ChatMessageBubble
                        message={message}
                        onBranch={handleBranchFromMessage}
                        branches={branchesByParentLocalId[message.localId] || []}
                        onOpenBranch={branches.handleOpenBranch}
                        audioStreamConfig={docRead.ttsStreamConfigRef.current.get(message.localId)}
                        onAudioPlaybackStart={docRead.handleAudioPlaybackStart}
                      />
                      {!branchNudgeDismissed &&
                        branchNudgeTargetLocalId === message.localId && (
                          <BranchNudge onDismiss={dismissBranchNudge} />
                        )}
                    </div>
                  )
                })}

                {finder.finderPending && (
                  <div className="flex items-start">
                    <div className="bg-card border border-border/40 shadow-sm rounded-2xl rounded-bl-md px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Searching...</span>
                      </div>
                    </div>
                  </div>
                )}

                {!finder.finderPending && hasFinderResults && (
                  <div className="flex items-start">
                    <div className="max-w-[90%] space-y-3">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                        <Search className="h-4 w-4" />
                        <span>
                          Found {finder.finderOptions.length} matching{" "}
                          {finder.finderOptions.length === 1 ? "chat" : "chats"}
                        </span>
                      </div>
                      {finder.finderOptions.map((option: FinderOption) => (
                        <FinderOptionCard
                          key={option.chatId}
                          option={option}
                          onClick={() => finder.handleOpenFoundChat(option.chatId)}
                          isOpening={finder.openingChatId === option.chatId}
                          disabled={finder.openingChatId !== null}
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

          <div className="border-t border-border/40 bg-card/60">
            {docRead.attachedFile && (
              <div className="mx-auto w-full max-w-3xl px-4 pt-3 pb-0">
                <FileAttachmentChip
                  filename={docRead.attachedFile.name}
                  isProcessing={docRead.isUploadingDoc}
                  onRemove={docRead.handleRemoveAttachment}
                />
              </div>
            )}

            {docRead.isGeneratingTTS && (
              <div className="mx-auto w-full max-w-3xl px-4 pt-3 pb-0">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent-soft border-l-2 border-l-thread text-sm">
                  <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
                  <span className="text-xs text-primary font-medium">Generating audio...</span>
                </div>
              </div>
            )}

            <div className="mx-auto flex w-full max-w-3xl items-end gap-2 p-4">
              <input
                ref={docRead.fileInputRef}
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) docRead.handleFileSelect(file)
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-[44px] w-[44px] shrink-0"
                onClick={() => docRead.fileInputRef.current?.click()}
                disabled={isLoading || isMerging || docRead.isUploadingDoc || docRead.isGeneratingTTS}
              >
                <Paperclip className="h-4 w-4" />
              </Button>

              <Textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  docRead.attachedFile
                    ? "Ask about the doc, or say \"read this to me\"..."
                    : "Type a message, @assistant to use Assistant, @codex to run a task, or /find to search..."
                }
                disabled={isLoading || isMerging || docRead.isGeneratingTTS}
                rows={1}
                className="min-h-[44px] max-h-[200px] resize-none bg-background"
              />
              <Button
                onClick={handleSend}
                disabled={isLoading || isMerging || docRead.isGeneratingTTS || !inputValue.trim()}
                size="icon"
                className="h-[44px] w-[44px] shrink-0"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <BranchOverlay
          branch={branches.activeBranch}
          parentMessageText={branches.parentMessageText}
          isOpen={!!activeBranchId}
          onClose={branches.handleCloseBranch}
          onUpdateBranch={branches.handleUpdateBranch}
        />

        {isMerging && <MergingOverlay />}
      </div>
    </TooltipProvider>
  )
}

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

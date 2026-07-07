"use client"

import { useCallback, useRef, useState } from "react"
import type { Dispatch, MutableRefObject, SetStateAction } from "react"
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime"
import { toast } from "sonner"
import { generateId, type UnifiedMessage } from "@/lib/chat/unified"
import type {
  MainThreadState,
  RespondResponse,
  RespondWithRetryArgs,
} from "@/lib/types"
import {
  createStoredThread,
  persistMessage,
} from "@/hooks/use-thread-persistence"

interface UseDocReadArgs {
  router: AppRouterInstance
  setState: Dispatch<SetStateAction<MainThreadState>>
  setIsLoading: Dispatch<SetStateAction<boolean>>
  storedThreadIdRef: MutableRefObject<string | null>
  selfSetChatIdRef: MutableRefObject<string | null>
  lastResponseIdRef: MutableRefObject<string | null>
  enqueueChain: <T>(operation: () => Promise<T>) => Promise<T>
  respondWithRetry: (args: RespondWithRetryArgs) => Promise<RespondResponse>
  fetchThreads: () => Promise<void>
}

export function useDocRead({
  router,
  setState,
  setIsLoading,
  storedThreadIdRef,
  selfSetChatIdRef,
  lastResponseIdRef,
  enqueueChain,
  respondWithRetry,
  fetchThreads,
}: UseDocReadArgs) {
  const [attachedFile, setAttachedFile] = useState<File | null>(null)
  const [extractedDocText, setExtractedDocText] = useState<string | null>(null)
  const [isUploadingDoc, setIsUploadingDoc] = useState(false)
  const [isGeneratingTTS, setIsGeneratingTTS] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const ttsStreamConfigRef = useRef<Map<string, { text: string }>>(new Map())

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

  const handleDocReadSend = useCallback(async (userText: string) => {
    if (!attachedFile || !extractedDocText) return

    const filename = attachedFile.name

    setAttachedFile(null)
    setExtractedDocText(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }

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

    if (!storedThreadIdRef.current) {
      const threadTitle = `Doc: ${filename}`
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
      const lowerText = userText.toLowerCase()
      const READ_KEYWORDS = [
        "read", "aloud", "listen", "narrate", "audio", "tts",
        "play", "speak", "voice", "out loud", "read it", "read this",
        "read me", "hear",
      ]
      const hasReadKeyword = READ_KEYWORDS.some((kw) => lowerText.includes(kw))

      const DISCUSS_KEYWORDS = [
        "summarize", "summary", "explain", "analyze", "what does",
        "what are", "key points", "tell me about", "describe",
        "compare", "extract", "list the", "how does", "why does",
      ]
      const hasDiscussKeyword = DISCUSS_KEYWORDS.some((kw) => lowerText.includes(kw))

      let isReadAloud: boolean

      if (hasReadKeyword && !hasDiscussKeyword) {
        isReadAloud = true
        console.log(`[Doc:classify] Keyword match — skipping LLM classifier`)
      } else if (hasDiscussKeyword && !hasReadKeyword) {
        isReadAloud = false
      } else {
        const classifyRes = await fetch("/api/doc/classify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userMessage: userText, filename }),
        })
        const classifyData = await classifyRes.json()
        isReadAloud = classifyData.intent === "read_aloud" && classifyData.confidence >= 0.3
      }

      if (isReadAloud) {
        setIsLoading(false)

        const msgId = generateId()

        ttsStreamConfigRef.current.set(msgId, {
          text: extractedDocText,
        })

        const assistantMessage: UnifiedMessage = {
          localId: msgId,
          role: "assistant",
          text: `Here's the audio reading of "${filename}".`,
          createdAt: Date.now(),
          audioMeta: { filename },
        }

        setState((prev) => ({
          ...prev,
          messages: [...prev.messages, assistantMessage],
        }))

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
        await enqueueChain(async () => {
          const contextInput = `[Document: ${filename}]\n\n${extractedDocText.slice(0, 30000)}\n\n---\n\nUser question: ${userText}`
          const assistantLocalId = generateId()
          pendingAssistantLocalId = assistantLocalId
          let assistantCreatedAt = Date.now()
          let assistantMessageCreated = false
          let streamedText = ""

          const responseData = await respondWithRetry({
            input: contextInput,
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
      setIsGeneratingTTS(false)
    }
  }, [
    attachedFile,
    enqueueChain,
    extractedDocText,
    fetchThreads,
    lastResponseIdRef,
    respondWithRetry,
    router,
    selfSetChatIdRef,
    setIsLoading,
    setState,
    storedThreadIdRef,
  ])

  return {
    attachedFile,
    setAttachedFile,
    extractedDocText,
    setExtractedDocText,
    isUploadingDoc,
    isGeneratingTTS,
    setIsGeneratingTTS,
    fileInputRef,
    ttsStreamConfigRef,
    handleFileSelect,
    handleRemoveAttachment,
    handleDocReadSend,
  }
}

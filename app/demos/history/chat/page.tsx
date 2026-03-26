"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { RotateCcw, Loader2, Sparkles, ArrowLeft } from "lucide-react"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { TooltipProvider } from "@/components/ui/tooltip"
import { MarkdownContent } from "@/components/ui/markdown-content"
import { cn } from "@/lib/utils"
import { HistoryComposer, type AttachedChat } from "@/components/history"

/**
 * Simple message type for Demo 2 chat
 */
interface Demo2Message {
  id: string
  role: "user" | "assistant"
  text: string
  createdAt: number
  hasContext?: boolean // indicates context was attached
}

function generateId(): string {
  return crypto.randomUUID()
}

/**
 * Format a timestamp as a relative time string
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  if (seconds > 10) return `${seconds}s ago`
  return "just now"
}

/**
 * Fetch summary for a chat (generates if needed)
 */
async function fetchChatSummary(
  chatId: string
): Promise<{ title: string; category: string; summary: string } | null> {
  try {
    const res = await fetch(`/api/chats/${chatId}/summary`)
    if (!res.ok) return null
    const data = await res.json()
    return {
      title: data.title,
      category: data.category,
      summary: data.summary,
    }
  } catch {
    return null
  }
}

/**
 * Build context preamble from attached chats
 */
function buildContextPreamble(
  contexts: Array<{ title: string; category: string; summary: string }>
): string {
  if (contexts.length === 0) return ""

  const entries = contexts
    .map(
      (ctx, i) => `${i + 1}. "${ctx.title}" (${ctx.category}):
   ${ctx.summary}`
    )
    .join("\n\n")

  return `ATTACHED PAST CHAT CONTEXT (use only if relevant to the user's question):

${entries}

END ATTACHED CONTEXT.

`
}

export default function HistoryChatPage() {
  // State
  const [messages, setMessages] = useState<Demo2Message[]>([])
  const [inputValue, setInputValue] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [isFetchingContext, setIsFetchingContext] = useState(false)
  const [lastResponseId, setLastResponseId] = useState<string | null>(null)

  // Refs for autoscroll behavior
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const shouldAutoScroll = useRef(true)

  // Track if user has scrolled away from bottom
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const { scrollTop, scrollHeight, clientHeight } = container
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight
    shouldAutoScroll.current = distanceFromBottom < 100
  }, [])

  // Autoscroll to bottom when new messages arrive
  useEffect(() => {
    if (shouldAutoScroll.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages, isLoading])

  // Handle sending a message with attached context
  const handleSend = async (attachedChats: AttachedChat[]) => {
    const userText = inputValue.trim()
    if (!userText || isLoading) return

    // Create user message for UI (show only the user's text)
    const userMessage: Demo2Message = {
      id: generateId(),
      role: "user",
      text: userText,
      createdAt: Date.now(),
      hasContext: attachedChats.length > 0,
    }

    setMessages((prev) => [...prev, userMessage])
    setInputValue("")
    setIsLoading(true)
    shouldAutoScroll.current = true

    try {
      // Step 1: Fetch summaries for attached chats
      let contextPreamble = ""
      if (attachedChats.length > 0) {
        setIsFetchingContext(true)

        const contexts: Array<{
          title: string
          category: string
          summary: string
        }> = []

        for (const chat of attachedChats) {
          const summaryData = await fetchChatSummary(chat.chatId)
          if (summaryData) {
            contexts.push(summaryData)
          }
        }

        contextPreamble = buildContextPreamble(contexts)
        setIsFetchingContext(false)
      }

      // Step 2: Build the full input with context preamble
      const fullInput = contextPreamble
        ? `${contextPreamble}USER MESSAGE:\n${userText}`
        : userText

      // Step 3: Send to /api/respond (unchanged endpoint)
      const res = await fetch("/api/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: fullInput,
          previous_response_id: lastResponseId,
          mode: "deep",
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Failed to get response")
      }

      // Step 4: Add assistant message to UI
      const assistantMessage: Demo2Message = {
        id: generateId(),
        role: "assistant",
        text: data.output_text,
        createdAt: Date.now(),
      }

      setMessages((prev) => [...prev, assistantMessage])
      setLastResponseId(data.id)
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Something went wrong"
      toast.error(errorMessage)
    } finally {
      setIsLoading(false)
      setIsFetchingContext(false)
    }
  }

  // Reset chat state
  const handleReset = () => {
    setMessages([])
    setLastResponseId(null)
    setInputValue("")
    toast.success("Chat cleared")
  }

  const hasMessages = messages.length > 0

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-3">
            <Link href="/demos/history">
              <Button variant="ghost" size="sm" className="gap-1.5">
                <ArrowLeft className="h-4 w-4" />
                History
              </Button>
            </Link>
            <div className="h-6 w-px bg-border" />
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <span className="font-medium">Context Chat</span>
            </div>
            {lastResponseId && (
              <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-0.5 rounded">
                {lastResponseId.slice(0, 12)}...
              </span>
            )}
          </div>
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
                <Sparkles className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-lg font-medium mb-2">
                Chat with Past Context
              </h3>
              <p className="text-sm text-muted-foreground max-w-sm mb-4">
                Attach past conversations as context for your messages. Click
                the + button to select chats.
              </p>
              <div className="text-xs text-muted-foreground/70 max-w-sm p-3 bg-muted rounded-lg">
                <strong>How it works:</strong> When you attach past chats, their
                summaries are included in your message to give the AI relevant
                context.
              </div>
            </div>
          ) : (
            // Messages list
            <div className="p-4 space-y-4">
              {messages.map((message) => (
                <Demo2MessageBubble key={message.id} message={message} />
              ))}
              {isLoading && (
                <div className="flex items-start gap-3">
                  <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        {isFetchingContext
                          ? "Loading context..."
                          : "Thinking..."}
                      </span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Composer with attachment support */}
        <HistoryComposer
          value={inputValue}
          onChange={setInputValue}
          onSend={handleSend}
          disabled={isLoading}
          placeholder="Type a message... (use + to attach past chats)"
        />
      </div>
    </TooltipProvider>
  )
}

/**
 * Simple message bubble for Demo 2 (no branching)
 */
function Demo2MessageBubble({ message }: { message: Demo2Message }) {
  const isUser = message.role === "user"

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
        {/* Context indicator for user messages */}
        {isUser && message.hasContext && (
          <div className="flex items-center gap-1 mb-1 text-[10px] text-primary-foreground/70">
            <Sparkles className="h-3 w-3" />
            <span>Context attached</span>
          </div>
        )}
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
            {message.text}
          </p>
        ) : (
          <MarkdownContent content={message.text} />
        )}
        <p
          className={cn(
            "text-[10px] mt-1",
            isUser ? "text-primary-foreground/60" : "text-muted-foreground/60"
          )}
        >
          {formatRelativeTime(message.createdAt)}
        </p>
      </div>
    </div>
  )
}

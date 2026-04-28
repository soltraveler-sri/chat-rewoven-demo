"use client"

import { FormEvent, useState } from "react"
import { Compass, Database, Loader2, Send, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { AssistantTaskCard } from "@/components/assistant/assistant-task-card"
import type { AssistantTaskResult } from "@/lib/assistant/types"

const SUGGESTIONS = [
  {
    label: "Build a plan",
    prompt: "Synthesize relevant chats into a clear plan I can follow",
  },
  {
    label: "Recover loose ends",
    prompt: "Find unfinished chats from this week and brief me on next actions",
  },
  {
    label: "Create a spreadsheet",
    prompt: "Extract lifting numbers into a spreadsheet",
  },
]

function createPendingTask(id: string, request: string): AssistantTaskResult {
  const now = Date.now()
  return {
    id,
    createdAt: now,
    updatedAt: now,
    status: "searching",
    requestText: request,
    interpretedGoal: "Review workspace context and prepare a product-level Assistant result.",
    taskKind: "clarification",
    progress: ["queued", "interpreting", "searching"],
    sources: [],
    resultSummary: "Reviewing available chat context...",
    proposedActions: [],
    reviewedChatCount: 0,
  }
}

interface AssistantPopupProps {
  onClose: () => void
  onRunTask: (
    request: string,
    options?: { taskId?: string; previousTask?: AssistantTaskResult | null }
  ) => Promise<AssistantTaskResult>
  onLoadSampleWorkspace: () => void
  onOpenChat?: (chatId: string) => void
  onInsertPrompt?: (prompt: string) => void
}

export function AssistantPopup({
  onClose,
  onRunTask,
  onLoadSampleWorkspace,
  onOpenChat,
  onInsertPrompt,
}: AssistantPopupProps) {
  const [input, setInput] = useState("")
  const [task, setTask] = useState<AssistantTaskResult | null>(null)
  const [isRunning, setIsRunning] = useState(false)

  const runTask = async (request: string) => {
    const trimmed = request.trim()
    if (!trimmed || isRunning) return

    const taskId = crypto.randomUUID()
    setInput("")
    setTask(createPendingTask(taskId, trimmed))
    setIsRunning(true)

    try {
      const result = await onRunTask(trimmed, { taskId, previousTask: task })
      setTask(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Assistant failed to run"
      toast.error(message)
      setTask({
        ...createPendingTask(taskId, trimmed),
        status: "failed",
        updatedAt: Date.now(),
        resultSummary: message,
        error: message,
      })
    } finally {
      setIsRunning(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    runTask(input)
  }

  return (
    <div className="absolute right-0 top-full z-40 mt-2 w-[420px] overflow-hidden rounded-xl border border-border bg-card shadow-xl dark:shadow-black/30">
      <div className="border-b border-border bg-teal-500/5 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-teal-500/10">
              <Compass className="h-4 w-4 text-teal-700 dark:text-teal-300" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Assistant</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Work across chats, recover loose ends, and turn context into files.
              </p>
            </div>
          </div>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="space-y-3 p-3">
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask across your chats..."
            rows={1}
            disabled={isRunning}
            className="min-h-10 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
          />
          <Button type="submit" size="icon" className="h-10 w-10 shrink-0" disabled={!input.trim() || isRunning}>
            {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>

        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <Button
              key={suggestion.label}
              type="button"
              variant="outline"
              size="sm"
              className="h-7 rounded-full px-2.5 text-[11px]"
              disabled={isRunning}
              onClick={() => runTask(suggestion.prompt)}
            >
              {suggestion.label}
            </Button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/30 px-3 py-2">
          <p className="text-xs text-muted-foreground">Need demo data?</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={onLoadSampleWorkspace}
          >
            <Database className="h-3.5 w-3.5" />
            Load samples
          </Button>
        </div>

        <div className="max-h-[500px] overflow-auto">
          {task ? (
            <AssistantTaskCard
              task={task}
              compact
              onFollowUp={(text) => runTask(text)}
              onOpenChat={onOpenChat}
              onInsertPrompt={onInsertPrompt}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
              Recent Assistant task results will appear here.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

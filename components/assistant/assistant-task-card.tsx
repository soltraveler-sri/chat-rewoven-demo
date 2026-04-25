"use client"

import { FormEvent, useState } from "react"
import {
  AlertCircle,
  Check,
  Clipboard,
  Compass,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquare,
  Search,
  Sparkles,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { MarkdownContent } from "@/components/ui/markdown-content"
import { cn } from "@/lib/utils"
import type {
  AssistantArtifact,
  AssistantOpenLoopItem,
  AssistantProposedAction,
  AssistantSource,
  AssistantTaskResult,
  AssistantTaskStatus,
} from "@/lib/assistant/types"

const STATUS_LABELS: Record<AssistantTaskStatus, string> = {
  queued: "Queued",
  interpreting: "Interpreting",
  searching: "Reviewing chats",
  reviewing: "Reviewing context",
  generating: "Generating",
  ready: "Ready",
  failed: "Failed",
  no_results: "No results",
}

const STATUS_STYLES: Record<AssistantTaskStatus, string> = {
  queued: "bg-muted text-muted-foreground",
  interpreting: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  searching: "bg-teal-500/10 text-teal-700 dark:text-teal-300",
  reviewing: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  generating: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  ready: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  failed: "bg-red-500/10 text-red-700 dark:text-red-300",
  no_results: "bg-muted text-muted-foreground",
}

interface AssistantTaskCardProps {
  task: AssistantTaskResult
  compact?: boolean
  onFollowUp?: (text: string, parentTaskId: string) => void
  onClose?: () => void
  onOpenChat?: (chatId: string) => void
  onInsertPrompt?: (prompt: string) => void
}

function downloadArtifact(artifact: AssistantArtifact) {
  const blob = new Blob([artifact.content], { type: artifact.mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = artifact.filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function formatRelativeDate(timestamp?: number): string {
  if (!timestamp) return ""
  const diff = Date.now() - timestamp
  const days = Math.floor(diff / 86400000)
  if (days <= 0) return "today"
  if (days === 1) return "1d ago"
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}

function copyText(text: string, label = "Copied") {
  navigator.clipboard.writeText(text)
  toast.success(label)
}

function ProgressList({ task }: { task: AssistantTaskResult }) {
  const steps: Array<{ status: AssistantTaskStatus; label: string }> = [
    { status: "interpreting", label: "Interpreted request" },
    { status: "searching", label: "Reviewed available chats" },
    { status: "reviewing", label: "Checked evidence" },
    { status: "generating", label: "Prepared result" },
  ]

  const done = new Set(task.progress)
  const isRunning = !["ready", "failed", "no_results"].includes(task.status)

  return (
    <div className="grid grid-cols-2 gap-2">
      {steps.map((step) => {
        const complete = done.has(step.status) || task.status === "ready" || task.status === "no_results"
        return (
          <div
            key={step.status}
            className="flex items-center gap-2 rounded-md border border-border/60 bg-background/60 px-2.5 py-2 text-xs"
          >
            {complete ? (
              <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            ) : isRunning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : (
              <span className="h-3.5 w-3.5 rounded-full border border-border" />
            )}
            <span className="truncate">{step.label}</span>
          </div>
        )
      })}
    </div>
  )
}

function SourceList({
  sources,
  onOpenChat,
}: {
  sources: AssistantSource[]
  onOpenChat?: (chatId: string) => void
}) {
  if (sources.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
        No matching chat sources were found.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {sources.slice(0, 5).map((source) => (
        <div
          key={`${source.chatId}-${source.title}`}
          className="rounded-lg border border-border/70 bg-background/60 px-3 py-2.5"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <p className="truncate text-sm font-medium">{source.title}</p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{source.reason}</p>
            </div>
            {onOpenChat && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 px-2"
                onClick={() => onOpenChat(source.chatId)}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          {source.snippet && (
            <p className="mt-2 rounded-md bg-muted/50 px-2 py-1.5 text-xs leading-relaxed text-muted-foreground">
              {source.snippet}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

function ArtifactPanel({ artifact }: { artifact: AssistantArtifact }) {
  return (
    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{artifact.filename}</p>
            <p className="text-xs text-muted-foreground">
              {artifact.kind.toUpperCase()}
              {artifact.rowCount ? ` - ${artifact.rowCount} rows` : ""}
              {artifact.sizeLabel ? ` - ${artifact.sizeLabel}` : ""}
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          className="h-8 shrink-0 gap-1.5"
          onClick={() => downloadArtifact(artifact)}
        >
          <Download className="h-3.5 w-3.5" />
          Download
        </Button>
      </div>
    </div>
  )
}

function OpenLoopItem({
  item,
  onOpenChat,
  onInsertPrompt,
}: {
  item: AssistantOpenLoopItem
  onOpenChat?: (chatId: string) => void
  onInsertPrompt?: (prompt: string) => void
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/60 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{item.chatTitle}</p>
          <p className="text-xs text-muted-foreground">
            {item.chatId} {item.lastUpdated ? `- ${formatRelativeDate(item.lastUpdated)}` : ""}
          </p>
        </div>
        {onOpenChat && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2"
            onClick={() => onOpenChat(item.chatId)}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <div className="mt-2 space-y-2 text-sm">
        <p>
          <span className="font-medium">Why unfinished: </span>
          <span className="text-muted-foreground">{item.reason}</span>
        </p>
        <p>
          <span className="font-medium">Next action: </span>
          <span className="text-muted-foreground">{item.nextAction}</span>
        </p>
      </div>
      {item.snippet && (
        <p className="mt-2 rounded-md bg-muted/50 px-2 py-1.5 text-xs leading-relaxed text-muted-foreground">
          {item.snippet}
        </p>
      )}
      {item.draftCodexPrompt && (
        <div className="mt-3 rounded-md border border-border bg-muted/30 p-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Draft Codex Prompt
            </p>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => copyText(item.draftCodexPrompt!, "Codex prompt copied")}
              >
                <Clipboard className="h-3.5 w-3.5" />
              </Button>
              {onInsertPrompt && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => onInsertPrompt(item.draftCodexPrompt!)}
                >
                  Insert
                </Button>
              )}
            </div>
          </div>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
            {item.draftCodexPrompt}
          </pre>
        </div>
      )}
    </div>
  )
}

function ProposedActions({
  actions,
  artifact,
  onOpenChat,
  onInsertPrompt,
}: {
  actions: AssistantProposedAction[]
  artifact?: AssistantArtifact
  onOpenChat?: (chatId: string) => void
  onInsertPrompt?: (prompt: string) => void
}) {
  const actionable = actions.filter(
    (action, index, all) =>
      index === all.findIndex((candidate) => candidate.type === action.type && candidate.chatId === action.chatId)
  )

  if (actionable.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2">
      {actionable.slice(0, 5).map((action) => {
        if (action.type === "download_artifact" && artifact) {
          return (
            <Button
              key={action.id}
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => downloadArtifact(artifact)}
            >
              <Download className="h-3.5 w-3.5" />
              {action.label}
            </Button>
          )
        }
        if (action.type === "open_chat" && action.chatId && onOpenChat) {
          return (
            <Button
              key={action.id}
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => onOpenChat(action.chatId!)}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {action.label}
            </Button>
          )
        }
        if (action.type === "insert_codex_prompt" && action.prompt && onInsertPrompt) {
          return (
            <Button
              key={action.id}
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => onInsertPrompt(action.prompt!)}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {action.label}
            </Button>
          )
        }
        return null
      })}
    </div>
  )
}

export function AssistantTaskCard({
  task,
  compact = false,
  onFollowUp,
  onClose,
  onOpenChat,
  onInsertPrompt,
}: AssistantTaskCardProps) {
  const [followUp, setFollowUp] = useState("")
  const isWorking = !["ready", "failed", "no_results"].includes(task.status)

  const handleFollowUp = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = followUp.trim()
    if (!text || !onFollowUp) return
    setFollowUp("")
    onFollowUp(text, task.id)
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-teal-500/20 bg-card shadow-sm dark:shadow-md dark:shadow-black/20",
        compact ? "max-h-[560px]" : "w-full"
      )}
    >
      <div className="border-b border-border/70 bg-teal-500/5 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-teal-500/10">
              <Compass className="h-4 w-4 text-teal-700 dark:text-teal-300" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium">Assistant</p>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium",
                    STATUS_STYLES[task.status]
                  )}
                >
                  {STATUS_LABELS[task.status]}
                </span>
              </div>
              <p className="mt-1 break-words text-sm text-muted-foreground">
                {task.requestText}
              </p>
            </div>
          </div>
          {onClose && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div className={cn("space-y-4 p-4", compact && "max-h-[500px] overflow-auto")}>
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
            Interpreted Goal
          </p>
          <p className="text-sm leading-relaxed">{task.interpretedGoal}</p>
        </div>

        <ProgressList task={task} />

        {isWorking && (
          <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Working across available chat context...
          </div>
        )}

        {task.status === "failed" && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{task.error || task.resultSummary}</span>
          </div>
        )}

        <div>
          <p className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
            Result
          </p>
          <div className="text-sm leading-relaxed">
            <MarkdownContent content={task.resultSummary} />
          </div>
        </div>

        {task.artifact && <ArtifactPanel artifact={task.artifact} />}

        {task.openLoops && task.openLoops.length > 0 && (
          <div>
            <p className="mb-2 text-[10px] font-medium uppercase text-muted-foreground">
              Open Loops Brief
            </p>
            <div className="space-y-2">
              {task.openLoops.map((item) => (
                <OpenLoopItem
                  key={item.id}
                  item={item}
                  onOpenChat={onOpenChat}
                  onInsertPrompt={onInsertPrompt}
                />
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center gap-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-[10px] font-medium uppercase text-muted-foreground">
              Sources Used
            </p>
            <span className="text-[10px] text-muted-foreground">
              {task.reviewedChatCount} reviewed
            </span>
          </div>
          <SourceList sources={task.sources} onOpenChat={onOpenChat} />
        </div>

        {task.missingInfo && task.missingInfo.length > 0 && (
          <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
            <p className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
              Missing or Ambiguous
            </p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {task.missingInfo.map((item) => (
                <li key={item}>- {item}</li>
              ))}
            </ul>
          </div>
        )}

        <ProposedActions
          actions={task.proposedActions}
          artifact={task.artifact}
          onOpenChat={onOpenChat}
          onInsertPrompt={onInsertPrompt}
        />

        {onFollowUp && (
          <form onSubmit={handleFollowUp} className="flex items-end gap-2 border-t border-border/70 pt-3">
            <textarea
              value={followUp}
              onChange={(event) => setFollowUp(event.target.value)}
              placeholder="Follow up with Assistant..."
              rows={1}
              className="min-h-9 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <Button type="submit" size="sm" disabled={!followUp.trim()}>
              Send
            </Button>
          </form>
        )}

        {onClose && !compact && (
          <div className="flex justify-end border-t border-border/70 pt-3">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Resume chat
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

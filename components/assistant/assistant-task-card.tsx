"use client"

import { FormEvent, useEffect, useState } from "react"
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Check,
  Clipboard,
  Compass,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { MarkdownContent } from "@/components/ui/markdown-content"
import { docxFilenameFor, makeDocxBlobFromMarkdown } from "@/lib/assistant/docx"
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
  onIncludeInChatContext?: (task: AssistantTaskResult) => void
  isIncludedInChatContext?: boolean
}

const TERMINAL_STATUSES = new Set<AssistantTaskStatus>(["ready", "failed", "no_results"])

const TASK_KIND_LABELS: Record<AssistantTaskResult["taskKind"], string> = {
  cross_chat_artifact: "Artifact",
  open_loops: "Open loops",
  current_chat_help: "Current chat",
  codex_prompt_draft: "Codex follow-up",
  clarification: "Assistant",
}

const WORKING_STEPS = [
  "Interpreting the request",
  "Reviewing relevant chats",
  "Checking evidence",
  "Preparing the result",
]

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

function downloadDocxArtifact(artifact: AssistantArtifact) {
  const blob = makeDocxBlobFromMarkdown(artifact.content, artifact.filename)
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = docxFilenameFor(artifact.filename)
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

function useWorkingStep(isWorking: boolean, createdAt: number): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!isWorking) return
    const interval = window.setInterval(() => setNow(Date.now()), 900)
    return () => window.clearInterval(interval)
  }, [isWorking])

  const elapsedMs = Math.max(0, now - createdAt)
  return Math.min(WORKING_STEPS.length - 1, Math.floor(elapsedMs / 1600))
}

function WorkingState({
  stepIndex,
  compact = false,
}: {
  stepIndex: number
  compact?: boolean
}) {
  return (
    <div className="rounded-lg border border-teal-500/15 bg-teal-500/5 px-3 py-3">
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin text-teal-700 dark:text-teal-300" />
        <span className="font-medium">{WORKING_STEPS[stepIndex]}</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-background">
        <div
          className="h-full rounded-full bg-teal-600 transition-all duration-500 dark:bg-teal-300"
          style={{ width: `${((stepIndex + 1) / WORKING_STEPS.length) * 100}%` }}
        />
      </div>
      {!compact && (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
          {WORKING_STEPS.map((step, index) => (
            <div key={step} className="flex min-w-0 items-center gap-1.5">
              {index < stepIndex ? (
                <Check className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <span
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    index === stepIndex ? "bg-teal-600 dark:bg-teal-300" : "bg-muted-foreground/25"
                  )}
                />
              )}
              <span className={cn("truncate", index === stepIndex && "text-foreground")}>
                {step}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SourceList({
  sources,
  onOpenChat,
  dense = false,
}: {
  sources: AssistantSource[]
  onOpenChat?: (chatId: string) => void
  dense?: boolean
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
          className={cn(
            "rounded-lg border border-border/70 bg-background/60",
            dense ? "px-2.5 py-2" : "px-3 py-2.5"
          )}
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
          {source.snippet && !dense && (
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
  const supportsDocx = artifact.kind === "markdown"

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
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant={supportsDocx ? "outline" : "default"}
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => downloadArtifact(artifact)}
          >
            <Download className="h-3.5 w-3.5" />
            {supportsDocx ? "Markdown" : "Download"}
          </Button>
          {supportsDocx && (
            <Button
              type="button"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => downloadDocxArtifact(artifact)}
            >
              <FileText className="h-3.5 w-3.5" />
              DOCX
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function ArtifactPreview({
  artifact,
  compact = false,
}: {
  artifact: AssistantArtifact
  compact?: boolean
}) {
  const maxChars = compact ? 5000 : 12000
  const content =
    artifact.content.length > maxChars
      ? `${artifact.content.slice(0, maxChars).trim()}\n\n...`
      : artifact.content
  const isMarkdown = artifact.kind === "markdown"

  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-background">
      <div
        className={cn(
          "overflow-auto px-3 py-3 text-sm",
          compact ? "max-h-56" : "max-h-80"
        )}
      >
        {isMarkdown ? (
          <MarkdownContent content={content} />
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-muted-foreground">
            {content}
          </pre>
        )}
      </div>
    </div>
  )
}

function SourcesDetails({
  task,
  onOpenChat,
}: {
  task: AssistantTaskResult
  onOpenChat?: (chatId: string) => void
}) {
  const hasSources = task.sources.length > 0
  const label = hasSources
    ? `${task.sources.length} source${task.sources.length === 1 ? "" : "s"} used`
    : "No matching sources"

  if (!hasSources) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
        <Search className="h-3.5 w-3.5" />
        <span>{label}</span>
        <span>•</span>
        <span>{task.reviewedChatCount} reviewed</span>
      </div>
    )
  }

  return (
    <details className="group rounded-lg border border-border/70 bg-muted/20">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p className="text-[10px] font-medium uppercase text-muted-foreground">
            Sources Used
          </p>
          <span className="truncate text-xs text-muted-foreground">
            {label} • {task.reviewedChatCount} reviewed
          </span>
        </div>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border/70 p-2">
        <SourceList sources={task.sources} onOpenChat={onOpenChat} dense />
      </div>
    </details>
  )
}

function MissingInfoDetails({ items }: { items?: string[] }) {
  if (!items?.length) return null

  return (
    <details className="group rounded-lg border border-border/70 bg-muted/20">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase text-muted-foreground">
            Missing or Ambiguous
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {items.length} item{items.length === 1 ? "" : "s"} to confirm
          </p>
        </div>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <ul className="space-y-1 border-t border-border/70 px-3 py-2 text-xs text-muted-foreground">
        {items.map((item) => (
          <li key={item}>- {item}</li>
        ))}
      </ul>
    </details>
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
  onInsertPrompt,
}: {
  actions: AssistantProposedAction[]
  onInsertPrompt?: (prompt: string) => void
}) {
  const actionable = actions.filter(
    (action, index, all) =>
      action.type === "insert_codex_prompt" &&
      action.prompt &&
      onInsertPrompt &&
      index === all.findIndex((candidate) => candidate.type === action.type && candidate.prompt === action.prompt)
  )

  if (actionable.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2">
      {actionable.slice(0, 5).map((action) => {
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
  onIncludeInChatContext,
  isIncludedInChatContext = false,
}: AssistantTaskCardProps) {
  const [followUp, setFollowUp] = useState("")
  const [artifactPreviewState, setArtifactPreviewState] = useState<{
    filename?: string
    open: boolean
  }>(() => ({
    filename: task.artifact?.filename,
    open: Boolean(task.artifact) && !compact,
  }))
  const isWorking = !TERMINAL_STATUSES.has(task.status)
  const workingStep = useWorkingStep(isWorking, task.createdAt)
  const artifactFilename = task.artifact?.filename
  const showArtifactPreview =
    artifactPreviewState.filename === artifactFilename
      ? artifactPreviewState.open
      : Boolean(artifactFilename) && !compact

  const handleFollowUp = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = followUp.trim()
    if (!text || !onFollowUp) return
    setFollowUp("")
    onFollowUp(text, task.id)
  }

  const canIncludeInContext =
    Boolean(onIncludeInChatContext) && task.status === "ready" && Boolean(task.artifact || task.resultSummary)
  const sourcesSummary = `${task.reviewedChatCount} chat${task.reviewedChatCount === 1 ? "" : "s"} reviewed${
    task.sources.length ? ` • ${task.sources.length} source${task.sources.length === 1 ? "" : "s"} used` : ""
  }`

  const renderArtifactActions = () => {
    if (!task.artifact && !canIncludeInContext) return null

    return (
      <div className="flex flex-wrap gap-2">
        {task.artifact && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() =>
              setArtifactPreviewState({
                filename: artifactFilename,
                open: !showArtifactPreview,
              })
            }
          >
            {showArtifactPreview ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
            {showArtifactPreview ? "Hide preview" : "Preview output"}
          </Button>
        )}
        {canIncludeInContext && onIncludeInChatContext && (
          <Button
            type="button"
            variant={isIncludedInChatContext ? "secondary" : "outline"}
            size="sm"
            className="h-8 gap-1.5"
            disabled={isIncludedInChatContext}
            onClick={() => onIncludeInChatContext(task)}
          >
            <Plus className="h-3.5 w-3.5" />
            {isIncludedInChatContext ? "Included in chat context" : "Include in chat context"}
          </Button>
        )}
      </div>
    )
  }

  const followUpForm = onFollowUp ? (
    <form onSubmit={handleFollowUp} className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/60 p-2">
      <textarea
        value={followUp}
        onChange={(event) => setFollowUp(event.target.value)}
        placeholder="Follow up with Assistant..."
        rows={1}
        className="min-h-8 flex-1 resize-none bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-0"
      />
      <Button type="submit" size="sm" className="h-8" disabled={!followUp.trim()}>
        Send
      </Button>
    </form>
  ) : null

  if (compact) {
    return (
      <div className="overflow-hidden rounded-lg border border-teal-500/20 bg-card shadow-sm">
        <div className="space-y-3 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-teal-500/10">
                <Compass className="h-4 w-4 text-teal-700 dark:text-teal-300" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="font-medium">Assistant</p>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {TASK_KIND_LABELS[task.taskKind]}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium",
                      STATUS_STYLES[task.status]
                    )}
                  >
                    {STATUS_LABELS[task.status]}
                  </span>
                </div>
                <p className="mt-1 break-words text-sm leading-relaxed text-muted-foreground">
                  {task.requestText}
                </p>
              </div>
            </div>
            {onClose && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          {isWorking ? (
            <WorkingState stepIndex={workingStep} compact />
          ) : (
            <>
              {task.status === "failed" && (
                <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{task.error || task.resultSummary}</span>
                </div>
              )}

              <div className="rounded-lg bg-muted/30 px-3 py-2 text-sm leading-relaxed">
                <MarkdownContent content={task.resultSummary} />
              </div>

              {task.artifact && <ArtifactPanel artifact={task.artifact} />}
              {renderArtifactActions()}
              {task.artifact && showArtifactPreview && (
                <ArtifactPreview artifact={task.artifact} compact />
              )}

              {task.openLoops && task.openLoops.length > 0 && (
                <div className="space-y-2">
                  {task.openLoops.slice(0, 3).map((item) => (
                    <OpenLoopItem
                      key={item.id}
                      item={item}
                      onOpenChat={onOpenChat}
                      onInsertPrompt={onInsertPrompt}
                    />
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between gap-2 rounded-md bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                <span>{sourcesSummary}</span>
                {task.sources.length > 0 && (
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-1 font-medium text-foreground">
                      Sources
                      <ChevronDown className="h-3 w-3 group-open:hidden" />
                      <ChevronUp className="hidden h-3 w-3 group-open:block" />
                    </summary>
                    <div className="mt-2 min-w-[320px]">
                      <SourceList sources={task.sources} onOpenChat={onOpenChat} dense />
                    </div>
                  </details>
                )}
              </div>

              {followUpForm}
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "mx-auto w-full max-w-5xl overflow-hidden rounded-xl border border-teal-500/20 bg-card shadow-sm dark:shadow-md dark:shadow-black/20"
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
                <span className="rounded-full bg-background/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {TASK_KIND_LABELS[task.taskKind]}
                </span>
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

      <div className="space-y-4 p-4">
        {isWorking && (
          <WorkingState stepIndex={workingStep} />
        )}

        {!isWorking && (
          <>
            <div className="rounded-lg bg-muted/30 px-3 py-2">
              <p className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
                Interpreted Goal
              </p>
              <p className="text-sm leading-relaxed">{task.interpretedGoal}</p>
            </div>

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
            {renderArtifactActions()}
            {task.artifact && showArtifactPreview && (
              <ArtifactPreview artifact={task.artifact} />
            )}

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

            <SourcesDetails task={task} onOpenChat={onOpenChat} />

            <MissingInfoDetails items={task.missingInfo} />

            <ProposedActions
              actions={task.proposedActions}
              onInsertPrompt={onInsertPrompt}
            />

            {followUpForm}

            {onClose && (
              <div className="flex justify-end border-t border-border/70 pt-3">
                <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                  Resume chat
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

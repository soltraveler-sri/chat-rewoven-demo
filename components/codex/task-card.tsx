"use client"

import { useState, useEffect, useRef } from "react"
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Check,
  AlertCircle,
  ExternalLink,
  Copy,
  Play,
  GitPullRequest,
  FileCode,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { MarkdownContent } from "@/components/ui/markdown-content"
import { cn } from "@/lib/utils"
import type { CodexTask, CodexFileChange, WorkspaceSnapshot } from "@/lib/codex/types"
import { TASK_STATUS_LABELS, TASK_STATUS_COLORS } from "@/lib/codex/types"

// =============================================================================
// Types
// =============================================================================

interface TaskCardProps {
  task: CodexTask
  workspace?: WorkspaceSnapshot
  onApplyChanges: () => Promise<void>
  onCreatePR: () => Promise<void>
  onRefresh: () => Promise<void>
}

// Animated log messages to show while processing
const ANIMATED_LOGS = [
  "Parsing prompt structure...",
  "Identifying target files...",
  "Generating implementation plan...",
  "Writing new code blocks...",
  "Validating syntax...",
  "Finalizing changes...",
]

// =============================================================================
// Main TaskCard Component
// =============================================================================

export function TaskCard({
  task,
  workspace,
  onApplyChanges,
  onCreatePR,
  onRefresh,
}: TaskCardProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [isApplying, setIsApplying] = useState(false)
  const [isCreatingPR, setIsCreatingPR] = useState(false)

  const isRunning = task.status === "running" || task.status === "queued"
  const canApply =
    task.status === "draft_ready" && !isApplying && !isCreatingPR
  const canCreatePR =
    (task.status === "applied" || task.status === "draft_ready") &&
    !isApplying &&
    !isCreatingPR &&
    !task.prUrl
  const hasError = task.status === "failed"

  // Auto-select first file when changes are available
  useEffect(() => {
    if (task.changes.length > 0 && !selectedFilePath) {
      setSelectedFilePath(task.changes[0].path)
    }
  }, [task.changes, selectedFilePath])

  const handleApply = async () => {
    setIsApplying(true)
    try {
      await onApplyChanges()
      toast.success("Changes applied successfully")
    } catch {
      toast.error("Failed to apply changes")
    } finally {
      setIsApplying(false)
    }
  }

  const handleCreatePR = async () => {
    setIsCreatingPR(true)
    try {
      await onCreatePR()
      toast.success("PR created successfully")
    } catch {
      toast.error("Failed to create PR")
    } finally {
      setIsCreatingPR(false)
    }
  }

  const handleCopyDiff = () => {
    if (task.diffUnified) {
      navigator.clipboard.writeText(task.diffUnified)
      toast.success("Diff copied to clipboard")
    }
  }

  // Get the selected file change
  const selectedChange = task.changes.find((c) => c.path === selectedFilePath)

  // =============================================================================
  // Collapsed State
  // =============================================================================

  if (!isExpanded) {
    return (
      <div
        className="flex items-center gap-3 px-4 py-3 bg-card border border-border dark:border-muted-foreground/25 rounded-xl cursor-pointer hover:bg-muted/50 transition-colors shadow-sm dark:shadow-md dark:shadow-black/20"
        onClick={() => setIsExpanded(true)}
      >
        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {isRunning && (
            <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" />
          )}
          {task.status === "draft_ready" && (
            <FileCode className="h-4 w-4 text-amber-500 shrink-0" />
          )}
          {task.status === "applied" && (
            <Check className="h-4 w-4 text-green-500 shrink-0" />
          )}
          {task.status === "pr_created" && (
            <GitPullRequest className="h-4 w-4 text-purple-500 shrink-0" />
          )}
          {hasError && <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />}
          <span className="text-sm font-medium truncate">
            Codex task • {task.title || "Processing..."}
          </span>
        </div>
        <span
          className={cn(
            "text-[10px] px-2 py-0.5 rounded-full shrink-0",
            TASK_STATUS_COLORS[task.status]
          )}
        >
          {TASK_STATUS_LABELS[task.status]}
        </span>
      </div>
    )
  }

  // =============================================================================
  // Expanded State
  // =============================================================================

  return (
    <div className="bg-card border border-border dark:border-muted-foreground/25 rounded-xl overflow-hidden shadow-sm dark:shadow-md dark:shadow-black/20">
      {/* Sticky Header */}
      <div className="sticky top-0 z-10 bg-card border-b border-border dark:border-muted-foreground/20">
        {/* Title row */}
        <div
          className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
          onClick={() => setIsExpanded(false)}
        >
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {isRunning && (
              <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" />
            )}
            <span className="text-sm font-medium truncate">
              {task.title || "Processing..."}
            </span>
          </div>
          <span
            className={cn(
              "text-[10px] px-2 py-0.5 rounded-full shrink-0",
              TASK_STATUS_COLORS[task.status]
            )}
          >
            {TASK_STATUS_LABELS[task.status]}
          </span>

          {/* Header actions - only show when not running */}
          {!isRunning && !hasError && (
            <div
              className="flex items-center gap-1.5 ml-2"
              onClick={(e) => e.stopPropagation()}
            >
              {canApply && (
                <Button
                  size="sm"
                  onClick={handleApply}
                  disabled={isApplying}
                  className="h-7 gap-1 text-xs"
                >
                  {isApplying ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                  Apply
                </Button>
              )}

              {canCreatePR && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCreatePR}
                  disabled={isCreatingPR}
                  className="h-7 gap-1 text-xs"
                >
                  {isCreatingPR ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <GitPullRequest className="h-3 w-3" />
                  )}
                  Create PR
                </Button>
              )}

              {task.prUrl && (
                <a
                  href={task.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-purple-600 dark:text-purple-400 hover:underline px-2"
                >
                  <ExternalLink className="h-3 w-3" />
                  View PR
                </a>
              )}

              {task.diffUnified && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleCopyDiff}
                  className="h-7 gap-1 text-xs"
                >
                  <Copy className="h-3 w-3" />
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Body - Fixed height container */}
      <div className="h-[360px] overflow-hidden">
        {isRunning ? (
          // Running state with progress animation
          <ProgressView task={task} onRefresh={onRefresh} />
        ) : hasError ? (
          // Error state
          <ErrorView task={task} />
        ) : (
          // Completed state - two column layout
          <div className="flex h-full">
            {/* Left column - Summary & Plan */}
            <div className="w-[280px] border-r border-border flex flex-col">
              <ScrollArea className="flex-1">
                <div className="p-4 space-y-4">
                  {/* Prompt */}
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground mb-1 font-medium">
                      Prompt
                    </p>
                    <p className="text-sm text-foreground">{task.prompt}</p>
                  </div>

                  {/* Plan */}
                  {task.planMarkdown && (
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground mb-1 font-medium">
                        Plan
                      </p>
                      <div className="text-sm text-foreground/80">
                        <MarkdownContent content={task.planMarkdown} />
                      </div>
                    </div>
                  )}

                  {/* File list */}
                  {task.changes.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground mb-2 font-medium">
                        Changed Files ({task.changes.length})
                      </p>
                      <div className="space-y-1">
                        {task.changes.map((change) => (
                          <FileListItem
                            key={change.path}
                            change={change}
                            isSelected={selectedFilePath === change.path}
                            isApplied={workspace?.files[change.path] === change.after}
                            onClick={() => setSelectedFilePath(change.path)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* Right column - Diff Preview */}
            <div className="flex-1 flex flex-col min-w-0">
              {selectedChange ? (
                <DiffPreview
                  change={selectedChange}
                  isApplied={workspace?.files[selectedChange.path] === selectedChange.after}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                  {task.changes.length === 0
                    ? "No changes generated"
                    : "Select a file to view diff"}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// Progress Pacing Configuration
// =============================================================================

/**
 * Time-based progress pacing for realistic ~30s experience
 * 
 * Progress curve:
 * - 0-60% in ~10-12 seconds (fast initial progress)
 * - 60-92% in ~18-22 seconds (slowing down)
 * - 92-96% cap until task completes (never looks "done" too early)
 * - On task completion: accelerate to 100% in 400-800ms
 */
const PROGRESS_CONFIG = {
  // Target time to reach each milestone (in seconds)
  PHASE_1_TARGET_PERCENT: 60,
  PHASE_1_DURATION_MS: 11000, // 11 seconds to reach 60%
  
  PHASE_2_TARGET_PERCENT: 92,
  PHASE_2_DURATION_MS: 20000, // 20 more seconds to reach 92% (total: 31s)
  
  // Cap - progress stalls here until task completes
  MAX_PROGRESS_WHILE_RUNNING: 96,
  
  // Final animation when task completes
  COMPLETION_ANIMATION_MS: 500,
}

/**
 * Calculate progress percentage based on elapsed time
 * Uses easing curves to feel natural
 */
function calculateTimeBasedProgress(elapsedMs: number, isComplete: boolean): number {
  if (isComplete) {
    return 100
  }

  const { 
    PHASE_1_TARGET_PERCENT, 
    PHASE_1_DURATION_MS,
    PHASE_2_TARGET_PERCENT,
    PHASE_2_DURATION_MS,
    MAX_PROGRESS_WHILE_RUNNING,
  } = PROGRESS_CONFIG

  // Phase 1: 0 → 60% over ~11 seconds
  if (elapsedMs < PHASE_1_DURATION_MS) {
    const t = elapsedMs / PHASE_1_DURATION_MS
    // Ease-out curve: fast start, slowing down
    const eased = 1 - Math.pow(1 - t, 2)
    return eased * PHASE_1_TARGET_PERCENT
  }

  // Phase 2: 60% → 92% over ~20 more seconds
  const phase2Elapsed = elapsedMs - PHASE_1_DURATION_MS
  if (phase2Elapsed < PHASE_2_DURATION_MS) {
    const t = phase2Elapsed / PHASE_2_DURATION_MS
    // Slower ease-out for this phase
    const eased = 1 - Math.pow(1 - t, 3)
    const phase2Progress = eased * (PHASE_2_TARGET_PERCENT - PHASE_1_TARGET_PERCENT)
    return PHASE_1_TARGET_PERCENT + phase2Progress
  }

  // Phase 3: Creep slowly from 92% to 96% cap
  const phase3Elapsed = elapsedMs - PHASE_1_DURATION_MS - PHASE_2_DURATION_MS
  // Very slow creep: takes 30 more seconds to go from 92% to 96%
  const creepRate = 4 / 30000 // 4% over 30 seconds
  const creepProgress = Math.min(phase3Elapsed * creepRate, MAX_PROGRESS_WHILE_RUNNING - PHASE_2_TARGET_PERCENT)
  
  return Math.min(PHASE_2_TARGET_PERCENT + creepProgress, MAX_PROGRESS_WHILE_RUNNING)
}

/**
 * Get the current status label based on progress
 */
function getProgressStatus(progress: number): string {
  if (progress < 15) return "Queued"
  if (progress < 40) return "Planning"
  if (progress < 100) return "Generating"
  return "Complete"
}

/**
 * Get the current status text based on progress
 */
function getProgressText(progress: number): string {
  if (progress < 10) return "Initializing task..."
  if (progress < 25) return "Analyzing your request..."
  if (progress < 40) return "Reading workspace files..."
  if (progress < 60) return "Drafting code changes..."
  if (progress < 80) return "Writing file contents..."
  if (progress < 95) return "Formatting output..."
  return "Finalizing..."
}

// =============================================================================
// Progress View Component (Running State)
// =============================================================================

function ProgressView({
  task,
  onRefresh,
}: {
  task: CodexTask
  onRefresh: () => Promise<void>
}) {
  const [logIndex, setLogIndex] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const startTimeRef = useRef<number | null>(null)
  const animationFrameRef = useRef<number | null>(null)

  // Initialize start time on mount
  useEffect(() => {
    startTimeRef.current = Date.now()
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [])

  // Smooth progress updates using requestAnimationFrame
  useEffect(() => {
    let lastUpdate = Date.now()
    
    const updateProgress = () => {
      if (startTimeRef.current === null) return
      
      const now = Date.now()
      // Throttle updates to ~60fps for smooth animation
      if (now - lastUpdate >= 16) {
        setElapsedMs(now - startTimeRef.current)
        lastUpdate = now
      }
      
      animationFrameRef.current = requestAnimationFrame(updateProgress)
    }
    
    animationFrameRef.current = requestAnimationFrame(updateProgress)
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [])

  // Cycle through animated log messages
  useEffect(() => {
    const timer = setInterval(() => {
      setLogIndex((prev) => (prev + 1) % ANIMATED_LOGS.length)
    }, 1800)
    return () => clearInterval(timer)
  }, [])

  // Auto-refresh periodically
  useEffect(() => {
    if (task.id.startsWith("placeholder_")) {
      return
    }

    const interval = setInterval(() => {
      setIsRefreshing(true)
      onRefresh().finally(() => setIsRefreshing(false))
    }, 3000)

    return () => clearInterval(interval)
  }, [onRefresh, task.id])

  // Calculate time-based progress (never completes since component unmounts when task finishes)
  const progress = calculateTimeBasedProgress(elapsedMs, false)
  const elapsedSeconds = Math.floor(elapsedMs / 1000)
  const currentStatus = getProgressStatus(progress)
  const currentText = getProgressText(progress)

  // Get visible animated logs (show 4 most recent)
  const visibleLogs = Array.from({ length: 4 }, (_, i) => {
    const idx = (logIndex - i + ANIMATED_LOGS.length) % ANIMATED_LOGS.length
    return { text: ANIMATED_LOGS[idx], opacity: 1 - i * 0.25 }
  }).reverse()

  return (
    <div className="h-full flex flex-col p-6">
      {/* Header with status pill and timer */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "text-xs font-medium px-2.5 py-1 rounded-full transition-all duration-300",
              currentStatus === "Queued" && "bg-muted text-muted-foreground",
              currentStatus === "Planning" && "bg-blue-500/20 text-blue-600 dark:text-blue-400",
              currentStatus === "Generating" && "bg-purple-500/20 text-purple-600 dark:text-purple-400"
            )}
          >
            {currentStatus}
          </span>
          {isRefreshing && (
            <div className="h-2 w-2 bg-blue-500 rounded-full animate-pulse" />
          )}
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="animate-pulse">●</span>
          <span>Working… {elapsedSeconds}s</span>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col justify-center max-w-md mx-auto w-full space-y-6">
        {/* Spinner and current action */}
        <div className="text-center space-y-3">
          <div className="relative inline-block">
            <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
          </div>
          <p className="text-sm font-medium text-foreground">{currentText}</p>
        </div>

        {/* Progress bar */}
        <div className="space-y-2">
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-blue-400 rounded-full transition-all duration-150 ease-out"
              style={{ width: `${Math.round(progress)}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{currentStatus === "Generating" ? "Generating changes..." : "Preparing..."}</span>
            <span>{Math.round(progress)}%</span>
          </div>
        </div>
      </div>

      {/* Animated log output - fixed at bottom */}
      <div className="mt-auto pt-4">
        <ScrollArea className="h-[100px] bg-muted/30 rounded-lg border border-border/50">
          <div className="p-3 space-y-1.5 font-mono text-[11px]">
            {/* Real logs if any */}
            {task.logs.length > 0 && task.logs.slice(-2).map((log, idx) => (
              <div key={`real-${idx}`} className="text-foreground/70 flex items-start gap-2">
                <Check className="h-3 w-3 text-green-500 shrink-0 mt-0.5" />
                <span>{log}</span>
              </div>
            ))}
            {/* Animated skeleton logs */}
            {visibleLogs.map((log, idx) => (
              <div
                key={`anim-${idx}`}
                className="text-muted-foreground flex items-start gap-2 transition-opacity duration-300"
                style={{ opacity: log.opacity }}
              >
                <span className="text-blue-400 shrink-0">→</span>
                <span>{log.text}</span>
              </div>
            ))}
            {/* Skeleton blocks */}
            <div className="space-y-1.5 pt-1">
              <div className="h-3 w-3/4 bg-muted rounded animate-pulse" />
              <div className="h-3 w-1/2 bg-muted rounded animate-pulse" style={{ animationDelay: "150ms" }} />
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

// =============================================================================
// Error View Component
// =============================================================================

function ErrorView({ task }: { task: CodexTask }) {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="text-center space-y-4 max-w-md">
        <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
          <AlertCircle className="h-6 w-6 text-red-500" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground mb-2">Task Failed</p>
          <p className="text-sm text-red-600 dark:text-red-400">{task.error}</p>
        </div>
        {task.logs.length > 0 && (
          <div className="bg-muted/50 rounded-lg p-3 text-left max-h-[150px] overflow-auto">
            <div className="space-y-1 font-mono text-[11px]">
              {task.logs.map((log, idx) => (
                <div key={idx} className="text-muted-foreground">
                  {log}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// File List Item Component
// =============================================================================

function FileListItem({
  change,
  isSelected,
  isApplied,
  onClick,
}: {
  change: CodexFileChange
  isSelected: boolean
  isApplied: boolean
  onClick: () => void
}) {
  const isNew = !change.before

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors",
        isSelected
          ? "bg-primary/10 text-primary"
          : "hover:bg-muted text-foreground/80"
      )}
    >
      <FileCode className="h-3 w-3 shrink-0" />
      <span className="text-xs font-mono truncate flex-1">{change.path}</span>
      <span
        className={cn(
          "text-[9px] px-1 py-0.5 rounded shrink-0",
          isNew
            ? "bg-green-500/20 text-green-600 dark:text-green-400"
            : "bg-amber-500/20 text-amber-600 dark:text-amber-400"
        )}
      >
        {isNew ? "NEW" : "MOD"}
      </span>
      {isApplied && (
        <Check className="h-3 w-3 text-green-500 shrink-0" />
      )}
    </button>
  )
}

// =============================================================================
// Diff Preview Component
// =============================================================================

function DiffPreview({
  change,
  isApplied,
}: {
  change: CodexFileChange
  isApplied: boolean
}) {
  const isNew = !change.before

  // Generate simple diff lines for display
  const diffLines = generateDiffLines(change)

  return (
    <div className="flex flex-col h-full">
      {/* Diff header */}
      <div className="flex items-center gap-2 px-4 py-2 bg-muted/50 border-b border-border">
        <FileCode className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-mono flex-1">{change.path}</span>
        <span
          className={cn(
            "text-[10px] px-1.5 py-0.5 rounded",
            isNew
              ? "bg-green-500/20 text-green-600 dark:text-green-400"
              : "bg-amber-500/20 text-amber-600 dark:text-amber-400"
          )}
        >
          {isNew ? "NEW FILE" : "MODIFIED"}
        </span>
        {isApplied && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-600 dark:text-green-400">
            APPLIED
          </span>
        )}
      </div>

      {/* Diff content */}
      <ScrollArea className="flex-1">
        <pre className="p-4 text-xs font-mono leading-relaxed">
          {diffLines.map((line, idx) => (
            <div
              key={idx}
              className={cn(
                "whitespace-pre",
                line.type === "add" && "bg-green-500/10 text-green-700 dark:text-green-300",
                line.type === "remove" && "bg-red-500/10 text-red-700 dark:text-red-300",
                line.type === "header" && "text-muted-foreground font-semibold"
              )}
            >
              {line.content}
            </div>
          ))}
        </pre>
      </ScrollArea>
    </div>
  )
}

// =============================================================================
// Helper Functions
// =============================================================================

interface DiffLine {
  type: "add" | "remove" | "context" | "header"
  content: string
}

function generateDiffLines(change: CodexFileChange): DiffLine[] {
  const lines: DiffLine[] = []
  const isNew = !change.before

  // Header
  lines.push({ type: "header", content: `--- a/${change.path}` })
  lines.push({ type: "header", content: `+++ b/${change.path}` })

  if (isNew) {
    // New file - show all lines as additions
    const afterLines = change.after.split("\n")
    lines.push({ type: "header", content: `@@ -0,0 +1,${afterLines.length} @@` })
    afterLines.forEach((line) => {
      lines.push({ type: "add", content: `+${line}` })
    })
  } else {
    // Modified file - generate simplified diff
    const beforeLines = change.before!.split("\n")
    const afterLines = change.after.split("\n")

    lines.push({
      type: "header",
      content: `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    })

    // Simple diff: show removed lines, then added lines
    // In a real implementation, use a proper diff algorithm
    beforeLines.forEach((line) => {
      lines.push({ type: "remove", content: `-${line}` })
    })
    afterLines.forEach((line) => {
      lines.push({ type: "add", content: `+${line}` })
    })
  }

  return lines
}

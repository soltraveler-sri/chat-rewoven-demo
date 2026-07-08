"use client"

import {
  Code,
  FileAudio,
  GitBranch,
  Loader2,
  MessageSquare,
  Paperclip,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { APP_BADGE, APP_NAME, APP_TAGLINE } from "@/lib/branding"
import { cn } from "@/lib/utils"
import type { StoredChatThreadMeta } from "@/lib/store/types"

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}

export function UnifiedSidebar({
  threads,
  isLoadingThreads,
  activeThreadId,
  urlChatId,
  onReset,
  onSelectThread,
}: {
  threads: StoredChatThreadMeta[]
  isLoadingThreads: boolean
  activeThreadId: string | null
  urlChatId: string | null
  onReset: () => void
  onSelectThread: (threadId: string) => void
}) {
  return (
    <div className="w-64 border-r border-border/40 flex flex-col bg-surface-sunken">
      <div className="p-3">
        <Button onClick={onReset} className="w-full gap-2" variant="secondary">
          <Plus className="h-4 w-4" />
          New Chat
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {isLoadingThreads ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : threads.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No chats yet
            </div>
          ) : (
            threads.map((thread) => {
              const isActive = thread.id === activeThreadId || thread.id === urlChatId
              return (
                <button
                  key={thread.id}
                  onClick={() => onSelectThread(thread.id)}
                  className={cn(
                    "w-full text-left p-2.5 rounded-lg transition-colors",
                    "border-l-2 border-l-transparent hover:bg-accent/60",
                    isActive && "bg-accent-soft border-l-thread"
                  )}
                >
                  <div className="flex items-start gap-2">
                    <MessageSquare
                      className={cn(
                        "h-4 w-4 mt-0.5 shrink-0",
                        isActive ? "text-primary" : "text-muted-foreground"
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {thread.title || "New Chat"}
                      </div>
                      <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                        {formatRelativeTime(thread.updatedAt)}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

const EXAMPLE_PROMPTS: {
  label: string
  prompt: string
  tag: string
  icon: typeof MessageSquare
  action: "branch" | "codex" | "assistant" | "find"
}[] = [
  {
    label: "Branch from a reply — explore without derailing the thread",
    prompt: "Plan a 3-day Kyoto trip focused on food",
    tag: "Branch",
    icon: GitBranch,
    action: "branch",
  },
  {
    label: "@codex add a dark-mode toggle to the settings page",
    prompt: "@codex add a dark-mode toggle to the settings page",
    tag: "Codex",
    icon: Code,
    action: "codex",
  },
  {
    label: "@assistant can you create an itinerary for my portugal trip exactly like we did for kyoto",
    prompt: "@assistant can you create an itinerary for my portugal trip exactly like we did for kyoto",
    tag: "Assistant",
    icon: Sparkles,
    action: "assistant",
  },
  {
    label: "/find the chat about the telescope",
    prompt: "/find the chat about the telescope",
    tag: "Find",
    icon: Search,
    action: "find",
  },
]

export function UnifiedEmptyState({
  onSelectExample,
  onUseSampleDocument,
  prereqNotice,
  onDismissPrereqNotice,
}: {
  onSelectExample?: (action: "branch" | "codex" | "assistant" | "find") => void
  onUseSampleDocument?: () => void
  prereqNotice?: string | null
  onDismissPrereqNotice?: () => void
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-xl">
        {/* Wordmark — the front door */}
        <div className="flex items-baseline gap-2.5">
          <h1 className="font-display text-4xl font-medium text-foreground">
            {APP_NAME}
          </h1>
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
            {APP_BADGE}
          </span>
        </div>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          {APP_TAGLINE}
        </p>

        {/* Try one of these */}
        <p className="mt-8 mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
          Try one of these
        </p>
        <div className="grid gap-2">
          {EXAMPLE_PROMPTS.map(({ prompt, label, tag, icon: Icon, action }) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onSelectExample?.(action)}
              className={cn(
                "group flex w-full items-center gap-3 rounded-lg px-3.5 py-3 text-left",
                "border border-border/50 bg-card transition-colors",
                "hover:border-thread/40 hover:bg-accent-soft/40",
                "focus:outline-none focus:ring-2 focus:ring-ring/40"
              )}
            >
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
              <span className="flex-1 text-sm text-foreground">{label}</span>
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                {tag}
              </span>
            </button>
          ))}
        </div>

        {prereqNotice && (
          <div className="mt-2 rounded-lg border border-border/50 border-l-2 border-l-thread bg-accent-soft/35 px-3.5 py-3">
            <div className="flex items-start gap-2">
              <p className="flex-1 text-sm leading-relaxed text-muted-foreground">
                {prereqNotice}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={onDismissPrereqNotice}
                aria-label="Dismiss notice"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* Doc-read hint (not a seedable prompt — needs a file) */}
        <div className="mt-2 flex items-center gap-3 rounded-lg px-3.5 py-3 text-sm text-muted-foreground">
          <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground/70" />
          <span>
            Attach a PDF and say{" "}
            <span className="text-foreground">&ldquo;read this to me&rdquo;</span>{" "}
            for a narrated document, or{" "}
            <button
              type="button"
              onClick={onUseSampleDocument}
              className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
            >
              <FileAudio className="h-3.5 w-3.5" />
              use our sample document
            </button>
            .
          </span>
        </div>
      </div>
    </div>
  )
}

export function MergingOverlay() {
  return (
    <div className="fixed inset-0 bg-background/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-xl p-6 shadow-xl flex flex-col items-center gap-4 min-w-[280px]">
        <Loader2 className="h-8 w-8 text-primary animate-spin" />
        <div className="text-center space-y-1">
          <h3 className="text-sm font-medium text-foreground">
            Preparing branch context
          </h3>
          <p className="text-xs text-muted-foreground">Summarizing conversation...</p>
        </div>
      </div>
    </div>
  )
}

"use client"

import { FileAudio, Loader2, MessageSquare, Plus, Sparkles, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
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
    <div className="w-64 border-r border-border flex flex-col bg-muted/30">
      <div className="p-3 border-b border-border">
        <Button onClick={onReset} className="w-full gap-2" variant="outline">
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
                  className={`w-full text-left p-2.5 rounded-lg transition-colors hover:bg-accent/50 ${
                    isActive ? "bg-accent" : ""
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <MessageSquare className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {thread.title || "New Chat"}
                      </div>
                      <div className="text-xs text-muted-foreground">
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

export function UnifiedEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
        <Zap className="h-8 w-8 text-primary" />
      </div>
      <h3 className="text-lg font-medium mb-2">Unified Chat</h3>
      <p className="text-sm text-muted-foreground max-w-sm mb-4">
        All features in one place. Chat, branch, run Codex tasks, or find past
        conversations.
      </p>
      <div className="text-xs text-muted-foreground/70 max-w-sm p-3 bg-muted rounded-lg space-y-2">
        <p>
          <strong>Features:</strong>
        </p>
        <p>
          <code className="bg-background px-1 rounded">@assistant</code> &mdash;
          Work across chats and recover unfinished work
        </p>
        <p>
          <code className="bg-background px-1 rounded">@codex</code> &mdash;
          Generate code with task cards
        </p>
        <p>
          <code className="bg-background px-1 rounded">/find</code> &mdash;
          Search past conversations
        </p>
        <p>
          <span className="inline-flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> Branch
          </span>{" "}
          &mdash; Click branch on any assistant message
        </p>
        <p>
          <span className="inline-flex items-center gap-1">
            <FileAudio className="h-3 w-3" /> Doc Read
          </span>{" "}
          &mdash; Attach a PDF/DOCX and ask to read it aloud
        </p>
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


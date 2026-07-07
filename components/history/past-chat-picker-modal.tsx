"use client"

import { useState, useEffect, useMemo } from "react"
import {
  Search,
  X,
  Clock,
  Briefcase,
  Code,
  MessageCircle,
  User,
  Plane,
  ShoppingCart,
  Check,
  Loader2,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import type { StoredChatCategory, StoredChatThreadMeta } from "@/lib/store/types"
import { CATEGORY_LABELS } from "@/lib/store/types"
import { SessionChatCache } from "@/lib/session-cache"

// Icon mapping for categories
const CATEGORY_ICON_MAP: Record<StoredChatCategory, React.ReactNode> = {
  recent: <Clock className="h-3 w-3" />,
  professional: <Briefcase className="h-3 w-3" />,
  coding: <Code className="h-3 w-3" />,
  short_qa: <MessageCircle className="h-3 w-3" />,
  personal: <User className="h-3 w-3" />,
  travel: <Plane className="h-3 w-3" />,
  shopping: <ShoppingCart className="h-3 w-3" />,
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
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return "just now"
}

export interface AttachedChat {
  chatId: string
  title: string
  category: StoredChatCategory
  summary?: string
}

interface PastChatPickerModalProps {
  isOpen: boolean
  onClose: () => void
  onSelect: (chat: AttachedChat) => void
  selectedChatIds: string[]
}

export function PastChatPickerModal({
  isOpen,
  onClose,
  onSelect,
  selectedChatIds,
}: PastChatPickerModalProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [threads, setThreads] = useState<StoredChatThreadMeta[]>([])
  const [isLoading, setIsLoading] = useState(false)

  // Fetch all threads when modal opens, merging with session cache
  useEffect(() => {
    if (!isOpen) return

    async function fetchThreads() {
      setIsLoading(true)
      try {
        let serverThreads: StoredChatThreadMeta[] = []
        try {
          const res = await fetch("/api/chats")
          if (res.ok) {
            const data = await res.json()
            serverThreads = data.threads || []
          }
        } catch (error) {
          console.error("Failed to fetch threads from server:", error)
        }

        // Merge with session cache (union by ID, prefer server version)
        const localThreads = SessionChatCache.listThreads()
        const mergedMap = new Map<string, StoredChatThreadMeta>()
        for (const t of localThreads) mergedMap.set(t.id, t)
        for (const t of serverThreads) mergedMap.set(t.id, t) // server wins
        const merged = Array.from(mergedMap.values())
        merged.sort((a, b) => b.updatedAt - a.updatedAt)
        setThreads(merged)

        // Track merge divergence
        const localOnlyCount = localThreads.filter(
          (lt) => !serverThreads.some((st) => st.id === lt.id)
        ).length
        if (localOnlyCount > 0) {
          SessionChatCache.trackEvent("mergeLocalOnlyCount", localOnlyCount)
        }
      } finally {
        setIsLoading(false)
      }
    }

    fetchThreads()
  }, [isOpen])

  // Filter threads by search query (GLOBAL - always searches all threads)
  const filteredThreads = useMemo(() => {
    const query = searchQuery.toLowerCase().trim()
    if (!query) return threads

    return threads.filter(
      (t) =>
        t.title.toLowerCase().includes(query) ||
        (t.summary && t.summary.toLowerCase().includes(query))
    )
  }, [threads, searchQuery])

  const handleSelect = (thread: StoredChatThreadMeta) => {
    onSelect({
      chatId: thread.id,
      title: thread.title,
      category: thread.category,
      summary: thread.summary,
    })
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            Attach Past Chat
          </DialogTitle>
        </DialogHeader>

        {/* Search input */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search all conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-9"
            autoFocus
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Search is global across all chats
        </p>

        {/* Results list */}
        <ScrollArea className="h-[300px] -mx-6 px-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredThreads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-sm text-muted-foreground">
                {searchQuery
                  ? "No chats match your search"
                  : "No past chats available"}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredThreads.map((thread) => {
                const isSelected = selectedChatIds.includes(thread.id)

                return (
                  <button
                    key={thread.id}
                    onClick={() => handleSelect(thread)}
                    disabled={isSelected}
                    className={cn(
                      "w-full text-left px-3 py-2.5 rounded-lg transition-colors",
                      isSelected
                        ? "bg-primary/10 cursor-not-allowed"
                        : "hover:bg-muted"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "text-sm font-medium truncate",
                              isSelected ? "text-primary" : "text-foreground"
                            )}
                          >
                            {thread.title}
                          </span>
                          {isSelected && (
                            <Check className="h-4 w-4 text-primary shrink-0" />
                          )}
                        </div>
                        {thread.summary && (
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                            {thread.summary}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-muted-foreground/70">
                            {formatRelativeTime(thread.updatedAt)}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-muted rounded text-muted-foreground">
                            {CATEGORY_ICON_MAP[thread.category]}
                            {CATEGORY_LABELS[thread.category]}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="flex justify-end pt-2 border-t border-border">
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

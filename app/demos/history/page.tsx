"use client"

import { useState, useEffect, useMemo, useCallback, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import {
  History,
  Search,
  Clock,
  Briefcase,
  Code,
  MessageCircle,
  User,
  Plane,
  ShoppingCart,
  MessageSquare,
  ChevronRight,
  Loader2,
  X,
  RefreshCw,
  MoreHorizontal,
  Sparkles,
  Plus,
  Layers,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { FinderView } from "@/components/history"
import { StorageWarningBanner } from "@/components/ui/storage-warning-banner"
import type {
  StoredChatCategory,
  StoredChatThreadMeta,
  StoredChatThread,
  StacksMeta,
} from "@/lib/store/types"
import { STORED_CHAT_CATEGORIES, CATEGORY_LABELS } from "@/lib/store/types"
import { SessionChatCache } from "@/lib/session-cache"

// Icon mapping for categories
const CATEGORY_ICON_MAP: Record<StoredChatCategory, React.ReactNode> = {
  recent: <Clock className="h-4 w-4" />,
  professional: <Briefcase className="h-4 w-4" />,
  coding: <Code className="h-4 w-4" />,
  short_qa: <MessageCircle className="h-4 w-4" />,
  personal: <User className="h-4 w-4" />,
  travel: <Plane className="h-4 w-4" />,
  shopping: <ShoppingCart className="h-4 w-4" />,
}

// Small icons for dropdown menu
const CATEGORY_ICON_SMALL: Record<StoredChatCategory, React.ReactNode> = {
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

/**
 * Format a timestamp as a date string
 */
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

/**
 * Format last refresh time with helpful label
 */
function formatLastRefresh(timestamp: number | null): string {
  if (!timestamp) return "Not yet refreshed"
  return `Last refresh: ${formatRelativeTime(timestamp)}`
}

type ViewMode = "finder" | "browse"

/**
 * Inner component that uses useSearchParams
 */
function HistoryDemoContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // URL-based state
  const currentChatId = searchParams.get("chatId")
  const viewModeParam = searchParams.get("view") as ViewMode | null

  // View mode (Finder is default)
  const [viewMode, setViewMode] = useState<ViewMode>(viewModeParam || "finder")

  // State
  const [threads, setThreads] = useState<StoredChatThreadMeta[]>([])
  const [stacksMeta, setStacksMeta] = useState<StacksMeta | null>(null)
  const [selectedCategory, setSelectedCategory] =
    useState<StoredChatCategory | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedThread, setSelectedThread] = useState<StoredChatThread | null>(
    null
  )
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingThread, setIsLoadingThread] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshProgress, setRefreshProgress] = useState<string | null>(null)

  // Update URL when view mode changes
  const handleViewModeChange = useCallback(
    (mode: ViewMode) => {
      setViewMode(mode)
      const params = new URLSearchParams(searchParams.toString())
      if (mode === "finder") {
        params.delete("view") // finder is default, don't need param
      } else {
        params.set("view", mode)
      }
      // Keep chatId if present
      router.replace(`/demos/history?${params.toString()}`)
    },
    [router, searchParams]
  )

  // Handle opening a chat from finder
  const handleOpenChat = useCallback(
    (chatId: string, useReplace: boolean) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set("chatId", chatId)
      const url = `/demos/history?${params.toString()}`

      if (useReplace) {
        router.replace(url)
      } else {
        router.push(url)
      }
    },
    [router, searchParams]
  )

  // Handle selecting a thread in browse mode
  const handleSelectThread = useCallback(
    (threadId: string) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set("chatId", threadId)
      router.push(`/demos/history?${params.toString()}`)
    },
    [router, searchParams]
  )

  // Handle closing the transcript view
  const handleCloseTranscript = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete("chatId")
    router.push(`/demos/history?${params.toString()}`)
  }, [router, searchParams])

  // Fetch threads and stacks meta, merging with session cache
  const fetchData = useCallback(async () => {
    try {
      const [threadsRes, metaRes] = await Promise.all([
        fetch("/api/chats"),
        fetch("/api/stacks/meta"),
      ])

      let serverThreads: StoredChatThreadMeta[] = []
      if (threadsRes.ok) {
        const data = await threadsRes.json()
        serverThreads = data.threads || []
      }

      // Merge with session cache (union by ID, server wins)
      const localThreads = SessionChatCache.listThreads()
      const mergedMap = new Map<string, StoredChatThreadMeta>()
      for (const t of localThreads) mergedMap.set(t.id, t)
      for (const t of serverThreads) mergedMap.set(t.id, t)
      const merged = Array.from(mergedMap.values())
      merged.sort((a, b) => b.updatedAt - a.updatedAt)
      setThreads(merged)

      // Track merge divergence — local threads not on server
      const localOnlyCount = localThreads.filter(
        (lt) => !serverThreads.some((st) => st.id === lt.id)
      ).length
      if (localOnlyCount > 0) {
        SessionChatCache.trackEvent("mergeLocalOnlyCount", localOnlyCount)
      }

      if (metaRes.ok) {
        const data = await metaRes.json()
        setStacksMeta(data)
      }
    } catch (error) {
      console.error("Failed to fetch history data:", error)
    }
  }, [])

  // Initial fetch
  useEffect(() => {
    async function initialFetch() {
      setIsLoading(true)
      await fetchData()
      setIsLoading(false)
    }
    initialFetch()
  }, [fetchData])

  // Fetch selected thread details
  useEffect(() => {
    async function fetchThread() {
      if (!currentChatId) {
        setSelectedThread(null)
        return
      }

      setIsLoadingThread(true)
      try {
        const res = await fetch(`/api/chats/${currentChatId}`)
        if (res.ok) {
          const data = await res.json()
          setSelectedThread(data.thread || null)
        } else {
          // Server returned error — fall back to session cache
          const cached = SessionChatCache.getThread(currentChatId)
        if (cached) {
          setSelectedThread(cached)
          SessionChatCache.trackEvent("threadCacheFallbacks")
        }
      }
    } catch (error) {
        console.error("Failed to fetch thread:", error)
        // Network error — fall back to session cache
        const cached = SessionChatCache.getThread(currentChatId)
        if (cached) {
          setSelectedThread(cached)
          SessionChatCache.trackEvent("threadCacheFallbacks")
        }
      } finally {
        setIsLoadingThread(false)
      }
    }

    fetchThread()
  }, [currentChatId])

  // Handle refresh stacks
  const handleRefreshStacks = async () => {
    // Count recent chats
    const recentCount = threads.filter((t) => t.category === "recent").length

    if (recentCount === 0 && threads.length === 0) {
      toast.info("No chats to organize", {
        description: "Start some conversations in Demo 1 first.",
      })
      return
    }

    setIsRefreshing(true)
    setRefreshProgress(
      recentCount > 0
        ? `Sorting ${recentCount} recent chat${recentCount > 1 ? "s" : ""}...`
        : "Checking for updates..."
    )

    try {
      const res = await fetch("/api/stacks/refresh", {
        method: "POST",
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Refresh failed")
      }

      // Update local state with new counts
      if (data.counts) {
        setStacksMeta((prev) => ({
          ...prev,
          lastRefreshAt: data.lastRefreshAt,
          counts: data.counts,
        }))
      }

      // Refresh the full thread list to get updated data
      await fetchData()

      if (data.refreshedCount > 0) {
        toast.success(`Organized ${data.refreshedCount} chats`, {
          description: "Chats have been sorted into smart stacks.",
        })
      } else {
        toast.info("All caught up!", {
          description: "No new chats needed organizing.",
        })
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to refresh stacks"
      toast.error("Refresh failed", { description: errorMessage })
    } finally {
      setIsRefreshing(false)
      setRefreshProgress(null)
    }
  }

  // Handle manual category change
  const handleMoveToStack = async (
    threadId: string,
    newCategory: StoredChatCategory
  ) => {
    try {
      const res = await fetch(`/api/chats/${threadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: newCategory }),
      })

      if (!res.ok) {
        throw new Error("Failed to update category")
      }

      // Update local state
      setThreads((prev) =>
        prev.map((t) =>
          t.id === threadId ? { ...t, category: newCategory } : t
        )
      )

      // Update selected thread if it's the one being changed
      if (selectedThread?.id === threadId) {
        setSelectedThread((prev) =>
          prev ? { ...prev, category: newCategory } : prev
        )
      }

      toast.success(`Moved to ${CATEGORY_LABELS[newCategory]}`)
    } catch (error) {
      console.error("Failed to move thread:", error)
      toast.error("Failed to move chat")
    }
  }

  // Calculate category counts from threads (fallback if meta not available)
  const categoryCounts = useMemo(() => {
    // Always recalculate from threads for accuracy
    const counts = {} as Record<StoredChatCategory, number>
    for (const cat of STORED_CHAT_CATEGORIES) {
      counts[cat] = 0
    }
    for (const thread of threads) {
      counts[thread.category] = (counts[thread.category] || 0) + 1
    }
    return counts
  }, [threads])

  // Filter threads by search query (GLOBAL - always searches all threads)
  // Note: Category filter only affects display, NOT search scope
  const filteredThreads = useMemo(() => {
    const query = searchQuery.toLowerCase().trim()

    // First filter by category (if selected)
    let filtered = selectedCategory
      ? threads.filter((t) => t.category === selectedCategory)
      : threads

    // Then filter by search query (searches title and summary)
    // IMPORTANT: Search is global - when searching, we search ALL threads
    if (query) {
      // When searching, always search ALL threads regardless of category
      filtered = threads.filter(
        (t) =>
          t.title.toLowerCase().includes(query) ||
          (t.summary && t.summary.toLowerCase().includes(query))
      )
    }

    return filtered
  }, [threads, selectedCategory, searchQuery])

  // Total thread count
  const totalCount = threads.length
  const recentCount = categoryCounts.recent || 0

  return (
    <div className="flex h-full flex-col">
      {/* Storage warning banner */}
      <StorageWarningBanner className="m-2" />

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar - Mode toggle + Category stacks */}
        <div className="w-64 border-r border-border flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <History className="h-5 w-5" />
              Chat History
            </div>
            <Link href="/demos/history/chat">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Plus className="h-4 w-4" />
              </Button>
            </Link>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Find or browse past conversations
          </p>
        </div>

        {/* View mode toggle */}
        <div className="p-3 border-b border-border">
          <div className="flex rounded-lg bg-muted p-1">
            <button
              onClick={() => handleViewModeChange("finder")}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                viewMode === "finder"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Search className="h-4 w-4" />
              Finder
            </button>
            <button
              onClick={() => handleViewModeChange("browse")}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                viewMode === "browse"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Layers className="h-4 w-4" />
              Browse
            </button>
          </div>
        </div>

        {/* Refresh section (shown in browse mode) */}
        {viewMode === "browse" && (
          <div className="p-3 border-b border-border bg-muted/30">
            <Button
              onClick={handleRefreshStacks}
              disabled={isRefreshing || isLoading}
              className="w-full gap-2"
              size="sm"
            >
              {isRefreshing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="truncate">
                    {refreshProgress || "Refreshing..."}
                  </span>
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Refresh Stacks
                  {recentCount > 0 && (
                    <span className="ml-1 bg-primary-foreground/20 px-1.5 py-0.5 rounded text-[10px]">
                      {recentCount}
                    </span>
                  )}
                </>
              )}
            </Button>
            <div className="mt-2 space-y-0.5">
              <p className="text-[10px] text-muted-foreground text-center">
                {formatLastRefresh(stacksMeta?.lastRefreshAt ?? null)}
              </p>
              <p className="text-[10px] text-muted-foreground/60 text-center">
                Runs daily in background
              </p>
            </div>
          </div>
        )}

        {/* Category list (shown in browse mode) */}
        {viewMode === "browse" && (
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {/* All chats option */}
              <button
                onClick={() => setSelectedCategory(null)}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors",
                  selectedCategory === null
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  <span>All Chats</span>
                </div>
                <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
                  {totalCount}
                </span>
              </button>

              {/* Separator */}
              <div className="h-px bg-border my-2" />

              {/* Category buttons */}
              {STORED_CHAT_CATEGORIES.map((category) => {
                const count = categoryCounts[category] || 0
                const isSelected = selectedCategory === category
                const isRecent = category === "recent"

                return (
                  <button
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors",
                      isSelected
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      isRecent && count > 0 && !isSelected && "text-foreground"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {CATEGORY_ICON_MAP[category]}
                      <span>{CATEGORY_LABELS[category]}</span>
                    </div>
                    <span
                      className={cn(
                        "text-xs px-1.5 py-0.5 rounded",
                        isRecent && count > 0
                          ? "bg-primary/20 text-primary"
                          : "bg-muted"
                      )}
                    >
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>
          </ScrollArea>
        )}

        {/* Finder mode sidebar content */}
        {viewMode === "finder" && (
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-4">
              <div className="text-sm text-muted-foreground">
                <p className="mb-3">
                  Type in the main area to find a past conversation using natural language.
                </p>
                <div className="space-y-2 text-xs">
                  <p className="font-medium text-foreground">Examples:</p>
                  <p>&bull; &quot;Find my chat about React hooks&quot;</p>
                  <p>&bull; &quot;Where did we discuss the API?&quot;</p>
                  <p>&bull; &quot;/find travel planning&quot;</p>
                </div>
              </div>

              <div className="h-px bg-border" />

              <div className="text-xs text-muted-foreground/70">
                <p className="font-medium text-muted-foreground mb-1">Pro tip:</p>
                <p>
                  Use <code className="bg-muted px-1 rounded">/find</code> for direct
                  search without intent detection.
                </p>
              </div>

              {/* Quick stats */}
              <div className="h-px bg-border" />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Total chats</span>
                <span className="font-medium">{totalCount}</span>
              </div>
              {recentCount > 0 && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Uncategorized</span>
                  <span className="font-medium text-primary">{recentCount}</span>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col">
        {viewMode === "finder" ? (
          // Finder view
          <FinderView
            currentChatId={currentChatId}
            currentChat={selectedThread}
            onOpenChat={handleOpenChat}
            isLoadingChat={isLoadingThread}
          />
        ) : (
          // Browse view (existing stacks UI)
          <>
            {/* Search bar */}
            <div className="p-4 border-b border-border">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search all conversations..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-9"
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
              {searchQuery && (
                <p className="text-xs text-muted-foreground mt-2">
                  Searching all conversations (global search)
                </p>
              )}
            </div>

            {/* Content split view */}
            <div className="flex-1 flex overflow-hidden">
              {/* Thread list */}
              <div className="w-80 border-r border-border flex flex-col">
                <ScrollArea className="flex-1">
                  {isLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : filteredThreads.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                      <div className="rounded-full bg-muted p-3 mb-3">
                        <MessageSquare className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <p className="text-sm font-medium">No conversations</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {searchQuery
                          ? "No results match your search"
                          : selectedCategory
                          ? `No ${CATEGORY_LABELS[selectedCategory].toLowerCase()} chats yet`
                          : "Start a chat in Demo 1 to see it here"}
                      </p>
                    </div>
                  ) : (
                    <div className="p-2 space-y-1">
                      {filteredThreads.map((thread) => (
                        <div
                          key={thread.id}
                          className={cn(
                            "relative rounded-lg transition-colors group",
                            currentChatId === thread.id
                              ? "bg-primary/10"
                              : "hover:bg-muted"
                          )}
                        >
                          <button
                            onClick={() => handleSelectThread(thread.id)}
                            className="w-full text-left px-3 py-3 pr-10"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={cn(
                                      "text-sm font-medium truncate",
                                      currentChatId === thread.id
                                        ? "text-primary"
                                        : "text-foreground"
                                    )}
                                  >
                                    {thread.title}
                                  </span>
                                </div>
                                {thread.summary && (
                                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                                    {thread.summary}
                                  </p>
                                )}
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-[10px] text-muted-foreground/70">
                                    {formatRelativeTime(thread.updatedAt)}
                                  </span>
                                  <span className="text-[10px] px-1.5 py-0.5 bg-muted rounded text-muted-foreground">
                                    {CATEGORY_LABELS[thread.category]}
                                  </span>
                                </div>
                              </div>
                              <ChevronRight
                                className={cn(
                                  "h-4 w-4 shrink-0 transition-colors mt-1",
                                  currentChatId === thread.id
                                    ? "text-primary"
                                    : "text-muted-foreground/50 group-hover:text-muted-foreground"
                                )}
                              />
                            </div>
                          </button>

                          {/* More menu */}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                className={cn(
                                  "absolute right-2 top-3 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity",
                                  "hover:bg-muted-foreground/10"
                                )}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger>
                                  <RefreshCw className="h-3 w-3 mr-2" />
                                  Move to stack
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent>
                                  {STORED_CHAT_CATEGORIES.map((category) => (
                                    <DropdownMenuItem
                                      key={category}
                                      onClick={() =>
                                        handleMoveToStack(thread.id, category)
                                      }
                                      disabled={thread.category === category}
                                    >
                                      {CATEGORY_ICON_SMALL[category]}
                                      <span className="ml-2">
                                        {CATEGORY_LABELS[category]}
                                      </span>
                                      {thread.category === category && (
                                        <span className="ml-auto text-[10px] text-muted-foreground">
                                          Current
                                        </span>
                                      )}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleSelectThread(thread.id)}
                              >
                                <MessageSquare className="h-3 w-3 mr-2" />
                                View transcript
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </div>

              {/* Transcript view */}
              <div className="flex-1 flex flex-col bg-muted/30">
                {currentChatId ? (
                  isLoadingThread ? (
                    <div className="flex-1 flex items-center justify-center">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : selectedThread ? (
                    <>
                      {/* Thread header */}
                      <div className="p-4 border-b border-border bg-background">
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <h2 className="font-semibold truncate">
                              {selectedThread.title}
                            </h2>
                            <div className="flex items-center gap-2 mt-0.5">
                              <p className="text-xs text-muted-foreground">
                                {formatDate(selectedThread.createdAt)} &bull;{" "}
                                {selectedThread.messages.length} messages
                              </p>
                              <span className="text-[10px] px-1.5 py-0.5 bg-muted rounded text-muted-foreground">
                                {CATEGORY_LABELS[selectedThread.category]}
                              </span>
                            </div>
                            {selectedThread.summary && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                {selectedThread.summary}
                              </p>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleCloseTranscript}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      {/* Messages */}
                      <ScrollArea className="flex-1">
                        <div className="p-4 space-y-4">
                          {selectedThread.messages.map((message) => (
                            <div
                              key={message.id}
                              className={cn(
                                "flex",
                                message.role === "user"
                                  ? "justify-end"
                                  : "justify-start"
                              )}
                            >
                              <div
                                className={cn(
                                  "max-w-[80%] rounded-2xl px-4 py-3",
                                  message.role === "user"
                                    ? "bg-primary text-primary-foreground rounded-br-md"
                                    : message.role === "context"
                                    ? "bg-warning/10 text-foreground border border-warning/20 rounded-bl-md"
                                    : "bg-card text-card-foreground border border-border rounded-bl-md"
                                )}
                              >
                                {message.role === "context" && (
                                  <div className="text-[10px] uppercase tracking-[0.08em] text-warning-foreground dark:text-warning font-medium mb-1">
                                    CONTEXT
                                  </div>
                                )}
                                <p className="text-sm whitespace-pre-wrap">
                                  {message.text}
                                </p>
                                <p
                                  className={cn(
                                    "text-[10px] mt-1",
                                    message.role === "user"
                                      ? "text-primary-foreground/70"
                                      : "text-muted-foreground/70"
                                  )}
                                >
                                  {formatRelativeTime(message.createdAt)}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </>
                  ) : (
                    <div className="flex-1 flex items-center justify-center">
                      <p className="text-muted-foreground">Thread not found</p>
                    </div>
                  )
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                    <div className="rounded-full bg-muted p-4 mb-4">
                      <MessageSquare className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <h3 className="text-lg font-medium mb-2">
                      Select a conversation
                    </h3>
                    <p className="text-sm text-muted-foreground max-w-sm">
                      Choose a conversation from the list to view its transcript.
                      Click &quot;Refresh Stacks&quot; to organize recent chats with
                      AI.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
      </div>
    </div>
  )
}

/**
 * Demo 2: Chat History with Finder-first UX
 *
 * Features:
 * - Finder view (default): Conversational retrieval using /api/chats/intent and /api/chats/find
 * - Browse view: Existing stacks UI for browsing categorized chats
 * - URL-based navigation: /demos/history?chatId=xxx&view=browse
 */
export default function HistoryDemo() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <HistoryDemoContent />
    </Suspense>
  )
}

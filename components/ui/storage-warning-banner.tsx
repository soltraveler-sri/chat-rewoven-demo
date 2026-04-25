"use client"

import { useState, useEffect } from "react"
import { AlertTriangle, X, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"

interface StorageStatus {
  storageType: "kv" | "memory"
  kvConfigured: boolean
  mode?: "redis" | "memory"
  backend?: "upstash" | "vercel_kv" | "memory"
  healthy?: boolean
  connectivity?: "ok" | "error" | "timeout" | "not_configured"
  warning?: string
}

interface StorageWarningBannerProps {
  className?: string
}

/**
 * A compact inline warning banner that shows when storage is running
 * in memory mode (without Redis configured).
 *
 * Fetches /api/storage on mount and shows a dismissible warning if
 * mode !== "redis", or Redis is configured but the health check fails.
 */
export function StorageWarningBanner({ className }: StorageWarningBannerProps) {
  const [status, setStatus] = useState<StorageStatus | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function fetchStatus() {
      try {
        const res = await fetch("/api/storage")
        if (res.ok) {
          const data = await res.json()
          setStatus(data)
        }
      } catch (error) {
        console.error("Failed to fetch storage status:", error)
      } finally {
        setIsLoading(false)
      }
    }
    fetchStatus()
  }, [])

  // Don't show anything while loading or if dismissed
  if (isLoading || dismissed) {
    return null
  }

  // Don't show if Redis is configured and reachable.
  const storageLooksHealthy =
    (status?.mode === "redis" || status?.storageType === "kv") &&
    status?.healthy !== false

  if (!status || storageLooksHealthy) {
    return null
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2 text-sm bg-amber-500/10 border border-amber-500/20 rounded-lg",
        className
      )}
    >
      <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
      <span className="flex-1 text-amber-700 dark:text-amber-300 text-xs">
        {status.warning ||
          "Storage is running in demo-local mode. History may reset on refresh."}
        <a
          href="https://vercel.com/docs/storage/vercel-redis"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 ml-1 underline underline-offset-2 hover:text-amber-600 dark:hover:text-amber-200"
        >
          Configure Redis
          <ExternalLink className="h-3 w-3" />
        </a>
      </span>
      <button
        onClick={() => setDismissed(true)}
        className="p-0.5 rounded hover:bg-amber-500/20 text-amber-600 dark:text-amber-400"
        aria-label="Dismiss warning"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

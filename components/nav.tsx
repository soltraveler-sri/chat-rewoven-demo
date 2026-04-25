"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import {
  GitBranch,
  History,
  Terminal,
  Sun,
  Moon,
  Database,
  HardDrive,
  AlertTriangle,
  ChevronDown,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

const demoItems = [
  {
    href: "/demos/branches",
    label: "Branches",
    icon: GitBranch,
  },
  {
    href: "/demos/history",
    label: "History",
    icon: History,
  },
  {
    href: "/demos/codex",
    label: "Codex",
    icon: Terminal,
  },
]

interface StorageInfo {
  type: "kv" | "memory" | "error"
  available: boolean
  message: string
}

/**
 * API response shape from /api/storage
 */
interface StorageApiResponse {
  storageType?: "kv" | "memory"
  kvConfigured?: boolean
  healthy?: boolean
  connectivity?: "ok" | "error" | "timeout" | "not_configured"
  warning?: string
}

/**
 * Safely convert API response to StorageInfo format
 */
function parseStorageResponse(data: StorageApiResponse): StorageInfo {
  const storageType = data?.storageType
  const configuredButUnhealthy = data?.kvConfigured && data?.healthy === false
  const type: StorageInfo["type"] = configuredButUnhealthy
    ? "error"
    : storageType === "kv" || storageType === "memory"
      ? storageType
      : "error"

  return {
    type,
    available: Boolean(data?.kvConfigured && data?.healthy !== false),
    message:
      data?.warning ??
      (type === "kv"
        ? "Using Redis/KV for persistent storage."
        : type === "memory"
          ? "Using in-memory store. Data may reset."
          : data?.connectivity
            ? `Storage check failed: ${data.connectivity}.`
            : "Unable to determine storage status."),
  }
}

function StorageIndicator() {
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null)

  useEffect(() => {
    fetch("/api/storage")
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        return res.json()
      })
      .then((data: StorageApiResponse) => {
        setStorageInfo(parseStorageResponse(data))
      })
      .catch(() =>
        setStorageInfo({
          type: "error",
          available: false,
          message: "Failed to fetch storage status",
        })
      )
  }, [])

  if (!storageInfo) {
    return null
  }

  const getIcon = () => {
    switch (storageInfo.type) {
      case "kv":
        return <Database className="h-3.5 w-3.5" />
      case "memory":
        return <HardDrive className="h-3.5 w-3.5" />
      case "error":
        return <AlertTriangle className="h-3.5 w-3.5" />
    }
  }

  const getLabel = () => {
    switch (storageInfo.type) {
      case "kv":
        return "KV"
      case "memory":
        return "Dev"
      case "error":
        return "Error"
    }
  }

  const getColorClass = () => {
    switch (storageInfo.type) {
      case "kv":
        return "text-green-600 dark:text-green-400"
      case "memory":
        return "text-amber-600 dark:text-amber-400"
      case "error":
        return "text-red-600 dark:text-red-400"
    }
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md border border-border/50 bg-muted/50",
              getColorClass()
            )}
          >
            {getIcon()}
            <span>{getLabel()}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <p className="font-medium">
            Storage: {(storageInfo.type ?? "unknown").toUpperCase()}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {storageInfo.message ?? "No additional information."}
          </p>
          {storageInfo.type === "error" && (
            <p className="text-xs text-muted-foreground mt-2">
              See README for setup instructions.
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function Nav() {
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()

  // Check if current page is one of the individual demos
  const isOnDemoPage = demoItems.some((item) => pathname === item.href)
  const currentDemo = demoItems.find((item) => pathname === item.href)

  return (
    <nav className="flex items-center justify-between px-6 py-4 border-b border-border/50">
      <div className="flex items-center gap-1">
        <Link
          href="/"
          className="text-lg font-semibold tracking-tight mr-6 hover:text-muted-foreground transition-colors"
        >
          LLM Chat Demos
        </Link>
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={isOnDemoPage ? "secondary" : "ghost"}
                size="sm"
                className={cn("gap-2", isOnDemoPage && "bg-secondary")}
              >
                {currentDemo ? (
                  <>
                    <currentDemo.icon className="h-4 w-4" />
                    {currentDemo.label}
                  </>
                ) : (
                  "Demos"
                )}
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {demoItems.map((item) => {
                const isActive = pathname === item.href
                return (
                  <DropdownMenuItem key={item.href} asChild>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2 cursor-pointer",
                        isActive && "bg-accent"
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <StorageIndicator />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="h-8 w-8"
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </div>
    </nav>
  )
}

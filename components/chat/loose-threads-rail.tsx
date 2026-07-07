"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Check,
  Code,
  FileAudio,
  GitBranch,
  Github,
  Search,
  Sparkles,
  TextQuote,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  getWovenThreads,
  WOVEN_THREADS_EVENT,
  type WovenThreadKey,
} from "@/lib/onboarding/progress"

const RAIL_HIDDEN_KEY = "cr:rail-hidden"
const RAIL_PULSED_KEY = "cr:rail-pulsed"

type RailAction = "branch" | "find" | "codex" | "doc" | "assistant"

const ROWS: Array<{
  key: WovenThreadKey
  action: RailAction
  name: string
  whisper: string
  icon: typeof GitBranch
}> = [
  {
    key: "branch_merge",
    action: "branch",
    name: "Branch & merge",
    whisper: "Explore a side path, then weave it back.",
    icon: GitBranch,
  },
  {
    key: "find",
    action: "find",
    name: "Find a past chat",
    whisper: "Recover the telescope thread from history.",
    icon: Search,
  },
  {
    key: "codex",
    action: "codex",
    name: "Run a Codex task",
    whisper: "Send a small implementation request.",
    icon: Code,
  },
  {
    key: "doc_audio",
    action: "doc",
    name: "Hear a document",
    whisper: "Attach the sample essay and read it aloud.",
    icon: FileAudio,
  },
  {
    key: "assistant",
    action: "assistant",
    name: "Ask the Assistant",
    whisper: "Let it look across loose ends.",
    icon: Sparkles,
  },
]

export function LooseThreadsRail({
  onStage,
  prereqNotice,
  onDismissPrereqNotice,
}: {
  onStage: (action: RailAction) => void
  prereqNotice?: string | null
  onDismissPrereqNotice?: () => void
}) {
  const [isMounted, setIsMounted] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [isHidden, setIsHidden] = useState(false)
  const [shouldPulse, setShouldPulse] = useState(false)
  const [woven, setWoven] = useState<Set<WovenThreadKey>>(() => new Set())

  useEffect(() => {
    const update = () => setWoven(getWovenThreads())
    const mountTimer = window.setTimeout(() => {
      setIsMounted(true)
      setIsHidden(window.localStorage.getItem(RAIL_HIDDEN_KEY) === "1")
      update()

      const hasPulsed = window.localStorage.getItem(RAIL_PULSED_KEY) === "1"
      if (!hasPulsed) {
        setShouldPulse(true)
        window.localStorage.setItem(RAIL_PULSED_KEY, "1")
      }
    }, 0)

    window.addEventListener(WOVEN_THREADS_EVENT, update)
    window.addEventListener("storage", update)
    return () => {
      window.clearTimeout(mountTimer)
      window.removeEventListener(WOVEN_THREADS_EVENT, update)
      window.removeEventListener("storage", update)
    }
  }, [])

  const completedCount = woven.size
  const isComplete = completedCount === ROWS.length

  const label = useMemo(
    () => (isComplete ? "Woven · 5/5" : `Threads · ${completedCount}/5`),
    [completedCount, isComplete]
  )

  if (!isMounted || isHidden) return null

  return (
    <div className="relative">
      <Button
        type="button"
        variant={isOpen ? "secondary" : "outline"}
        size="sm"
        className={cn(
          "gap-1.5 border-l-2 border-l-thread",
          isComplete && "border-success/30 bg-success/10 text-success hover:bg-success/15",
          shouldPulse && "animate-thread-pill-pulse"
        )}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <TextQuote className="h-4 w-4" />
        {label}
      </Button>

      {isOpen && (
        <div className="absolute right-0 top-full z-40 mt-2 w-[420px] overflow-hidden rounded-xl border border-border border-l-2 border-l-thread bg-card shadow-[0_2px_16px_rgba(0,0,0,0.04)] dark:shadow-black/30">
          <div className="border-b border-border/60 bg-accent-soft/40 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Loose threads</h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {isComplete
                    ? "All five woven. The rest is just chat — which is the point."
                    : "Five real moves that show what this chat can hold."}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => setIsOpen(false)}
                aria-label="Close loose threads"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            {isComplete && (
              <a
                href="https://github.com/soltraveler-sri/chat-rewoven-demo"
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                <Github className="h-3.5 w-3.5" />
                View the code
              </a>
            )}
          </div>

          <div className="space-y-1 p-2.5">
            {ROWS.map((row) => {
              const Icon = row.icon
              const isWoven = woven.has(row.key)
              return (
                <button
                  key={row.key}
                  type="button"
                  onClick={() => onStage(row.action)}
                  className={cn(
                    "group flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                    "border border-transparent hover:border-thread/30 hover:bg-accent-soft/35 focus:outline-none focus:ring-2 focus:ring-ring/30"
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-muted-foreground",
                      isWoven && "bg-success/10 text-success"
                    )}
                  >
                    {isWoven ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">
                      {row.name}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                      {row.whisper}
                    </span>
                  </span>
                </button>
              )
            })}

            {prereqNotice && (
              <div className="mx-1 mt-2 rounded-lg border border-border/50 border-l-2 border-l-thread bg-accent-soft/35 px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <p className="flex-1 text-xs leading-relaxed text-muted-foreground">
                    {prereqNotice}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={onDismissPrereqNotice}
                    aria-label="Dismiss notice"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-border/60 px-3 py-2.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={() => {
                window.localStorage.setItem(RAIL_HIDDEN_KEY, "1")
                setIsHidden(true)
                setIsOpen(false)
              }}
            >
              Hide this
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

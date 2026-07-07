"use client"

import {
  Clock,
  Briefcase,
  Code,
  MessageCircle,
  User,
  Plane,
  ShoppingCart,
  ArrowRight,
  Loader2,
  CheckCircle2,
  Circle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { StoredChatCategory } from "@/lib/store/types"
import { CATEGORY_LABELS } from "@/lib/store/types"

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

/**
 * Get confidence label and styling based on confidence score
 */
function getConfidenceDisplay(confidence: number): {
  label: string
  className: string
  icon: React.ReactNode
} {
  if (confidence >= 0.85) {
    return {
      label: "High match",
      className: "text-success",
      icon: <CheckCircle2 className="h-3 w-3" />,
    }
  }
  if (confidence >= 0.6) {
    return {
      label: "Good match",
      className: "text-foreground/80",
      icon: <Circle className="h-3 w-3" />,
    }
  }
  return {
    label: "Possible match",
    className: "text-muted-foreground",
    icon: <Circle className="h-3 w-3" />,
  }
}

export interface FinderOption {
  chatId: string
  title: string
  summary: string
  updatedAt: number
  confidence: number
  why: string
  category?: StoredChatCategory
}

interface FinderOptionCardProps {
  option: FinderOption
  onClick: () => void
  isOpening?: boolean
  disabled?: boolean
}

/**
 * A polished card for displaying a chat finder result.
 * Shows title, summary, confidence indicator, updated time, and Open button.
 */
export function FinderOptionCard({
  option,
  onClick,
  isOpening = false,
  disabled = false,
}: FinderOptionCardProps) {
  const confidenceDisplay = getConfidenceDisplay(option.confidence)

  return (
    <button
      onClick={onClick}
      disabled={disabled || isOpening}
      className={cn(
        "group w-full text-left p-4 rounded-lg transition-all duration-200",
        "border-l-2 border-l-thread bg-card hover:bg-accent-soft/40",
        "focus:outline-none focus:ring-2 focus:ring-ring/40",
        isOpening && "bg-accent-soft/60",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Title */}
          <h4 className="font-medium text-foreground truncate">
            {option.title}
          </h4>

          {/* Summary (1-2 lines) */}
          {option.summary && (
            <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
              {option.summary}
            </p>
          )}

          {/* Why it matches (from LLM) */}
          {option.why && (
            <p className="text-xs text-muted-foreground/80 italic mt-1.5 line-clamp-1">
              &ldquo;{option.why}&rdquo;
            </p>
          )}

          {/* Metadata row */}
          <div className="flex items-center gap-3 mt-2">
            {/* Confidence indicator */}
            <span
              className={cn(
                "inline-flex items-center gap-1 text-xs font-medium",
                confidenceDisplay.className
              )}
            >
              {confidenceDisplay.icon}
              {confidenceDisplay.label}
            </span>

            {/* Category badge */}
            {option.category && (
              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-muted rounded text-muted-foreground">
                {CATEGORY_ICON_MAP[option.category]}
                {CATEGORY_LABELS[option.category]}
              </span>
            )}

            {/* Updated time */}
            <span className="text-[10px] text-muted-foreground/70">
              {formatRelativeTime(option.updatedAt)}
            </span>
          </div>
        </div>

        {/* Open button / Opening state */}
        <div
          className={cn(
            "shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
            isOpening
              ? "bg-accent-soft text-primary"
              : "bg-secondary text-secondary-foreground group-hover:bg-accent-soft group-hover:text-primary"
          )}
        >
          {isOpening ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Opening...</span>
            </>
          ) : (
            <>
              <span>Open</span>
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </div>
      </div>
    </button>
  )
}

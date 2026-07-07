"use client"

import { GitBranch, GitMerge, ChevronDown, Zap, Brain, Check } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { BranchThread } from "@/lib/types"

interface BranchChipProps {
  branches: BranchThread[]
  onOpenBranch: (branchId: string) => void
}

export function BranchChip({ branches, onOpenBranch }: BranchChipProps) {
  if (branches.length === 0) return null

  // Single branch: show a compact pill
  if (branches.length === 1) {
    const branch = branches[0]
    return (
      <button
        onClick={() => onOpenBranch(branch.id)}
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full",
          "text-xs font-medium",
          "transition-all duration-200 cursor-pointer",
          "border animate-chip-in",
          branch.mergedIntoMain
            ? "bg-success/10 hover:bg-success/15 border-success/30 text-success"
            : "bg-muted/80 hover:bg-muted border-border/50"
        )}
      >
        {branch.mergedIntoMain ? (
          <GitMerge className="h-3 w-3" />
        ) : (
          <GitBranch className="h-3 w-3 text-muted-foreground" />
        )}
        <span className="max-w-[120px] truncate">{branch.title}</span>
        {branch.mergedIntoMain ? (
          <MergedIndicator />
        ) : (
          <ModeIndicator mode={branch.mode} />
        )}
      </button>
    )
  }

  // Multiple branches: show dropdown
  const mergedCount = branches.filter((b) => b.mergedIntoMain).length

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full",
            "text-xs font-medium",
            "transition-all duration-200 cursor-pointer",
            "border animate-chip-in",
            mergedCount > 0
              ? "bg-success/10 hover:bg-success/15 border-success/30"
              : "bg-muted/80 hover:bg-muted border-border/50"
          )}
        >
          {mergedCount > 0 ? (
            <GitMerge className="h-3 w-3 text-success" />
          ) : (
            <GitBranch className="h-3 w-3 text-muted-foreground" />
          )}
          <span>
            {mergedCount > 0 && mergedCount < branches.length
              ? `${branches.length} branches (${mergedCount} merged)`
              : mergedCount === branches.length
              ? `${branches.length} branches (all merged)`
              : `${branches.length} branches`}
          </span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {branches.map((branch) => (
          <DropdownMenuItem
            key={branch.id}
            onClick={() => onOpenBranch(branch.id)}
            className="flex items-center gap-2 cursor-pointer"
          >
            {branch.mergedIntoMain ? (
              <GitMerge className="h-3.5 w-3.5 text-success shrink-0" />
            ) : (
              <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            )}
            <span className="truncate flex-1">{branch.title}</span>
            {branch.mergedIntoMain ? (
              <MergedIndicator />
            ) : (
              <ModeIndicator mode={branch.mode} />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Small mode indicator pill
function ModeIndicator({ mode }: { mode: "fast" | "deep" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px]",
        mode === "fast"
          ? "bg-warning/15 text-warning"
          : "bg-muted text-muted-foreground"
      )}
    >
      {mode === "fast" ? (
        <Zap className="h-2.5 w-2.5" />
      ) : (
        <Brain className="h-2.5 w-2.5" />
      )}
    </span>
  )
}

// Merged indicator
function MergedIndicator() {
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] bg-success/20 text-success">
      <Check className="h-2.5 w-2.5" />
    </span>
  )
}

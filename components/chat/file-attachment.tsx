"use client"

import { FileText, X, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface FileAttachmentChipProps {
  filename: string
  /** Show loading state while file is being processed */
  isProcessing?: boolean
  onRemove?: () => void
  className?: string
}

export function FileAttachmentChip({
  filename,
  isProcessing = false,
  onRemove,
  className,
}: FileAttachmentChipProps) {
  const ext = filename.split(".").pop()?.toUpperCase() || "FILE"

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg",
        "bg-secondary border border-border/50 text-sm",
        className
      )}
    >
      {isProcessing ? (
        <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" />
      ) : (
        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
      )}
      <span className="text-xs font-medium truncate max-w-[180px]">
        {filename}
      </span>
      <span className="text-[10px] text-muted-foreground uppercase">
        {ext}
      </span>
      {onRemove && !isProcessing && (
        <Button
          variant="ghost"
          size="icon"
          className="h-4 w-4 p-0 hover:bg-accent rounded-full ml-0.5"
          onClick={onRemove}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  )
}

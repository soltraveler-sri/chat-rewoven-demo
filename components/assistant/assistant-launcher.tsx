"use client"

import { useState } from "react"
import { Compass } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AssistantPopup } from "@/components/assistant/assistant-popup"
import type { AssistantTaskResult } from "@/lib/assistant/types"

interface AssistantLauncherProps {
  onRunTask: (
    request: string,
    options?: { taskId?: string; previousTask?: AssistantTaskResult | null }
  ) => Promise<AssistantTaskResult>
  onLoadSampleWorkspace: () => void
  onOpenChat?: (chatId: string) => void
  onInsertPrompt?: (prompt: string) => void
}

export function AssistantLauncher({
  onRunTask,
  onLoadSampleWorkspace,
  onOpenChat,
  onInsertPrompt,
}: AssistantLauncherProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="relative">
      <Button
        type="button"
        variant={isOpen ? "secondary" : "outline"}
        size="sm"
        className="gap-1.5"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <Compass className="h-4 w-4" />
        Assistant
      </Button>
      {isOpen && (
        <AssistantPopup
          onClose={() => setIsOpen(false)}
          onRunTask={onRunTask}
          onLoadSampleWorkspace={onLoadSampleWorkspace}
          onOpenChat={onOpenChat}
          onInsertPrompt={onInsertPrompt}
        />
      )}
    </div>
  )
}

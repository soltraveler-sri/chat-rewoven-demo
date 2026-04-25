import type { StoredChatCategory } from "@/lib/store/types"

export type AssistantTaskStatus =
  | "queued"
  | "interpreting"
  | "searching"
  | "reviewing"
  | "generating"
  | "ready"
  | "failed"
  | "no_results"

export type AssistantTaskKind =
  | "cross_chat_artifact"
  | "open_loops"
  | "current_chat_help"
  | "codex_prompt_draft"
  | "clarification"

export type AssistantArtifactKind = "csv" | "markdown" | "text" | "html"

export interface AssistantSource {
  chatId: string
  title: string
  updatedAt?: number
  reason: string
  snippet: string
  confidence?: number
}

export interface AssistantArtifact {
  kind: AssistantArtifactKind
  filename: string
  mimeType: string
  content: string
  rowCount?: number
  sizeLabel?: string
}

export interface AssistantProposedAction {
  id: string
  label: string
  type:
    | "open_chat"
    | "summarize_left_off"
    | "draft_prompt"
    | "copy_codex_prompt"
    | "insert_codex_prompt"
    | "download_artifact"
    | "dismiss"
  chatId?: string
  prompt?: string
}

export interface AssistantOpenLoopItem {
  id: string
  chatTitle: string
  chatId: string
  lastUpdated?: number
  reason: string
  nextAction: string
  canAssistantHelp: boolean
  suggestedAction: string
  draftCodexPrompt?: string
  snippet?: string
  confidence: number
}

export interface AssistantTaskResult {
  id: string
  createdAt: number
  updatedAt: number
  status: AssistantTaskStatus
  requestText: string
  interpretedGoal: string
  taskKind: AssistantTaskKind
  progress: AssistantTaskStatus[]
  sources: AssistantSource[]
  resultSummary: string
  artifact?: AssistantArtifact
  openLoops?: AssistantOpenLoopItem[]
  proposedActions: AssistantProposedAction[]
  missingInfo?: string[]
  reviewedChatCount: number
  error?: string
}

export interface AssistantChatMessageInput {
  id?: string
  role: string
  text: string
  createdAt?: number
  taskId?: string
  isTaskCard?: boolean
}

export interface AssistantChatThreadInput {
  id: string
  title: string
  summary?: string
  category?: StoredChatCategory | string
  createdAt: number
  updatedAt: number
  messages: AssistantChatMessageInput[]
}

export interface AssistantRunRequest {
  request: string
  clientTaskId?: string
  localThreads?: AssistantChatThreadInput[]
  currentThread?: AssistantChatThreadInput | null
  previousTask?: Pick<
    AssistantTaskResult,
    "requestText" | "interpretedGoal" | "taskKind" | "resultSummary" | "sources"
  > | null
}

export interface AssistantRunResponse {
  task: AssistantTaskResult
}

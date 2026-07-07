/**
 * Chat message types for the LLM Chat Demo
 */

/**
 * Context message metadata - for context cards injected into main thread
 */
export interface ContextMetadata {
  /** The branch ID this context came from */
  branchId: string
  /** The branch title */
  branchTitle: string
  /** Whether it was a summary or full merge */
  mergeType: "summary" | "full"
}

export interface ChatMessage {
  /** Unique local identifier (UUID) */
  localId: string
  /** Message role */
  role: "user" | "assistant" | "context"
  /** Message text content */
  text: string
  /** Timestamp (Unix ms) */
  createdAt: number
  /** OpenAI response ID - only present for assistant messages */
  responseId?: string
  /** Context metadata - only present for context messages */
  contextMeta?: ContextMetadata
  /** Audio URL for TTS playback - only present for doc-read assistant messages */
  audioUrl?: string
  /** Audio metadata for doc-read messages */
  audioMeta?: {
    /** Voice used, when known — the server owns the default */
    voice?: string
    filename: string
  }
}

export interface MainThreadState {
  /** All messages in the main thread */
  messages: ChatMessage[]
  /** The response ID of the last assistant message (for chaining) */
  lastResponseId: string | null
}

/**
 * Branch thread model - represents a side conversation forked from an assistant message
 *
 * NOTE: "No nesting" - you cannot create a branch from inside a branch (no branch-of-branch).
 * This is a deliberate limitation to keep the mental model simple.
 */
export interface BranchThread {
  /** Unique identifier (UUID) */
  id: string
  /** The localId of the parent assistant message in main thread */
  parentAssistantLocalId: string
  /** The responseId of the parent assistant message (fork point) */
  parentAssistantResponseId: string
  /** Branch title (e.g., "Branch 1" or derived from first user message) */
  title: string
  /** Creation timestamp (Unix ms) */
  createdAt: number
  /** Last update timestamp (Unix ms) */
  updatedAt: number
  /** Response mode for this branch */
  mode: "fast" | "deep"
  /** Whether to include this branch in main chat context (UI toggle) */
  includeInMain: boolean
  /** How to include in main: summary or full (advanced control) */
  includeMode: "summary" | "full"
  /** Messages within this branch */
  messages: ChatMessage[]
  /** The response ID of the last assistant message in this branch (for chaining) */
  lastResponseId: string | null
  /** Whether this branch has been merged into main */
  mergedIntoMain: boolean
  /** How it was merged (if merged) */
  mergedAs?: "summary" | "full"
  /** Timestamp when merged */
  mergedAt?: number
}

/**
 * API request/response types
 */
export interface RespondRequest {
  input: string
  previous_response_id?: string | null
  mode?: "fast" | "deep"
}

export interface RespondResponse {
  id: string
  output_text: string
}

export interface SummarizeRequest {
  branchMessages: Array<{ role: "user" | "assistant"; text: string }>
  maxBullets?: number
}

export interface SummarizeResponse {
  summary: string
}

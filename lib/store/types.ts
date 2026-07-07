/**
 * Store types for chat persistence (Demo 2/3)
 *
 * IMPORTANT: These types are SEPARATE from Demo 1's ChatMessage/BranchThread
 * to avoid conflicts. Do NOT modify lib/types.ts.
 */

/**
 * Categories for organizing stored chats in the Smart Stacks UI
 */
export type StoredChatCategory =
  | "recent"
  | "professional"
  | "coding"
  | "short_qa"
  | "personal"
  | "travel"
  | "shopping"

/**
 * A stored chat message (simplified from Demo 1's ChatMessage)
 */
export interface StoredChatMessage {
  /** Unique message ID */
  id: string
  /** Message role */
  role: "user" | "assistant" | "context"
  /** Message text content */
  text: string
  /** Creation timestamp (Unix ms) */
  createdAt: number
  /** OpenAI response ID (for assistant messages) */
  responseId?: string
  /** Task ID if this is a task card message */
  taskId?: string
  /** Whether this is a task card (renders TaskCard instead of bubble) */
  isTaskCard?: boolean
  /** Context metadata for branch merge context messages */
  contextMeta?: {
    branchId: string
    branchTitle: string
    mergeType: "summary" | "full"
  }
  /** Audio metadata for doc-read assistant messages */
  audioMeta?: {
    filename: string
    docText?: string
  }
}

/**
 * A stored chat thread with metadata for history/stacks
 */
export interface StoredChatThread {
  /** Unique thread ID */
  id: string
  /** Thread title (auto-generated or user-set) */
  title: string
  /** Category for Smart Stacks organization */
  category: StoredChatCategory
  /** Optional summary of the conversation */
  summary?: string
  /** Creation timestamp (Unix ms) */
  createdAt: number
  /** Last update timestamp (Unix ms) */
  updatedAt: number
  /** Last OpenAI response ID in the thread (for chaining) */
  lastResponseId?: string | null
  /** All messages in the thread */
  messages: StoredChatMessage[]
}

/**
 * Metadata for Smart Stacks feature
 */
export interface StacksMeta {
  /** Last time stacks were refreshed/categorized (Unix ms) */
  lastRefreshAt: number | null
  /** Category counts for the stacks UI */
  counts: Record<StoredChatCategory, number>
}

/**
 * Thread metadata (without messages) for list views
 */
export type StoredChatThreadMeta = Omit<StoredChatThread, "messages">

/**
 * All valid category values for iteration
 */
export const STORED_CHAT_CATEGORIES: StoredChatCategory[] = [
  "recent",
  "professional",
  "coding",
  "short_qa",
  "personal",
  "travel",
  "shopping",
]

/**
 * Human-readable labels for categories
 */
export const CATEGORY_LABELS: Record<StoredChatCategory, string> = {
  recent: "Recent",
  professional: "Professional",
  coding: "Coding",
  short_qa: "Short Q&A",
  personal: "Personal",
  travel: "Travel",
  shopping: "Shopping",
}

/**
 * Icons for categories (using lucide-react icon names)
 */
export const CATEGORY_ICONS: Record<StoredChatCategory, string> = {
  recent: "Clock",
  professional: "Briefcase",
  coding: "Code",
  short_qa: "MessageCircle",
  personal: "User",
  travel: "Plane",
  shopping: "ShoppingCart",
}

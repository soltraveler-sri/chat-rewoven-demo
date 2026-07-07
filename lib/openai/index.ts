/**
 * Centralized OpenAI client exports
 *
 * Usage:
 * ```typescript
 * import { createTextResponse, createParsedResponse, formatOpenAIError } from "@/lib/openai"
 *
 * // For text responses
 * const response = await createTextResponse({
 *   kind: "chat_fast",
 *   input: "Hello",
 * })
 *
 * // For structured outputs
 * const { parsed } = await createParsedResponse({
 *   kind: "intent",
 *   input: prompt,
 *   schema: IntentSchema,
 *   schemaName: "intent_result",
 * })
 * ```
 */

export {
  // Types
  type RequestKind,

  // Client
  getOpenAIClient,

  // Configuration
  getModel,
  getChainedChatModel,
  getReasoningEffort,
  getReasoningEffortFallback,
  getTextVerbosity,
  getConfigInfo,

  // Request builders
  createTextResponse,
  createTextResponseStream,
  createParsedResponse,
  createSummarizeResponse,

  // Error handling
  formatOpenAIError,

  // Response helpers
  extractTextOutput,
} from "./client"

/**
 * Centralized OpenAI client and request configuration
 *
 * This module provides:
 * - Singleton OpenAI client
 * - Request kind-based configuration (model, reasoning, verbosity)
 * - Safe parameter handling (no unsupported params)
 * - Consistent error handling
 *
 * Key principles:
 * - Reasoning effort is centrally configurable and falls back when rejected
 * - Never send temperature, top_p, or max_output_tokens
 * - Use text.verbosity for response length control
 */

import OpenAI from "openai"
import { z } from "zod"
import { zodTextFormat } from "openai/helpers/zod"

// =============================================================================
// Request Kinds
// =============================================================================

/**
 * Request kinds with pre-configured settings
 *
 * Each kind has appropriate model, reasoning effort, and verbosity defaults.
 */
export type RequestKind =
  | "chat_fast" // Fast chat responses (reasoning: low)
  | "chat_deep" // Deep chat responses (reasoning: low)
  | "summarize" // Summarization tasks (gpt-5-nano, reasoning: low)
  | "intent" // Intent classification (gpt-5-nano, reasoning: low)
  | "stacks" // Smart Stacks categorization (gpt-5-nano, reasoning: low)
  | "finder" // Chat finder reranking (gpt-5-mini, reasoning: low)
  | "codex" // Codex tasks (gpt-5.1-codex-mini, reasoning: low)
  | "assistant" // Product-level Assistant tasks (gpt-5-mini, reasoning: low)

/**
 * Request kinds that use previous_response_id chaining.
 * These MUST use store: true and the same underlying model.
 */
const CHAINED_KINDS: Set<RequestKind> = new Set(["chat_fast", "chat_deep"])

// =============================================================================
// Configuration
// =============================================================================

/**
 * Default models for each request kind
 * Note: chat_fast and chat_deep share the same model via getChainedChatModel()
 */
const DEFAULT_MODELS: Record<RequestKind, string> = {
  chat_fast: "gpt-5-mini", // Both chat kinds use the same model for chaining
  chat_deep: "gpt-5-mini", // Both chat kinds use the same model for chaining
  summarize: "gpt-5-nano",
  intent: "gpt-5-nano",
  stacks: "gpt-5-nano",
  finder: "gpt-5-mini",
  codex: "gpt-5.1-codex-mini",
  assistant: "gpt-5-mini",
}

/**
 * Environment variable names for model overrides
 * Note: summarize supports both OPENAI_SUMMARY_MODEL and OPENAI_MODEL_SUMMARIZE
 */
const MODEL_ENV_VARS: Record<RequestKind, string[]> = {
  chat_fast: ["OPENAI_MODEL_FAST"],
  chat_deep: ["OPENAI_MODEL_DEEP"],
  summarize: ["OPENAI_SUMMARY_MODEL", "OPENAI_MODEL_SUMMARIZE"],
  intent: ["OPENAI_MODEL_INTENT"],
  stacks: ["OPENAI_MODEL_STACKS"],
  finder: ["OPENAI_MODEL_FINDER"],
  codex: ["OPENAI_MODEL_CODEX"],
  assistant: ["OPENAI_MODEL_ASSISTANT", "OPENAI_ASSISTANT_MODEL"],
}

// Track if we've already warned about model mismatch (to avoid spamming logs)
let chainedModelWarningLogged = false

/**
 * Get the unified model for chained chat requests.
 *
 * This ensures chat_fast and chat_deep use the SAME underlying model,
 * which is required for previous_response_id chaining to work reliably.
 *
 * Priority:
 * 1. OPENAI_MODEL_CHAT (explicit unified override)
 * 2. OPENAI_MODEL_DEEP (prefer the "deep" model for quality)
 * 3. OPENAI_MODEL_FAST (fallback)
 * 4. Default: gpt-5-mini
 */
export function getChainedChatModel(): string {
  // Priority 1: Explicit unified chat model
  const chatModel = process.env.OPENAI_MODEL_CHAT
  if (chatModel) {
    return chatModel
  }

  const fastModel = process.env.OPENAI_MODEL_FAST
  const deepModel = process.env.OPENAI_MODEL_DEEP

  // If both are configured differently, warn and use deep model
  if (fastModel && deepModel && fastModel !== deepModel) {
    if (!chainedModelWarningLogged) {
      console.warn(
        `[OpenAI] Warning: OPENAI_MODEL_FAST (${fastModel}) != OPENAI_MODEL_DEEP (${deepModel}). ` +
        `Using ${deepModel} for both to ensure previous_response_id chaining works. ` +
        `Set OPENAI_MODEL_CHAT to explicitly configure the unified chat model.`
      )
      chainedModelWarningLogged = true
    }
    return deepModel
  }

  // Priority 2: Deep model
  if (deepModel) {
    return deepModel
  }

  // Priority 3: Fast model
  if (fastModel) {
    return fastModel
  }

  // Default
  return DEFAULT_MODELS.chat_deep
}

type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh"
type TextVerbosity = "low" | "medium" | "high"

/**
 * Reasoning effort for each request kind
 *
 * Defaults can be overridden by kind-specific env vars. Some model families
 * support slightly different reasoning values, so unsupported values are
 * retried where a fallback is configured.
 */
const REASONING_EFFORT: Record<RequestKind, ReasoningEffort> = {
  chat_fast: "low",
  chat_deep: "low",
  summarize: "low",
  intent: "low",
  stacks: "low",
  finder: "low",
  codex: "low",
  assistant: "low",
}

/**
 * Fallback reasoning effort if the primary is rejected by the API
 */
const REASONING_EFFORT_FALLBACK: Partial<Record<RequestKind, ReasoningEffort>> = {
  summarize: "low", // Supports env overrides such as minimal with a safe fallback
  assistant: "low",
}

const REASONING_ENV_VARS: Partial<Record<RequestKind, string[]>> = {
  chat_fast: ["OPENAI_REASONING_FAST"],
  chat_deep: ["OPENAI_REASONING_DEEP"],
  summarize: ["OPENAI_REASONING_SUMMARIZE", "OPENAI_SUMMARY_REASONING"],
  intent: ["OPENAI_REASONING_INTENT"],
  stacks: ["OPENAI_REASONING_STACKS"],
  finder: ["OPENAI_REASONING_FINDER"],
  codex: ["OPENAI_REASONING_CODEX"],
  assistant: ["OPENAI_REASONING_ASSISTANT", "OPENAI_ASSISTANT_REASONING"],
}

/**
 * Text verbosity for each request kind
 */
const TEXT_VERBOSITY: Record<RequestKind, TextVerbosity> = {
  chat_fast: "low",
  chat_deep: "low",
  summarize: "low",
  intent: "low",
  stacks: "low",
  finder: "low",
  codex: "medium", // Codex needs more verbose output for explanations
  assistant: "high",
}

const TEXT_VERBOSITY_ENV_VARS: Partial<Record<RequestKind, string[]>> = {
  assistant: ["OPENAI_TEXT_VERBOSITY_ASSISTANT", "OPENAI_ASSISTANT_VERBOSITY"],
}

const VALID_REASONING_EFFORTS = new Set<ReasoningEffort>([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
])

const VALID_TEXT_VERBOSITY = new Set<TextVerbosity>(["low", "medium", "high"])
const invalidConfigWarnings = new Set<string>()

function warnInvalidConfigOnce(envVar: string, value: string, allowed: string): void {
  const key = `${envVar}:${value}`
  if (invalidConfigWarnings.has(key)) return
  console.warn(`[OpenAI] Ignoring invalid ${envVar}="${value}". Allowed values: ${allowed}.`)
  invalidConfigWarnings.add(key)
}

function readEnvOverride<T extends string>(
  envVars: string[],
  validValues: Set<T>,
  allowedLabel: string
): T | null {
  for (const envVar of envVars) {
    const value = process.env[envVar]?.trim()
    if (!value) continue
    if (validValues.has(value as T)) {
      return value as T
    }
    warnInvalidConfigOnce(envVar, value, allowedLabel)
  }
  return null
}

// =============================================================================
// Client
// =============================================================================

let openaiClient: OpenAI | null = null

/**
 * Get the singleton OpenAI client
 * Throws if OPENAI_API_KEY is not configured
 */
export function getOpenAIClient(): OpenAI {
  if (openaiClient) {
    return openaiClient
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not configured")
  }

  openaiClient = new OpenAI({ apiKey })
  return openaiClient
}

// =============================================================================
// Configuration Helpers
// =============================================================================

/**
 * Get the model for a request kind
 *
 * For chained kinds (chat_fast, chat_deep), this returns the unified
 * chat model to ensure previous_response_id chaining works correctly.
 */
export function getModel(kind: RequestKind): string {
  // Chained kinds must use the same model
  if (CHAINED_KINDS.has(kind)) {
    return getChainedChatModel()
  }

  const envVars = MODEL_ENV_VARS[kind]
  // Check each env var in priority order
  for (const envVar of envVars) {
    if (process.env[envVar]) {
      return process.env[envVar]!
    }
  }
  return DEFAULT_MODELS[kind]
}

/**
 * Get the reasoning effort for a request kind
 */
export function getReasoningEffort(kind: RequestKind): ReasoningEffort {
  const override = readEnvOverride(
    REASONING_ENV_VARS[kind] || [],
    VALID_REASONING_EFFORTS,
    "none, minimal, low, medium, high, xhigh"
  )
  return override ?? REASONING_EFFORT[kind]
}

/**
 * Get the fallback reasoning effort for a request kind (if any)
 */
export function getReasoningEffortFallback(kind: RequestKind): ReasoningEffort | undefined {
  return REASONING_EFFORT_FALLBACK[kind]
}

/**
 * Get the text verbosity for a request kind
 */
export function getTextVerbosity(kind: RequestKind): TextVerbosity {
  const override = readEnvOverride(
    TEXT_VERBOSITY_ENV_VARS[kind] || [],
    VALID_TEXT_VERBOSITY,
    "low, medium, high"
  )
  return override ?? TEXT_VERBOSITY[kind]
}

/**
 * Get configuration info for logging
 */
export function getConfigInfo(kind: RequestKind): {
  model: string
  reasoning: ReasoningEffort
  reasoningFallback: ReasoningEffort | undefined
  verbosity: string
} {
  return {
    model: getModel(kind),
    reasoning: getReasoningEffort(kind),
    reasoningFallback: getReasoningEffortFallback(kind),
    verbosity: getTextVerbosity(kind),
  }
}

// =============================================================================
// Request Builders
// =============================================================================

/**
 * Non-streaming response create params
 */
type NonStreamingResponseParams = OpenAI.Responses.ResponseCreateParamsNonStreaming

/**
 * Build common request parameters for a given kind
 *
 * This function ensures:
 * - Correct model is selected
 * - Reasoning effort is set from central defaults or env overrides
 * - Text verbosity is set appropriately
 * - No unsupported parameters are sent
 * - Chained kinds (chat_fast, chat_deep) use store: true for previous_response_id
 */
function buildCommonParams(
  kind: RequestKind,
  input: string | OpenAI.Responses.ResponseInput,
  options?: {
    previousResponseId?: string | null
    instructions?: string
    reasoningEffortOverride?: ReasoningEffort
    storeOverride?: boolean
  }
): NonStreamingResponseParams {
  const model = getModel(kind)
  const reasoning = options?.reasoningEffortOverride ?? getReasoningEffort(kind)
  const verbosity = getTextVerbosity(kind)

  // Chained kinds MUST use store: true for previous_response_id to work.
  // For summarization, we always use store: false.
  // storeOverride allows explicit control.
  const shouldStore = options?.storeOverride !== undefined 
    ? options.storeOverride 
    : CHAINED_KINDS.has(kind)

  const params: NonStreamingResponseParams = {
    model,
    input,
    store: shouldStore,
    stream: false,
    reasoning: { effort: reasoning } as NonStreamingResponseParams["reasoning"],
    text: {
      format: { type: "text" },
      verbosity,
    },
  }

  if (options?.previousResponseId) {
    params.previous_response_id = options.previousResponseId
  }

  if (options?.instructions) {
    params.instructions = options.instructions
  }

  return params
}

/**
 * Create a text response request
 */
export async function createTextResponse(options: {
  kind: RequestKind
  input: string | OpenAI.Responses.ResponseInput
  previousResponseId?: string | null
  instructions?: string
  abortSignal?: AbortSignal
  storeOverride?: boolean
}): Promise<OpenAI.Responses.Response> {
  const client = getOpenAIClient()
  const params = buildCommonParams(options.kind, options.input, {
    previousResponseId: options.previousResponseId,
    instructions: options.instructions,
    storeOverride: options.storeOverride,
  })

  const config = getConfigInfo(options.kind)
  console.log(`[OpenAI:${options.kind}] Request:`, {
    model: config.model,
    reasoning: config.reasoning,
    verbosity: config.verbosity,
    hasPreviousResponseId: !!options.previousResponseId,
  })

  try {
    const response = await client.responses.create(params, {
      signal: options.abortSignal,
    })

    console.log(`[OpenAI:${options.kind}] Response:`, {
      id: response.id,
      status: response.status,
      model: response.model,
    })

    return response
  } catch (error) {
    handleOpenAIError(error, options.kind, config)
    throw error
  }
}

/**
 * Create a summarization response with timeout and reasoning effort fallback
 * 
 * This function is optimized for speed:
 * - Uses "low" reasoning effort by default
 * - Supports abort signal for timeout
 * - Always uses store: false (summarization shouldn't affect chaining state)
 * - Includes instrumentation logging for debugging
 */
export async function createSummarizeResponse(options: {
  input: string | OpenAI.Responses.ResponseInput
  instructions?: string
  abortSignal?: AbortSignal
}): Promise<{
  response: OpenAI.Responses.Response
  durationMs: number
  reasoningUsed: ReasoningEffort
  timedOut: boolean
}> {
  const client = getOpenAIClient()
  const config = getConfigInfo("summarize")
  const startTime = Date.now()
  
  let reasoningUsed = config.reasoning
  let timedOut = false

  // Dev-only instrumentation logging
  if (process.env.NODE_ENV === "development") {
    console.log(`[Summarize:start]`, {
      model: config.model,
      reasoning: config.reasoning,
      reasoningFallback: config.reasoningFallback,
      verbosity: config.verbosity,
    })
  }

  const attemptRequest = async (reasoning: ReasoningEffort): Promise<OpenAI.Responses.Response> => {
    const params = buildCommonParams("summarize", options.input, {
      instructions: options.instructions,
      reasoningEffortOverride: reasoning,
      storeOverride: false, // Summarization never stores
    })

    return client.responses.create(params, {
      signal: options.abortSignal,
    })
  }

  try {
    // Try with the configured reasoning effort.
    const response = await attemptRequest(reasoningUsed)
    const durationMs = Date.now() - startTime

    // Dev-only instrumentation logging
    if (process.env.NODE_ENV === "development") {
      console.log(`[Summarize:complete]`, {
        id: response.id,
        model: response.model,
        durationMs,
        reasoningUsed,
        timedOut: false,
      })
    }

    return { response, durationMs, reasoningUsed, timedOut }
  } catch (error) {
    const durationMs = Date.now() - startTime

    // Check if this is an abort/timeout
    if (error instanceof Error && error.name === "AbortError") {
      timedOut = true
      if (process.env.NODE_ENV === "development") {
        console.log(`[Summarize:timeout]`, {
          durationMs,
          reasoningUsed,
          timedOut: true,
        })
      }
      throw error
    }

    // Check if the API rejected the configured reasoning effort - retry with fallback
    if (
      config.reasoningFallback &&
      config.reasoningFallback !== reasoningUsed &&
      error instanceof OpenAI.APIError &&
      isReasoningUnsupportedError(error)
    ) {
      console.log(`[Summarize] "${reasoningUsed}" reasoning rejected, retrying with "${config.reasoningFallback}"`)
      reasoningUsed = config.reasoningFallback

      try {
        const response = await attemptRequest(reasoningUsed)
        const finalDurationMs = Date.now() - startTime

        if (process.env.NODE_ENV === "development") {
          console.log(`[Summarize:complete:fallback]`, {
            id: response.id,
            model: response.model,
            durationMs: finalDurationMs,
            reasoningUsed,
            timedOut: false,
          })
        }

        return { response, durationMs: finalDurationMs, reasoningUsed, timedOut }
      } catch (fallbackError) {
        handleOpenAIError(fallbackError, "summarize", config)
        throw fallbackError
      }
    }

    handleOpenAIError(error, "summarize", config)
    throw error
  }
}

/**
 * Create a parsed (structured output) response request
 */
export async function createParsedResponse<T extends z.ZodType>(options: {
  kind: RequestKind
  input: string | OpenAI.Responses.ResponseInput
  schema: T
  schemaName: string
  previousResponseId?: string | null
  instructions?: string
}): Promise<{
  response: OpenAI.Responses.Response
  parsed: z.infer<T> | null
}> {
  const client = getOpenAIClient()
  const model = getModel(options.kind)
  const reasoning = getReasoningEffort(options.kind)
  const fallbackReasoning = getReasoningEffortFallback(options.kind)
  const verbosity = getTextVerbosity(options.kind)

  const config = getConfigInfo(options.kind)
  console.log(`[OpenAI:${options.kind}] Parse request:`, {
    model: config.model,
    reasoning: config.reasoning,
    schema: options.schemaName,
  })

  const attemptParse = async (reasoningToUse: ReasoningEffort) => {
    return client.responses.parse({
      model,
      input: options.input,
      store: false,
      instructions: options.instructions,
      reasoning: { effort: reasoningToUse } as NonStreamingResponseParams["reasoning"],
      text: {
        format: zodTextFormat(options.schema, options.schemaName),
        verbosity,
      },
    })
  }

  try {
    const response = await attemptParse(reasoning)

    console.log(`[OpenAI:${options.kind}] Parse response:`, {
      id: response.id,
      status: response.status,
      model: response.model,
      hasParsed: !!response.output_parsed,
    })

    return {
      response,
      parsed: response.output_parsed as z.infer<T> | null,
    }
  } catch (error) {
    if (
      fallbackReasoning &&
      fallbackReasoning !== reasoning &&
      error instanceof OpenAI.APIError &&
      isReasoningUnsupportedError(error)
    ) {
      console.log(
        `[OpenAI:${options.kind}] "${reasoning}" reasoning rejected, retrying parse with "${fallbackReasoning}"`
      )
      try {
        const response = await attemptParse(fallbackReasoning)
        console.log(`[OpenAI:${options.kind}] Parse response:fallback`, {
          id: response.id,
          status: response.status,
          model: response.model,
          hasParsed: !!response.output_parsed,
        })
        return {
          response,
          parsed: response.output_parsed as z.infer<T> | null,
        }
      } catch (fallbackError) {
        handleOpenAIError(fallbackError, options.kind, config)
        throw fallbackError
      }
    }
    handleOpenAIError(error, options.kind, config)
    throw error
  }
}

function isReasoningUnsupportedError(error: { message: string; code?: string | null }): boolean {
  const message = error.message.toLowerCase()
  return (
    message.includes("reasoning") ||
    message.includes("effort") ||
    message.includes("minimal") ||
    error.code === "invalid_parameter_value" ||
    error.code === "unsupported_value"
  )
}

// =============================================================================
// Error Handling
// =============================================================================

/**
 * Handle OpenAI API errors with detailed logging
 */
function handleOpenAIError(
  error: unknown,
  kind: RequestKind,
  config: { model: string; reasoning: string; verbosity: string }
): void {
  if (error instanceof OpenAI.APIError) {
    console.error(`[OpenAI:${kind}] API Error:`, {
      route: kind,
      model: config.model,
      reasoning: config.reasoning,
      verbosity: config.verbosity,
      status: error.status,
      message: error.message,
      code: error.code,
      requestId: error.headers?.["x-request-id"],
    })
  } else {
    console.error(`[OpenAI:${kind}] Unknown Error:`, error)
  }
}

/**
 * Format an OpenAI error for API response
 */
export function formatOpenAIError(error: unknown, kind: RequestKind): {
  error: string
  details?: {
    route: string
    model: string
    reasoning: string
  }
} {
  const config = getConfigInfo(kind)

  if (error instanceof OpenAI.APIError) {
    return {
      error: `OpenAI API error: ${error.message}`,
      details: {
        route: kind,
        model: config.model,
        reasoning: config.reasoning,
      },
    }
  }

  return {
    error: error instanceof Error ? error.message : "Unknown error",
  }
}

// =============================================================================
// Response Helpers
// =============================================================================

/**
 * Extract text output from a response
 */
export function extractTextOutput(response: OpenAI.Responses.Response): string {
  // Try output_text first (convenience property)
  if (response.output_text) {
    return response.output_text
  }

  // Fall back to extracting from output array
  if (response.output) {
    for (const item of response.output) {
      if (item.type === "message" && item.content) {
        for (const content of item.content) {
          if (content.type === "output_text") {
            return content.text
          }
        }
      }
    }
  }

  return ""
}

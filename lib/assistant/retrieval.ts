import { z } from "zod"
import { makeAssistantArtifact, rowsToCsv, slugifyFilenamePart } from "@/lib/assistant/artifacts"
import {
  generateAssistantCsvArtifact,
  generateAssistantDocumentArtifact,
} from "@/lib/assistant/generation"
import type {
  AssistantArtifact,
  AssistantChatThreadInput,
  AssistantOpenLoopItem,
  AssistantProposedAction,
  AssistantSource,
  AssistantTaskKind,
  AssistantTaskResult,
  AssistantTaskStatus,
} from "@/lib/assistant/types"
import { createParsedResponse } from "@/lib/openai"

const MAX_THREAD_TEXT = 12000
const MAX_SNIPPET = 260
const MAX_DIGEST_CHARS = 15000
const DIGEST_SNIPPET_CHARS = 200
const OPEN_LOOP_LIMIT = 6
const FALLBACK_NOTE =
  "Model-assisted planning was unavailable; this run used a deterministic organizer."

type AssistantArtifactFormat = "document" | "csv" | null

interface ScoredThread {
  thread: AssistantChatThreadInput
  score: number
  confidence: number
  reason: string
  snippet: string
}

interface AssistantPlan {
  taskKind: AssistantTaskKind
  interpretedGoal: string
  artifactFormat: AssistantArtifactFormat
  selectedChats: Array<{
    chatId: string
    reason: string
    confidence: number
  }>
  openLoops: Array<{
    chatId: string
    reason: string
    nextAction: string
    needsCodexPrompt: boolean
    confidence: number
  }>
}

const AssistantSelectedChatSchema = z.object({
  chatId: z.string().describe("Relevant chat ID exactly as provided"),
  reason: z.string().describe("Why this chat is relevant to the user request"),
  confidence: z.number().min(0).max(1),
})

const AssistantOpenLoopSchema = z.object({
  chatId: z.string().describe("Open-loop chat ID exactly as provided"),
  reason: z.string().describe("What remains unfinished or unresolved"),
  nextAction: z.string().describe("The next concrete action the user should take"),
  needsCodexPrompt: z.boolean(),
  confidence: z.number().min(0).max(1),
})

const AssistantPlanningSchema = z.object({
  taskKind: z.enum([
    "cross_chat_artifact",
    "open_loops",
    "current_chat_help",
    "codex_prompt_draft",
    "clarification",
  ]),
  interpretedGoal: z.string().min(1).describe("Concise interpretation of the user's goal"),
  artifactFormat: z.enum(["document", "csv"]).nullable(),
  selectedChats: z
    .array(AssistantSelectedChatSchema)
    .max(8)
    .describe("Only genuinely relevant chats, never filler"),
  openLoops: z
    .array(AssistantOpenLoopSchema)
    .max(6)
    .describe("Only for open-loop or prompt-drafting requests"),
})

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "from",
  "into",
  "where",
  "were",
  "what",
  "when",
  "all",
  "my",
  "me",
  "we",
  "you",
  "they",
  "them",
  "chat",
  "chats",
  "assistant",
  "find",
  "make",
  "turn",
  "create",
  "give",
  "need",
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9@]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

function truncate(text: string, max = MAX_SNIPPET): string {
  const cleaned = text.replace(/\s+/g, " ").trim()
  if (cleaned.length <= max) return cleaned
  return `${cleaned.slice(0, max - 3).trim()}...`
}

function displayTitleForThread(thread: AssistantChatThreadInput): string {
  const title = thread.title?.trim()
  if (title && title.toLowerCase() !== "new chat") {
    return title
  }

  const firstUserMessage = thread.messages.find(
    (message) =>
      message.role === "user" &&
      message.text?.trim() &&
      !message.isTaskCard &&
      !isAssistantControlMessage(message.text)
  )
  if (firstUserMessage?.text) {
    return truncate(firstUserMessage.text.replace(/^@\w+\s+/i, ""), 72)
  }

  return title || "Untitled chat"
}

function isAssistantControlMessage(text: string): boolean {
  return text.trim().toLowerCase().startsWith("@assistant ")
}

function isAssistantOnlyThread(thread: AssistantChatThreadInput): boolean {
  const hasSubstantiveMessage = thread.messages.some(
    (message) =>
      message.text?.trim() &&
      !message.isTaskCard &&
      !isAssistantControlMessage(message.text)
  )
  return thread.title.toLowerCase().startsWith("@assistant") && !hasSubstantiveMessage
}

function transcriptForThread(thread: AssistantChatThreadInput): string {
  const lines = thread.messages
    .filter(
      (message) =>
        message.text?.trim() &&
        !message.isTaskCard &&
        !isAssistantControlMessage(message.text)
    )
    .map((message) => `${message.role}: ${message.text}`)
  return lines.join("\n").slice(0, MAX_THREAD_TEXT)
}

function hasCodexTask(thread: AssistantChatThreadInput): boolean {
  return thread.messages.some((message) => {
    const text = message.text.trim().toLowerCase()
    return Boolean(message.taskId || message.isTaskCard || text.startsWith("@codex "))
  })
}

function firstUserSnippet(thread: AssistantChatThreadInput): string {
  const message = thread.messages.find(
    (item) =>
      item.role === "user" &&
      item.text?.trim() &&
      !item.isTaskCard &&
      !isAssistantControlMessage(item.text)
  )
  return truncate(message?.text || "", DIGEST_SNIPPET_CHARS)
}

function recentMessageSnippets(thread: AssistantChatThreadInput): string[] {
  return thread.messages
    .filter((message) => message.text?.trim() && !isAssistantControlMessage(message.text))
    .slice(-2)
    .map((message) => truncate(`${message.role}: ${message.text}`, DIGEST_SNIPPET_CHARS))
}

function buildThreadDigest(threads: AssistantChatThreadInput[]): string {
  let usedChars = 0
  const blocks: string[] = []

  for (const thread of [...threads].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const block = [
      `<thread id="${thread.id}">`,
      `Title: ${displayTitleForThread(thread)}`,
      `Summary: ${truncate(thread.summary || "", DIGEST_SNIPPET_CHARS)}`,
      `Category: ${thread.category || "unknown"}`,
      `Updated: ${new Date(thread.updatedAt).toISOString()}`,
      `Message count: ${thread.messages.length}`,
      `Contains task card: ${hasCodexTask(thread) ? "yes" : "no"}`,
      `First user message: ${firstUserSnippet(thread) || "none"}`,
      "Recent messages:",
      ...recentMessageSnippets(thread).map((snippet) => `- ${snippet}`),
      "</thread>",
    ].join("\n")

    if (usedChars + block.length > MAX_DIGEST_CHARS) break
    blocks.push(block)
    usedChars += block.length
  }

  return blocks.join("\n\n")
}

function previousTaskBlock(
  previousTask?: {
    requestText: string
    interpretedGoal: string
    taskKind: AssistantTaskKind
    resultSummary: string
    sources: AssistantSource[]
  } | null
): string {
  if (!previousTask) return "No previous Assistant task context."
  return [
    `Previous request: ${previousTask.requestText}`,
    `Previous interpreted goal: ${previousTask.interpretedGoal}`,
    `Previous task kind: ${previousTask.taskKind}`,
    `Previous result summary: ${truncate(previousTask.resultSummary, 800)}`,
    "Previous sources:",
    ...previousTask.sources
      .slice(0, 8)
      .map((source) => `- ${source.title} (${source.chatId}): ${source.reason}`),
  ].join("\n")
}

async function planAssistantRun(args: {
  request: string
  threads: AssistantChatThreadInput[]
  previousTask?: {
    requestText: string
    interpretedGoal: string
    taskKind: AssistantTaskKind
    resultSummary: string
    sources: AssistantSource[]
  } | null
}): Promise<AssistantPlan | null> {
  if (!process.env.OPENAI_API_KEY) return null

  const digest = buildThreadDigest(args.threads)
  const prompt = `User request:
${args.request}

Previous task context:
${previousTaskBlock(args.previousTask)}

Candidate chat digest, most recently updated first:
${digest || "No candidate chats."}

Plan this Assistant run.
Rules:
- Classify the request into exactly one taskKind.
- Choose artifactFormat "document" for prose artifacts and "csv" for spreadsheet/table data extraction requests; otherwise use null.
- Select at most 8 chats, and only when the digest shows genuine relevance.
- For selectedChats and openLoops, use only chat IDs from the digest.
- For open-loop or Codex prompt drafting requests, fill openLoops with at most 6 genuinely unfinished threads.
- For other task kinds, leave openLoops empty.
- Keep interpretedGoal user-facing and concise.`

  try {
    const { parsed } = await createParsedResponse({
      kind: "assistant",
      input: prompt,
      schema: AssistantPlanningSchema,
      schemaName: "assistant_run_plan",
      instructions:
        "You plan a product-level cross-chat Assistant run. Use the provided chat digest only and return conservative structured output.",
    })
    return parsed
  } catch (error) {
    console.error("[Assistant] Model planning failed, using deterministic fallback:", error)
    return null
  }
}

function classifyTaskKind(request: string): AssistantTaskKind {
  const lower = request.toLowerCase()
  const asksForOpenLoops =
    lower.includes("unfinished") ||
    lower.includes("open loop") ||
    lower.includes("left off") ||
    lower.includes("unresolved") ||
    lower.includes("follow-up") ||
    lower.includes("follow up") ||
    lower.includes("come back")

  if (lower.includes("codex") && (lower.includes("prompt") || lower.includes("follow"))) {
    return "codex_prompt_draft"
  }

  if (asksForOpenLoops) {
    return "open_loops"
  }

  if (
    lower.includes("spreadsheet") ||
    lower.includes("csv") ||
    lower.includes("table") ||
    lower.includes("extract") ||
    lower.includes("export") ||
    lower.includes("brief") ||
    lower.includes("document") ||
    lower.includes("plan") ||
    lower.includes("overview") ||
    lower.includes("reference") ||
    lower.includes("synthesize") ||
    lower.includes("compile")
  ) {
    return "cross_chat_artifact"
  }

  if (lower.includes("this chat")) {
    return "current_chat_help"
  }

  return "clarification"
}

function fallbackArtifactFormat(request: string, taskKind: AssistantTaskKind): AssistantArtifactFormat {
  if (taskKind !== "cross_chat_artifact") return null
  const lower = request.toLowerCase()
  if (
    lower.includes("spreadsheet") ||
    lower.includes("csv") ||
    lower.includes("table") ||
    lower.includes("extract") ||
    lower.includes("export")
  ) {
    return "csv"
  }
  return "document"
}

function genericInterpretedGoal(kind: AssistantTaskKind, request: string): string {
  if (kind === "codex_prompt_draft") {
    return "Find likely unfinished implementation work and draft a clean @codex prompt the user can run."
  }
  if (kind === "open_loops") {
    return "Review recent chats for unfinished work, explain why each looks open, and suggest the next action."
  }
  if (kind === "cross_chat_artifact") {
    return "Collect relevant chats, organize the available context, and generate a downloadable artifact."
  }
  if (kind === "current_chat_help") {
    return "Use the current chat plus available workspace context to prepare the next product-level action."
  }
  return truncate(request, 140) || "Interpret the request and review available chat context."
}

function fallbackPlan(request: string): AssistantPlan {
  const taskKind = classifyTaskKind(request)
  return {
    taskKind,
    interpretedGoal: genericInterpretedGoal(taskKind, request),
    artifactFormat: fallbackArtifactFormat(request, taskKind),
    selectedChats: [],
    openLoops: [],
  }
}

function scoreThread(thread: AssistantChatThreadInput, tokens: string[]): ScoredThread {
  const title = thread.title.toLowerCase()
  const summary = (thread.summary || "").toLowerCase()
  const transcript = transcriptForThread(thread).toLowerCase()

  let matchScore = 0
  const matchedTerms: string[] = []
  for (const token of unique(tokens)) {
    let matched = false
    if (title.includes(token)) {
      matchScore += 5
      matched = true
    }
    if (summary.includes(token)) {
      matchScore += 3
      matched = true
    }
    const transcriptMatches = transcript.split(token).length - 1
    if (transcriptMatches > 0) {
      matchScore += Math.min(transcriptMatches, 6)
      matched = true
    }
    if (matched) matchedTerms.push(token)
  }

  let score = matchScore
  const ageMs = Date.now() - thread.updatedAt
  if (matchScore > 0 && ageMs >= 0 && ageMs < 7 * 24 * 60 * 60 * 1000) {
    score += 1.5
  }

  const snippet = findSnippet(thread, tokens)
  const confidence = Math.max(0.35, Math.min(0.98, score / 18))
  const reason =
    matchedTerms.length > 0
      ? `Matched ${unique(matchedTerms).slice(0, 4).join(", ")} in this chat.`
      : "Reviewed as part of the available chat workspace."

  return { thread, score, confidence, reason, snippet }
}

function selectRelevantThreads(
  request: string,
  threads: AssistantChatThreadInput[],
  limit = 8
): ScoredThread[] {
  const tokens = tokenize(request)
  if (tokens.length === 0) return []
  const scored = threads.map((thread) => scoreThread(thread, tokens))
  scored.sort((a, b) => b.score - a.score || b.thread.updatedAt - a.thread.updatedAt)
  return scored.filter((item) => item.score > 0).slice(0, limit)
}

function findSnippet(thread: AssistantChatThreadInput, tokens: string[]): string {
  const uniqueTokens = unique(tokens)
  const fragments = thread.messages
    .filter((message) => message.text)
    .flatMap((message) => message.text.split(/(?<=[.!?])\s+|\n+/))
    .map((fragment) => fragment.trim())
    .filter(Boolean)

  const scored = fragments.map((fragment) => {
    const lower = fragment.toLowerCase()
    const score = uniqueTokens.reduce((sum, token) => sum + (lower.includes(token) ? 1 : 0), 0)
    return { fragment, score }
  })

  scored.sort((a, b) => b.score - a.score)
  const best = scored.find((item) => item.score > 0) || scored[scored.length - 1]
  return truncate(best?.fragment || thread.summary || thread.title)
}

function sourcesFromScored(scored: ScoredThread[]): AssistantSource[] {
  return scored.map((item) => ({
    chatId: item.thread.id,
    title: displayTitleForThread(item.thread),
    updatedAt: item.thread.updatedAt,
    reason: item.reason,
    snippet: item.snippet,
    confidence: item.confidence,
  }))
}

function selectedThreadsFromPlan(args: {
  plan: AssistantPlan
  threads: AssistantChatThreadInput[]
  request: string
}): ScoredThread[] {
  const threadMap = new Map(args.threads.map((thread) => [thread.id, thread]))
  const tokens = tokenize(args.request)
  const selected: ScoredThread[] = []

  for (const item of args.plan.selectedChats.slice(0, 8)) {
    const thread = threadMap.get(item.chatId)
    if (!thread) {
      console.warn(`[Assistant] Planner returned unknown chatId: ${item.chatId}`)
      continue
    }
    selected.push({
      thread,
      score: item.confidence,
      confidence: item.confidence,
      reason: item.reason,
      snippet: findSnippet(thread, tokens),
    })
  }

  return selected
}

function genericArtifactTitle(request: string): string {
  return truncate(request.replace(/^@\w+\s+/i, ""), 72) || "Assistant Workspace Artifact"
}

function extractTopicBullets(request: string, scored: ScoredThread[]): string[] {
  const tokens = tokenize(request)
  const bullets: string[] = []
  const seen = new Set<string>()

  for (const item of scored) {
    for (const message of item.thread.messages) {
      if (!message.text) continue
      for (const fragment of message.text.split(/(?<=[.!?])\s+|\n+/)) {
        const lower = fragment.toLowerCase()
        if (!tokens.some((token) => lower.includes(token))) continue
        const bullet = truncate(fragment, 180)
        if (!seen.has(bullet)) {
          seen.add(bullet)
          bullets.push(bullet)
        }
      }
    }
  }

  return bullets.slice(0, 12)
}

function buildDocumentArtifact(args: {
  request: string
  interpretedGoal: string
  scored: ScoredThread[]
}): {
  artifact?: AssistantArtifact
  summary: string
  missingInfo: string[]
} {
  const title = genericArtifactTitle(args.request)
  const bullets = extractTopicBullets(args.request, args.scored)

  if (args.scored.length === 0 || bullets.length === 0) {
    return {
      summary: "I did not find enough matching chat context to generate a useful document.",
      missingInfo: ["No relevant source snippets were found in available chats."],
    }
  }

  const sourceNotes = args.scored.slice(0, 6).map((item) => {
    const title = displayTitleForThread(item.thread)
    return `- ${title} (${item.thread.id}): ${item.snippet}`
  })

  const content = [
    `# ${title}`,
    "",
    "## Interpreted Goal",
    args.interpretedGoal,
    "",
    "## What I Found",
    ...bullets.map((bullet) => `- ${bullet}`),
    "",
    "## Suggested Structure",
    "1. Key context gathered from matching chats",
    "2. Decisions or recommendations explicitly supported by the chats",
    "3. Source notes to review before using the artifact",
    "4. Missing details to confirm",
    "",
    "## Source Notes",
    ...sourceNotes,
    "",
    "## Sources Used",
    ...args.scored.map(
      (item) => `- ${displayTitleForThread(item.thread)} (${item.thread.id}): ${item.reason}`
    ),
    "",
    "## Missing or Ambiguous Information",
    "- Timing, exact scope, and unsupported details should be confirmed by the user.",
    "- The Assistant used only the provided demo chat context and did not invent outside facts.",
    "",
  ].join("\n")

  return {
    artifact: makeAssistantArtifact({
      kind: "markdown",
      filename: `${slugifyFilenamePart(title)}.md`,
      content,
    }),
    summary: `I created a downloadable artifact from ${args.scored.length} source chat${args.scored.length === 1 ? "" : "s"}.`,
    missingInfo: ["Timing and exact scope may need user confirmation."],
  }
}

function buildCsvArtifact(request: string, scored: ScoredThread[]): {
  artifact?: AssistantArtifact
  summary: string
  missingInfo: string[]
} {
  if (scored.length === 0) {
    return {
      summary: "I did not find enough matching chat context to generate a useful CSV.",
      missingInfo: ["No relevant source snippets were found in available chats."],
    }
  }

  const headers = ["sourceChatTitle", "sourceChatId", "reason", "snippet", "confidence"]
  const rows = scored.map((item) => ({
    sourceChatTitle: displayTitleForThread(item.thread),
    sourceChatId: item.thread.id,
    reason: item.reason,
    snippet: item.snippet,
    confidence: Math.round(item.confidence * 100) / 100,
  }))

  return {
    artifact: makeAssistantArtifact({
      kind: "csv",
      filename: `${slugifyFilenamePart(genericArtifactTitle(request))}.csv`,
      content: rowsToCsv(headers, rows),
      rowCount: rows.length,
    }),
    summary: `I created a generic CSV organizer with ${rows.length} source chat${rows.length === 1 ? "" : "s"}.`,
    missingInfo: ["Structured row extraction requires model-assisted generation."],
  }
}

function buildCodexPrompt(thread: AssistantChatThreadInput, reason: string): string {
  const recent = thread.messages
    .slice(-4)
    .map((message) => `${message.role}: ${truncate(message.text, 300)}`)
    .join("\n")

  return [
    "@codex",
    `Use the context from "${displayTitleForThread(thread)}" to finish the unresolved implementation work.`,
    "",
    "Context:",
    recent,
    "",
    "Task:",
    reason.toLowerCase().includes("codex")
      ? "Inspect the relevant files, implement the planned fix, and add or update focused regression coverage."
      : "Turn the plan from this chat into the smallest safe implementation, preserving existing behavior.",
    "",
    "Guardrails:",
    "- Keep the patch narrowly scoped.",
    "- Preserve existing chat, history, branch, file, and artifact behavior.",
    "- Report changed files and verification steps.",
  ].join("\n")
}

function buildOpenLoopsFromPlan(args: {
  plan: AssistantPlan
  threads: AssistantChatThreadInput[]
  request: string
  planningWasFallback: boolean
}): {
  openLoops: AssistantOpenLoopItem[]
  sources: AssistantSource[]
  summary: string
  actions: AssistantProposedAction[]
} {
  const threadMap = new Map(args.threads.map((thread) => [thread.id, thread]))
  const tokens = tokenize(args.request)
  const loops = args.plan.openLoops
    .slice(0, OPEN_LOOP_LIMIT)
    .map((loop) => {
      const thread = threadMap.get(loop.chatId)
      if (!thread) {
        console.warn(`[Assistant] Planner returned unknown open-loop chatId: ${loop.chatId}`)
        return null
      }
      const draftCodexPrompt = loop.needsCodexPrompt ? buildCodexPrompt(thread, loop.reason) : undefined
      const item: AssistantOpenLoopItem = {
        id: `${thread.id}-open-loop`,
        chatTitle: displayTitleForThread(thread),
        chatId: thread.id,
        lastUpdated: thread.updatedAt,
        reason: loop.reason,
        nextAction: loop.nextAction,
        canAssistantHelp: true,
        suggestedAction: loop.needsCodexPrompt ? "Create Codex prompt" : "Summarize where we left off",
        draftCodexPrompt,
        snippet: findSnippet(thread, tokens),
        confidence: loop.confidence,
      }
      return item
    })
    .filter((item): item is AssistantOpenLoopItem => Boolean(item))
    .sort((a, b) => b.confidence - a.confidence || (b.lastUpdated || 0) - (a.lastUpdated || 0))

  const sources = loops.map((item) => ({
    chatId: item.chatId,
    title: item.chatTitle,
    updatedAt: item.lastUpdated,
    reason: item.reason,
    snippet: item.snippet || "",
    confidence: item.confidence,
  }))

  const actions: AssistantProposedAction[] = []
  for (const item of loops) {
    actions.push({
      id: `${item.id}-open`,
      label: "Open chat",
      type: "open_chat",
      chatId: item.chatId,
    })
    if (item.draftCodexPrompt) {
      actions.push({
        id: `${item.id}-insert-codex`,
        label: "Insert Codex prompt",
        type: "insert_codex_prompt",
        chatId: item.chatId,
        prompt: item.draftCodexPrompt,
      })
    }
  }

  return {
    openLoops: loops,
    sources,
    summary:
      loops.length === 0
        ? args.planningWasFallback
          ? "I reviewed the available chats with the deterministic organizer, but model-assisted open-loop detection was unavailable."
          : "I reviewed the available recent chats and did not find a clear unfinished thread."
        : `I found ${loops.length} likely unfinished chat${loops.length === 1 ? "" : "s"} and prepared next actions.`,
    actions,
  }
}

export function mergeAssistantThreads(
  threads: AssistantChatThreadInput[],
  currentThread?: AssistantChatThreadInput | null
): AssistantChatThreadInput[] {
  const map = new Map<string, AssistantChatThreadInput>()

  for (const thread of threads) {
    if (!thread?.id) continue
    if (isAssistantOnlyThread(thread)) continue
    const existing = map.get(thread.id)
    if (!existing || thread.messages.length >= existing.messages.length) {
      map.set(thread.id, {
        ...thread,
        messages: thread.messages || [],
      })
    }
  }

  if (currentThread && currentThread.messages.length > 0) {
    const existing = map.get(currentThread.id)
    map.set(currentThread.id, {
      ...(existing || currentThread),
      ...currentThread,
      title: currentThread.title || existing?.title || "Current chat",
      messages: currentThread.messages,
      updatedAt: Math.max(currentThread.updatedAt, existing?.updatedAt || 0),
    })
  }

  return Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt)
}

function sourcesForNonArtifact(scored: ScoredThread[]): string {
  if (scored.length === 0) {
    return "I reviewed the available chats but did not find a strong match for this request."
  }
  return `I found ${scored.length} relevant chat${scored.length === 1 ? "" : "s"} to review for this request.`
}

export async function createAssistantTaskResult(args: {
  id: string
  request: string
  threads: AssistantChatThreadInput[]
  previousTask?: {
    requestText: string
    interpretedGoal: string
    taskKind: AssistantTaskKind
    resultSummary: string
    sources: AssistantSource[]
  } | null
}): Promise<AssistantTaskResult> {
  const now = Date.now()
  const progress: AssistantTaskStatus[] = ["queued", "interpreting", "searching", "reviewing"]
  const effectiveRequest = args.previousTask
    ? [
        `Previous Assistant request: ${args.previousTask.requestText}`,
        `Previous interpreted goal: ${args.previousTask.interpretedGoal}`,
        `Previous result summary: ${args.previousTask.resultSummary}`,
        `Follow-up request: ${args.request}`,
      ].join("\n")
    : args.request

  const modelPlan = await planAssistantRun({
    request: args.request,
    threads: args.threads,
    previousTask: args.previousTask ?? null,
  })
  const planningWasFallback = !modelPlan
  const plan = modelPlan || fallbackPlan(args.request)

  if (planningWasFallback && (plan.taskKind === "open_loops" || plan.taskKind === "codex_prompt_draft")) {
    const scored = selectRelevantThreads(effectiveRequest, args.threads, OPEN_LOOP_LIMIT)
    plan.openLoops = scored.map((item) => ({
      chatId: item.thread.id,
      reason: item.reason,
      nextAction: "Review the matching chat and choose the next concrete step.",
      needsCodexPrompt: plan.taskKind === "codex_prompt_draft",
      confidence: item.confidence,
    }))
  }

  if (plan.taskKind === "open_loops" || plan.taskKind === "codex_prompt_draft") {
    const result = buildOpenLoopsFromPlan({
      plan,
      threads: args.threads,
      request: effectiveRequest,
      planningWasFallback,
    })
    const missingInfo =
      result.openLoops.length === 0
        ? ["No clear unfinished chats matched the requested scope."]
        : []
    if (planningWasFallback) missingInfo.push(FALLBACK_NOTE)

    return {
      id: args.id,
      createdAt: now,
      updatedAt: now,
      status: result.openLoops.length > 0 ? "ready" : "no_results",
      requestText: args.request,
      interpretedGoal: plan.interpretedGoal,
      taskKind: plan.taskKind,
      progress: [...progress, "ready"],
      sources: result.sources,
      resultSummary: result.summary,
      openLoops: result.openLoops,
      proposedActions: result.actions,
      missingInfo: missingInfo.length > 0 ? missingInfo : undefined,
      reviewedChatCount: args.threads.length,
    }
  }

  const scored = planningWasFallback
    ? selectRelevantThreads(effectiveRequest, args.threads)
    : selectedThreadsFromPlan({ plan, threads: args.threads, request: effectiveRequest })
  const sources = sourcesFromScored(scored)
  const artifactFormat = plan.artifactFormat

  let artifactResult: {
    artifact?: AssistantArtifact
    summary: string
    missingInfo: string[]
  } = {
    summary: sourcesForNonArtifact(scored),
    missingInfo: [],
  }

  if (artifactFormat === "document") {
    artifactResult = buildDocumentArtifact({
      request: args.request,
      interpretedGoal: plan.interpretedGoal,
      scored,
    })
    if (!planningWasFallback && scored.length > 0) {
      const modelArtifact = await generateAssistantDocumentArtifact({
        request: effectiveRequest,
        interpretedGoal: plan.interpretedGoal,
        title: genericArtifactTitle(args.request),
        sources: scored.slice(0, 8).map((item) => ({
          chatId: item.thread.id,
          title: displayTitleForThread(item.thread),
          updatedAt: item.thread.updatedAt,
          reason: item.reason,
          snippet: item.snippet,
          transcript: transcriptForThread(item.thread),
        })),
      })
      if (modelArtifact) artifactResult = modelArtifact
    }
  } else if (artifactFormat === "csv") {
    artifactResult = buildCsvArtifact(args.request, scored)
    if (!planningWasFallback && scored.length > 0) {
      const modelArtifact = await generateAssistantCsvArtifact({
        request: effectiveRequest,
        interpretedGoal: plan.interpretedGoal,
        title: genericArtifactTitle(args.request),
        sources: scored.slice(0, 8).map((item) => ({
          chatId: item.thread.id,
          title: displayTitleForThread(item.thread),
          updatedAt: item.thread.updatedAt,
          reason: item.reason,
          snippet: item.snippet,
          transcript: transcriptForThread(item.thread),
        })),
      })
      if (modelArtifact) artifactResult = modelArtifact
    }
  } else if (scored.length === 0) {
    artifactResult.missingInfo.push("No relevant source snippets were found in available chats.")
  }

  if (planningWasFallback) {
    artifactResult = {
      ...artifactResult,
      missingInfo: [...artifactResult.missingInfo, FALLBACK_NOTE],
    }
  }

  const proposedActions: AssistantProposedAction[] = []
  if (artifactResult.artifact) {
    proposedActions.push({
      id: `${args.id}-download`,
      label: "Download artifact",
      type: "download_artifact",
    })
  }
  for (const source of sources.slice(0, 3)) {
    proposedActions.push({
      id: `${args.id}-open-${source.chatId}`,
      label: "Open chat",
      type: "open_chat",
      chatId: source.chatId,
    })
  }

  const noResults = !artifactResult.artifact && sources.length === 0

  return {
    id: args.id,
    createdAt: now,
    updatedAt: now,
    status: noResults ? "no_results" : "ready",
    requestText: args.request,
    interpretedGoal: plan.interpretedGoal,
    taskKind: plan.taskKind,
    progress: [...progress, artifactResult.artifact ? "generating" : "ready", "ready"],
    sources,
    resultSummary: artifactResult.summary,
    artifact: artifactResult.artifact,
    proposedActions,
    missingInfo: artifactResult.missingInfo.length > 0 ? artifactResult.missingInfo : undefined,
    reviewedChatCount: args.threads.length,
  }
}

export function createFailedAssistantTask(args: {
  id: string
  request: string
  error: string
}): AssistantTaskResult {
  const now = Date.now()
  return {
    id: args.id,
    createdAt: now,
    updatedAt: now,
    status: "failed",
    requestText: args.request,
    interpretedGoal: "The Assistant could not complete this request.",
    taskKind: "clarification",
    progress: ["queued", "interpreting", "failed"],
    sources: [],
    resultSummary: args.error,
    proposedActions: [],
    missingInfo: [args.error],
    reviewedChatCount: 0,
    error: args.error,
  }
}

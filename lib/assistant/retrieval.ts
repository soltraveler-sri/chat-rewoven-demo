import { makeAssistantArtifact, rowsToCsv, slugifyFilenamePart } from "@/lib/assistant/artifacts"
import { generateAssistantDocumentArtifact } from "@/lib/assistant/generation"
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

const MAX_THREAD_TEXT = 12000
const MAX_SNIPPET = 260
const OPEN_LOOP_LIMIT = 6

interface ScoredThread {
  thread: AssistantChatThreadInput
  score: number
  confidence: number
  reason: string
  snippet: string
}

interface LiftingCsvRow {
  sourceChatTitle: string
  sourceChatId: string
  dateOrTimeframe: string
  category: string
  item: string
  value: string
  unit: string
  repsSets: string
  notes: string
  confidence: string
  sourceSnippet: string
}

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

const DOMAIN_TERMS: Record<string, string[]> = {
  lifting: [
    "lifting",
    "lift",
    "squat",
    "bench",
    "deadlift",
    "press",
    "overhead",
    "ohp",
    "program",
    "sets",
    "reps",
    "lb",
    "lbs",
    "kg",
    "bodyweight",
  ],
  calculus: [
    "calculus",
    "limits",
    "continuity",
    "derivatives",
    "integrals",
    "integration",
    "series",
    "taylor",
    "optimization",
    "curriculum",
  ],
  codex: ["codex", "@codex", "implementation", "bug", "fix", "repo", "files", "test"],
  product: [
    "product",
    "management",
    "pm",
    "interview",
    "metrics",
    "execution",
    "study",
    "prep",
    "leadership",
  ],
  golf: [
    "golf",
    "golfer",
    "swing",
    "club",
    "driver",
    "iron",
    "speed",
    "mobility",
    "rotator",
    "shoulder",
    "performance",
    "training",
  ],
  nutrition: [
    "nutrition",
    "diet",
    "protein",
    "carbs",
    "calories",
    "meals",
    "recovery",
    "sleep",
    "bodyweight",
  ],
}

const OPEN_LOOP_TERMS = [
  "todo",
  "next step",
  "next steps",
  "we should",
  "after this",
  "come back",
  "fix later",
  "run codex",
  "codex",
  "@codex",
  "implementation prompt",
  "turn that into",
  "do you want me",
  "would you like",
  "plan:",
  "debug",
  "bug",
  "unresolved",
]

const EXERCISES = [
  "bench press",
  "overhead press",
  "front squat",
  "barbell row",
  "deadlift",
  "bodyweight",
  "squat",
  "bench",
  "press",
  "row",
]

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

function requestDomainTokens(request: string): string[] {
  const lower = request.toLowerCase()
  const domains = Object.entries(DOMAIN_TERMS)
    .filter(([name, terms]) => lower.includes(name) || terms.some((term) => lower.includes(term)))
    .flatMap(([, terms]) => terms)
  return unique([...tokenize(request), ...domains])
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
    lower.includes("come back") ||
    lower.includes("planned to run codex") ||
    lower.includes("need a codex")

  if (lower.includes("codex") && (lower.includes("prompt") || lower.includes("follow"))) {
    return "codex_prompt_draft"
  }

  if (asksForOpenLoops) {
    return "open_loops"
  }

  if (
    lower.includes("spreadsheet") ||
    lower.includes("csv") ||
    lower.includes("extract") ||
    lower.includes("curriculum") ||
    lower.includes("study guide") ||
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

function interpretedGoalFor(kind: AssistantTaskKind, request: string): string {
  const lower = request.toLowerCase()
  if (kind === "codex_prompt_draft") {
    return "Find likely unfinished Codex plans and draft a clean @codex prompt the user can run."
  }
  if (kind === "open_loops") {
    return "Review recent chats for unfinished work, explain why each looks open, and suggest the next action."
  }
  if (kind === "cross_chat_artifact" && lower.includes("lifting")) {
    return "Look across lifting-related chats, extract only stated numbers/program details, and generate a CSV download."
  }
  if (kind === "cross_chat_artifact" && lower.includes("curriculum")) {
    return "Collect relevant learning chats and turn the available context into a downloadable curriculum document."
  }
  if (kind === "cross_chat_artifact" && lower.includes("plan")) {
    return "Synthesize relevant chats into a practical downloadable plan with evidence, priorities, and open questions."
  }
  if (
    kind === "cross_chat_artifact" &&
    (lower.includes("overview") || lower.includes("reference") || lower.includes("personal numbers"))
  ) {
    return "Create a concise reference artifact from the user's stated details across relevant chats."
  }
  if (kind === "cross_chat_artifact") {
    return "Collect relevant chats, organize the available context, and generate a downloadable artifact."
  }
  if (kind === "current_chat_help") {
    return "Use the current chat plus available workspace context to prepare the next product-level action."
  }
  return "Interpret the request and review available chat context without mutating existing chats."
}

function scoreThread(thread: AssistantChatThreadInput, tokens: string[]): ScoredThread {
  const title = thread.title.toLowerCase()
  const summary = (thread.summary || "").toLowerCase()
  const transcript = transcriptForThread(thread).toLowerCase()

  let matchScore = 0
  const matchedTerms: string[] = []
  for (const token of tokens) {
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
  const tokens = requestDomainTokens(request)
  const scored = threads.map((thread) => scoreThread(thread, tokens))
  scored.sort((a, b) => b.score - a.score || b.thread.updatedAt - a.thread.updatedAt)
  return scored.filter((item) => item.score > 0).slice(0, limit)
}

function findSnippet(thread: AssistantChatThreadInput, tokens: string[]): string {
  const fragments = thread.messages
    .filter((message) => message.text)
    .flatMap((message) => message.text.split(/(?<=[.!?])\s+|\n+/))
    .map((fragment) => fragment.trim())
    .filter(Boolean)

  const scored = fragments.map((fragment) => {
    const lower = fragment.toLowerCase()
    const score = tokens.reduce((sum, token) => sum + (lower.includes(token) ? 1 : 0), 0)
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

function splitIntoExtractionSegments(text: string): string[] {
  return text
    .split(/\n+|[.;]\s+|,\s+(?=(?:and\s+)?(?:squat|bench|deadlift|overhead|press|bodyweight|front|row))/i)
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function extractExercise(segment: string): string {
  const lower = segment.toLowerCase()
  return EXERCISES.find((exercise) => lower.includes(exercise)) || ""
}

function extractRepsSets(segment: string): string {
  const setsByReps = segment.match(/\b(\d+)\s*[xX]\s*(\d+)\b/)
  if (setsByReps) return `${setsByReps[1]}x${setsByReps[2]}`

  const setsOf = segment.match(/\b(\d+)\s+sets?\s+(?:of\s+)?(\d+)\b/i)
  if (setsOf) return `${setsOf[1]}x${setsOf[2]}`

  const reps = segment.match(/\b(?:for\s+)?(\d+)\s+reps?\b/i)
  if (reps) return `${reps[1]} reps`

  return ""
}

function extractTimeframe(segment: string, thread: AssistantChatThreadInput): string {
  const lower = segment.toLowerCase()
  if (lower.includes("next block") || lower.includes("next program")) return "next block"
  if (lower.includes("current")) return "current"
  if (lower.includes("today")) return "today"
  if (lower.includes("last week")) return "last week"
  return thread.updatedAt ? new Date(thread.updatedAt).toLocaleDateString("en-US") : ""
}

function extractLiftingRows(scored: ScoredThread[]): LiftingCsvRow[] {
  const rows: LiftingCsvRow[] = []
  const seen = new Set<string>()

  for (const item of scored) {
    for (const message of item.thread.messages) {
      if (!message.text) continue
      for (const segment of splitIntoExtractionSegments(message.text)) {
        const exercise = extractExercise(segment)
        const valueMatch = segment.match(/\b(\d+(?:\.\d+)?)\s*(lb|lbs|pounds|kg|kgs|%)\b/i)
        if (!exercise || !valueMatch) continue

        const key = `${item.thread.id}:${exercise}:${valueMatch[1]}:${truncate(segment, 120)}`
        if (seen.has(key)) continue
        seen.add(key)

        const lower = segment.toLowerCase()
        const category = lower.includes("program") || lower.includes("5x5") || lower.includes("next block")
          ? "program"
          : exercise === "bodyweight"
            ? "bodyweight"
            : "current strength"

        rows.push({
          sourceChatTitle: displayTitleForThread(item.thread),
          sourceChatId: item.thread.id,
          dateOrTimeframe: extractTimeframe(segment, item.thread),
          category,
          item: exercise === "bench" ? "bench press" : exercise,
          value: valueMatch[1],
          unit: valueMatch[2].toLowerCase().replace("pounds", "lb").replace("lbs", "lb").replace("kgs", "kg"),
          repsSets: extractRepsSets(segment),
          notes: lower.includes("shoulder") ? "shoulder note mentioned" : "",
          confidence: exercise && valueMatch ? "high" : "medium",
          sourceSnippet: truncate(segment, 220),
        })
      }
    }
  }

  return rows
}

function buildLiftingArtifact(request: string, scored: ScoredThread[]): {
  artifact?: AssistantArtifact
  summary: string
  missingInfo: string[]
} {
  const rows = extractLiftingRows(scored)
  const headers = [
    "sourceChatTitle",
    "sourceChatId",
    "dateOrTimeframe",
    "category",
    "item",
    "value",
    "unit",
    "repsSets",
    "notes",
    "confidence",
    "sourceSnippet",
  ]

  if (rows.length === 0) {
    return {
      summary:
        "I reviewed the available lifting-related chats, but did not find explicit exercise numbers with units to place in a CSV.",
      missingInfo: ["No explicit exercise values with units were found in the reviewed chats."],
    }
  }

  const content = rowsToCsv(headers, rows)
  const artifact = makeAssistantArtifact({
    kind: "csv",
    filename: `${slugifyFilenamePart(request)}.csv`,
    content,
    rowCount: rows.length,
  })

  return {
    artifact,
    summary: `I found ${rows.length} stated lifting/program data point${rows.length === 1 ? "" : "s"} and generated a CSV. Unknown fields are left blank rather than inferred.`,
    missingInfo: rows.some((row) => !row.repsSets)
      ? ["Some rows did not include reps or sets in the source text."]
      : [],
  }
}

function inferDocumentTitle(request: string): string {
  const lower = request.toLowerCase()
  if (lower.includes("calculus")) return "Calculus Curriculum"
  if (lower.includes("golf") && lower.includes("plan")) return "6-8 Week Golf Performance Plan"
  if (lower.includes("personal") && (lower.includes("number") || lower.includes("info"))) {
    return "Personal Numbers and Reference Overview"
  }
  if (lower.includes("product") || lower.includes("pm ")) return "Product Management Study Guide"
  if (lower.includes("brief")) return "Assistant Brief"
  return "Assistant Workspace Document"
}

function extractTopicBullets(request: string, scored: ScoredThread[]): string[] {
  const tokens = requestDomainTokens(request)
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

function buildDocumentArtifact(request: string, scored: ScoredThread[]): {
  artifact?: AssistantArtifact
  summary: string
  missingInfo: string[]
} {
  const title = inferDocumentTitle(request)
  const bullets = extractTopicBullets(request, scored)

  if (scored.length === 0 || bullets.length === 0) {
    return {
      summary: "I did not find enough matching chat context to generate a useful document.",
      missingInfo: ["No relevant source snippets were found in available chats."],
    }
  }

  const lower = request.toLowerCase()
  const suggestedStructure = lower.includes("calculus")
    ? [
        "Functions, graphs, and prerequisite review",
        "Limits and continuity",
        "Derivative rules and interpretation",
        "Applications of derivatives",
        "Basic integrals and the fundamental theorem",
        "Integration techniques",
        "Infinite series and Taylor polynomials",
        "Mixed review and applied problems",
      ]
    : [
        "Key context gathered from matching chats",
        "Decisions or recommendations explicitly supported by the chats",
        "Source notes to review before using the artifact",
        "Missing details to confirm",
      ]

  const sourceNotes = scored.slice(0, 6).map((item) => {
    const title = displayTitleForThread(item.thread)
    return `- ${title} (${item.thread.id}): ${item.snippet}`
  })

  const content = [
    `# ${title}`,
    "",
    "## Interpreted Goal",
    interpretedGoalFor("cross_chat_artifact", request),
    "",
    "## What I Found",
    ...bullets.map((bullet) => `- ${bullet}`),
    "",
    "## Suggested Artifact Structure",
    ...suggestedStructure.map((item, index) => `${index + 1}. ${item}`),
    "",
    "## Source Notes",
    ...sourceNotes,
    "",
    "## Sources Used",
    ...scored.map((item) => `- ${displayTitleForThread(item.thread)} (${item.thread.id}): ${item.reason}`),
    "",
    "## Missing or Ambiguous Information",
    "- Timing, exact workload, and mastery checks should be confirmed by the user.",
    "- The Assistant used only the provided demo chat context and did not invent outside facts.",
    "",
  ].join("\n")

  return {
    artifact: makeAssistantArtifact({
      kind: "markdown",
      filename: `${slugifyFilenamePart(title)}.md`,
      content,
    }),
    summary: `I created a downloadable ${title.toLowerCase()} from ${scored.length} source chat${scored.length === 1 ? "" : "s"}.`,
    missingInfo: ["Timing and exact scope may need user confirmation."],
  }
}

function hasQuestionEnding(text: string): boolean {
  return /\?\s*$/.test(text.trim()) || /\b(do you want|would you like|should i|can you confirm)\b/i.test(text)
}

function hasCodexTask(thread: AssistantChatThreadInput): boolean {
  return thread.messages.some((message) => {
    const text = message.text.trim().toLowerCase()
    return Boolean(message.taskId || message.isTaskCard || text.startsWith("@codex "))
  })
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
    reason.includes("Codex")
      ? "Inspect the relevant files, implement the planned fix, and add or update focused regression coverage."
      : "Turn the plan from this chat into the smallest safe implementation, preserving existing behavior.",
    "",
    "Guardrails:",
    "- Keep the patch narrowly scoped.",
    "- Preserve existing chat, history, branch, file, and artifact behavior.",
    "- Report changed files and verification steps.",
  ].join("\n")
}

function detectOpenLoop(thread: AssistantChatThreadInput, codexOnly: boolean): AssistantOpenLoopItem | null {
  const messages = thread.messages.filter(
    (message) => message.text?.trim() && !isAssistantControlMessage(message.text)
  )
  if (messages.length === 0) return null

  const transcript = messages.map((message) => message.text).join("\n").toLowerCase()
  const last = messages[messages.length - 1]
  const lastText = last.text || ""
  const recentText = messages.slice(-3).map((message) => message.text).join("\n")
  const lowerRecent = recentText.toLowerCase()
  const codexMentioned = /\bcodex\b|@codex/i.test(transcript)
  const codexPlannedButNotRun = codexMentioned && !hasCodexTask(thread)

  if (codexOnly && !codexPlannedButNotRun && !codexMentioned) return null

  const reasons: string[] = []
  let confidence = 0

  if (codexPlannedButNotRun) {
    reasons.push("The chat discussed running Codex, but no Codex task card appears in the thread.")
    confidence += 0.42
  }
  if (last.role === "assistant" && hasQuestionEnding(lastText)) {
    reasons.push("The last assistant message asks for a decision or follow-up.")
    confidence += 0.28
  }
  if (last.role === "user") {
    reasons.push("The last message is a user request with no later assistant response in this thread.")
    confidence += 0.24
  }
  const matchedSignals = OPEN_LOOP_TERMS.filter((term) => lowerRecent.includes(term))
  if (matchedSignals.length > 0) {
    reasons.push(`Recent messages include open-loop language: ${matchedSignals.slice(0, 3).join(", ")}.`)
    confidence += Math.min(0.3, matchedSignals.length * 0.08)
  }

  if (reasons.length === 0) return null

  const reason = reasons.join(" ")
  const nextAction = codexPlannedButNotRun
    ? "Review the plan and run a focused Codex prompt."
    : last.role === "assistant" && hasQuestionEnding(lastText)
      ? "Answer the assistant's question or ask the Assistant to draft the next prompt."
      : "Summarize where the chat stopped and choose the next concrete step."

  return {
    id: `${thread.id}-open-loop`,
    chatTitle: displayTitleForThread(thread),
    chatId: thread.id,
    lastUpdated: thread.updatedAt,
    reason,
    nextAction,
    canAssistantHelp: true,
    suggestedAction: codexPlannedButNotRun ? "Create Codex prompt" : "Summarize where we left off",
    draftCodexPrompt: codexPlannedButNotRun ? buildCodexPrompt(thread, reason) : undefined,
    snippet: truncate(recentText, 320),
    confidence: Math.min(0.97, Math.max(0.55, confidence)),
  }
}

function buildOpenLoopsResult(
  request: string,
  threads: AssistantChatThreadInput[],
  taskKind: AssistantTaskKind
): {
  openLoops: AssistantOpenLoopItem[]
  sources: AssistantSource[]
  summary: string
  actions: AssistantProposedAction[]
} {
  const lower = request.toLowerCase()
  const codexOnly = taskKind === "codex_prompt_draft" || (lower.includes("codex") && !lower.includes("anything"))
  const wantsWeek = lower.includes("week")
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const candidates = wantsWeek ? threads.filter((thread) => thread.updatedAt >= oneWeekAgo) : threads

  const openLoops = candidates
    .map((thread) => detectOpenLoop(thread, codexOnly))
    .filter((item): item is AssistantOpenLoopItem => Boolean(item))
    .sort((a, b) => b.confidence - a.confidence || (b.lastUpdated || 0) - (a.lastUpdated || 0))
    .slice(0, OPEN_LOOP_LIMIT)

  const sources = openLoops.map((item) => ({
    chatId: item.chatId,
    title: item.chatTitle,
    updatedAt: item.lastUpdated,
    reason: item.reason,
    snippet: item.snippet || "",
    confidence: item.confidence,
  }))

  const actions: AssistantProposedAction[] = []
  for (const item of openLoops) {
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
    openLoops,
    sources,
    summary:
      openLoops.length === 0
        ? "I reviewed the available recent chats and did not find a clear unfinished thread."
        : `I found ${openLoops.length} likely unfinished chat${openLoops.length === 1 ? "" : "s"} and prepared next actions.`,
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
  const initialKind = classifyTaskKind(args.request)
  const taskKind =
    initialKind === "clarification" && args.previousTask ? args.previousTask.taskKind : initialKind
  const effectiveRequest = args.previousTask
    ? [
        `Previous Assistant request: ${args.previousTask.requestText}`,
        `Previous interpreted goal: ${args.previousTask.interpretedGoal}`,
        `Previous result summary: ${args.previousTask.resultSummary}`,
        `Follow-up request: ${args.request}`,
      ].join("\n")
    : args.request
  const interpretedGoal = args.previousTask
    ? `Continue the previous Assistant task and apply this follow-up: ${args.request}`
    : interpretedGoalFor(taskKind, args.request)
  const progress: AssistantTaskStatus[] = ["queued", "interpreting", "searching", "reviewing"]

  if (taskKind === "open_loops" || taskKind === "codex_prompt_draft") {
    const result = buildOpenLoopsResult(args.request, args.threads, taskKind)
    return {
      id: args.id,
      createdAt: now,
      updatedAt: now,
      status: result.openLoops.length > 0 ? "ready" : "no_results",
      requestText: args.request,
      interpretedGoal,
      taskKind,
      progress: [...progress, "ready"],
      sources: result.sources,
      resultSummary: result.summary,
      openLoops: result.openLoops,
      proposedActions: result.actions,
      missingInfo:
        result.openLoops.length === 0
          ? ["No clear unfinished chats matched the requested scope."]
          : undefined,
      reviewedChatCount: args.threads.length,
    }
  }

  const scored = selectRelevantThreads(effectiveRequest, args.threads)
  const sources = sourcesFromScored(scored)
  const lower = effectiveRequest.toLowerCase()
  let artifactResult =
    lower.includes("lifting") || lower.includes("spreadsheet") || lower.includes("csv")
      ? buildLiftingArtifact(args.request, scored)
      : buildDocumentArtifact(args.request, scored)

  if (
    scored.length > 0 &&
    !(lower.includes("lifting") || lower.includes("spreadsheet") || lower.includes("csv"))
  ) {
    const modelArtifact = await generateAssistantDocumentArtifact({
      request: effectiveRequest,
      interpretedGoal,
      title: inferDocumentTitle(args.request),
      sources: scored.slice(0, 8).map((item) => ({
        chatId: item.thread.id,
        title: displayTitleForThread(item.thread),
        updatedAt: item.thread.updatedAt,
        reason: item.reason,
        snippet: item.snippet,
        transcript: transcriptForThread(item.thread),
      })),
    })

    if (modelArtifact) {
      artifactResult = modelArtifact
    } else if (artifactResult.artifact) {
      artifactResult = {
        ...artifactResult,
        missingInfo: [
          ...artifactResult.missingInfo,
          "Model-assisted synthesis was unavailable, so this demo used a deterministic organizer.",
        ],
      }
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
    interpretedGoal,
    taskKind,
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

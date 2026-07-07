/**
 * MockTaskRunner - Demo implementation of TaskRunner
 *
 * Uses OpenAI to generate realistic task outputs including:
 * - A title for the task
 * - A plan in markdown format
 * - File changes
 * - Log messages
 */

import { z } from "zod"
import type { TaskRunner, StartTaskArgs } from "./TaskRunner"
import type { CodexTask, WorkspaceSnapshot, CodexFileChange, CodexTaskContextSummary } from "./types"
import { getCodexStore } from "@/lib/store"
import { createParsedResponse, getConfigInfo } from "@/lib/openai"

/**
 * Zod schema for structured output from the model
 */
const FileChangeSchema = z.object({
  path: z.string().describe("File path relative to project root"),
  after: z.string().describe("Complete new file contents"),
})

const TaskOutputSchema = z.object({
  title: z
    .string()
    .describe("A short title for this task (max 60 chars)"),
  planMarkdown: z
    .string()
    .describe(
      "A step-by-step plan in markdown format explaining what changes will be made"
    ),
  changes: z
    .array(FileChangeSchema)
    .describe("Array of file changes to apply"),
  logs: z
    .array(z.string())
    .describe("Log messages showing progress"),
})

/**
 * Generate a unique task ID
 */
function generateTaskId(): string {
  return `task_${crypto.randomUUID().slice(0, 8)}`
}

/**
 * Build the prompt for task generation
 */
function buildTaskPrompt(
  userPrompt: string,
  workspace: WorkspaceSnapshot
): string {
  const fileList = Object.entries(workspace.files)
    .map(([path, content]) => {
      // Truncate large files
      const truncated =
        content.length > 500 ? content.slice(0, 500) + "\n... (truncated)" : content
      return `### ${path}\n\`\`\`\n${truncated}\n\`\`\``
    })
    .join("\n\n")

  return `You are a coding assistant that generates file changes based on user requests.

## Current Workspace Files

${fileList}

## User Request

${userPrompt}

## Instructions

1. Generate a short, descriptive title for this task (max 60 chars)
2. Create a step-by-step plan in markdown explaining what you'll do
3. Generate the file changes needed (provide complete new file contents for each changed file)
4. Create log messages that would appear during execution

## Important Guidelines for File Generation

**CRITICAL**: Always generate actual code files, not just documentation!

When the user requests building, adding, or implementing a feature:
- Generate **3 to 6 files** minimum to demonstrate a realistic implementation
- **MUST include at least 2-3 actual code files** (.ts, .tsx, .js, .jsx, .css, .html, etc.)
- Include a mix of file types appropriate to the request:
  - Source files (e.g., .ts, .tsx, .js files in src/)
  - Type definitions or interfaces when relevant (.ts files with types/interfaces)
  - Styles if UI-related (.css, .scss)
  - Configuration files if needed
  - Update README.md ONLY as a supplementary file, never as the main output
- Keep individual file changes concise and demo-friendly (under 50 lines per file is ideal)
- Prefer creating new files over modifying existing ones for new features
- Use realistic file paths that fit the project structure (e.g., src/components/, src/utils/, src/routes/, src/api/)

**FORBIDDEN**: Returning only README.md or only documentation files. Always include implementation code.

Example for "add a health check endpoint":
- src/routes/health.ts (main implementation)
- src/types/health.ts (type definitions)
- src/utils/health-checks.ts (utility functions)
- src/tests/health.test.ts (optional: test file)

Return a JSON object with: title, planMarkdown, changes, logs`
}

/**
 * Infer programming language from file extension
 */
function inferLanguageFromPath(path: string): string | null {
  const ext = path.split('.').pop()?.toLowerCase()
  const languageMap: Record<string, string> = {
    'ts': 'TypeScript',
    'tsx': 'TypeScript (React)',
    'js': 'JavaScript',
    'jsx': 'JavaScript (React)',
    'css': 'CSS',
    'scss': 'SCSS',
    'html': 'HTML',
    'json': 'JSON',
    'md': 'Markdown',
    'py': 'Python',
    'go': 'Go',
    'rs': 'Rust',
    'java': 'Java',
    'rb': 'Ruby',
    'php': 'PHP',
    'sql': 'SQL',
    'yaml': 'YAML',
    'yml': 'YAML',
    'sh': 'Shell',
    'bash': 'Bash',
  }
  return ext ? languageMap[ext] || null : null
}

/**
 * Generate a compact context summary from completed task
 * Used for injecting context into follow-up chat messages
 */
function generateContextSummary(
  title: string,
  changes: CodexFileChange[],
  planMarkdown: string
): CodexTaskContextSummary {
  // Extract file paths
  const filePaths = changes.map(c => c.path)
  
  // Infer languages from file extensions (deduplicated)
  const languagesSet = new Set<string>()
  for (const path of filePaths) {
    const lang = inferLanguageFromPath(path)
    if (lang) languagesSet.add(lang)
  }
  const languages = Array.from(languagesSet)
  
  // Generate bullet summary from plan markdown
  // Extract key points, limiting to 3-6 bullets
  const bullets: string[] = []
  
  // Try to extract bullets from the plan
  const lines = planMarkdown.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    // Look for bullet points or numbered items
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || /^\d+\.\s/.test(trimmed)) {
      const text = trimmed.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '')
      if (text.length > 10 && text.length < 150) {
        bullets.push(text)
        if (bullets.length >= 6) break
      }
    }
  }
  
  // If we didn't get enough bullets from the plan, generate basic ones
  if (bullets.length < 3) {
    // Add file-based bullets
    const newFiles = changes.filter(c => !c.before).map(c => c.path)
    const modifiedFiles = changes.filter(c => c.before).map(c => c.path)
    
    if (newFiles.length > 0) {
      bullets.push(`Created ${newFiles.length} new file${newFiles.length > 1 ? 's' : ''}: ${newFiles.slice(0, 3).join(', ')}${newFiles.length > 3 ? '...' : ''}`)
    }
    if (modifiedFiles.length > 0) {
      bullets.push(`Modified ${modifiedFiles.length} existing file${modifiedFiles.length > 1 ? 's' : ''}`)
    }
    if (languages.length > 0) {
      bullets.push(`Primary language${languages.length > 1 ? 's' : ''}: ${languages.slice(0, 3).join(', ')}`)
    }
  }
  
  return {
    title,
    filePaths,
    languages,
    bullets: bullets.slice(0, 6), // Max 6 bullets
  }
}

/**
 * Generate a unified diff from changes
 */
function generateUnifiedDiff(
  changes: CodexFileChange[],
  workspace: WorkspaceSnapshot
): string {
  const diffs: string[] = []

  for (const change of changes) {
    const before = workspace.files[change.path] || ""
    const after = change.after

    // Simple diff header
    diffs.push(`--- a/${change.path}`)
    diffs.push(`+++ b/${change.path}`)

    // Show a simplified diff (in production, use a real diff library)
    const beforeLines = before.split("\n")
    const afterLines = after.split("\n")

    if (before === "") {
      // New file
      diffs.push(`@@ -0,0 +1,${afterLines.length} @@`)
      afterLines.forEach((line) => diffs.push(`+${line}`))
    } else {
      // Modified file - just show first few changes for demo
      diffs.push(`@@ -1,${beforeLines.length} +1,${afterLines.length} @@`)
      // Show first 10 lines of each for brevity
      beforeLines.slice(0, 10).forEach((line) => diffs.push(`-${line}`))
      afterLines.slice(0, 10).forEach((line) => diffs.push(`+${line}`))
      if (afterLines.length > 10) {
        diffs.push(`... (${afterLines.length - 10} more lines)`)
      }
    }

    diffs.push("")
  }

  return diffs.join("\n")
}

/**
 * MockTaskRunner implementation
 *
 * Uses the centralized OpenAI client with "codex" request kind:
 * - Model: gpt-5.4-mini (or OPENAI_MODEL_CODEX env var)
 * - Reasoning effort: low (NOT "none" - that causes 400 errors!)
 * - Text verbosity: medium
 */
export class MockTaskRunner implements TaskRunner {
  async startTask(args: StartTaskArgs): Promise<CodexTask> {
    const { prompt, workspace, demoUid } = args
    const store = getCodexStore()

    // Create initial task
    const taskId = generateTaskId()
    const now = Date.now()

    const task: CodexTask = {
      id: taskId,
      createdAt: now,
      updatedAt: now,
      prompt,
      title: "Processing...",
      status: "running",
      planMarkdown: "",
      changes: [],
      logs: ["Task started", "Analyzing workspace..."],
      diffUnified: "",
    }

    // Save initial task
    await store.saveTask(demoUid, task)

    try {
      // Build prompt and call OpenAI using centralized client
      const fullPrompt = buildTaskPrompt(prompt, workspace)
      const config = getConfigInfo("codex")

      console.log(`[MockTaskRunner] Starting task ${taskId} with model ${config.model} (reasoning: ${config.reasoning})`)

      // Uses the "codex" request kind from the centralized client
      const { parsed } = await createParsedResponse({
        kind: "codex",
        input: fullPrompt,
        schema: TaskOutputSchema,
        schemaName: "task_output",
      })

      if (!parsed) {
        throw new Error("Failed to parse task output")
      }

      // Populate changes with before content
      const changesWithBefore: CodexFileChange[] = parsed.changes.map(
        (change) => ({
          path: change.path,
          before: workspace.files[change.path],
          after: change.after,
        })
      )

      // Generate unified diff
      const diffUnified = generateUnifiedDiff(changesWithBefore, workspace)
      
      // Generate compact context summary for chat follow-ups
      const contextSummary = generateContextSummary(
        parsed.title,
        changesWithBefore,
        parsed.planMarkdown
      )

      // Update task with results
      const updatedTask: CodexTask = {
        ...task,
        updatedAt: Date.now(),
        title: parsed.title,
        status: "draft_ready",
        planMarkdown: parsed.planMarkdown,
        changes: changesWithBefore,
        diffUnified,
        contextSummary,
        logs: [
          ...task.logs,
          "Generating plan...",
          ...parsed.logs,
          "Changes ready for review",
        ],
      }

      await store.saveTask(demoUid, updatedTask)
      console.log(`[MockTaskRunner] Task ${taskId} completed with ${changesWithBefore.length} changes`)

      return updatedTask
    } catch (error) {
      console.error(`[MockTaskRunner] Task ${taskId} failed:`, error)

      // Update task with error
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error"
      const failedTask: CodexTask = {
        ...task,
        updatedAt: Date.now(),
        status: "failed",
        error: errorMessage,
        logs: [...task.logs, `Error: ${errorMessage}`],
      }

      await store.saveTask(demoUid, failedTask)
      return failedTask
    }
  }

  async applyChanges(taskId: string, demoUid: string): Promise<WorkspaceSnapshot> {
    const store = getCodexStore()

    const task = await store.getTask(demoUid, taskId)
    if (!task) {
      throw new Error(`Task not found: ${taskId}`)
    }

    if (task.status !== "draft_ready" && task.status !== "applied") {
      throw new Error(`Cannot apply changes: task status is ${task.status}`)
    }

    // Get current workspace
    const workspace = await store.getWorkspace(demoUid)

    // Apply changes
    const updatedFiles = { ...workspace.files }
    for (const change of task.changes) {
      updatedFiles[change.path] = change.after
    }

    const updatedWorkspace: WorkspaceSnapshot = {
      files: updatedFiles,
      updatedAt: Date.now(),
    }

    // Save updated workspace
    await store.saveWorkspace(demoUid, updatedWorkspace)

    // Update task status
    const updatedTask: CodexTask = {
      ...task,
      updatedAt: Date.now(),
      status: "applied",
      logs: [...task.logs, "Changes applied to workspace"],
    }
    await store.saveTask(demoUid, updatedTask)

    console.log(`[MockTaskRunner] Applied ${task.changes.length} changes for task ${taskId}`)

    return updatedWorkspace
  }

  async createPR(taskId: string, demoUid: string): Promise<{ prUrl: string }> {
    const store = getCodexStore()

    const task = await store.getTask(demoUid, taskId)
    if (!task) {
      throw new Error(`Task not found: ${taskId}`)
    }

    if (task.status !== "applied" && task.status !== "draft_ready") {
      throw new Error(`Cannot create PR: task status is ${task.status}`)
    }

    // Generate fake PR URL
    const prNumber = Math.floor(Math.random() * 900) + 100
    const prUrl = `https://github.com/demo-org/demo-repo/pull/${prNumber}`

    // Update task
    const updatedTask: CodexTask = {
      ...task,
      updatedAt: Date.now(),
      status: "pr_created",
      prUrl,
      logs: [...task.logs, `PR created: ${prUrl}`],
    }
    await store.saveTask(demoUid, updatedTask)

    console.log(`[MockTaskRunner] Created PR for task ${taskId}: ${prUrl}`)

    return { prUrl }
  }

  async getTask(taskId: string, demoUid: string): Promise<CodexTask | null> {
    const store = getCodexStore()
    return store.getTask(demoUid, taskId)
  }
}

/**
 * Singleton instance
 */
let mockRunnerInstance: MockTaskRunner | null = null

export function getMockTaskRunner(): MockTaskRunner {
  if (!mockRunnerInstance) {
    mockRunnerInstance = new MockTaskRunner()
  }
  return mockRunnerInstance
}

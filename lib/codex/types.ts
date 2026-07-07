/**
 * Codex Task Types for Demo 3
 *
 * This defines the data model for @codex tasks that appear inline in chat.
 */

/**
 * Task status enum
 */
export type CodexTaskStatus =
  | "queued"
  | "running"
  | "draft_ready"
  | "applied"
  | "pr_created"
  | "done"
  | "failed"

/**
 * A file change produced by the task
 */
export interface CodexFileChange {
  /** File path relative to workspace root */
  path: string
  /** Original content (if modifying existing file) */
  before?: string
  /** New content */
  after: string
}

/**
 * Compact context summary for chat follow-ups
 * Generated when a task completes, injected into chat context
 */
export interface CodexTaskContextSummary {
  /** Task title */
  title: string
  /** Key file paths created/modified */
  filePaths: string[]
  /** Inferred programming languages from file extensions */
  languages: string[]
  /** 3-6 bullet summary of what was built */
  bullets: string[]
}

/**
 * A Codex task that processes a user prompt and generates code changes
 */
export interface CodexTask {
  /** Unique task ID */
  id: string
  /** Creation timestamp (Unix ms) */
  createdAt: number
  /** Last update timestamp (Unix ms) */
  updatedAt: number
  /** The user's original prompt (without @codex prefix) */
  prompt: string
  /** Generated title for the task */
  title: string
  /** Current status */
  status: CodexTaskStatus
  /** Generated plan in markdown format */
  planMarkdown: string
  /** File changes to apply */
  changes: CodexFileChange[]
  /** Unified diff string (optional, for display) */
  diffUnified?: string
  /** Log messages from the task runner */
  logs: string[]
  /** PR URL if created */
  prUrl?: string
  /** Error message if failed */
  error?: string
  /** Compact context summary for chat follow-ups (generated on completion) */
  contextSummary?: CodexTaskContextSummary
}

/**
 * Workspace snapshot - represents the current state of demo files
 */
export interface WorkspaceSnapshot {
  /** Map of file path to file contents */
  files: Record<string, string>
  /** Last update timestamp */
  updatedAt: number
}

/**
 * Task metadata without full changes (for list views)
 */
export type CodexTaskMeta = Omit<CodexTask, "changes" | "planMarkdown" | "logs">

/**
 * Human-readable status labels
 */
export const TASK_STATUS_LABELS: Record<CodexTaskStatus, string> = {
  queued: "Queued",
  running: "Generating...",
  draft_ready: "Ready to Apply",
  applied: "Applied",
  pr_created: "PR Created",
  done: "Done",
  failed: "Failed",
}

/**
 * Status colors for UI — Interlace same-room signal tokens (quiet tinted washes).
 * ready/pending = flax warning, applied/done = sage success, failed = brick
 * destructive, running & PR = the dyed-thread accent family.
 */
export const TASK_STATUS_COLORS: Record<CodexTaskStatus, string> = {
  queued: "bg-muted text-muted-foreground",
  running: "bg-accent-soft text-primary",
  draft_ready: "bg-warning/15 text-warning-foreground dark:text-warning",
  applied: "bg-success/15 text-success",
  pr_created: "bg-accent-soft text-primary",
  done: "bg-success/15 text-success",
  failed: "bg-destructive/15 text-destructive",
}

/**
 * Default workspace files for demo
 */
export const DEFAULT_WORKSPACE_FILES: Record<string, string> = {
  "README.md": `# Demo Project

This is a sample project for the Codex demo.

## Getting Started

\`\`\`bash
npm install
npm run dev
\`\`\`
`,
  "package.json": `{
  "name": "demo-project",
  "version": "1.0.0",
  "scripts": {
    "dev": "ts-node src/app.ts",
    "build": "tsc",
    "test": "jest"
  },
  "dependencies": {
    "express": "^4.18.2"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0"
  }
}
`,
  "src/app.ts": `import express from 'express';
import { greet } from './utils';

const app = express();
const PORT = 3000;

app.get('/', (req, res) => {
  res.json({ message: greet('World') });
});

app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`);
});
`,
  "src/utils.ts": `/**
 * Utility functions
 */

export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}
`,
}

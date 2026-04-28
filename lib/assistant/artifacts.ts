import type { AssistantArtifact, AssistantArtifactKind } from "@/lib/assistant/types"

export function escapeCsvField(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value)
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`
  }
  return raw
}

export function rowsToCsv<T extends object>(headers: string[], rows: T[]): string {
  const lines = [
    headers.map(escapeCsvField).join(","),
    ...rows.map((row) =>
      headers.map((header) => escapeCsvField(row[header as keyof T])).join(",")
    ),
  ]
  return lines.join("\n")
}

export function sanitizeArtifactContent(content: string): string {
  return content.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
}

export function makeAssistantArtifact(args: {
  kind: AssistantArtifactKind
  filename: string
  content: string
  rowCount?: number
}): AssistantArtifact {
  const mimeTypeByKind: Record<AssistantArtifactKind, string> = {
    csv: "text/csv;charset=utf-8",
    markdown: "text/markdown;charset=utf-8",
    text: "text/plain;charset=utf-8",
    html: "text/html;charset=utf-8",
  }

  const content = sanitizeArtifactContent(args.content)
  const byteCount = new TextEncoder().encode(content).length
  const sizeLabel =
    byteCount < 1024
      ? `${byteCount} B`
      : `${Math.round((byteCount / 1024) * 10) / 10} KB`

  return {
    kind: args.kind,
    filename: args.filename,
    mimeType: mimeTypeByKind[args.kind],
    content,
    rowCount: args.rowCount,
    sizeLabel,
  }
}

export function slugifyFilenamePart(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
  return slug || "assistant-output"
}

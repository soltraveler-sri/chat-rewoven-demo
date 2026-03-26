/**
 * Document text extraction utilities
 *
 * Supports PDF and DOCX files. Extracts plain text content
 * for use in LLM context and TTS generation.
 */

import { PDFParse } from "pdf-parse"
import mammoth from "mammoth"

export interface ExtractedDocument {
  /** The extracted plain text */
  text: string
  /** Original filename */
  filename: string
  /** File type */
  fileType: "pdf" | "docx"
  /** Approximate word count */
  wordCount: number
  /** Approximate character count */
  charCount: number
}

const SUPPORTED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
])

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB

/**
 * Validate that a file is a supported document type
 */
export function validateDocumentFile(
  file: { name: string; type: string; size: number }
): { valid: boolean; error?: string } {
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)` }
  }

  // Check by MIME type or file extension
  const ext = file.name.toLowerCase().split(".").pop()
  if (!SUPPORTED_TYPES.has(file.type) && ext !== "pdf" && ext !== "docx") {
    return { valid: false, error: "Unsupported file type. Please upload a PDF or DOCX file." }
  }

  return { valid: true }
}

/**
 * Extract text from a PDF buffer
 */
async function extractFromPDF(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) })
  const result = await parser.getText()
  return result.text
}

/**
 * Extract text from a DOCX buffer
 */
async function extractFromDOCX(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer })
  return result.value
}

/**
 * Extract text from a document file buffer
 */
export async function extractText(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<ExtractedDocument> {
  const ext = filename.toLowerCase().split(".").pop()

  let text: string
  let fileType: "pdf" | "docx"

  if (mimeType === "application/pdf" || ext === "pdf") {
    text = await extractFromPDF(buffer)
    fileType = "pdf"
  } else if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx"
  ) {
    text = await extractFromDOCX(buffer)
    fileType = "docx"
  } else {
    throw new Error(`Unsupported file type: ${mimeType} (${ext})`)
  }

  // Clean up extracted text - normalize whitespace
  text = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim()

  const wordCount = text.split(/\s+/).filter(Boolean).length
  const charCount = text.length

  return {
    text,
    filename,
    fileType,
    wordCount,
    charCount,
  }
}

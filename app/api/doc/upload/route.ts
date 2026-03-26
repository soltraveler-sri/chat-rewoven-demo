import { NextRequest, NextResponse } from "next/server"
import { extractText, validateDocumentFile } from "@/lib/doc/extract"

export const runtime = "nodejs"

/**
 * POST /api/doc/upload
 *
 * Accepts a file upload (PDF or DOCX), extracts text content,
 * and returns the extracted text with metadata.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      )
    }

    // Validate file
    const validation = validateDocumentFile({
      name: file.name,
      type: file.type,
      size: file.size,
    })

    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      )
    }

    // Extract text
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const doc = await extractText(buffer, file.name, file.type)

    if (!doc.text || doc.text.length < 10) {
      return NextResponse.json(
        { error: "Could not extract text from this file. It may be scanned/image-based." },
        { status: 422 }
      )
    }

    console.log(`[Doc:upload] Extracted ${doc.wordCount} words from ${doc.filename}`)

    return NextResponse.json({
      filename: doc.filename,
      fileType: doc.fileType,
      text: doc.text,
      wordCount: doc.wordCount,
      charCount: doc.charCount,
    })
  } catch (error) {
    console.error("[Doc:upload] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process file" },
      { status: 500 }
    )
  }
}

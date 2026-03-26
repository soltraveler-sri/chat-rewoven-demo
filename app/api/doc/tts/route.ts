import { NextRequest, NextResponse } from "next/server"
import { generateDocumentTTS, type TTSVoice, TTS_VOICES } from "@/lib/doc/tts"

export const runtime = "nodejs"

// TTS generation can take a while for long documents
export const maxDuration = 120 // 2 minutes

interface TTSRequest {
  text: string
  voice?: TTSVoice
  model?: "tts-1" | "tts-1-hd"
  speed?: number
}

/**
 * POST /api/doc/tts
 *
 * Generates TTS audio for document text.
 * Handles chunking internally for long documents.
 * Returns MP3 audio as a binary response.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as TTSRequest

    if (!body.text || typeof body.text !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'text' field" },
        { status: 400 }
      )
    }

    // Validate voice if provided
    if (body.voice && !TTS_VOICES.includes(body.voice)) {
      return NextResponse.json(
        { error: `Invalid voice. Must be one of: ${TTS_VOICES.join(", ")}` },
        { status: 400 }
      )
    }

    // Cap text length for safety (roughly 50 pages)
    const MAX_TEXT_LENGTH = 200_000
    const text = body.text.length > MAX_TEXT_LENGTH
      ? body.text.slice(0, MAX_TEXT_LENGTH)
      : body.text

    console.log(`[Doc:tts] Generating TTS for ${text.length} chars, voice: ${body.voice || "nova"}`)

    const audioBuffer = await generateDocumentTTS(text, {
      voice: body.voice || "nova",
      model: body.model || "tts-1",
      speed: body.speed || 1.0,
    })

    console.log(`[Doc:tts] Generated ${audioBuffer.length} bytes of audio`)

    // Return as MP3 binary
    const uint8 = new Uint8Array(audioBuffer)
    return new NextResponse(uint8, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.length.toString(),
        "Cache-Control": "no-cache",
      },
    })
  } catch (error) {
    console.error("[Doc:tts] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "TTS generation failed" },
      { status: 500 }
    )
  }
}

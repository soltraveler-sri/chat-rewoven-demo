import { NextRequest, NextResponse } from "next/server"
import { chunkText, generateChunkAudio, type TTSVoice, TTS_VOICES } from "@/lib/doc/tts"

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
 * Generates TTS audio for document text with streaming.
 * Chunks text and streams each chunk's MP3 bytes as they're generated,
 * enabling progressive playback on the client via MediaSource.
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

    const textChunks = chunkText(text)

    console.log(`[Doc:tts] Streaming TTS for ${text.length} chars, ${textChunks.length} chunks, voice: ${body.voice || "nova"}`)

    const options = {
      voice: (body.voice || "nova") as TTSVoice,
      model: (body.model || "tts-1") as "tts-1" | "tts-1-hd",
      speed: body.speed || 1.0,
    }

    // Stream MP3 bytes as each chunk is generated
    const t0 = Date.now()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for (let i = 0; i < textChunks.length; i++) {
            const chunkStart = Date.now()
            console.log(`[Doc:tts] Generating chunk ${i + 1}/${textChunks.length} (${textChunks[i].length} chars) | +${chunkStart - t0}ms`)
            const audioBuffer = await generateChunkAudio(textChunks[i], options)
            const chunkEnd = Date.now()
            console.log(`[Doc:tts] Chunk ${i + 1}/${textChunks.length} done: ${audioBuffer.byteLength} bytes in ${chunkEnd - chunkStart}ms | enqueuing at +${chunkEnd - t0}ms`)
            controller.enqueue(new Uint8Array(audioBuffer))
          }
          console.log(`[Doc:tts] Streaming complete (${textChunks.length} chunks) | total ${Date.now() - t0}ms`)
          controller.close()
        } catch (error) {
          console.error("[Doc:tts] Stream error:", error)
          controller.error(error)
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "audio/mpeg",
        "X-Total-Chunks": textChunks.length.toString(),
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

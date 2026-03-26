/**
 * TTS (Text-to-Speech) utilities
 *
 * Handles chunking long documents into segments that fit within
 * the OpenAI TTS API's character limit, and concatenating the
 * resulting audio buffers.
 */

import { getOpenAIClient } from "@/lib/openai"

/** OpenAI TTS character limit per request */
const TTS_CHAR_LIMIT = 4096

/** Available OpenAI TTS voices */
export const TTS_VOICES = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
] as const

export type TTSVoice = (typeof TTS_VOICES)[number]

export interface TTSOptions {
  voice?: TTSVoice
  /** "tts-1" for speed, "tts-1-hd" for quality */
  model?: "tts-1" | "tts-1-hd"
  /** Playback speed multiplier (0.25 to 4.0) */
  speed?: number
}

/**
 * Split text into chunks that fit within the TTS character limit.
 * Splits on sentence boundaries to avoid cutting words/sentences.
 */
export function chunkText(text: string, maxChars: number = TTS_CHAR_LIMIT): string[] {
  if (text.length <= maxChars) {
    return [text]
  }

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining.trim())
      break
    }

    // Find the best split point within the limit
    let splitIndex = maxChars

    // Try to split at sentence boundary (. ! ?)
    const sentenceEnd = remaining.lastIndexOf(". ", splitIndex)
    const exclamEnd = remaining.lastIndexOf("! ", splitIndex)
    const questEnd = remaining.lastIndexOf("? ", splitIndex)
    const bestSentence = Math.max(sentenceEnd, exclamEnd, questEnd)

    if (bestSentence > maxChars * 0.5) {
      // Found a good sentence boundary in the second half
      splitIndex = bestSentence + 1 // Include the punctuation
    } else {
      // Fall back to paragraph boundary
      const paraEnd = remaining.lastIndexOf("\n", splitIndex)
      if (paraEnd > maxChars * 0.3) {
        splitIndex = paraEnd
      } else {
        // Fall back to word boundary
        const wordEnd = remaining.lastIndexOf(" ", splitIndex)
        if (wordEnd > maxChars * 0.3) {
          splitIndex = wordEnd
        }
        // Else just hard-cut at maxChars
      }
    }

    const chunk = remaining.slice(0, splitIndex).trim()
    if (chunk) {
      chunks.push(chunk)
    }
    remaining = remaining.slice(splitIndex).trim()
  }

  return chunks
}

/**
 * Generate TTS audio for a single text chunk.
 * Returns the raw audio buffer (mp3).
 */
export async function generateChunkAudio(
  text: string,
  options: TTSOptions
): Promise<Buffer> {
  const client = getOpenAIClient()

  const response = await client.audio.speech.create({
    model: options.model || "tts-1",
    voice: options.voice || "nova",
    input: text,
    response_format: "mp3",
    speed: options.speed || 1.0,
  })

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/**
 * Generate TTS audio for a full document.
 *
 * Chunks the text, generates audio for each chunk in sequence,
 * and concatenates the resulting MP3 buffers.
 *
 * @param onProgress Optional callback for progress updates (chunk index, total chunks)
 */
export async function generateDocumentTTS(
  text: string,
  options: TTSOptions = {},
  onProgress?: (current: number, total: number) => void
): Promise<Buffer> {
  const chunks = chunkText(text)
  const audioBuffers: Buffer[] = []

  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(i + 1, chunks.length)

    const audio = await generateChunkAudio(chunks[i], options)
    audioBuffers.push(audio)
  }

  // Concatenate MP3 buffers (MP3 frames are self-contained, so simple concatenation works)
  return Buffer.concat(audioBuffers)
}

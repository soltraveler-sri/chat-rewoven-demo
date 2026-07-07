/**
 * TTS (Text-to-Speech) utilities
 *
 * Handles chunking long documents into segments that fit within
 * the OpenAI TTS API's character limit, and concatenating the
 * resulting audio buffers.
 */

import { getOpenAIClient } from "@/lib/openai"
import {
  DEFAULT_TTS_MODEL,
  DEFAULT_TTS_VOICE,
  TTS_VOICES,
  type TTSVoice,
} from "./tts-constants"

export { TTS_VOICES, DEFAULT_TTS_MODEL, DEFAULT_TTS_VOICE }
export type { TTSVoice }

/**
 * Target chunk size for TTS requests.
 * Smaller chunks = faster time-to-first-audio (each chunk generates in ~3-6s).
 * OpenAI's hard limit is 4096, but we use 500 to enable progressive streaming.
 */
const TTS_CHUNK_SIZE = 500

/** Server-side defaults with env overrides — clients should not pick models */
export function getTTSModel(): string {
  return process.env.OPENAI_MODEL_TTS || DEFAULT_TTS_MODEL
}

export function getTTSVoice(): TTSVoice {
  const envVoice = process.env.OPENAI_TTS_VOICE as TTSVoice | undefined
  return envVoice && TTS_VOICES.includes(envVoice) ? envVoice : DEFAULT_TTS_VOICE
}

export interface TTSOptions {
  voice?: TTSVoice
  /** TTS model ID; defaults to the latest gpt-4o-mini-tts snapshot */
  model?: string
}

/**
 * Split text into chunks that fit within the TTS character limit.
 * Splits on sentence boundaries to avoid cutting words/sentences.
 */
export function chunkText(text: string, maxChars: number = TTS_CHUNK_SIZE): string[] {
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

    if (bestSentence > maxChars * 0.3) {
      // Found a good sentence boundary
      splitIndex = bestSentence + 1 // Include the punctuation
    } else {
      // Fall back to paragraph boundary
      const paraEnd = remaining.lastIndexOf("\n", splitIndex)
      if (paraEnd > maxChars * 0.2) {
        splitIndex = paraEnd
      } else {
        // Fall back to word boundary
        const wordEnd = remaining.lastIndexOf(" ", splitIndex)
        if (wordEnd > maxChars * 0.2) {
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

  // Note: no `speed` param — it is unsupported on gpt-4o-mini-tts models;
  // playback speed is handled client-side via audio.playbackRate.
  const response = await client.audio.speech.create({
    model: options.model || getTTSModel(),
    voice: options.voice || getTTSVoice(),
    input: text,
    response_format: "mp3",
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

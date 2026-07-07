/**
 * TTS configuration shared between server and client code.
 *
 * Defaults live here (not in client components) so the demo works with only
 * OPENAI_API_KEY set, and so the model/voice can be changed in one place.
 * Server code may override via OPENAI_MODEL_TTS / OPENAI_TTS_VOICE env vars.
 */

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

/** Latest steerable TTS model (SDK-verified) */
export const DEFAULT_TTS_MODEL = "gpt-4o-mini-tts-2025-12-15"

export const DEFAULT_TTS_VOICE: TTSVoice = "nova"

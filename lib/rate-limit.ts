/**
 * Lightweight rate limiting for model-backed API routes.
 *
 * The hosted demo exposes routes that spend real OpenAI credits, so each
 * anonymous demo user (demo_uid cookie, IP fallback) gets a fixed-window
 * allowance per route group. Limits are deliberately generous for genuine
 * demo use and only exist to stop abuse of the public deployment.
 *
 * Counters live in a per-instance memory map and, when Redis is configured,
 * are mirrored there so limits hold across serverless instances. Failures
 * never block a request — rate limiting degrades open, not closed.
 */

import { NextRequest, NextResponse } from "next/server"
import { getRedisClient } from "@/lib/store/redis-client"

interface RateLimitRule {
  /** Max requests per window */
  limit: number
  /** Window size in seconds */
  windowSec: number
}

/** Route groups with separate allowances (TTS is the expensive one) */
export const RATE_LIMITS = {
  /** Chat, summarize, finder, intent, stacks, assistant, codex, titles */
  model: { limit: 30, windowSec: 60 } satisfies RateLimitRule,
  /** Text-to-speech audio generation */
  tts: { limit: 5, windowSec: 60 } satisfies RateLimitRule,
} as const

export type RateLimitGroup = keyof typeof RATE_LIMITS

// Per-instance fallback counters: key -> { count, windowStart }
const memoryCounters = new Map<string, { count: number; windowStart: number }>()
const MEMORY_COUNTER_CAP = 5_000

function callerKey(request: NextRequest): string {
  const uid = request.cookies.get("demo_uid")?.value
  if (uid) return `uid:${uid}`
  const forwarded = request.headers.get("x-forwarded-for")
  return `ip:${forwarded?.split(",")[0]?.trim() || "unknown"}`
}

function checkMemory(key: string, rule: RateLimitRule): boolean {
  const now = Date.now()
  const windowMs = rule.windowSec * 1000
  const entry = memoryCounters.get(key)

  if (!entry || now - entry.windowStart >= windowMs) {
    if (memoryCounters.size >= MEMORY_COUNTER_CAP) {
      memoryCounters.clear() // crude but bounded; demo-scale traffic
    }
    memoryCounters.set(key, { count: 1, windowStart: now })
    return true
  }

  entry.count++
  return entry.count <= rule.limit
}

async function checkRedis(key: string, rule: RateLimitRule): Promise<boolean | null> {
  const redis = getRedisClient()
  if (!redis) return null

  try {
    const windowId = Math.floor(Date.now() / (rule.windowSec * 1000))
    const redisKey = `ratelimit:${key}:${windowId}`
    const count = await redis.incr(redisKey)
    if (count === 1) {
      await redis.expire(redisKey, rule.windowSec + 5)
    }
    return count <= rule.limit
  } catch {
    // Redis unavailable — fall back to the in-memory counter
    return null
  }
}

/**
 * Enforce a rate limit for the calling demo user.
 * Returns a 429 response to send, or null when the request is allowed.
 */
export async function enforceRateLimit(
  request: NextRequest,
  group: RateLimitGroup
): Promise<NextResponse | null> {
  const rule = RATE_LIMITS[group]
  const key = `${group}:${callerKey(request)}`

  const redisResult = await checkRedis(key, rule)
  const allowed = redisResult ?? checkMemory(key, rule)

  if (allowed) return null

  return NextResponse.json(
    {
      error: "You're sending requests a little too fast for the demo. Give it a moment and try again.",
      code: "rate_limited",
      retryAfterSec: rule.windowSec,
    },
    { status: 429, headers: { "Retry-After": String(rule.windowSec) } }
  )
}

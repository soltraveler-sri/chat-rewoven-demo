/**
 * Redis Heartbeat — Vercel Cron route
 *
 * Performs a single direct write to Upstash Redis once per day
 * to prevent the database from being archived due to inactivity.
 *
 * This route intentionally BYPASSES the app's ResilientRedisStore
 * (which can silently fall back to in-memory) and uses a fresh
 * @vercel/kv client pointed at the real Upstash instance.
 *
 * Protected by CRON_SECRET (Bearer token).
 */

import { NextResponse } from "next/server"
import { createClient } from "@vercel/kv"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const HEARTBEAT_KEY = "__system:redis_heartbeat"
const TTL_SECONDS = 30 * 24 * 60 * 60 // 30 days

function resolveRedisCredentials(): { url: string; token: string } {
  // Upstash official (preferred)
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN
  if (upstashUrl && upstashToken) {
    return { url: upstashUrl, token: upstashToken }
  }

  // Vercel KV fallback
  const kvUrl = process.env.KV_REST_API_URL
  const kvToken = process.env.KV_REST_API_TOKEN
  if (kvUrl && kvToken) {
    return { url: kvUrl, token: kvToken }
  }

  throw new Error(
    "Redis credentials missing. Set UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN."
  )
}

export async function GET(request: Request): Promise<NextResponse> {
  // ── Auth ──────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error("[redis-heartbeat] CRON_SECRET env var is not set")
    return NextResponse.json(
      { ok: false, error: "Server misconfigured: CRON_SECRET not set" },
      { status: 500 }
    )
  }

  const auth = request.headers.get("authorization")
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  // ── Heartbeat ─────────────────────────────────────────────
  try {
    const { url, token } = resolveRedisCredentials()
    const redis = createClient({ url, token })

    const ranAt = new Date().toISOString()
    await redis.set(HEARTBEAT_KEY, ranAt, { ex: TTL_SECONDS })

    console.log(
      `[redis-heartbeat] OK key=${HEARTBEAT_KEY} ranAt=${ranAt}`
    )

    return NextResponse.json({
      ok: true,
      key: HEARTBEAT_KEY,
      command: "SET",
      ttlSeconds: TTL_SECONDS,
      ranAt,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[redis-heartbeat] FAIL error=${message}`)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

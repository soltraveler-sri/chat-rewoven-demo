import { NextResponse } from "next/server"
import { getStorageInfo } from "@/lib/store"
import { getRedisClient } from "@/lib/store/redis-client"

const STORAGE_PING_TIMEOUT_MS = 1500

async function checkRedisConnectivity(): Promise<{
  healthy: boolean
  connectivity: "ok" | "error" | "timeout" | "not_configured"
  latencyMs?: number
  error?: string
}> {
  const client = getRedisClient()
  if (!client) {
    return { healthy: false, connectivity: "not_configured" }
  }

  const startedAt = Date.now()
  const ping = client
    .ping()
    .then(() => ({
      healthy: true,
      connectivity: "ok" as const,
      latencyMs: Date.now() - startedAt,
    }))
    .catch((error: unknown) => ({
      healthy: false,
      connectivity: "error" as const,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }))

  const timeout = new Promise<{
    healthy: false
    connectivity: "timeout"
    latencyMs: number
    error: string
  }>((resolve) => {
    setTimeout(() => {
      resolve({
        healthy: false,
        connectivity: "timeout",
        latencyMs: Date.now() - startedAt,
        error: "Redis health check timed out",
      })
    }, STORAGE_PING_TIMEOUT_MS)
  })

  return Promise.race([ping, timeout])
}

/**
 * GET /api/storage - Get current storage status
 *
 * Returns information about the storage backend:
 * - storageType: "kv" | "memory" (for backwards compatibility)
 * - kvConfigured: boolean
 * - mode: "redis" | "memory" (actual storage mode)
 * - backend: "upstash" | "vercel_kv" | "memory" (detected backend)
 * - detectedEnvKeys: string[] (env var names found, no values)
 * - warning?: string (human-readable warning if using memory store)
 */
export async function GET() {
  try {
    const info = getStorageInfo()
    if (!info.kvConfigured) {
      return NextResponse.json({
        ...info,
        healthy: false,
        connectivity: "not_configured",
      })
    }

    const health = await checkRedisConnectivity()
    return NextResponse.json({
      ...info,
      ...health,
      warning: health.healthy
        ? info.warning
        : `Redis is configured but not reachable (${health.error || health.connectivity}). The demo will use its session fallback until the database is restored or replaced.`,
    })
  } catch (error) {
    console.error("[GET /api/storage] Error:", error)
    return NextResponse.json(
      {
        storageType: "memory",
        kvConfigured: false,
        mode: "memory",
        backend: "memory",
        healthy: false,
        connectivity: "error",
        detectedEnvKeys: [],
        warning:
          error instanceof Error ? error.message : "Failed to get storage info",
      },
      { status: 500 }
    )
  }
}

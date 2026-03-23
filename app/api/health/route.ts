import { NextResponse } from "next/server"
import { detectRedisEnv, getRedisClient } from "@/lib/store/redis-client"

/**
 * GET /api/health - Redis connectivity diagnostic endpoint
 *
 * Tests actual Redis connectivity and returns detailed diagnostics:
 * - Environment variable detection
 * - URL format validation
 * - Actual PING test with latency
 * - Detailed error cause chain on failure
 */
export async function GET() {
  const startTime = Date.now()
  const config = detectRedisEnv()

  // Redact URL to show only the host (no credentials)
  let urlInfo: string | null = null
  if (config.url) {
    try {
      const parsed = new URL(config.url)
      urlInfo = `${parsed.protocol}//${parsed.host} (protocol: ${parsed.protocol})`
    } catch {
      urlInfo = `INVALID URL (cannot parse: starts with "${config.url.slice(0, 12)}...")`
    }
  }

  const diagnostics: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    envDetection: {
      backend: config.backend,
      configured: config.configured,
      detectedEnvKeys: config.detectedEnvKeys,
      urlPresent: !!config.url,
      tokenPresent: !!config.token,
      urlInfo,
      urlLength: config.url?.length ?? 0,
      tokenLength: config.token?.length ?? 0,
    },
    allRedisEnvKeys: Object.keys(process.env).filter(
      (k) =>
        k.includes("REDIS") ||
        k.includes("KV_") ||
        k.includes("UPSTASH")
    ),
  }

  // URL format validation
  if (config.url) {
    const urlChecks = {
      startsWithHttps: config.url.startsWith("https://"),
      startsWithHttp: config.url.startsWith("http://"),
      startsWithRedis: config.url.startsWith("redis://") || config.url.startsWith("rediss://"),
      containsUpstash: config.url.includes("upstash.io"),
      endsWithSlash: config.url.endsWith("/"),
    }
    diagnostics.urlValidation = urlChecks

    if (urlChecks.startsWithRedis) {
      diagnostics.urlWarning =
        "URL uses redis:// protocol — @vercel/kv requires HTTPS REST API URL, not native Redis protocol. " +
        "Check if KV_REST_API_URL is set to the REST endpoint (https://xxx.upstash.io) not the Redis endpoint (redis://xxx.upstash.io:6379)"
    }
    if (!urlChecks.startsWithHttps && !urlChecks.startsWithHttp) {
      diagnostics.urlWarning =
        "URL does not start with http(s):// — this will cause fetch to fail"
    }
  }

  // Actual connectivity test
  if (config.configured) {
    const client = getRedisClient()
    if (client) {
      const pingStart = Date.now()
      try {
        const result = await client.ping()
        const pingMs = Date.now() - pingStart
        diagnostics.connectivity = {
          status: "ok",
          pingResult: result,
          latencyMs: pingMs,
        }
      } catch (err: unknown) {
        const pingMs = Date.now() - pingStart
        const errorChain: string[] = []
        let current: unknown = err
        let depth = 0
        while (current instanceof Error && depth < 5) {
          errorChain.push(`[${current.constructor.name}] ${current.message}`)
          current = current.cause
          depth++
        }
        if (current && !(current instanceof Error)) {
          errorChain.push(`[raw] ${String(current)}`)
        }

        diagnostics.connectivity = {
          status: "error",
          latencyMs: pingMs,
          errorMessage: err instanceof Error ? err.message : String(err),
          errorName: err instanceof Error ? err.constructor.name : typeof err,
          errorCauseChain: errorChain,
          // Check for common issues
          likelyCause: diagnoseCause(err, config.url),
        }
      }
    } else {
      diagnostics.connectivity = {
        status: "error",
        errorMessage: "getRedisClient() returned null despite configured=true",
      }
    }
  } else {
    diagnostics.connectivity = {
      status: "not_configured",
      message: "No Redis env vars detected — using in-memory storage",
    }
  }

  diagnostics.totalDiagnosticMs = Date.now() - startTime

  const isHealthy =
    diagnostics.connectivity &&
    (diagnostics.connectivity as Record<string, unknown>).status === "ok"

  return NextResponse.json(diagnostics, { status: isHealthy ? 200 : 503 })
}

function diagnoseCause(err: unknown, url?: string): string {
  const msg = err instanceof Error ? err.message : String(err)
  const cause = err instanceof Error ? String(err.cause ?? "") : ""
  const combined = `${msg} ${cause}`.toLowerCase()

  if (combined.includes("enotfound") || combined.includes("dns")) {
    return "DNS resolution failed — the Redis host cannot be resolved. Check if the URL is correct."
  }
  if (combined.includes("econnrefused")) {
    return "Connection refused — the host is reachable but not accepting connections on that port."
  }
  if (combined.includes("etimedout") || combined.includes("timeout")) {
    return "Connection timed out — possible region mismatch, firewall, or the Upstash instance is paused."
  }
  if (combined.includes("certificate") || combined.includes("ssl") || combined.includes("tls")) {
    return "TLS/SSL error — certificate verification failed."
  }
  if (combined.includes("unauthorized") || combined.includes("401")) {
    return "Authentication failed — the token may be invalid or expired."
  }
  if (combined.includes("fetch failed")) {
    if (url?.startsWith("redis://") || url?.startsWith("rediss://")) {
      return "LIKELY ROOT CAUSE: URL uses redis:// protocol but @vercel/kv needs https:// REST API URL. " +
        "The KV_REST_API_URL env var may contain the native Redis URL instead of the REST endpoint."
    }
    return "Generic fetch failure — could be DNS, network, TLS, or timeout. Check errorCauseChain for details."
  }
  return "Unknown — check errorCauseChain for details."
}

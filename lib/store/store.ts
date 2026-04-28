/**
 * Chat store abstraction with Redis backend + in-memory fallback
 *
 * This provides persistence for Demo 2/3 features without affecting Demo 1.
 * All operations are best-effort - failures should not break the app.
 * 
 * Supports both Vercel KV and Upstash Redis env var patterns.
 */

import type {
  StoredChatThread,
  StoredChatThreadMeta,
  StoredChatMessage,
  StoredChatCategory,
  StacksMeta,
} from "./types"
import { STORED_CHAT_CATEGORIES } from "./types"
import { getRedisClient, isRedisConfigured, getStorageMode } from "./redis-client"

/**
 * Store interface for chat persistence
 */
export interface ChatStore {
  // Thread operations
  listThreads(demoUid: string): Promise<StoredChatThreadMeta[]>
  getThread(demoUid: string, threadId: string): Promise<StoredChatThread | null>
  createThread(
    demoUid: string,
    initial: Partial<StoredChatThread>
  ): Promise<StoredChatThread>
  appendMessage(
    demoUid: string,
    threadId: string,
    message: StoredChatMessage
  ): Promise<void>
  updateThread(
    demoUid: string,
    threadId: string,
    partial: Partial<StoredChatThread>
  ): Promise<void>
  deleteThread(demoUid: string, threadId: string): Promise<void>

  // Stacks meta operations
  getStacksMeta(demoUid: string): Promise<StacksMeta>
  setLastStacksRefreshAt(demoUid: string, ts: number): Promise<void>
}

/**
 * TTL for KV keys (7 days in seconds)
 */
const KV_TTL_SECONDS = 7 * 24 * 60 * 60 // 604800 seconds

/**
 * Key generation helpers for KV store
 * Namespace: u:{demo_uid}:chats:* for chat-related keys
 */
function threadListKey(demoUid: string): string {
  return `u:${demoUid}:chats:index`
}

function threadKey(demoUid: string, threadId: string): string {
  return `u:${demoUid}:chat:${threadId}`
}

function stacksMetaKey(demoUid: string): string {
  return `u:${demoUid}:stacks:meta`
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  return crypto.randomUUID()
}

/**
 * Calculate category counts from threads
 */
function calculateCounts(
  threads: StoredChatThreadMeta[]
): Record<StoredChatCategory, number> {
  const counts = {} as Record<StoredChatCategory, number>
  for (const cat of STORED_CHAT_CATEGORIES) {
    counts[cat] = 0
  }
  for (const thread of threads) {
    counts[thread.category] = (counts[thread.category] || 0) + 1
  }
  return counts
}

/**
 * Check if we're in development mode
 */
function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development"
}

/**
 * Log store operations (one line per request)
 */
function logOp(
  storeType: "Redis" | "Memory",
  operation: string,
  demoUid: string,
  extra?: string
): void {
  const uid = demoUid.slice(0, 8)
  const msg = extra
    ? `[ChatStore:${storeType}] ${operation} uid=${uid} ${extra}`
    : `[ChatStore:${storeType}] ${operation} uid=${uid}`
  console.log(msg)
}

/**
 * Redis-backed store implementation
 * Works with both Vercel KV and Upstash Redis env var patterns
 */
class RedisStore implements ChatStore {
  async listThreads(demoUid: string): Promise<StoredChatThreadMeta[]> {
    logOp("Redis", "listThreads", demoUid)
    const redis = getRedisClient()
    if (!redis) return []

    // Let errors propagate so ResilientRedisStore can detect and fall back
    const threadIds = await redis.smembers(threadListKey(demoUid))
    if (!threadIds || threadIds.length === 0) return []

    const threads: StoredChatThreadMeta[] = []
    for (const id of threadIds) {
      const thread = await redis.get<StoredChatThread>(
        threadKey(demoUid, id as string)
      )
      if (thread) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { messages: _, ...meta } = thread
        threads.push(meta)
      }
    }

    threads.sort((a, b) => b.updatedAt - a.updatedAt)
    return threads
  }

  async getThread(
    demoUid: string,
    threadId: string
  ): Promise<StoredChatThread | null> {
    logOp("Redis", "getThread", demoUid, `threadId=${threadId.slice(0, 8)}`)
    const redis = getRedisClient()
    if (!redis) return null

    return await redis.get<StoredChatThread>(threadKey(demoUid, threadId))
  }

  async createThread(
    demoUid: string,
    initial: Partial<StoredChatThread>
  ): Promise<StoredChatThread> {
    const now = Date.now()
    const thread: StoredChatThread = {
      id: initial.id || generateId(),
      title: initial.title || "New Chat",
      category: initial.category || "recent",
      summary: initial.summary,
      createdAt: initial.createdAt || now,
      updatedAt: initial.updatedAt || now,
      lastResponseId: initial.lastResponseId ?? null,
      messages: initial.messages || [],
    }

    logOp("Redis", "createThread", demoUid, `threadId=${thread.id.slice(0, 8)}`)
    const redis = getRedisClient()
    if (!redis) return thread

    // Let errors propagate so ResilientRedisStore can detect and fall back
    await redis.set(threadKey(demoUid, thread.id), thread, { ex: KV_TTL_SECONDS })
    await redis.sadd(threadListKey(demoUid), thread.id)
    await redis.expire(threadListKey(demoUid), KV_TTL_SECONDS)

    return thread
  }

  async appendMessage(
    demoUid: string,
    threadId: string,
    message: StoredChatMessage
  ): Promise<void> {
    logOp(
      "Redis",
      "appendMessage",
      demoUid,
      `threadId=${threadId.slice(0, 8)} role=${message.role}`
    )
    const redis = getRedisClient()
    if (!redis) return

    const thread = await this.getThread(demoUid, threadId)
    if (!thread) {
      console.warn("[RedisStore] appendMessage: thread not found", threadId)
      return
    }

    thread.messages.push(message)
    thread.updatedAt = Date.now()
    if (message.responseId) {
      thread.lastResponseId = message.responseId
    }

    await redis.set(threadKey(demoUid, threadId), thread, { ex: KV_TTL_SECONDS })
  }

  async updateThread(
    demoUid: string,
    threadId: string,
    partial: Partial<StoredChatThread>
  ): Promise<void> {
    logOp("Redis", "updateThread", demoUid, `threadId=${threadId.slice(0, 8)}`)
    const redis = getRedisClient()
    if (!redis) return

    const thread = await this.getThread(demoUid, threadId)
    if (!thread) {
      console.warn("[RedisStore] updateThread: thread not found", threadId)
      return
    }

    const updated = {
      ...thread,
      ...partial,
      updatedAt: Date.now(),
    }

    await redis.set(threadKey(demoUid, threadId), updated, { ex: KV_TTL_SECONDS })
  }

  async deleteThread(demoUid: string, threadId: string): Promise<void> {
    logOp("Redis", "deleteThread", demoUid, `threadId=${threadId.slice(0, 8)}`)
    const redis = getRedisClient()
    if (!redis) return

    await redis.del(threadKey(demoUid, threadId))
    await redis.srem(threadListKey(demoUid), threadId)
  }

  async getStacksMeta(demoUid: string): Promise<StacksMeta> {
    logOp("Redis", "getStacksMeta", demoUid)
    const redis = getRedisClient()
    if (!redis) {
      return { lastRefreshAt: null, counts: calculateCounts([]) }
    }

    const meta = await redis.get<{ lastRefreshAt: number | null }>(
      stacksMetaKey(demoUid)
    )
    const threads = await this.listThreads(demoUid)
    return {
      lastRefreshAt: meta?.lastRefreshAt ?? null,
      counts: calculateCounts(threads),
    }
  }

  async setLastStacksRefreshAt(demoUid: string, ts: number): Promise<void> {
    logOp("Redis", "setLastStacksRefreshAt", demoUid)
    const redis = getRedisClient()
    if (!redis) return

    await redis.set(stacksMetaKey(demoUid), { lastRefreshAt: ts }, { ex: KV_TTL_SECONDS })
  }
}

/**
 * In-memory store for local development without Vercel KV
 */
class MemoryStore implements ChatStore {
  private threads: Map<string, Map<string, StoredChatThread>> = new Map()
  private stacksMeta: Map<string, { lastRefreshAt: number | null }> = new Map()

  private getOrCreateUserThreads(
    demoUid: string
  ): Map<string, StoredChatThread> {
    if (!this.threads.has(demoUid)) {
      this.threads.set(demoUid, new Map())
    }
    return this.threads.get(demoUid)!
  }

  async listThreads(demoUid: string): Promise<StoredChatThreadMeta[]> {
    logOp("Memory", "listThreads", demoUid)
    const userThreads = this.getOrCreateUserThreads(demoUid)
    const threads = Array.from(userThreads.values()).map((t) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { messages: _, ...meta } = t
      return meta
    })
    threads.sort((a, b) => b.updatedAt - a.updatedAt)
    return threads
  }

  async getThread(
    demoUid: string,
    threadId: string
  ): Promise<StoredChatThread | null> {
    logOp("Memory", "getThread", demoUid, `threadId=${threadId.slice(0, 8)}`)
    const userThreads = this.getOrCreateUserThreads(demoUid)
    return userThreads.get(threadId) ?? null
  }

  async createThread(
    demoUid: string,
    initial: Partial<StoredChatThread>
  ): Promise<StoredChatThread> {
    const now = Date.now()
    const thread: StoredChatThread = {
      id: initial.id || generateId(),
      title: initial.title || "New Chat",
      category: initial.category || "recent",
      summary: initial.summary,
      createdAt: initial.createdAt || now,
      updatedAt: initial.updatedAt || now,
      lastResponseId: initial.lastResponseId ?? null,
      messages: initial.messages || [],
    }

    logOp("Memory", "createThread", demoUid, `threadId=${thread.id.slice(0, 8)}`)
    const userThreads = this.getOrCreateUserThreads(demoUid)
    userThreads.set(thread.id, thread)
    return thread
  }

  async upsertThread(demoUid: string, thread: StoredChatThread): Promise<void> {
    logOp("Memory", "upsertThread", demoUid, `threadId=${thread.id.slice(0, 8)}`)
    const userThreads = this.getOrCreateUserThreads(demoUid)
    userThreads.set(thread.id, {
      ...thread,
      messages: [...thread.messages],
    })
  }

  async appendMessage(
    demoUid: string,
    threadId: string,
    message: StoredChatMessage
  ): Promise<void> {
    logOp(
      "Memory",
      "appendMessage",
      demoUid,
      `threadId=${threadId.slice(0, 8)} role=${message.role}`
    )
    const userThreads = this.getOrCreateUserThreads(demoUid)
    const thread = userThreads.get(threadId)
    if (!thread) {
      console.warn("[MemoryStore] appendMessage: thread not found", threadId)
      return
    }

    thread.messages.push(message)
    thread.updatedAt = Date.now()
    if (message.responseId) {
      thread.lastResponseId = message.responseId
    }
  }

  async updateThread(
    demoUid: string,
    threadId: string,
    partial: Partial<StoredChatThread>
  ): Promise<void> {
    logOp("Memory", "updateThread", demoUid, `threadId=${threadId.slice(0, 8)}`)
    const userThreads = this.getOrCreateUserThreads(demoUid)
    const thread = userThreads.get(threadId)
    if (!thread) {
      console.warn("[MemoryStore] updateThread: thread not found", threadId)
      return
    }

    Object.assign(thread, partial, { updatedAt: Date.now() })
  }

  async deleteThread(demoUid: string, threadId: string): Promise<void> {
    logOp("Memory", "deleteThread", demoUid, `threadId=${threadId.slice(0, 8)}`)
    const userThreads = this.getOrCreateUserThreads(demoUid)
    userThreads.delete(threadId)
  }

  async getStacksMeta(demoUid: string): Promise<StacksMeta> {
    logOp("Memory", "getStacksMeta", demoUid)
    const meta = this.stacksMeta.get(demoUid)
    const threads = await this.listThreads(demoUid)
    return {
      lastRefreshAt: meta?.lastRefreshAt ?? null,
      counts: calculateCounts(threads),
    }
  }

  async setLastStacksRefreshAt(demoUid: string, ts: number): Promise<void> {
    logOp("Memory", "setLastStacksRefreshAt", demoUid)
    this.stacksMeta.set(demoUid, { lastRefreshAt: ts })
  }
}

/**
 * Resilient store that wraps RedisStore with automatic MemoryStore fallback.
 *
 * When Redis is configured but unreachable (DNS failure, timeout, etc.),
 * this store detects the failure and transparently switches to an in-memory
 * fallback so the application continues to function. It periodically retries
 * Redis to recover when connectivity is restored.
 */
class ResilientRedisStore implements ChatStore {
  private redis: RedisStore
  private fallback: MemoryStore
  private redisHealthy = true
  private consecutiveFailures = 0
  private lastRetryAt = 0
  private fallbackWarningLogged = false

  /** After this many consecutive failures, switch to fallback */
  private static readonly FAILURE_THRESHOLD = 1
  /** Minimum interval (ms) between Redis retry attempts after fallback */
  private static readonly RETRY_INTERVAL_MS = 30_000

  constructor(redis: RedisStore, fallback: MemoryStore) {
    this.redis = redis
    this.fallback = fallback
  }

  /** Whether we're currently using the fallback store */
  get isUsingFallback(): boolean {
    return !this.redisHealthy
  }

  private markRedisFailure(): void {
    this.consecutiveFailures++
    if (this.consecutiveFailures >= ResilientRedisStore.FAILURE_THRESHOLD) {
      if (this.redisHealthy) {
        this.redisHealthy = false
        if (!this.fallbackWarningLogged) {
          console.warn(
            "[ChatStore:Resilient] Redis unreachable — falling back to in-memory store. " +
            "Data will persist within this serverless instance but not across cold starts."
          )
          this.fallbackWarningLogged = true
        }
      }
    }
  }

  private markRedisSuccess(): void {
    if (!this.redisHealthy) {
      console.log("[ChatStore:Resilient] Redis connectivity restored")
    }
    this.redisHealthy = true
    this.consecutiveFailures = 0
  }

  private shouldRetryRedis(): boolean {
    if (this.redisHealthy) return true
    const now = Date.now()
    if (now - this.lastRetryAt >= ResilientRedisStore.RETRY_INTERVAL_MS) {
      this.lastRetryAt = now
      return true
    }
    return false
  }

  private async mirrorRedisThreadToFallback(demoUid: string, threadId: string): Promise<void> {
    try {
      const thread = await this.redis.getThread(demoUid, threadId)
      if (thread) {
        await this.fallback.upsertThread(demoUid, thread)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(
        `[ChatStore:Resilient] Failed to mirror Redis thread to fallback: ${message}`
      )
    }
  }

  /**
   * Try a Redis operation; on failure, fall back to memory store.
   * For read operations, the memory store result is returned (may be empty on first fallback).
   * For write operations, we always write to the fallback too so data is available.
   */
  private async tryRedisOrFallback<T>(
    operation: string,
    redisFn: () => Promise<T>,
    fallbackFn: () => Promise<T>,
    isWrite = false,
  ): Promise<T> {
    // If Redis is unhealthy and we shouldn't retry yet, go straight to fallback
    if (!this.shouldRetryRedis()) {
      return fallbackFn()
    }

    try {
      const result = await redisFn()
      this.markRedisSuccess()
      return result
    } catch (error) {
      this.markRedisFailure()
      const errMsg = error instanceof Error ? error.message : String(error)
      const cause = error instanceof Error && error.cause
        ? ` (cause: ${error.cause instanceof Error ? error.cause.message : String(error.cause)})`
        : ""
      console.error(`[ChatStore:Resilient] ${operation} Redis failed, using fallback: ${errMsg}${cause}`)
      return fallbackFn()
    }
  }

  async listThreads(demoUid: string): Promise<StoredChatThreadMeta[]> {
    return this.tryRedisOrFallback(
      "listThreads",
      () => this.redis.listThreads(demoUid),
      () => this.fallback.listThreads(demoUid),
    )
  }

  async getThread(demoUid: string, threadId: string): Promise<StoredChatThread | null> {
    return this.tryRedisOrFallback(
      "getThread",
      () => this.redis.getThread(demoUid, threadId),
      () => this.fallback.getThread(demoUid, threadId),
    )
  }

  async createThread(demoUid: string, initial: Partial<StoredChatThread>): Promise<StoredChatThread> {
    // Always write to fallback so data is available if Redis fails later
    const thread = await this.tryRedisOrFallback(
      "createThread",
      async () => {
        const result = await this.redis.createThread(demoUid, initial)
        // Mirror to fallback for resilience
        await this.fallback.createThread(demoUid, { ...result })
        return result
      },
      () => this.fallback.createThread(demoUid, initial),
      true,
    )
    return thread
  }

  async appendMessage(demoUid: string, threadId: string, message: StoredChatMessage): Promise<void> {
    await this.tryRedisOrFallback(
      "appendMessage",
      async () => {
        await this.redis.appendMessage(demoUid, threadId, message)
        await this.mirrorRedisThreadToFallback(demoUid, threadId)
      },
      () => this.fallback.appendMessage(demoUid, threadId, message),
      true,
    )
  }

  async updateThread(demoUid: string, threadId: string, partial: Partial<StoredChatThread>): Promise<void> {
    await this.tryRedisOrFallback(
      "updateThread",
      async () => {
        await this.redis.updateThread(demoUid, threadId, partial)
        await this.mirrorRedisThreadToFallback(demoUid, threadId)
      },
      () => this.fallback.updateThread(demoUid, threadId, partial),
      true,
    )
  }

  async deleteThread(demoUid: string, threadId: string): Promise<void> {
    await this.tryRedisOrFallback(
      "deleteThread",
      async () => {
        await this.redis.deleteThread(demoUid, threadId)
        await this.fallback.deleteThread(demoUid, threadId)
      },
      () => this.fallback.deleteThread(demoUid, threadId),
      true,
    )
  }

  async getStacksMeta(demoUid: string): Promise<StacksMeta> {
    return this.tryRedisOrFallback(
      "getStacksMeta",
      () => this.redis.getStacksMeta(demoUid),
      () => this.fallback.getStacksMeta(demoUid),
    )
  }

  async setLastStacksRefreshAt(demoUid: string, ts: number): Promise<void> {
    await this.tryRedisOrFallback(
      "setLastStacksRefreshAt",
      async () => {
        await this.redis.setLastStacksRefreshAt(demoUid, ts)
        await this.fallback.setLastStacksRefreshAt(demoUid, ts)
      },
      () => this.fallback.setLastStacksRefreshAt(demoUid, ts),
      true,
    )
  }
}

/**
 * Singleton store instances (persists across requests)
 */
let memoryStoreInstance: MemoryStore | null = null
let redisStoreInstance: RedisStore | null = null
let resilientStoreInstance: ResilientRedisStore | null = null
let storeInitLogged = false

function getMemoryStore(): MemoryStore {
  if (!memoryStoreInstance) {
    memoryStoreInstance = new MemoryStore()
  }
  return memoryStoreInstance
}

function getRedisStore(): RedisStore {
  if (!redisStoreInstance) {
    redisStoreInstance = new RedisStore()
  }
  return redisStoreInstance
}

function getResilientStore(): ResilientRedisStore {
  if (!resilientStoreInstance) {
    resilientStoreInstance = new ResilientRedisStore(getRedisStore(), getMemoryStore())
    if (!storeInitLogged) {
      console.log("[ChatStore] Initialized resilient Redis store (with memory fallback)")
      storeInitLogged = true
    }
  }
  return resilientStoreInstance
}

/**
 * Get the appropriate store implementation based on environment
 *
 * When Redis is configured, returns a ResilientRedisStore that automatically
 * falls back to MemoryStore if Redis becomes unreachable.
 */
export function getChatStore(): ChatStore {
  if (isRedisConfigured()) {
    return getResilientStore()
  }
  if (isDevelopment()) {
    if (!storeInitLogged) {
      console.log("[ChatStore] Initialized in-memory store (development only)")
      storeInitLogged = true
    }
    return getMemoryStore()
  }
  console.warn(
    "[ChatStore] WARNING: Using in-memory store in production. " +
      "Configure Redis env vars (KV_REST_API_URL/TOKEN or UPSTASH_REDIS_REST_URL/TOKEN) for durable storage."
  )
  return getMemoryStore()
}

/**
 * Get the storage mode currently in use
 */
export { getStorageMode }

/**
 * Export a default store instance
 */
export const chatStore = {
  get store(): ChatStore {
    return getChatStore()
  },
}

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import {
  createAssistantTaskResult,
  createFailedAssistantTask,
  mergeAssistantThreads,
} from "@/lib/assistant/retrieval"
import type { AssistantChatThreadInput } from "@/lib/assistant/types"
import { getChatStore } from "@/lib/store"

export const runtime = "nodejs"

const AssistantMessageSchema = z.object({
  id: z.string().optional(),
  role: z.string(),
  text: z.string(),
  createdAt: z.number().optional(),
  taskId: z.string().optional(),
  isTaskCard: z.boolean().optional(),
})

const AssistantThreadSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string().optional(),
  category: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  messages: z.array(AssistantMessageSchema).default([]),
})

const AssistantRunSchema = z.object({
  request: z.string().min(1),
  clientTaskId: z.string().optional(),
  localThreads: z.array(AssistantThreadSchema).optional(),
  currentThread: AssistantThreadSchema.nullable().optional(),
  previousTask: z
    .object({
      requestText: z.string(),
      interpretedGoal: z.string(),
      taskKind: z.string(),
      resultSummary: z.string(),
      sources: z.array(z.unknown()),
    })
    .nullable()
    .optional(),
})

function getDemoUid(request: NextRequest): string | null {
  return request.cookies.get("demo_uid")?.value ?? null
}

async function loadStoredThreads(demoUid: string | null): Promise<AssistantChatThreadInput[]> {
  if (!demoUid) return []

  try {
    const store = getChatStore()
    const metas = await store.listThreads(demoUid)
    const threads: Array<AssistantChatThreadInput | null> = await Promise.all(
      metas.map(async (meta) => {
        try {
          const thread = await store.getThread(demoUid, meta.id)
          if (!thread) return null
          const assistantThread: AssistantChatThreadInput = {
            id: thread.id,
            title: thread.title,
            summary: thread.summary,
            category: thread.category,
            createdAt: thread.createdAt,
            updatedAt: thread.updatedAt,
            messages: thread.messages.map((message) => ({
              id: message.id,
              role: message.role,
              text: message.text,
              createdAt: message.createdAt,
              taskId: message.taskId,
              isTaskCard: message.isTaskCard,
            })),
          }
          return assistantThread
        } catch {
          return null
        }
      })
    )
    return threads.filter((thread): thread is AssistantChatThreadInput => Boolean(thread))
  } catch (error) {
    console.error("[POST /api/assistant/run] Failed to load stored threads:", error)
    return []
  }
}

export async function POST(request: NextRequest) {
  let requestText = ""
  const fallbackId = crypto.randomUUID()

  try {
    const body = await request.json()
    const parsed = AssistantRunSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request body",
          details: parsed.error.flatten(),
        },
        { status: 400 }
      )
    }

    requestText = parsed.data.request.trim()
    const taskId = parsed.data.clientTaskId || fallbackId
    const storedThreads = await loadStoredThreads(getDemoUid(request))
    const threads = mergeAssistantThreads(
      [...(parsed.data.localThreads || []), ...storedThreads],
      parsed.data.currentThread || null
    )

    const task = await createAssistantTaskResult({
      id: taskId,
      request: requestText,
      threads,
      previousTask: null,
    })

    return NextResponse.json({ task })
  } catch (error) {
    console.error("[POST /api/assistant/run] Error:", error)
    const message = error instanceof Error ? error.message : "Assistant failed to run"
    const task = createFailedAssistantTask({
      id: fallbackId,
      request: requestText || "Assistant request",
      error: message,
    })
    return NextResponse.json({ task }, { status: 200 })
  }
}

import { NextRequest, NextResponse } from "next/server"
import { getChatStore } from "@/lib/store"
import type { StoredChatMessage } from "@/lib/store"

/**
 * Helper to get demo_uid from cookies
 */
function getDemoUid(request: NextRequest): string | null {
  return request.cookies.get("demo_uid")?.value ?? null
}

/**
 * POST /api/chats/[id]/messages - Append a message to a thread
 *
 * Body: StoredChatMessage
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const demoUid = getDemoUid(request)

  if (!demoUid) {
    return NextResponse.json(
      { error: "No demo_uid cookie found" },
      { status: 401 }
    )
  }

  try {
    const { id } = await params
    const body = (await request.json()) as StoredChatMessage

    // Validate required fields
    if (!body.id || !body.role || !body.text) {
      return NextResponse.json(
        { error: "Missing required fields: id, role, text" },
        { status: 400 }
      )
    }

    const store = getChatStore()

    // Check if thread exists — if not, auto-create it (upsert).
    // This handles the case where the thread was created in the client's
    // session cache but the server store never received it (Redis down).
    let existing = await store.getThread(demoUid, id)
    if (!existing) {
      try {
        existing = await store.createThread(demoUid, {
          id,
          title: "New Chat",
          category: "recent",
          messages: [],
        })
      } catch {
        // If auto-create also fails, return 404
        return NextResponse.json(
          { error: "Thread not found" },
          { status: 404 }
        )
      }
    }

    const message: StoredChatMessage = {
      id: body.id,
      role: body.role,
      text: body.text,
      createdAt: body.createdAt || Date.now(),
      responseId: body.responseId,
      ...(body.taskId ? { taskId: body.taskId } : {}),
      ...(body.isTaskCard ? { isTaskCard: body.isTaskCard } : {}),
      ...(body.contextMeta ? { contextMeta: body.contextMeta } : {}),
    }

    await store.appendMessage(demoUid, id, message)

    return NextResponse.json({ success: true, message }, { status: 201 })
  } catch (error) {
    console.error("[POST /api/chats/[id]/messages] Error:", error)
    return NextResponse.json(
      { error: "Failed to append message" },
      { status: 500 }
    )
  }
}

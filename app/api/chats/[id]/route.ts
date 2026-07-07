import { NextRequest, NextResponse } from "next/server"
import { getChatStore } from "@/lib/store"
import type { StoredChatThread } from "@/lib/store"

/**
 * Helper to get demo_uid from cookies
 */
function getDemoUid(request: NextRequest): string | null {
  return request.cookies.get("demo_uid")?.value ?? null
}

/**
 * GET /api/chats/[id] - Get a single thread with all messages
 */
export async function GET(
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
    const store = getChatStore()
    const thread = await store.getThread(demoUid, id)

    if (!thread) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404 }
      )
    }

    return NextResponse.json({ thread })
  } catch (error) {
    console.error("[GET /api/chats/[id]] Error:", error)
    return NextResponse.json(
      { error: "Failed to get thread" },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/chats/[id] - Update thread metadata (title, summary, category, lastResponseId)
 *
 * Body: Partial<StoredChatThread> (excluding messages and id)
 */
export async function PATCH(
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
    const body = (await request.json()) as Partial<StoredChatThread>

    const store = getChatStore()

    // Check if thread exists — if not, auto-create (upsert) to handle
    // threads that only exist in the client's session cache
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
        return NextResponse.json(
          { error: "Thread not found" },
          { status: 404 }
        )
      }
    }

    // Only allow updating specific fields
    const updates: Partial<StoredChatThread> = {}
    if (body.title !== undefined) updates.title = body.title
    if (body.summary !== undefined) updates.summary = body.summary
    if (body.category !== undefined) updates.category = body.category
    if (body.lastResponseId !== undefined)
      updates.lastResponseId = body.lastResponseId

    await store.updateThread(demoUid, id, updates)

    // Return updated thread
    const updated = await store.getThread(demoUid, id)
    return NextResponse.json({ thread: updated })
  } catch (error) {
    console.error("[PATCH /api/chats/[id]] Error:", error)
    return NextResponse.json(
      { error: "Failed to update thread" },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/chats/[id] - Delete a thread
 */
export async function DELETE(
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
    const store = getChatStore()

    // Check if thread exists
    const existing = await store.getThread(demoUid, id)
    if (!existing) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404 }
      )
    }

    await store.deleteThread(demoUid, id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[DELETE /api/chats/[id]] Error:", error)
    return NextResponse.json(
      { error: "Failed to delete thread" },
      { status: 500 }
    )
  }
}

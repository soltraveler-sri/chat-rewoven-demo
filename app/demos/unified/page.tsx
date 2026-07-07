import { redirect } from "next/navigation"

export default async function UnifiedDemoRedirect({
  searchParams,
}: {
  searchParams: Promise<{ chatId?: string | string[] }>
}) {
  const params = await searchParams
  const chatId = Array.isArray(params.chatId) ? params.chatId[0] : params.chatId
  redirect(chatId ? `/?chatId=${encodeURIComponent(chatId)}` : "/")
}

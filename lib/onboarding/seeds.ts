import { SessionChatCache } from "@/lib/session-cache"
import type { StoredChatThread, StoredChatThreadMeta } from "@/lib/store/types"

export const ONBOARDING_SEEDED_STORAGE_KEY = "cr:seeded"

function message(
  id: string,
  role: "user" | "assistant",
  text: string,
  createdAt: number
) {
  return { id, role, text, createdAt }
}

export function createLooseThreadSeeds(now = Date.now()): StoredChatThread[] {
  const hour = 60 * 60 * 1000
  const day = 24 * hour

  return [
    {
      id: "loose-thread-asyncio-deadlock",
      title: "Debugging a Python asyncio deadlock",
      category: "coding",
      summary:
        "A Python asyncio worker pool deadlocked because tasks held a semaphore while awaiting queue joins; the fix was to release the semaphore before waiting, add timeouts, and drain cancellations cleanly.",
      createdAt: now - 5 * day,
      updatedAt: now - 5 * day + 2 * hour,
      lastResponseId: null,
      messages: [
        message(
          "loose-thread-asyncio-deadlock-1",
          "user",
          "I have a Python asyncio scraper that sometimes hangs forever. Ten workers read from a queue, each worker uses an async semaphore around fetch(), and shutdown awaits queue.join(). No exception is printed.",
          now - 5 * day
        ),
        message(
          "loose-thread-asyncio-deadlock-2",
          "assistant",
          "The shape sounds like a deadlock around backpressure rather than a network stall. Check whether a worker can acquire the semaphore, enqueue follow-up URLs, then await queue.join() or another queue-dependent operation before calling task_done(). That creates a cycle: the queue cannot drain because a worker is waiting for the queue to drain.",
          now - 5 * day + 20 * 60 * 1000
        ),
        message(
          "loose-thread-asyncio-deadlock-3",
          "user",
          "That is close. The worker calls await queue.join() when it sees a poison-pill sentinel, but it is still inside async with semaphore. Some fetch retries are also waiting for the semaphore.",
          now - 5 * day + hour
        ),
        message(
          "loose-thread-asyncio-deadlock-4",
          "assistant",
          "Move shutdown coordination outside the semaphore. Workers should only hold the semaphore for the bounded fetch section, always call task_done() in a finally block, and let the supervisor await queue.join() after producers stop. Add asyncio.timeout() around fetch and cancel workers after join completes so a slow retry cannot keep the pool half-open.",
          now - 5 * day + 90 * 60 * 1000
        ),
        message(
          "loose-thread-asyncio-deadlock-5",
          "user",
          "So one supervisor owns join(), workers own fetch and task_done(), and the semaphore never wraps shutdown.",
          now - 5 * day + 110 * 60 * 1000
        ),
        message(
          "loose-thread-asyncio-deadlock-6",
          "assistant",
          "Exactly. A small regression test can use a fake fetch that blocks behind an Event, then assert the supervisor can cancel cleanly and every queued item receives task_done(). That catches the deadlock without depending on real network timing.",
          now - 5 * day + 2 * hour
        ),
      ],
    },
    {
      id: "loose-thread-jwst-early-universe",
      title: "How JWST sees the early universe",
      category: "personal",
      summary:
        "A plain-language explanation of how the James Webb Space Telescope uses infrared light, redshift, and its segmented mirror to study the earliest galaxies.",
      createdAt: now - 4 * day,
      updatedAt: now - 4 * day + 2 * hour,
      lastResponseId: null,
      messages: [
        message(
          "loose-thread-jwst-early-universe-1",
          "user",
          "Explain how the telescope can see galaxies from the early universe. I understand bigger mirror means more light, but the redshift and infrared part is fuzzy.",
          now - 4 * day
        ),
        message(
          "loose-thread-jwst-early-universe-2",
          "assistant",
          "As space expands, light from very distant galaxies is stretched on its way to us. Ultraviolet and visible light that left young stars more than 13 billion years ago arrives shifted into infrared wavelengths. JWST was built cold, with infrared instruments, so it can detect that stretched light instead of looking where the light used to be.",
          now - 4 * day + 25 * 60 * 1000
        ),
        message(
          "loose-thread-jwst-early-universe-3",
          "user",
          "Where does the mirror design matter?",
          now - 4 * day + hour
        ),
        message(
          "loose-thread-jwst-early-universe-4",
          "assistant",
          "Its 18 gold-coated mirror segments unfold into a 6.5 meter collector. That large area gathers faint infrared photons from tiny early galaxies, while the segmented design made launch possible. The sunshield keeps the telescope cold so its own heat does not drown out those signals.",
          now - 4 * day + 90 * 60 * 1000
        ),
        message(
          "loose-thread-jwst-early-universe-5",
          "user",
          "So if I search later for the chat about the telescope, it should be this one.",
          now - 4 * day + 110 * 60 * 1000
        ),
        message(
          "loose-thread-jwst-early-universe-6",
          "assistant",
          "Yes. The memorable handle is the telescope: JWST sees early galaxies because cosmic redshift moves their ancient starlight into infrared, and the cold segmented mirror is tuned to catch it.",
          now - 4 * day + 2 * hour
        ),
      ],
    },
    {
      id: "loose-thread-bond-yields-rate-cuts",
      title: "Bond yields and rate cuts, explained",
      category: "professional",
      summary:
        "A markets explanation of why bond prices and yields move inversely, how rate-cut expectations shift the curve, and why short and long maturities can react differently.",
      createdAt: now - 3 * day,
      updatedAt: now - 3 * day + 2 * hour,
      lastResponseId: null,
      messages: [
        message(
          "loose-thread-bond-yields-rate-cuts-1",
          "user",
          "I keep hearing that bonds rally when traders expect rate cuts. Why does the yield fall if people are buying the bond?",
          now - 3 * day
        ),
        message(
          "loose-thread-bond-yields-rate-cuts-2",
          "assistant",
          "A bond's coupon is fixed, so price and yield move in opposite directions. If a $1,000 bond pays $40 a year, that is 4 percent at par. If demand pushes the price to $1,050, the same $40 cash flow is a lower yield for the new buyer.",
          now - 3 * day + 25 * 60 * 1000
        ),
        message(
          "loose-thread-bond-yields-rate-cuts-3",
          "user",
          "And rate cuts change the whole curve?",
          now - 3 * day + hour
        ),
        message(
          "loose-thread-bond-yields-rate-cuts-4",
          "assistant",
          "They can, but not evenly. The front end usually tracks expected central-bank policy, so two-year yields may fall quickly when cuts look likely. Ten-year yields also price inflation, growth, and term premium, so they can fall less, fall more, or even rise if investors think cuts will reignite growth or inflation.",
          now - 3 * day + 90 * 60 * 1000
        ),
        message(
          "loose-thread-bond-yields-rate-cuts-5",
          "user",
          "So a steepening curve after cut talk is not automatically bullish.",
          now - 3 * day + 110 * 60 * 1000
        ),
        message(
          "loose-thread-bond-yields-rate-cuts-6",
          "assistant",
          "Right. It depends on why the curve steepened: relief about a soft landing, fear of inflation, or a rush out of long duration. The price/yield inverse relationship is mechanical; the curve story is interpretation.",
          now - 3 * day + 2 * hour
        ),
      ],
    },
    {
      id: "loose-thread-portugal-week",
      title: "A week in Portugal: Lisbon to the Algarve",
      category: "travel",
      summary:
        "A seven-day Portugal travel sketch from Lisbon through Sintra and the Alentejo to Lagos and the Algarve, with food, train timing, and beach pacing.",
      createdAt: now - 2 * day,
      updatedAt: now - 2 * day + 2 * hour,
      lastResponseId: null,
      messages: [
        message(
          "loose-thread-portugal-week-1",
          "user",
          "Sketch a relaxed one-week Portugal trip that starts in Lisbon and ends with a little beach time in the Algarve. I care more about food and walking than nightlife.",
          now - 2 * day
        ),
        message(
          "loose-thread-portugal-week-2",
          "assistant",
          "Days 1-2: Lisbon. Stay near Chiado or Principe Real, walk Alfama early, ride the tram only if the line is short, and plan dinners around seafood rice, bifanas, and a serious pastel de nata comparison. Keep one evening for a miradouro at sunset.",
          now - 2 * day + 25 * 60 * 1000
        ),
        message(
          "loose-thread-portugal-week-3",
          "user",
          "Can I fit Sintra without making the whole trip feel rushed?",
          now - 2 * day + hour
        ),
        message(
          "loose-thread-portugal-week-4",
          "assistant",
          "Yes: Day 3 as a focused Sintra day, not a checklist. Pick Pena Palace plus one quieter stop like Monserrate, then return to Lisbon. Day 4 travel south through Evora or straight to Lagos depending on whether Roman ruins and Alentejo food beat an extra beach afternoon.",
          now - 2 * day + 90 * 60 * 1000
        ),
        message(
          "loose-thread-portugal-week-5",
          "user",
          "Give me the ending as a day-by-day Algarve plan.",
          now - 2 * day + 110 * 60 * 1000
        ),
        message(
          "loose-thread-portugal-week-6",
          "assistant",
          "Days 5-7: base in Lagos or Tavira. Spend one day on cliff walks around Ponta da Piedade, one slow beach day with grilled fish and no ambitious transit, and the final morning on a short boat trip or market walk before the train or flight out of Faro.",
          now - 2 * day + 2 * hour
        ),
      ],
    },
  ]
}

export async function seedLooseThreadsIfNeeded(serverThreads: StoredChatThreadMeta[]) {
  if (typeof window === "undefined") return false
  if (serverThreads.length > 0) return false
  if (window.localStorage.getItem(ONBOARDING_SEEDED_STORAGE_KEY)) return false

  const seeds = createLooseThreadSeeds()
  let createdAny = false

  for (const seed of seeds) {
    const response = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: seed.title,
        category: seed.category,
        summary: seed.summary,
        lastResponseId: seed.lastResponseId,
        messages: seed.messages,
      }),
    })

    if (!response.ok) {
      throw new Error("Could not create starter chats")
    }

    const data = (await response.json()) as { thread?: StoredChatThread }
    if (data.thread) {
      SessionChatCache.saveThread(data.thread)
      createdAny = true
    }
  }

  window.localStorage.setItem(ONBOARDING_SEEDED_STORAGE_KEY, "1")
  return createdAny
}

import type { StoredChatThread } from "@/lib/store/types"

function message(id: string, role: "user" | "assistant", text: string, createdAt: number) {
  return { id, role, text, createdAt }
}

export function createAssistantDemoThreads(now = Date.now()): StoredChatThread[] {
  const hour = 60 * 60 * 1000
  const day = 24 * hour

  return [
    {
      id: "assistant-demo-lifting",
      title: "Lifting numbers and program notes",
      category: "personal",
      summary:
        "Current lifting numbers, target sets, and program notes for squat, bench, deadlift, and overhead press.",
      createdAt: now - 5 * day,
      updatedAt: now - 1 * day,
      lastResponseId: null,
      messages: [
        message(
          "assistant-demo-lifting-1",
          "user",
          "Here are my current lifting numbers: squat 315 lb for 5 reps, bench press 225 lb for 3 reps, deadlift 405 lb for 1 rep, overhead press 135 lb for 5 reps. Bodyweight is 184 lb.",
          now - 5 * day
        ),
        message(
          "assistant-demo-lifting-2",
          "assistant",
          "Logged. Your next block can use conservative training maxes and keep the heavy deadlift exposure low.",
          now - 5 * day + hour
        ),
        message(
          "assistant-demo-lifting-3",
          "user",
          "For the next program, use 5x5 squat at 275 lb, bench 5x5 at 195 lb, deadlift 1x5 at 365 lb, and overhead press 5x5 at 115 lb. Add a note that my left shoulder was cranky on bench.",
          now - 2 * day
        ),
        message(
          "assistant-demo-lifting-4",
          "assistant",
          "I would treat the shoulder note as a constraint and keep bench volume steady until it calms down.",
          now - 2 * day + hour
        ),
      ],
    },
    {
      id: "assistant-demo-calculus",
      title: "Calculus self-study plan",
      category: "personal",
      summary:
        "A learning path covering limits, derivatives, integrals, series, and applications.",
      createdAt: now - 6 * day,
      updatedAt: now - 2 * day,
      lastResponseId: null,
      messages: [
        message(
          "assistant-demo-calculus-1",
          "user",
          "I want to relearn calculus from scratch. I remember algebra and trig, but limits and epsilon-delta proofs are rusty.",
          now - 6 * day
        ),
        message(
          "assistant-demo-calculus-2",
          "assistant",
          "Start with functions, graphs, limits, continuity, and only then move into derivative rules.",
          now - 6 * day + hour
        ),
        message(
          "assistant-demo-calculus-3",
          "user",
          "Can you turn this into a curriculum that gets me to integration techniques, Taylor series, and optimization problems?",
          now - 2 * day
        ),
        message(
          "assistant-demo-calculus-4",
          "assistant",
          "Yes. The sequence should be: limits and continuity, derivatives, applications of derivatives, basic integrals, integration techniques, infinite series, Taylor polynomials, and mixed review.",
          now - 2 * day + hour
        ),
      ],
    },
    {
      id: "assistant-demo-codex-plan",
      title: "Codex follow-up for onboarding bug",
      category: "coding",
      summary:
        "A plan to run Codex on a signup onboarding state bug, but no Codex task was run.",
      createdAt: now - 4 * day,
      updatedAt: now - 3 * day,
      lastResponseId: null,
      messages: [
        message(
          "assistant-demo-codex-plan-1",
          "user",
          "The onboarding checklist is not marking the profile step complete after saving the profile form.",
          now - 4 * day
        ),
        message(
          "assistant-demo-codex-plan-2",
          "assistant",
          "The likely fix is in the profile save handler or onboarding progress reducer. Next step: run Codex to inspect the profile form submit path, update completion state after successful save, and add a regression test.",
          now - 3 * day
        ),
      ],
    },
    {
      id: "assistant-demo-debug-open-loop",
      title: "Branch merge debugging notes",
      category: "coding",
      summary:
        "Debugging notes for a branch merge race condition that ended before implementation.",
      createdAt: now - 7 * day,
      updatedAt: now - 5 * day,
      lastResponseId: null,
      messages: [
        message(
          "assistant-demo-debug-open-loop-1",
          "user",
          "We should fix the race where branch context sometimes merges before the new response id is persisted.",
          now - 7 * day
        ),
        message(
          "assistant-demo-debug-open-loop-2",
          "assistant",
          "Plan: queue branch merge ingestion, await persistence, then re-enable input. Do you want me to turn that into an implementation prompt?",
          now - 5 * day
        ),
      ],
    },
    {
      id: "assistant-demo-pm-prep",
      title: "Product management interview prep",
      category: "professional",
      summary:
        "Study notes for product sense, metrics, execution, and leadership interview practice.",
      createdAt: now - 8 * day,
      updatedAt: now - 4 * day,
      lastResponseId: null,
      messages: [
        message(
          "assistant-demo-pm-prep-1",
          "user",
          "Help me organize product management prep around product sense, analytical metrics, execution tradeoffs, and leadership stories.",
          now - 8 * day
        ),
        message(
          "assistant-demo-pm-prep-2",
          "assistant",
          "Use four tracks: product sense cases, metric diagnosis, execution planning, and behavioral stories. Keep a one-page story bank for leadership examples.",
          now - 4 * day
        ),
      ],
    },
  ]
}

import { assistantFlow } from "./assistant"
import { branchNudgeFlow } from "./branch-nudge"
import { codexFlow } from "./codex"
import { coldStartOnboardingFlow } from "./cold-start-onboarding"
import { darkColdStartFlow, darkInThreadFlow } from "./dark-mode"
import { docReadFlow } from "./doc-read"
import { findFlow } from "./find"
import { railCompletionFlow } from "./rail-completion"
import type { UxFlow } from "./types"

export const flows: UxFlow[] = [
  coldStartOnboardingFlow,
  branchNudgeFlow,
  findFlow,
  codexFlow,
  docReadFlow,
  assistantFlow,
  railCompletionFlow,
  darkColdStartFlow,
  darkInThreadFlow,
]

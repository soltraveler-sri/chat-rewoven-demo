import type { Page } from "playwright"

export type StepStatus = "green" | "spec-pending"

export interface UxStep {
  name: string
  run: (ctx: UxFlowContext) => Promise<void>
}

export interface PendingAssertion {
  flow: string
  name: string
  expected: string
  status: "present" | "pending"
}

export interface UxFlowContext {
  page: Page
  baseUrl: string
  flowName: string
  pendingAssertions: PendingAssertion[]
  markSpecPending: (name: string, expected: string, probe: () => Promise<boolean>) => Promise<void>
}

export interface UxFlow {
  name: string
  aliases?: string[]
  description: string
  steps: UxStep[]
}

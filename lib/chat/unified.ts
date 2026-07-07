"use client"

import type { ChatMessage } from "@/lib/types"

export function generateId(): string {
  return crypto.randomUUID()
}

export function isCodexCommand(text: string): boolean {
  return text.trim().toLowerCase().startsWith("@codex ")
}

export function extractCodexPrompt(text: string): string {
  return text.trim().slice(7).trim()
}

export function isAssistantCommand(text: string): boolean {
  return text.trim().toLowerCase().startsWith("@assistant ")
}

export function extractAssistantPrompt(text: string): string {
  return text.trim().slice(11).trim()
}

export function isFindCommand(text: string): boolean {
  return text.trim().toLowerCase().startsWith("/find ")
}

export function extractFindQuery(text: string): string {
  return text.trim().slice(6).trim()
}

export interface UnifiedMessage extends ChatMessage {
  taskId?: string
  isTaskCard?: boolean
  assistantTaskId?: string
  isAssistantTaskCard?: boolean
}

export interface FindResponse {
  query: string
  options: Array<{
    chatId: string
    title: string
    summary: string
    updatedAt: number
    confidence: number
    why: string
  }>
}


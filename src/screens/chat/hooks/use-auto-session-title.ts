import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { chatQueryKeys } from '../chat-queries'
import {
  updateSessionTitleState,
  useSessionTitleInfo,
} from '../session-title-store'
import { textFromMessage } from '../utils'
import { generateSessionTitle } from '@/utils/generate-session-title'
import type { ChatMessage, SessionMeta } from '../types'

const MAX_TITLE_LENGTH = 50

const GENERIC_TITLE_PATTERNS = [
  /^a new session/i,
  /^new session/i,
  /^untitled/i,
  /^session \d/i,
  /^conversation$/i,
  /^chat$/i,
  /^[0-9a-f]{6,}/i,
  /^\w{8} \(\d{4}-\d{2}-\d{2}\)$/,
]

function isGenericTitle(title: string): boolean {
  const trimmed = title.trim()
  if (!trimmed || trimmed === 'New Session') return true
  return GENERIC_TITLE_PATTERNS.some((pattern) => pattern.test(trimmed))
}

function truncateTitle(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= MAX_TITLE_LENGTH) return normalized
  return `${normalized.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`
}

function getFirstUserMessage(messages: Array<ChatMessage>): string {
  const firstUser = messages.find((message) => message.role === 'user')
  return firstUser ? textFromMessage(firstUser).trim() : ''
}

function hasAssistantResponse(messages: Array<ChatMessage>): boolean {
  return messages.some((message) => {
    if (message.role !== 'assistant') return false
    return textFromMessage(message).trim().length > 0
  })
}

type UseAutoSessionTitleInput = {
  friendlyId: string
  sessionKey: string | undefined
  activeSession?: SessionMeta
  messages: Array<ChatMessage>
  messageCount?: number
  enabled: boolean
}

type UpdateTitlePayload = {
  friendlyId: string
  sessionKey: string
  title: string
}

export function useAutoSessionTitle({
  friendlyId,
  sessionKey,
  activeSession,
  messages,
  enabled,
}: UseAutoSessionTitleInput) {
  const queryClient = useQueryClient()
  const titleInfo = useSessionTitleInfo(friendlyId)
  const lastAttemptRef = useRef<Record<string, string>>({})

  const proposedTitle = useMemo(() => {
    const snippet = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(0, 6)
      .map((m) => ({ role: m.role, text: textFromMessage(m).trim() }))
    if (snippet.length === 0) return ''
    return generateSessionTitle(snippet, { maxLength: MAX_TITLE_LENGTH, maxWords: 6 })
  }, [messages])

  const shouldGenerate = useMemo(() => {
    if (!enabled) return false
    if (!friendlyId || friendlyId === 'new') return false
    if (!sessionKey || sessionKey === 'new') return false
    if (!proposedTitle) return false
    if (!hasAssistantResponse(messages)) return false
    if (activeSession?.label && !isGenericTitle(activeSession.label))
      return false
    if (activeSession?.title && !isGenericTitle(activeSession.title))
      return false
    if (
      activeSession?.derivedTitle &&
      !isGenericTitle(activeSession.derivedTitle)
    ) {
      return false
    }
    if (titleInfo.source === 'manual' && titleInfo.title) return false
    if (
      titleInfo.status === 'ready' &&
      titleInfo.title &&
      !isGenericTitle(titleInfo.title)
    ) {
      return false
    }
    return titleInfo.status !== 'generating'
  }, [
    activeSession?.derivedTitle,
    activeSession?.label,
    activeSession?.title,
    enabled,
    friendlyId,
    messages,
    proposedTitle,
    sessionKey,
    titleInfo.source,
    titleInfo.status,
    titleInfo.title,
  ])

  const applyTitle = useCallback((
    friendlyIdToUpdate: string,
    title: string,
    source: 'auto' | 'manual' = 'auto',
  ) => {
    updateSessionTitleState(friendlyIdToUpdate, {
      title,
      source,
      status: 'ready',
      error: null,
    })
    queryClient.setQueryData(
      chatQueryKeys.sessions,
      function updateSessions(existing: unknown) {
        if (!Array.isArray(existing)) return existing
        return existing.map((session) => {
          if (
            session &&
            typeof session === 'object' &&
            (session as SessionMeta).friendlyId === friendlyIdToUpdate
          ) {
            return {
              ...(session as SessionMeta),
              label: title,
              title,
              derivedTitle: title,
              titleStatus: 'ready',
              titleSource: source,
              titleError: null,
            }
          }
          return session
        })
      },
    )
  }, [queryClient])

  const mutation = useMutation({
    mutationFn: async (payload: UpdateTitlePayload) => {
      const res = await fetch('/api/sessions', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionKey: payload.sessionKey,
          friendlyId: payload.friendlyId,
          label: payload.title,
        }),
      })
      if (!res.ok) {
        const message = await res.text().catch(() => 'Failed to update title')
        throw new Error(message)
      }
      return payload
    },
    onSuccess: (payload) => {
      applyTitle(payload.friendlyId, payload.title, 'auto')
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.sessions })
    },
    onError: (_error, payload) => {
      // Keep the locally-generated title even if the server sync fails.
      // The title is already applied optimistically; just mark sync status.
      updateSessionTitleState(payload.friendlyId, {
        status: 'ready',
        error: null,
      })
    },
  })

  const { mutate, isPending } = mutation

  useEffect(() => {
    if (!shouldGenerate) return
    if (isPending) return
    const signature = `${sessionKey}:${proposedTitle}`
    if (lastAttemptRef.current[friendlyId] === signature) return

    // Defer client-side title assignment to give the agent's LLM-based
    // title generator time to produce a meaningful topic-based title.
    // The agent fires `maybe_auto_title()` in a background thread after
    // the first exchange and typically completes within 3-8 seconds.
    // If the agent sets a proper title in the meantime, `shouldGenerate`
    // will flip to false and this timeout will be a no-op.
    const timer = setTimeout(() => {
      // Re-check — the agent may have set a title while we waited
      if (lastAttemptRef.current[friendlyId] === signature) return
      lastAttemptRef.current[friendlyId] = signature
      updateSessionTitleState(friendlyId, { status: 'generating', error: null })
      // Apply optimistically so the UI shows the title immediately
      applyTitle(friendlyId, proposedTitle, 'auto')
      mutate({
        friendlyId,
        sessionKey: sessionKey ?? friendlyId,
        title: proposedTitle,
      })
    }, 8_000)

    return () => clearTimeout(timer)
  }, [applyTitle, friendlyId, isPending, mutate, proposedTitle, sessionKey, shouldGenerate])
}

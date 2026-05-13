/**
 * Legacy alias route — delegates to hermes-tasks-assignees handler.
 * Kept for backward compatibility with clients using the /api/claude-tasks-assignees path.
 */
import { createFileRoute } from '@tanstack/react-router'
import { handleTaskAssigneesGet } from './hermes-tasks-assignees'

export const Route = createFileRoute('/api/claude-tasks-assignees')({
  server: {
    handlers: {
      GET: async ({ request }) => handleTaskAssigneesGet(request),
    },
  },
})

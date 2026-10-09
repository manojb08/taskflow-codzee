import type { User } from '@/types'

/**
 * Mirrors the server rule on DELETE /tasks/:id: only the task's creator or an admin may delete it.
 * This only decides what the UI offers — the API enforces the rule regardless.
 */
export function canDeleteTask(
  user: Pick<User, '_id' | 'role'> | null,
  task: { creator: Pick<User, '_id'> | null },
): boolean {
  if (!user) return false
  return user.role === 'admin' || task.creator?._id === user._id
}

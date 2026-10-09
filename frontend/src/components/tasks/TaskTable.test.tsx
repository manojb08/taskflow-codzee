import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { TaskTable } from './TaskTable'
import { useAuth } from '@/context/AuthContext'
import type { Task, User } from '@/types'

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }))

function makeUser(overrides: Partial<User>): User {
  return {
    _id: 'member-id',
    name: 'Sarah Chen',
    email: 'sarah@taskflow.io',
    role: 'member',
    status: 'active',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

const creator = makeUser({ _id: 'creator-id', name: 'Alex Morgan', email: 'alex@taskflow.io' })

const task = {
  _id: '64b64b64b64b64b64b64b64b',
  title: 'Ship the release',
  description: '',
  status: 'todo',
  priority: 'medium',
  assignee: null,
  creator,
  dueDate: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
} as Task

async function openActionsMenuAs(user: User) {
  vi.mocked(useAuth).mockReturnValue({ user } as ReturnType<typeof useAuth>)
  render(
    <MemoryRouter>
      <TaskTable
        tasks={[task]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        onDeleteRequest={vi.fn()}
        hasActiveFilters={false}
      />
    </MemoryRouter>,
  )
  // jsdom renders both the desktop table and the mobile card list; either row's menu will do.
  await userEvent.click(screen.getAllByRole('button', { name: 'Task actions' })[0])
  await screen.findByRole('menuitem', { name: 'Edit task' })
}

describe('TaskTable actions menu', () => {
  it('offers Delete to the task creator', async () => {
    await openActionsMenuAs(creator)
    expect(screen.getByRole('menuitem', { name: 'Delete task' })).toBeInTheDocument()
  })

  it('offers Delete to an admin who did not create the task', async () => {
    await openActionsMenuAs(makeUser({ _id: 'admin-id', role: 'admin' }))
    expect(screen.getByRole('menuitem', { name: 'Delete task' })).toBeInTheDocument()
  })

  it('hides Delete from a member who did not create the task', async () => {
    await openActionsMenuAs(makeUser({ _id: 'someone-else' }))
    expect(screen.queryByRole('menuitem', { name: 'Delete task' })).not.toBeInTheDocument()
  })
})

import { describe, expect, it } from 'vitest'
import { canDeleteTask } from './permissions'

const task = { creator: { _id: 'creator-id' } }

describe('canDeleteTask', () => {
  it('allows the task creator', () => {
    expect(canDeleteTask({ _id: 'creator-id', role: 'member' }, task)).toBe(true)
  })

  it('allows an admin who did not create the task', () => {
    expect(canDeleteTask({ _id: 'admin-id', role: 'admin' }, task)).toBe(true)
  })

  it('blocks a member who did not create the task', () => {
    expect(canDeleteTask({ _id: 'other-id', role: 'member' }, task)).toBe(false)
  })

  it('blocks everyone when nobody is signed in', () => {
    expect(canDeleteTask(null, task)).toBe(false)
  })

  it('leaves a task whose creator no longer exists to admins', () => {
    expect(canDeleteTask({ _id: 'other-id', role: 'member' }, { creator: null })).toBe(false)
    expect(canDeleteTask({ _id: 'admin-id', role: 'admin' }, { creator: null })).toBe(true)
  })
})

export type UserRole = 'admin' | 'member'
export type UserStatus = 'active' | 'invited'

export interface User {
  _id: string
  name: string
  email: string
  role: UserRole
  status: UserStatus
  createdAt: string
  updatedAt: string
}

export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done' | 'blocked'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

export const TASK_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done', 'blocked']
export const TASK_PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent']

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  blocked: 'Blocked',
}

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
}

export interface Task {
  _id: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  assignee: User | null
  creator: User
  dueDate: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface Comment {
  _id: string
  task: string
  author: User
  body: string
  createdAt: string
  updatedAt: string
}

export type ActivityAction =
  | 'created'
  | 'status_changed'
  | 'priority_changed'
  | 'assignee_changed'
  | 'due_date_changed'

export interface ActivityEntry {
  _id: string
  actor: Pick<User, '_id' | 'name'>
  action: ActivityAction
  meta?: { from?: string | null; to?: string | null }
  createdAt: string
}

export interface TaskStats {
  total: number
  todo: number
  inProgress: number
  done: number
  totalTrendPct: number | null
  completedThisWeek: number
  dueThisWeek: number
  assignedToMeTodoCount: number
}

export interface Paginated<T> {
  items: T[]
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface ApiErrorBody {
  success: false
  error: {
    code: string
    message: string
    details?: unknown
  }
}

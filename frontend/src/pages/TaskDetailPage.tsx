import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { formatDistanceToNowStrict, format } from 'date-fns'
import { AlertTriangle, ChevronLeft, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { StatusBadge } from '@/components/tasks/StatusBadge'
import { PriorityBadge } from '@/components/tasks/PriorityBadge'
import { TaskFormFields, type TaskFormState } from '@/components/tasks/TaskFormFields'
import { DeleteTaskDialog } from '@/components/tasks/DeleteTaskDialog'
import { UserAvatar } from '@/components/common/UserAvatar'
import { CommentList } from '@/components/comments/CommentList'
import { CommentComposer } from '@/components/comments/CommentComposer'
import { ActivityFeed } from '@/components/tasks/ActivityFeed'
import { useUsers } from '@/hooks/useUsers'
import { useMyTasksCount } from '@/hooks/useMyTasksCount'
import { useAuth } from '@/context/AuthContext'
import { canDeleteTask } from '@/lib/permissions'
import { useToast } from '@/components/ui/toast'
import { getTask, updateTask } from '@/api/tasks'
import { createComment, deleteComment, listComments } from '@/api/comments'
import { listActivity } from '@/api/activity'
import { ApiClientError } from '@/api/client'
import { subscribe } from '@/lib/socket'
import type { ActivityEntry, Comment, Task } from '@/types'

function toFormState(task: Task): TaskFormState {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    assigneeId: task.assignee?._id ?? null,
    dueDate: task.dueDate ? task.dueDate.slice(0, 10) : '',
  }
}

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { user } = useAuth()
  const { users } = useUsers()
  const myTasksCount = useMyTasksCount()

  const [task, setTask] = useState<Task | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [comments, setComments] = useState<Comment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(true)

  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [activityLoading, setActivityLoading] = useState(true)

  const [isEditing, setIsEditing] = useState(searchParams.get('edit') === '1')
  const [form, setForm] = useState<TaskFormState | null>(null)
  const [titleError, setTitleError] = useState<string | undefined>()
  const [dueDateError, setDueDateError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  function loadTask() {
    if (!id) return
    setIsLoading(true)
    setError(null)
    getTask(id)
      .then((res) => {
        setTask(res.data.task)
        setForm(toFormState(res.data.task))
      })
      .catch((err) => setError(err instanceof ApiClientError ? err.message : 'Failed to load this task.'))
      .finally(() => setIsLoading(false))
  }

  useEffect(loadTask, [id])

  function loadComments() {
    if (!id) return
    setCommentsLoading(true)
    listComments(id)
      .then((res) => setComments(res.data.comments))
      .catch(() => toast({ title: "Couldn't load comments", variant: 'destructive' }))
      .finally(() => setCommentsLoading(false))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadComments, [id])

  function loadActivity() {
    if (!id) return
    setActivityLoading(true)
    listActivity(id)
      .then((res) => setActivity(res.data.activity))
      .catch(() => toast({ title: "Couldn't load activity", variant: 'destructive' }))
      .finally(() => setActivityLoading(false))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadActivity, [id])

  useEffect(() => {
    if (!id) return
    const unsubs = [
      subscribe<{ taskId: string }>('task:updated', ({ taskId }) => {
        if (taskId === id) {
          loadTask()
          loadActivity()
        }
      }),
      subscribe<{ taskId: string }>('task:deleted', ({ taskId }) => {
        if (taskId === id) loadTask()
      }),
      subscribe<{ taskId: string }>('comment:created', ({ taskId }) => {
        if (taskId === id) loadComments()
      }),
      subscribe<{ taskId: string }>('comment:deleted', ({ taskId }) => {
        if (taskId === id) loadComments()
      }),
    ]
    return () => unsubs.forEach((unsub) => unsub())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  function enterEdit() {
    if (task) setForm(toFormState(task))
    setTitleError(undefined)
    setDueDateError(undefined)
    setIsEditing(true)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('edit', '1')
      return next
    })
  }

  function cancelEdit() {
    if (task) setForm(toFormState(task))
    setIsEditing(false)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('edit')
      return next
    })
  }

  const dueDateChanged = form && task && form.dueDate !== (task.dueDate ? task.dueDate.slice(0, 10) : '')
  const unsavedChanges =
    form &&
    task &&
    (form.title !== task.title ||
      form.description !== task.description ||
      form.status !== task.status ||
      form.priority !== task.priority ||
      form.assigneeId !== (task.assignee?._id ?? null) ||
      dueDateChanged)

  async function saveChanges() {
    if (!id || !form) return
    setTitleError(undefined)
    setDueDateError(undefined)

    if (!form.title.trim()) {
      setTitleError('Title is required')
      return
    }
    if (form.dueDate && new Date(form.dueDate) < new Date(new Date().toDateString())) {
      setDueDateError("Due date can't be in the past.")
      return
    }

    setSaving(true)
    try {
      const res = await updateTask(id, {
        title: form.title.trim(),
        description: form.description.trim(),
        status: form.status,
        priority: form.priority,
        assignee: form.assigneeId,
        dueDate: form.dueDate || null,
      })
      setTask(res.data.task)
      setForm(toFormState(res.data.task))
      toast({ title: 'Task updated', variant: 'success' })
      cancelEdit()
      loadActivity()
    } catch (err) {
      toast({
        title: "Couldn't save changes",
        description: err instanceof ApiClientError ? err.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  async function onAddComment(body: string) {
    if (!id) return
    try {
      const res = await createComment(id, body)
      setComments((prev) => [...prev, res.data.comment])
    } catch (err) {
      toast({
        title: "Couldn't post comment",
        description: err instanceof ApiClientError ? err.message : 'Please try again.',
        variant: 'destructive',
      })
    }
  }

  async function onDeleteComment(commentId: string) {
    try {
      await deleteComment(commentId)
      setComments((prev) => prev.filter((c) => c._id !== commentId))
    } catch {
      toast({ title: "Couldn't delete comment", variant: 'destructive' })
    }
  }

  const breadcrumb = task ? `TF-${task._id.slice(-4).toUpperCase()}` : 'Task'

  if (isLoading) {
    return (
      <AppShell breadcrumb="Task" myTasksCount={myTasksCount}>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-4 h-40 w-full" />
      </AppShell>
    )
  }

  if (error || !task || !form) {
    return (
      <AppShell breadcrumb="Task" myTasksCount={myTasksCount}>
        <div className="flex flex-col items-center justify-center gap-3 rounded-[8px] border border-border bg-white py-16 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" />
          <p className="text-sm font-medium text-ink">{error ?? 'Task not found'}</p>
          <Button variant="secondary" size="sm" onClick={loadTask}>
            Try Again
          </Button>
        </div>
      </AppShell>
    )
  }

  const canDelete = canDeleteTask(user, task)

  if (isEditing) {
    return (
      <AppShell breadcrumb={`Edit ${breadcrumb}`} myTasksCount={myTasksCount}>
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-xs text-ink/40">{breadcrumb}</p>
            <h1 className="font-heading text-2xl font-bold text-ink">Edit task</h1>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={cancelEdit}>
              Cancel
            </Button>
            <Button onClick={saveChanges} disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="rounded-[10px] border border-border bg-white p-6 lg:col-span-2">
            <TaskFormFields
              value={form}
              onChange={setForm}
              users={users}
              titleError={titleError}
              dueDateError={dueDateError}
            />
          </div>

          <div className="flex flex-col gap-4">
            {unsavedChanges && (
              <div className="rounded-[10px] border border-border bg-white p-4">
                <p className="mb-2 text-sm font-semibold text-ink">Unsaved changes</p>
                <ul className="flex flex-col gap-1 text-xs text-ink/60">
                  {form.status !== task.status && (
                    <li>
                      Status · {task.status} → <span className="font-medium text-ink">{form.status}</span>
                    </li>
                  )}
                  {form.priority !== task.priority && (
                    <li>
                      Priority · {task.priority} → <span className="font-medium text-ink">{form.priority}</span>
                    </li>
                  )}
                  {dueDateChanged && (
                    <li>
                      Due date ·{' '}
                      <span className="font-medium text-ink">{form.dueDate || 'none'}</span>
                    </li>
                  )}
                </ul>
              </div>
            )}

            {canDelete && (
              <div className="rounded-[10px] border border-destructive/20 bg-destructive-bg p-4">
                <p className="mb-1 text-sm font-semibold text-destructive">Danger zone</p>
                <p className="mb-3 text-xs text-destructive/80">
                  Deleting a task removes its comments and activity. This can&apos;t be undone.
                </p>
                <Button variant="destructive" size="sm" className="w-full" onClick={() => setDeleteOpen(true)}>
                  Delete task
                </Button>
              </div>
            )}
          </div>
        </div>

        <DeleteTaskDialog
          task={task}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          onDeleted={() => navigate('/tasks')}
        />
      </AppShell>
    )
  }

  return (
    <AppShell breadcrumb={breadcrumb} myTasksCount={myTasksCount}>
      <button
        onClick={() => navigate('/tasks')}
        className="mb-4 flex items-center gap-1 text-sm text-ink/50 hover:text-ink"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to tasks
      </button>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs text-ink/40">{breadcrumb}</p>
              <h1 className="mt-1 font-heading text-2xl font-bold text-ink">{task.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <StatusBadge status={task.status} />
                <PriorityBadge priority={task.priority} />
                <span className="text-ink/40">
                  Updated {formatDistanceToNowStrict(new Date(task.updatedAt), { addSuffix: true })}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="secondary" size="sm" onClick={enterEdit}>
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="icon" aria-label="More actions">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onSelect={enterEdit}>
                    <Pencil className="h-3.5 w-3.5" /> Edit task
                  </DropdownMenuItem>
                  {canDelete && (
                    <DropdownMenuItem destructive onSelect={() => setDeleteOpen(true)}>
                      <Trash2 className="h-3.5 w-3.5" /> Delete task
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="mt-6 rounded-[10px] border border-border bg-white p-5">
            <h2 className="mb-2 text-sm font-semibold text-ink">Description</h2>
            <p className="whitespace-pre-wrap break-words text-sm text-ink/70">
              {task.description || <span className="text-ink/30">No description provided.</span>}
            </p>
          </div>

          <div className="mt-6 rounded-[10px] border border-border bg-white p-5">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-ink">
              Comments
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-ink/50">{comments.length}</span>
            </h2>
            <CommentList comments={comments} isLoading={commentsLoading} onDelete={onDeleteComment} />
            <CommentComposer onSubmit={onAddComment} />
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-[10px] border border-border bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">Task information</h2>
            <dl className="flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-ink/40">Assignee</dt>
                <dd>
                  {task.assignee ? (
                    <span className="flex items-center gap-2">
                      <UserAvatar user={task.assignee} className="h-6 w-6" />
                      {task.assignee.name}
                    </span>
                  ) : (
                    <span className="text-ink/40">Unassigned</span>
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink/40">Status</dt>
                <dd>
                  <StatusBadge status={task.status} />
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink/40">Priority</dt>
                <dd>
                  <PriorityBadge priority={task.priority} />
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink/40">Due date</dt>
                <dd className="font-medium text-ink">
                  {task.dueDate ? format(new Date(task.dueDate), 'MMM d, yyyy') : '—'}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink/40">Created by</dt>
                <dd className="flex items-center gap-2">
                  <UserAvatar user={task.creator} className="h-6 w-6" />
                  {task.creator.name}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink/40">Created</dt>
                <dd className="font-medium text-ink">{format(new Date(task.createdAt), 'MMM d, yyyy')}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink/40">Updated</dt>
                <dd className="font-medium text-ink">
                  {formatDistanceToNowStrict(new Date(task.updatedAt), { addSuffix: true })}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-[10px] border border-border bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">Activity</h2>
            <ActivityFeed activity={activity} isLoading={activityLoading} />
          </div>
        </div>
      </div>

      <DeleteTaskDialog
        task={task}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={() => navigate('/tasks')}
      />
    </AppShell>
  )
}

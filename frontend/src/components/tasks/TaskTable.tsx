import { useNavigate } from 'react-router-dom'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { AlertTriangle, MoreHorizontal, SearchX } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { StatusBadge } from './StatusBadge'
import { PriorityBadge } from './PriorityBadge'
import { UserAvatar } from '@/components/common/UserAvatar'
import { useAuth } from '@/context/AuthContext'
import { canDeleteTask } from '@/lib/permissions'
import type { Task } from '@/types'

interface TaskTableProps {
  tasks: Task[]
  isLoading: boolean
  error: string | null
  onRetry: () => void
  onDeleteRequest: (task: Task) => void
  onClearFilters?: () => void
  hasActiveFilters: boolean
}

const COLUMNS = ['Task', 'Status', 'Priority', 'Assignee', 'Created', 'Updated', '']

export function TaskTable({
  tasks,
  isLoading,
  error,
  onRetry,
  onDeleteRequest,
  onClearFilters,
  hasActiveFilters,
}: TaskTableProps) {
  const navigate = useNavigate()
  const { user } = useAuth()

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-[8px] border border-border bg-white py-16 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive-bg">
          <AlertTriangle className="h-5 w-5 text-destructive" />
        </div>
        <p className="text-sm font-medium text-ink">Couldn&apos;t load tasks</p>
        <p className="max-w-xs text-sm text-ink/50">{error}</p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try Again
        </Button>
      </div>
    )
  }

  if (isLoading) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            {COLUMNS.map((c) => (
              <TableHead key={c}>{c}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 6 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell colSpan={7}>
                <Skeleton className="h-5 w-full" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-[8px] border border-border bg-white py-16 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
          <SearchX className="h-5 w-5 text-ink/40" />
        </div>
        <p className="text-sm font-medium text-ink">No tasks found</p>
        <p className="text-sm text-ink/50">Try changing your filters or create a new task.</p>
        {hasActiveFilters && onClearFilters && (
          <Button variant="secondary" size="sm" onClick={onClearFilters}>
            Clear filters
          </Button>
        )}
      </div>
    )
  }

  function TaskActionsMenu({ task }: { task: Task }) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Task actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => navigate(`/tasks/${task._id}?edit=1`)}>Edit task</DropdownMenuItem>
          {canDeleteTask(user, task) && (
            <DropdownMenuItem destructive onSelect={() => onDeleteRequest(task)}>
              Delete task
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((c) => (
                <TableHead key={c}>{c}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => (
              <TableRow key={task._id} className="cursor-pointer" onClick={() => navigate(`/tasks/${task._id}`)}>
                <TableCell>
                  <p className="font-medium text-ink">{task.title}</p>
                  <p className="text-xs text-ink/40">TF-{task._id.slice(-4).toUpperCase()}</p>
                </TableCell>
                <TableCell>
                  <StatusBadge status={task.status} />
                </TableCell>
                <TableCell>
                  <PriorityBadge priority={task.priority} />
                </TableCell>
                <TableCell>
                  {task.assignee ? (
                    <div className="flex items-center gap-2">
                      <UserAvatar user={task.assignee} className="h-6 w-6" />
                      <span className="text-sm text-ink/80">{task.assignee.name}</span>
                    </div>
                  ) : (
                    <span className="text-sm text-ink/30">Unassigned</span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-ink/50">{format(new Date(task.createdAt), 'MMM d')}</TableCell>
                <TableCell className="text-sm text-ink/50">
                  {formatDistanceToNowStrict(new Date(task.updatedAt), { addSuffix: true })}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <TaskActionsMenu task={task} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 md:hidden">
        {tasks.map((task) => (
          <div
            key={task._id}
            role="link"
            tabIndex={0}
            onClick={() => navigate(`/tasks/${task._id}`)}
            onKeyDown={(e) => e.key === 'Enter' && navigate(`/tasks/${task._id}`)}
            className="cursor-pointer rounded-[8px] border border-border bg-white p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{task.title}</p>
                <p className="text-xs text-ink/40">TF-{task._id.slice(-4).toUpperCase()}</p>
              </div>
              <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                <TaskActionsMenu task={task} />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusBadge status={task.status} />
              <PriorityBadge priority={task.priority} />
            </div>
            <div className="mt-3 flex items-center justify-between text-sm text-ink/50">
              {task.assignee ? (
                <div className="flex items-center gap-2">
                  <UserAvatar user={task.assignee} className="h-6 w-6" />
                  <span className="text-ink/80">{task.assignee.name}</span>
                </div>
              ) : (
                <span className="text-ink/30">Unassigned</span>
              )}
              <span>{formatDistanceToNowStrict(new Date(task.updatedAt), { addSuffix: true })}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

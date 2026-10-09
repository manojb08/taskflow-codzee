import { FilterQuery, PipelineStage, Types } from 'mongoose';
import { Task, ITask } from '../models/Task';
import { Comment } from '../models/Comment';
import { User } from '../models/User';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { logActivity } from '../utils/logActivity';
import { AuthenticatedRequest } from '../middleware/requireAuth';
import { broadcast } from '../realtime/io';

export const listTasks = asyncHandler(async (req: AuthenticatedRequest, res) => {
  const { page, limit, search, status, priority, assignee, sortBy, sortOrder } = req.query as unknown as {
    page: number;
    limit: number;
    search?: string;
    status?: string;
    priority?: string;
    assignee?: string;
    sortBy: string;
    sortOrder: 'asc' | 'desc';
  };

  const filter: FilterQuery<ITask> = {};
  if (status) filter.status = status;
  if (priority) filter.priority = priority;
  if (assignee) filter.assignee = assignee;
  if (search) filter.$text = { $search: search };

  const sort: Record<string, 1 | -1> = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };
  const skip = (page - 1) * limit;

  const [tasks, total] = await Promise.all([
    Task.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('assignee', 'name email')
      .populate('creator', 'name email'),
    Task.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: { tasks },
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

export const createTask = asyncHandler(async (req: AuthenticatedRequest, res) => {
  const task = await Task.create({
    ...req.body,
    creator: req.user!.id,
    completedAt: req.body.status === 'done' ? new Date() : null,
  });
  await logActivity({ task: task._id, actor: req.user!.id, action: 'created' });
  const populated = await task.populate([
    { path: 'assignee', select: 'name email' },
    { path: 'creator', select: 'name email' },
  ]);
  broadcast('task:created', { taskId: task._id });
  res.status(201).json({ success: true, data: { task: populated } });
});

export const getTask = asyncHandler(async (req, res) => {
  const task = await Task.findById(req.params.id)
    .populate('assignee', 'name email')
    .populate('creator', 'name email');
  if (!task) {
    throw ApiError.notFound('Task not found');
  }
  res.json({ success: true, data: { task } });
});

export const updateTask = asyncHandler(async (req: AuthenticatedRequest, res) => {
  const existing = await Task.findById(req.params.id);
  if (!existing) {
    throw ApiError.notFound('Task not found');
  }

  const body = req.body as Partial<{
    status: string;
    priority: string;
    assignee: string | null;
    dueDate: Date | null;
  }>;
  const statusChanged = 'status' in body && body.status !== existing.status;
  const update = statusChanged ? { ...body, completedAt: body.status === 'done' ? new Date() : null } : body;

  const task = await Task.findByIdAndUpdate(req.params.id, update, {
    new: true,
    runValidators: true,
  })
    .populate('assignee', 'name email')
    .populate('creator', 'name email');
  if (!task) {
    throw ApiError.notFound('Task not found');
  }

  const actor = req.user!.id;

  if (statusChanged) {
    await logActivity({
      task: task._id,
      actor,
      action: 'status_changed',
      meta: { from: existing.status, to: body.status },
    });
  }

  if ('priority' in body && body.priority !== existing.priority) {
    await logActivity({
      task: task._id,
      actor,
      action: 'priority_changed',
      meta: { from: existing.priority, to: body.priority },
    });
  }

  if ('assignee' in body) {
    const oldAssigneeId = existing.assignee ? existing.assignee.toString() : null;
    const newAssigneeId = body.assignee ?? null;
    if (oldAssigneeId !== newAssigneeId) {
      const [oldAssigneeUser, newAssigneeUser] = await Promise.all([
        oldAssigneeId ? User.findById(oldAssigneeId).select('name') : null,
        newAssigneeId ? User.findById(newAssigneeId).select('name') : null,
      ]);
      await logActivity({
        task: task._id,
        actor,
        action: 'assignee_changed',
        meta: { from: oldAssigneeUser?.name ?? null, to: newAssigneeUser?.name ?? null },
      });
    }
  }

  if ('dueDate' in body) {
    const oldDueDate = existing.dueDate ? existing.dueDate.toISOString() : null;
    const newDueDate = body.dueDate ? new Date(body.dueDate).toISOString() : null;
    if (oldDueDate !== newDueDate) {
      await logActivity({
        task: task._id,
        actor,
        action: 'due_date_changed',
        meta: { from: oldDueDate, to: newDueDate },
      });
    }
  }

  broadcast('task:updated', { taskId: task._id });
  res.json({ success: true, data: { task } });
});

export const deleteTask = asyncHandler(async (req: AuthenticatedRequest, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) {
    throw ApiError.notFound('Task not found');
  }

  const isCreator = task.creator.toString() === req.user!.id;
  const isAdmin = req.user!.role === 'admin';
  if (!isCreator && !isAdmin) {
    throw ApiError.forbidden('Only the task creator or an admin can delete this task');
  }

  await task.deleteOne();
  await Comment.deleteMany({ task: task._id });
  broadcast('task:deleted', { taskId: task._id });
  res.json({ success: true, data: { deleted: true } });
});

export const getTaskStats = asyncHandler(async (req: AuthenticatedRequest, res) => {
  const now = new Date();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const sevenDaysAgo = new Date(now.getTime() - 7 * oneDayMs);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * oneDayMs);
  const sevenDaysFromNow = new Date(now.getTime() + 7 * oneDayMs);

  // Each metric is a plain filter; all of them are counted in one $facet aggregation (one round trip
  // instead of nine).
  const metrics = {
    total: {},
    todo: { status: 'todo' },
    inProgress: { status: 'in_progress' },
    done: { status: 'done' },
    createdLast7Days: { createdAt: { $gte: sevenDaysAgo } },
    createdPrev7Days: { createdAt: { $gte: fourteenDaysAgo, $lt: sevenDaysAgo } },
    completedThisWeek: { status: 'done', completedAt: { $gte: sevenDaysAgo } },
    dueThisWeek: { dueDate: { $gte: now, $lte: sevenDaysFromNow }, status: { $ne: 'done' } },
    // Unlike countDocuments(), aggregate() doesn't cast values through the schema, so this has to be
    // an ObjectId already; the raw id string would silently match nothing.
    assignedToMeTodoCount: { assignee: new Types.ObjectId(req.user!.id), status: 'todo' },
  } satisfies Record<string, FilterQuery<ITask>>;
  type Metric = keyof typeof metrics;

  const facets = Object.fromEntries(
    Object.entries(metrics).map(([name, match]): [string, PipelineStage.FacetPipelineStage[]] => [
      name,
      [{ $match: match }, { $count: 'n' }],
    ]),
  );
  const [result] = await Task.aggregate<Record<Metric, { n: number }[]>>([{ $facet: facets }]);
  // $count emits no document at all when nothing matches.
  const count = (metric: Metric) => result[metric][0]?.n ?? 0;

  const createdLast7Days = count('createdLast7Days');
  const createdPrev7Days = count('createdPrev7Days');
  const totalTrendPct =
    createdPrev7Days === 0 ? null : Math.round(((createdLast7Days - createdPrev7Days) / createdPrev7Days) * 100);

  res.json({
    success: true,
    data: {
      total: count('total'),
      todo: count('todo'),
      inProgress: count('inProgress'),
      done: count('done'),
      totalTrendPct,
      completedThisWeek: count('completedThisWeek'),
      dueThisWeek: count('dueThisWeek'),
      assignedToMeTodoCount: count('assignedToMeTodoCount'),
    },
  });
});

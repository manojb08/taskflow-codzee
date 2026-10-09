import { Types } from 'mongoose';
import { connectDB, disconnectDB } from '../config/db';
import { Task } from '../models/Task';
import { ActivityLog } from '../models/ActivityLog';

/**
 * One-off backfill for tasks that were already `done` before `completedAt` existed. Uses the most
 * recent "moved to done" activity entry, falling back to `updatedAt` (the value the dashboard used
 * before). Safe to re-run: it only touches done tasks that still have no `completedAt`.
 * Returns how many tasks it actually updated.
 */
export async function backfillCompletedAt(): Promise<number> {
  const tasks = await Task.find({ status: 'done', completedAt: null }).select('_id updatedAt');

  let backfilled = 0;
  for (const task of tasks) {
    const lastMovedToDone = await ActivityLog.findOne({ task: task._id, action: 'status_changed', 'meta.to': 'done' })
      .sort({ createdAt: -1 })
      .select('createdAt');
    if (await stampCompletedAt(task._id, lastMovedToDone?.createdAt ?? task.updatedAt)) {
      backfilled += 1;
    }
  }

  return backfilled;
}

/**
 * Sets `completedAt` only if the task is still done and still has none: it may have been reopened
 * (or completed for real) since the backfill looked it up. Returns whether anything was written.
 */
export async function stampCompletedAt(taskId: Types.ObjectId, completedAt: Date): Promise<boolean> {
  const result = await Task.updateOne(
    { _id: taskId, status: 'done', completedAt: null },
    { $set: { completedAt } },
    // A backfill isn't an edit — leave updatedAt alone.
    { timestamps: false },
  );
  return result.modifiedCount === 1;
}

if (require.main === module) {
  connectDB()
    .then(backfillCompletedAt)
    .then((count) => {
      // eslint-disable-next-line no-console
      console.log(`Backfilled completedAt on ${count} task(s).`);
      return disconnectDB();
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}

import { connectDB, disconnectDB } from '../config/db';
import { Task } from '../models/Task';
import { ActivityLog } from '../models/ActivityLog';

/**
 * One-off backfill for tasks that were already `done` before `completedAt` existed. Uses the most
 * recent "moved to done" activity entry, falling back to `updatedAt` (the value the dashboard used
 * before). Safe to re-run: it only touches done tasks that still have no `completedAt`.
 */
export async function backfillCompletedAt(): Promise<number> {
  const tasks = await Task.find({ status: 'done', completedAt: null }).select('_id updatedAt');

  for (const task of tasks) {
    const lastMovedToDone = await ActivityLog.findOne({ task: task._id, action: 'status_changed', 'meta.to': 'done' })
      .sort({ createdAt: -1 })
      .select('createdAt');
    await Task.updateOne(
      { _id: task._id },
      { $set: { completedAt: lastMovedToDone?.createdAt ?? task.updatedAt } },
      // A backfill isn't an edit — leave updatedAt alone.
      { timestamps: false },
    );
  }

  return tasks.length;
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

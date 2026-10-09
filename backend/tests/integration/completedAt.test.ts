import request from 'supertest';
import { Types } from 'mongoose';
import { createApp } from '../../src/app';
import { Task } from '../../src/models/Task';
import { ActivityLog } from '../../src/models/ActivityLog';
import { backfillCompletedAt } from '../../src/utils/backfillCompletedAt';
import { createAuthedUser } from '../utils/testAuth';

const app = createApp();

async function createTask(token: string, body: Record<string, unknown>) {
  const res = await request(app).post('/api/v1/tasks').set('Authorization', `Bearer ${token}`).send(body);
  return res.body.data.task;
}

async function patchTask(token: string, taskId: string, body: Record<string, unknown>) {
  const res = await request(app).patch(`/api/v1/tasks/${taskId}`).set('Authorization', `Bearer ${token}`).send(body);
  return res.body.data.task;
}

describe('Task completedAt', () => {
  it('is set when a task is created as done, and null otherwise', async () => {
    const { token } = await createAuthedUser(app);

    const done = await createTask(token, { title: 'Already finished', status: 'done' });
    expect(done.completedAt).toEqual(expect.any(String));

    const open = await createTask(token, { title: 'Not started', status: 'todo' });
    expect(open.completedAt).toBeNull();
  });

  it('is set when a task moves to done and cleared when it is reopened', async () => {
    const { token } = await createAuthedUser(app);
    const task = await createTask(token, { title: 'Ship it' });

    const done = await patchTask(token, task._id, { status: 'done' });
    expect(done.completedAt).toEqual(expect.any(String));

    const reopened = await patchTask(token, task._id, { status: 'in_progress' });
    expect(reopened.completedAt).toBeNull();
  });

  it('keeps the original completion time when a done task is edited', async () => {
    const { token } = await createAuthedUser(app);
    const task = await createTask(token, { title: 'Finished earlier', status: 'done' });

    // The edit form always resends the current status, so this is the common case.
    const edited = await patchTask(token, task._id, { title: 'Finished earlier (renamed)', status: 'done' });
    expect(edited.completedAt).toBe(task.completedAt);
  });
});

describe('backfillCompletedAt', () => {
  it('dates legacy done tasks from their latest move to done, else from updatedAt', async () => {
    const { user } = await createAuthedUser(app);
    const creator = new Types.ObjectId(user._id as string);
    const legacyDate = new Date('2026-08-15T10:00:00.000Z');
    const firstDone = new Date('2026-08-20T10:00:00.000Z');
    const latestDone = new Date('2026-09-01T10:00:00.000Z');

    // Written straight to the collection so they look like documents from before completedAt existed.
    const base = { priority: 'medium', creator, createdAt: legacyDate };
    const { insertedIds } = await Task.collection.insertMany([
      { ...base, title: 'Done, with history', status: 'done', updatedAt: new Date() },
      { ...base, title: 'Done, no history', status: 'done', updatedAt: legacyDate },
      { ...base, title: 'Still open', status: 'todo', updatedAt: legacyDate },
    ]);
    const moved = (to: string, at: Date) => ({
      task: insertedIds[0],
      actor: creator,
      action: 'status_changed',
      meta: { from: 'in_progress', to },
      createdAt: at,
      updatedAt: at,
    });
    await ActivityLog.collection.insertMany([moved('done', firstDone), moved('done', latestDone)]);

    expect(await backfillCompletedAt()).toBe(2);

    const [withHistory, withoutHistory, stillOpen] = await Promise.all(
      [0, 1, 2].map((i) => Task.collection.findOne({ _id: insertedIds[i] })),
    );
    expect(withHistory?.completedAt).toEqual(latestDone);
    expect(withoutHistory?.completedAt).toEqual(legacyDate);
    expect(withoutHistory?.updatedAt).toEqual(legacyDate);
    expect(stillOpen?.completedAt).toBeUndefined();

    // Re-running finds nothing left to do.
    expect(await backfillCompletedAt()).toBe(0);
  });
});

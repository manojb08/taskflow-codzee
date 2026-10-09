import request from 'supertest';
import { createApp } from '../../src/app';
import { ActivityLog } from '../../src/models/ActivityLog';
import { createAuthedUser } from '../utils/testAuth';

const app = createApp();

async function createTask(app: import('express').Express, token: string, title = 'Task with activity') {
  const res = await request(app).post('/api/v1/tasks').set('Authorization', `Bearer ${token}`).send({ title });
  return res.body.data.task._id as string;
}

describe('Activity log', () => {
  it('logs a created entry when a task is created', async () => {
    const { token } = await createAuthedUser(app);
    const taskId = await createTask(app, token);

    const res = await request(app)
      .get(`/api/v1/tasks/${taskId}/activity`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.activity).toHaveLength(1);
    expect(res.body.data.activity[0].action).toBe('created');
  });

  it('logs status, priority, and assignee changes with human-usable from/to values', async () => {
    const { token } = await createAuthedUser(app, { email: 'owner@taskflow.io' });
    const assignee = await createAuthedUser(app, { email: 'assignee@taskflow.io' });
    const taskId = await createTask(app, token);

    await request(app)
      .patch(`/api/v1/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'in_progress', priority: 'high', assignee: assignee.user._id });

    const res = await request(app)
      .get(`/api/v1/tasks/${taskId}/activity`)
      .set('Authorization', `Bearer ${token}`);

    const actions = res.body.data.activity.map((a: { action: string }) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(['status_changed', 'priority_changed', 'assignee_changed', 'created']),
    );

    const statusEntry = res.body.data.activity.find((a: { action: string }) => a.action === 'status_changed');
    expect(statusEntry.meta).toMatchObject({ from: 'todo', to: 'in_progress' });

    const priorityEntry = res.body.data.activity.find((a: { action: string }) => a.action === 'priority_changed');
    expect(priorityEntry.meta).toMatchObject({ from: 'medium', to: 'high' });

    const assigneeEntry = res.body.data.activity.find((a: { action: string }) => a.action === 'assignee_changed');
    expect(assigneeEntry.meta).toMatchObject({ from: null, to: assignee.user.name });
  });

  it('does not log an entry for a no-op update', async () => {
    const { token } = await createAuthedUser(app);
    const taskId = await createTask(app, token);

    await request(app)
      .patch(`/api/v1/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'todo' });

    const res = await request(app)
      .get(`/api/v1/tasks/${taskId}/activity`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.data.activity).toHaveLength(1);
    expect(res.body.data.activity[0].action).toBe('created');
  });

  it('returns activity newest-first', async () => {
    const { token } = await createAuthedUser(app);
    const taskId = await createTask(app, token);

    await request(app)
      .patch(`/api/v1/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'in_progress' });
    await request(app)
      .patch(`/api/v1/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ priority: 'urgent' });

    const res = await request(app)
      .get(`/api/v1/tasks/${taskId}/activity`)
      .set('Authorization', `Bearer ${token}`);

    const actions = res.body.data.activity.map((a: { action: string }) => a.action);
    expect(actions).toEqual(['priority_changed', 'status_changed', 'created']);
  });

  it('rejects unauthenticated requests', async () => {
    const { token } = await createAuthedUser(app);
    const taskId = await createTask(app, token);

    const res = await request(app).get(`/api/v1/tasks/${taskId}/activity`);
    expect(res.status).toBe(401);
  });

  it('returns 404 for a task that does not exist', async () => {
    const { token } = await createAuthedUser(app);
    const res = await request(app)
      .get('/api/v1/tasks/64b64b64b64b64b64b64b64b/activity')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("deletes a task's activity along with the task, leaving other tasks' activity alone", async () => {
    const { token } = await createAuthedUser(app);
    const taskId = await createTask(app, token, 'Task to delete');
    const otherTaskId = await createTask(app, token, 'Task to keep');
    await request(app)
      .patch(`/api/v1/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'in_progress' });
    expect(await ActivityLog.countDocuments({ task: taskId })).toBe(2);

    const del = await request(app).delete(`/api/v1/tasks/${taskId}`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);

    // The activity endpoint 404s once its task is gone, so check the collection directly.
    expect(await ActivityLog.countDocuments({ task: taskId })).toBe(0);
    expect(await ActivityLog.countDocuments({ task: otherTaskId })).toBe(1);
  });
});

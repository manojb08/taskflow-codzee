import request from 'supertest';
import { createApp } from '../../src/app';
import { Task } from '../../src/models/Task';
import { createAuthedUser } from '../utils/testAuth';

const app = createApp();
const DAY_MS = 24 * 60 * 60 * 1000;

describe('Dashboard stats', () => {
  it('does not 400 (confirms /stats/summary is not swallowed by /:id)', async () => {
    const { token } = await createAuthedUser(app);
    const res = await request(app)
      .get('/api/v1/tasks/stats/summary')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('reflects created tasks by status', async () => {
    const { token } = await createAuthedUser(app);

    const seedTasks = [
      { title: 'Todo one', status: 'todo' },
      { title: 'Todo two', status: 'todo' },
      { title: 'In progress one', status: 'in_progress' },
      { title: 'Done one', status: 'done' },
    ];
    for (const t of seedTasks) {
      await request(app).post('/api/v1/tasks').set('Authorization', `Bearer ${token}`).send(t);
    }

    const res = await request(app)
      .get('/api/v1/tasks/stats/summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(4);
    expect(res.body.data.todo).toBe(2);
    expect(res.body.data.inProgress).toBe(1);
    expect(res.body.data.done).toBe(1);
  });

  it('scopes assignedToMeTodoCount to the requesting user', async () => {
    const owner = await createAuthedUser(app, { email: 'stats-owner@taskflow.io' });
    const userA = await createAuthedUser(app, { email: 'stats-a@taskflow.io' });
    const userB = await createAuthedUser(app, { email: 'stats-b@taskflow.io' });

    await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: 'A todo 1', status: 'todo', assignee: userA.user._id });
    await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: 'A todo 2', status: 'todo', assignee: userA.user._id });
    await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: 'A in progress', status: 'in_progress', assignee: userA.user._id });
    await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: 'B todo 1', status: 'todo', assignee: userB.user._id });

    const statsA = await request(app)
      .get('/api/v1/tasks/stats/summary')
      .set('Authorization', `Bearer ${userA.token}`);
    expect(statsA.body.data.assignedToMeTodoCount).toBe(2);

    const statsB = await request(app)
      .get('/api/v1/tasks/stats/summary')
      .set('Authorization', `Bearer ${userB.token}`);
    expect(statsB.body.data.assignedToMeTodoCount).toBe(1);
  });

  it('counts completedThisWeek by when a task was finished, not when it was last edited', async () => {
    const { token } = await createAuthedUser(app);

    // Finished a month ago, then edited today: must not count as completed this week.
    const oldTask = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Finished last month', status: 'done' });
    const oldTaskId = oldTask.body.data.task._id;
    await Task.updateOne({ _id: oldTaskId }, { completedAt: new Date(Date.now() - 30 * DAY_MS) });
    await request(app)
      .patch(`/api/v1/tasks/${oldTaskId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Finished last month (typo fixed)' });

    // Finished today.
    const newTask = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Started today' });
    await request(app)
      .patch(`/api/v1/tasks/${newTask.body.data.task._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'done' });

    const res = await request(app)
      .get('/api/v1/tasks/stats/summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.data.done).toBe(2);
    expect(res.body.data.completedThisWeek).toBe(1);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/v1/tasks/stats/summary');
    expect(res.status).toBe(401);
  });
});

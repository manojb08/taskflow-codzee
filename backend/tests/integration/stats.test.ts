import request from 'supertest';
import { Types } from 'mongoose';
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
    const edit = await request(app)
      .patch(`/api/v1/tasks/${oldTaskId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Finished last month (typo fixed)' });
    expect(edit.status).toBe(200);

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

  it('counts dueThisWeek as open tasks due within the next 7 days', async () => {
    const { token } = await createAuthedUser(app);
    const inDays = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString();

    const seedTasks = [
      { title: 'Due in 3 days', dueDate: inDays(3) },
      { title: 'Due in 3 days, already done', dueDate: inDays(3), status: 'done' },
      { title: 'Due in 10 days', dueDate: inDays(10) },
      { title: 'Overdue', dueDate: inDays(-2) },
      { title: 'No due date' },
    ];
    for (const t of seedTasks) {
      await request(app).post('/api/v1/tasks').set('Authorization', `Bearer ${token}`).send(t);
    }

    const res = await request(app)
      .get('/api/v1/tasks/stats/summary')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.data.dueThisWeek).toBe(1);
  });

  it('reports the week-over-week trend in created tasks, or null with no previous week', async () => {
    const { token } = await createAuthedUser(app);
    const createTask = async (title: string) => {
      const res = await request(app).post('/api/v1/tasks').set('Authorization', `Bearer ${token}`).send({ title });
      return res.body.data.task._id as string;
    };
    const getStats = () => request(app).get('/api/v1/tasks/stats/summary').set('Authorization', `Bearer ${token}`);

    for (const title of ['This week 1', 'This week 2', 'This week 3']) {
      await createTask(title);
    }
    expect((await getStats()).body.data.totalTrendPct).toBeNull();

    // Mongoose treats createdAt as immutable, so backdate through the driver.
    const lastWeek = [await createTask('Last week 1'), await createTask('Last week 2')];
    await Task.collection.updateMany(
      { _id: { $in: lastWeek.map((id) => new Types.ObjectId(id)) } },
      { $set: { createdAt: new Date(Date.now() - 10 * DAY_MS) } },
    );

    const res = await getStats();
    expect(res.body.data.total).toBe(5);
    expect(res.body.data.totalTrendPct).toBe(50); // 3 created this week vs 2 the week before
  });

  it('counts in_review and blocked tasks in the total only', async () => {
    const { token } = await createAuthedUser(app);
    for (const status of ['in_review', 'blocked']) {
      await request(app).post('/api/v1/tasks').set('Authorization', `Bearer ${token}`).send({ title: status, status });
    }

    const res = await request(app)
      .get('/api/v1/tasks/stats/summary')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.data).toMatchObject({ total: 2, todo: 0, inProgress: 0, done: 0, assignedToMeTodoCount: 0 });
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/v1/tasks/stats/summary');
    expect(res.status).toBe(401);
  });
});

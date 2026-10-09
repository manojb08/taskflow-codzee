import request from 'supertest';
import { createApp } from '../../src/app';
import { createAuthedAdmin, createAuthedUser } from '../utils/testAuth';

const app = createApp();

describe('Tasks', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/v1/tasks');
    expect(res.status).toBe(401);
  });

  it('creates a task with the creator set from the authenticated user', async () => {
    const { token, user } = await createAuthedUser(app);

    const res = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Write tests', description: 'Cover the task API' });

    expect(res.status).toBe(201);
    expect(res.body.data.task.title).toBe('Write tests');
    expect(res.body.data.task.status).toBe('todo');
    expect(res.body.data.task.priority).toBe('medium');
    expect(res.body.data.task.creator._id).toBe(user._id);
  });

  it('rejects creating a task without a title', async () => {
    const { token } = await createAuthedUser(app);
    const res = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ description: 'missing title' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('assigns a task to another registered user', async () => {
    const { token } = await createAuthedUser(app, { email: 'creator@taskflow.io' });
    const assignee = await createAuthedUser(app, { email: 'assignee@taskflow.io' });

    const res = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Assigned task', assignee: assignee.user._id });

    expect(res.status).toBe(201);
    expect(res.body.data.task.assignee._id).toBe(assignee.user._id);
  });

  it('updates a task and returns 404 for an unknown id', async () => {
    const { token } = await createAuthedUser(app);
    const created = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Original title' });

    const updated = await request(app)
      .patch(`/api/v1/tasks/${created.body.data.task._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'in_progress', priority: 'high' });

    expect(updated.status).toBe(200);
    expect(updated.body.data.task.status).toBe('in_progress');
    expect(updated.body.data.task.priority).toBe('high');

    const missing = await request(app)
      .patch('/api/v1/tasks/64b64b64b64b64b64b64b64b')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'done' });
    expect(missing.status).toBe(404);
  });

  it('deletes a task and cascades its comments', async () => {
    const { token } = await createAuthedUser(app);
    const created = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'To be deleted' });
    const taskId = created.body.data.task._id;

    await request(app)
      .post(`/api/v1/tasks/${taskId}/comments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'A comment' });

    const del = await request(app).delete(`/api/v1/tasks/${taskId}`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);

    const getAfterDelete = await request(app)
      .get(`/api/v1/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(getAfterDelete.status).toBe(404);

    const comments = await request(app)
      .get(`/api/v1/tasks/${taskId}/comments`)
      .set('Authorization', `Bearer ${token}`);
    expect(comments.status).toBe(404); // task itself no longer exists
  });

  it('blocks a member from deleting a task someone else created', async () => {
    const creator = await createAuthedUser(app, { email: 'task-owner@taskflow.io' });
    const otherMember = await createAuthedUser(app, { email: 'not-the-owner@taskflow.io' });
    const created = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${creator.token}`)
      .send({ title: 'Not yours to delete' });
    const taskId = created.body.data.task._id;

    const del = await request(app)
      .delete(`/api/v1/tasks/${taskId}`)
      .set('Authorization', `Bearer ${otherMember.token}`);
    expect(del.status).toBe(403);
    expect(del.body.error.code).toBe('FORBIDDEN');

    const stillThere = await request(app)
      .get(`/api/v1/tasks/${taskId}`)
      .set('Authorization', `Bearer ${creator.token}`);
    expect(stillThere.status).toBe(200);
  });

  it('lets an admin delete a task someone else created', async () => {
    const creator = await createAuthedUser(app, { email: 'member-owner@taskflow.io' });
    const admin = await createAuthedAdmin(app, { email: 'task-admin@taskflow.io' });
    const created = await request(app)
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${creator.token}`)
      .send({ title: 'Cleaned up by an admin' });

    const del = await request(app)
      .delete(`/api/v1/tasks/${created.body.data.task._id}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(del.status).toBe(200);
  });

  it('returns 404 when deleting a task that does not exist', async () => {
    const { token } = await createAuthedUser(app);
    const res = await request(app)
      .delete('/api/v1/tasks/64b64b64b64b64b64b64b64b')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  describe('list, search, filter, sort, paginate', () => {
    it('filters by status/priority/assignee, searches by title, sorts, and paginates', async () => {
      const { token } = await createAuthedUser(app, { email: 'lister@taskflow.io' });
      const assignee = await createAuthedUser(app, { email: 'lister-assignee@taskflow.io' });

      const seedTasks = [
        { title: 'Fix payment webhook issue', status: 'blocked', priority: 'urgent' },
        { title: 'Design onboarding flow', status: 'in_review', priority: 'high' },
        { title: 'Add task filtering', status: 'todo', priority: 'medium', assignee: assignee.user._id },
        { title: 'Refactor user permissions', status: 'done', priority: 'high' },
      ];
      for (const t of seedTasks) {
        await request(app).post('/api/v1/tasks').set('Authorization', `Bearer ${token}`).send(t);
      }

      const byStatus = await request(app)
        .get('/api/v1/tasks?status=blocked')
        .set('Authorization', `Bearer ${token}`);
      expect(byStatus.body.data.tasks).toHaveLength(1);
      expect(byStatus.body.data.tasks[0].title).toBe('Fix payment webhook issue');

      const byAssignee = await request(app)
        .get(`/api/v1/tasks?assignee=${assignee.user._id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(byAssignee.body.data.tasks).toHaveLength(1);
      expect(byAssignee.body.data.tasks[0].title).toBe('Add task filtering');

      const bySearch = await request(app)
        .get('/api/v1/tasks?search=webhook')
        .set('Authorization', `Bearer ${token}`);
      expect(bySearch.body.data.tasks).toHaveLength(1);
      expect(bySearch.body.data.tasks[0].title).toBe('Fix payment webhook issue');

      const paginated = await request(app)
        .get('/api/v1/tasks?page=1&limit=2&sortBy=title&sortOrder=asc')
        .set('Authorization', `Bearer ${token}`);
      expect(paginated.body.data.tasks).toHaveLength(2);
      expect(paginated.body.meta).toMatchObject({ page: 1, limit: 2, total: 4, totalPages: 2 });
      expect(paginated.body.data.tasks[0].title).toBe('Add task filtering');
    });

    it('returns an empty list (not an error) when filters match nothing', async () => {
      const { token } = await createAuthedUser(app, { email: 'empty@taskflow.io' });
      const res = await request(app)
        .get('/api/v1/tasks?status=done&priority=urgent')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.tasks).toHaveLength(0);
      expect(res.body.meta.total).toBe(0);
    });
  });
});

import request from 'supertest';
import { Express } from 'express';
import { User } from '../../src/models/User';
import { signAccessToken } from '../../src/utils/jwt';

let counter = 0;

export async function createAuthedUser(app: Express, overrides: Partial<{ name: string; email: string }> = {}) {
  counter += 1;
  const email = overrides.email ?? `user${counter}@taskflow.io`;
  const name = overrides.name ?? `User ${counter}`;
  const res = await request(app).post('/api/v1/auth/register').send({ name, email, password: 'password123' });
  return { token: res.body.data.accessToken as string, user: res.body.data.user };
}

export async function createAuthedAdmin(app: Express, overrides: Partial<{ name: string; email: string }> = {}) {
  const authed = await createAuthedUser(app, overrides);
  await User.findByIdAndUpdate(authed.user._id, { role: 'admin' });
  // The access token issued at registration still encodes the old role; mint a fresh one directly
  // rather than re-authenticating through /login, which would also consume the shared authLimiter.
  const token = signAccessToken({ sub: authed.user._id, role: 'admin' });
  return { token, user: { ...authed.user, role: 'admin' } };
}

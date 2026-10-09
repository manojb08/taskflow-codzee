# TaskFlow — Multi-User Task Management App

A small internal task-management tool for a team: create/assign/track tasks with search, filters, and comments.

Built for a full-stack engineering assessment. See also: [DESIGN.md](./DESIGN.md) (architecture & data model), [APPROACH.md](./APPROACH.md) (how the build was sequenced), [DECISIONS.md](./DECISIONS.md) (assumptions & tradeoffs), [AI_USAGE.md](./AI_USAGE.md).

## Stack

- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS + Radix UI primitives (hand-built ShadCN-style components)
- **Backend**: Node.js + Express + TypeScript
- **Database**: MongoDB + Mongoose
- **Auth**: JWT access token (in memory) + httpOnly refresh cookie
- **Tests**: Jest + Supertest + mongodb-memory-server (backend), Vitest + React Testing Library (frontend)

## Project layout

```
backend/    Express API server
frontend/   React SPA
DESIGN.md       architecture, data model, API contract, UI design system
APPROACH.md     engineering approach & build order
DECISIONS.md    assumptions, alternatives considered, tradeoffs
AI_USAGE.md     how AI tools were used in this submission
docker-compose.yml  local MongoDB
```

## Setup

### Prerequisites

- Node.js 20+
- MongoDB, one of:
  - **Docker** (recommended): `docker compose up -d` from the repo root starts MongoDB on `localhost:27017`.
  - A local MongoDB install, or a free [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register) cluster — put its connection string in `MONGODB_URI`.

### 1. Database

```bash
docker compose up -d
```

### 2. Backend

```bash
cd backend
cp .env.example .env    # defaults already point at the docker-compose Mongo instance
npm install
npm run seed             # creates 2 demo users + 1 sample task
npm run dev               # http://localhost:4000
```

Upgrading a database created before tasks had a `completedAt` field? Run `npm run backfill:completed-at` once so tasks that were already done keep a completion date.

Seeded accounts (for testing task assignment, and admin-only features like inviting members):

| Email | Password | Role |
|---|---|---|
| `alex@taskflow.io` | `password123` | admin |
| `sarah@taskflow.io` | `password123` | member |

### 3. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev               # http://localhost:5173
```

Open `http://localhost:5173`, log in with either seeded account.

### Running tests

```bash
cd backend && npm test      # integration tests against an in-memory MongoDB
cd frontend && npm test      # component/unit tests
```

## Environment variables

**backend/.env**
| Var | Description |
|---|---|
| `PORT` | API port (default `4000`) |
| `MONGODB_URI` | MongoDB connection string |
| `CLIENT_ORIGIN` | Frontend origin allowed by CORS (default `http://localhost:5173`) |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Random secrets for signing tokens — generate with `openssl rand -hex 32` |
| `JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | Token lifetimes (default `15m` / `7d`) |

**frontend/.env**
| Var | Description |
|---|---|
| `VITE_API_URL` | Base URL of the backend API (default `http://localhost:4000/api/v1`) |

## Architecture overview

Two independent apps talking over a versioned REST API (`/api/v1`) — no server-side rendering, no shared runtime. See [DESIGN.md](./DESIGN.md) for the full breakdown (data model, folder structure, security). In short:

- **Auth**: register/login issue a short-lived JWT access token (returned in the response body, held in memory on the client) plus a long-lived refresh token in an httpOnly cookie. The frontend's API client automatically retries a request once after a silent refresh if it gets a `401`.
- **Tasks**: standard CRUD, with server-side pagination, text search (title + description), and filtering by status/priority/assignee.
- **Comments**: a separate collection referencing a task, so a task document doesn't grow unbounded and comments can be paginated independently. Deleting a task cascades to its comments.
- **Activity log**: task creation and edits to status/priority/assignee/due-date are recorded and shown in the task detail view's Activity panel.
- **Invite / forgot-password**: share one token mechanism (a hashed, time-limited token that lets someone set a password). There's no email service wired up, so both flows return the link directly in the API response for the demo to be usable — see [DECISIONS.md](./DECISIONS.md#round-2--features-added-beyond-5-requirements).
- **Real-time**: a Socket.io layer sits alongside the REST API — mutations still go through the normal validated REST endpoints, and the server just broadcasts a lightweight "this changed, refetch it" event afterward. Open the app in two browser sessions and edit a task in one; the other updates without a manual refresh. Purely additive — the app works identically (via normal refetch) if the socket never connects.

## API overview

All endpoints are under `/api/v1`. Full contract in [DESIGN.md §3](./DESIGN.md#3-api-contract-rest-versioned-apiv1).

```
POST   /auth/register          POST   /auth/login          POST /auth/refresh
POST   /auth/logout            GET    /auth/me
POST   /auth/forgot-password   POST   /auth/set-password    (shared by invite-accept and reset)

GET    /users                  (id/name/email/role/status — for assignee pickers, Team page)
POST   /users                  admin only — invites a member, returns a one-time invite link
PATCH  /users/me                update your own name

GET    /tasks                  ?page&limit&search&status&priority&assignee&sortBy&sortOrder
POST   /tasks
GET    /tasks/stats/summary     dashboard metrics
GET    /tasks/:id
PATCH  /tasks/:id
DELETE /tasks/:id

GET    /tasks/:id/comments
POST   /tasks/:id/comments
DELETE /comments/:commentId

GET    /tasks/:id/activity
```

Responses use a consistent envelope: `{ success, data, meta? }` or `{ success: false, error: { code, message, details? } }`.

## Known limitations

Documented as deliberate scope decisions in [DECISIONS.md](./DECISIONS.md) — the short version:

- **No notification delivery.** Tasks/comments now sync live across open tabs/sessions via Socket.io (see below), but there's no persisted, per-user notification feed — the bell icon and @mentions don't push anything yet.
- **Role model is minimal.** Any authenticated user can edit/assign/delete any task (matches "small trusted team"); comment deletion is restricted to the author or an admin; inviting new members is admin-only.
- **No real email delivery.** Invite and password-reset links are returned directly by the API (shown on-screen) rather than emailed, since there's no email service configured — clearly labeled as dev-only in the UI.
- **Settings only supports editing your name.** Email (login identity) and role (admin-controlled) aren't self-service.
- **No file attachments, sub-tasks, or kanban/drag-and-drop.**

## AI usage

Disclosed in full in [AI_USAGE.md](./AI_USAGE.md).

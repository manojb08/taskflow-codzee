# DESIGN.md — TaskFlow (Multi-User Task Management App)

This document describes the system design for the assessment: a multi-user task management application. It covers architecture, data model, API contract, and the UI design system (reproduced from the provided Claude Design reference artifact).

---

## 1. High-Level Architecture

```
┌─────────────────────┐        HTTPS / JSON         ┌──────────────────────┐
│   Frontend (SPA)     │ ───────────────────────────▶ │   Backend (REST API)  │
│ React + TS + Tailwind│ ◀─────────────────────────── │ Node.js + Express + TS│
│  Vite dev server     │        JWT (Bearer)          │                        │
└─────────────────────┘                               └──────────┬────────────┘
                                                                    │ Mongoose
                                                                    ▼
                                                          ┌──────────────────┐
                                                          │   MongoDB         │
                                                          │ users / tasks /   │
                                                          │ comments          │
                                                          └──────────────────┘
```

- **Monorepo layout**: `backend/` and `frontend/` as independent npm projects, each with their own `package.json`, so they can be developed, tested, and deployed independently.
- **Communication**: Frontend talks to the backend over a versioned REST API (`/api/v1/...`) for every read and write — that's still the single source of truth. A Socket.io connection sits alongside it purely as a "something changed, go refetch" signal (see §3.1) — it never carries data the client trusts directly. No server-side rendering / no shared runtime — a clean client/server boundary keeps the assessment's two hardest concerns (auth, data modeling) testable in isolation.
- **Auth model**: Stateless JWT access tokens (short-lived) + httpOnly refresh token cookie (rotation). Chosen over server sessions because it needs no session store and keeps the API stateless/horizontally scalable — reasonable for a small internal tool without over-engineering. The same access token authenticates the Socket.io handshake.

---

## 2. Data Model (MongoDB / Mongoose)

### User
| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `name` | String | required |
| `email` | String | required, unique, lowercase, indexed |
| `passwordHash` | String | bcrypt hash, **never returned** in API responses |
| `role` | enum `admin` \| `member` | default `member` (kept minimal — full RBAC is out of scope) |
| `status` | enum `active` \| `invited` | default `active`; `invited` until the person accepts via a credential token |
| `tokenVersion` | Number | incremented on logout / password change to invalidate outstanding refresh tokens; never returned |
| `credentialTokenHash` / `credentialTokenExpires` / `credentialTokenPurpose` | String / Date / enum `invite`\|`reset` | set when an invite or password-reset link is issued; only the **hash** of the token is stored, never returned |
| `createdAt` / `updatedAt` | Date | timestamps |

### Task
| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `title` | String | required, 1–200 chars |
| `description` | String | optional, markdown-flavored plain text, max 2000 chars |
| `status` | enum `todo` \| `in_progress` \| `in_review` \| `done` \| `blocked` | default `todo` |
| `priority` | enum `low` \| `medium` \| `high` \| `urgent` | default `medium` |
| `assignee` | ObjectId ref `User` | nullable (unassigned allowed) |
| `creator` | ObjectId ref `User` | required, set from authenticated user, immutable |
| `dueDate` | Date | optional |
| `completedAt` | Date | set when status moves to `done`, cleared when it moves out; drives the dashboard's "completed this week" |
| `createdAt` / `updatedAt` | Date | timestamps (Mongoose auto) |

Indexes: `{ status: 1 }`, `{ priority: 1 }`, `{ assignee: 1 }`, text index on `{ title: 'text', description: 'text' }` for search.

### Comment
Modeled as a **separate collection** (not embedded) referencing the task, so a task's comment count doesn't cause its document to grow unbounded and the comments list can be paginated independently.

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `task` | ObjectId ref `Task` | required, indexed |
| `author` | ObjectId ref `User` | required |
| `body` | String | required, 1–2000 chars |
| `createdAt` / `updatedAt` | Date | timestamps |

### ActivityLog
Written on task creation and on any actual change to status/priority/assignee/dueDate during an edit (no-op edits write nothing). Powers the task detail view's read-only "Activity" panel.

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `task` | ObjectId ref `Task` | required, indexed |
| `actor` | ObjectId ref `User` | who made the change |
| `action` | enum `created` \| `status_changed` \| `priority_changed` \| `assignee_changed` \| `due_date_changed` | |
| `meta` | `{ from, to }` | human-readable old/new values (e.g. assignee resolved to a name, not an id) |
| `createdAt` | Date | timestamps |

---

## 3. API Contract (REST, versioned `/api/v1`)

All responses use a consistent envelope:
```json
// success
{ "success": true, "data": { ... }, "meta": { "page": 1, "limit": 20, "total": 42 } }
// error
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }
```

### Auth
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | — | Create user, returns access token + sets refresh cookie |
| POST | `/auth/login` | — | Validate credentials, returns access token + sets refresh cookie |
| POST | `/auth/refresh` | refresh cookie | Issues new access token |
| POST | `/auth/logout` | — | Clears refresh cookie, invalidates the refresh token server-side |
| GET | `/auth/me` | Bearer | Current user profile |
| POST | `/auth/forgot-password` | — (rate-limited) | Always returns a generic success message; issues a 1hr reset token when the email matches (returned directly outside production — no email service) |
| POST | `/auth/set-password` | — (rate-limited) | Consumes an invite or reset token atomically, sets the new password, activates the account |

### Users
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/users` | Bearer | List users (id, name, email, role, status) — assignee pickers, Team page |
| POST | `/users` | Bearer + admin | Invite a member: creates a `status:'invited'` user, returns a one-time invite link |
| PATCH | `/users/me` | Bearer | Update your own name |

### Tasks
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/tasks` | Bearer | List, paginated. Query: `page, limit, search, status, priority, assignee, sortBy, sortOrder` |
| POST | `/tasks` | Bearer | Create task (creator = current user) |
| GET | `/tasks/stats/summary` | Bearer | Dashboard metrics (counts, week-over-week trend, due-this-week, assigned-to-me) — registered before `/tasks/:id` so it isn't captured as an id |
| GET | `/tasks/:id` | Bearer | Task detail |
| PATCH | `/tasks/:id` | Bearer | Partial update (title/description/status/priority/assignee/dueDate); logs an ActivityLog entry per changed field |
| DELETE | `/tasks/:id` | Bearer | Delete task (cascades: deletes its comments) |
| GET | `/tasks/:id/activity` | Bearer | Task's activity trail, newest first |

### Comments
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/tasks/:id/comments` | Bearer | List comments for a task, paginated |
| POST | `/tasks/:id/comments` | Bearer | Add comment (author = current user) |
| DELETE | `/comments/:id` | Bearer | Delete own comment (author or admin only) |

**Authorization rule** (documented assumption — see DECISIONS.md): any authenticated user can view/edit/assign any task (small trusted team, matches "internal tool used by a small engineering team"). Delete of a *comment* is restricted to its author or an admin. Delete of a *task* is unrestricted among authenticated users, matching the design's per-row "Delete task" action being available to any team member. Inviting a new member is the one admin-only write endpoint — reading the roster (`GET /users`) is not restricted (see DECISIONS.md for why).

### 3.1 Real-time events (Socket.io, additive to the REST API above)

The client connects with `io(url, { auth: { token: <access token> } })`; the server verifies that token the same way `requireAuth` does before accepting the connection. Every authenticated client receives every event below (no rooms/per-user targeting — see DECISIONS.md Round 3). Payloads are IDs only; the client always refetches the actual data via the REST endpoints above rather than trusting broadcast data.

| Event | Payload | Emitted when |
|---|---|---|
| `task:created` | `{ taskId }` | after `POST /tasks` succeeds |
| `task:updated` | `{ taskId }` | after `PATCH /tasks/:id` succeeds |
| `task:deleted` | `{ taskId }` | after `DELETE /tasks/:id` succeeds |
| `comment:created` | `{ taskId, commentId }` | after `POST /tasks/:id/comments` succeeds |
| `comment:deleted` | `{ taskId, commentId }` | after `DELETE /comments/:id` succeeds |

---

## 4. UI Design System (from the provided Claude Design reference)

Reproduced 1:1 from the reference artifact's "Foundations" frame — treated as the source of truth for the frontend implementation.

**Colors**
| Token | Hex | Usage |
|---|---|---|
| Ink / primary | `#0A0A0A` | text, primary buttons |
| Accent | `#3B82F6` | links, "In Progress" badge, focus ring |
| Success | `#16A34A` | "Done" badge |
| Warning | `#CA8A04` | "In Review" badge, high priority dot |
| Destructive | `#DC2626` | "Blocked" badge, urgent priority, delete actions |
| App canvas | `#FCFCFC` | page background |
| Sidebar / topbar | `#F9F9F9` | nav surfaces |
| Border | `#E5E5E5` | dividers, input borders |

**Typography**: `Outfit` for headings (page title 24/700, section heading 20/600), `Geist` for body/UI text (table cell emphasis 14/500, body 14/400, metadata/timestamps 12/400). Both loaded via Google Fonts with system-font fallback stacks.

**Layout metrics**: sidebar 215px, topbar 46px, radius 8px, table row height 56px, content padding 40px, 8pt spacing grid, badge 22px tall / 6px radius / 1px border / 12px-500 label.

**Statuses**: To Do (gray), In Progress (blue), In Review (amber), Done (green), Blocked (red).
**Priorities**: Low, Medium (gray dots), High (amber dot), Urgent (red dot).

**Screens reproduced** (desktop 1440×900 + mobile 390×844, from the reference):
1. Login (+ Register), Forgot password, Set password (shared by accept-invite and reset-password)
2. Dashboard — stat cards (with real week-over-week trend + derived metrics) + recent tasks table
3. Tasks list — search, Status/Priority/Assignee filters, sort, paginated table, row actions
4. Task Detail — description, comments thread + composer (with @mention autocomplete), right rail (task info + activity feed)
5. Edit Task — inline edit with unsaved-changes summary + danger zone (delete)
6. Team — member roster with Active/Invited status, admin-gated Invite Member dialog
7. Settings — profile (name editing; email/role intentionally read-only)
8. States — loading (skeleton), empty ("No tasks found"), error (toast + destructive confirm dialog)
9. Responsive — sidebar collapses to a real slide-out Sheet, task list rows become cards below the `md` breakpoint, create task remains a Dialog on all sizes (see DECISIONS.md).

Components are built as reusable primitives (Button, Input, Select, Badge, Table, Dialog, Sheet, Avatar, Toast) via **ShadCN/UI** on top of Tailwind, matching the tokens above, so every screen composes the same primitives rather than one-off styles.

---

## 5. Frontend Structure

```
frontend/src/
  api/            # typed fetch client, one module per resource (auth, tasks, comments, users, activity)
  components/
    ui/           # shadcn primitives (button, input, badge, dialog, sheet, ...)
    layout/       # Sidebar, Topbar, AppShell
    tasks/        # TaskTable (table + mobile cards), TaskFilters, ActivityFeed, StatusBadge, PriorityBadge
    comments/     # CommentList, CommentComposer (mention autocomplete)
  pages/          # Login, Register, ForgotPassword, SetPassword, Dashboard, Tasks, TaskDetail, Team, Settings
  hooks/          # useTaskList, useDashboardStats, useDebouncedValue, useMyTasksCount, useUsers
  context/        # AuthContext
  types/          # shared TS types mirroring the API contract
  lib/            # utils (cn, date formatting)
```

## 6. Backend Structure

```
backend/src/
  config/         # env, db connection
  models/         # User, Task, Comment, ActivityLog (Mongoose schemas)
  controllers/    # authController, taskController, commentController, userController, activityController
  routes/         # one router per resource, mounted under /api/v1
  middleware/     # requireAuth, requireRole, errorHandler, validateRequest (zod), rateLimiter
  validators/     # zod schemas per endpoint
  utils/          # jwt, logActivity, ApiError, asyncHandler
  app.ts          # express app (middleware wiring)
  server.ts       # http server bootstrap + db connect
tests/
  integration/    # supertest against routes, mongodb-memory-server
  utils/          # shared test fixtures (auth helpers)
```

---

## 7. Security

- Passwords hashed with **bcrypt** (cost 12), never stored/returned in plaintext.
- JWT access token (15 min) in `Authorization: Bearer`, refresh token (7 days) in **httpOnly, sameSite=strict** cookie — mitigates XSS token theft on the access token's short window and keeps the refresh token off `localStorage`.
- `requireAuth` middleware rejects any protected route without a valid access token (`401`); `requireRole` additionally gates admin-only routes (invite member).
- Invite/reset credential tokens: 32 random bytes, only the **sha256 hash** is ever persisted, expiry enforced server-side (`credentialTokenExpires`), consumed **atomically** via a single `findOneAndUpdate` so a token can't be double-spent by two racing requests, and a successful password set bumps `tokenVersion` to invalidate any outstanding refresh tokens.
- `forgot-password` performs the identical database operation regardless of whether the email matches, so response timing can't be used to enumerate registered accounts.
- Input validation on every mutating endpoint via **zod**, server-side (client-side validation mirrors it for UX but is never trusted).
- Rate limiting on all `/auth/*` endpoints (login/register/forgot-password/set-password) to blunt brute force.
- Mongoose schema-level constraints + `helmet` + CORS locked to the frontend origin.
- No secrets committed — `.env.example` documents required vars, real `.env` is gitignored.
- The credential-token flow was adversarially reviewed after implementation (prompted to specifically look for token leakage, enumeration, expiry bypass, and authorization gaps); the timing-enumeration issue and the token race condition above were both found and fixed as a result — see AI_USAGE.md.

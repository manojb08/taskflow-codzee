# DECISIONS.md

Technical decisions, assumptions, alternatives considered, and tradeoffs made while building this. Organized by area; each entry follows the brief's rule: assumption → implemented consistently → documented here.

## Authentication & authorization

**JWT access token + httpOnly refresh cookie, instead of server sessions.**
- Alternative considered: session cookie + server-side session store (e.g. Redis).
- Why not: adds a stateful dependency for no real benefit at this scale — a takehome task app doesn't need session revocation lists or shared session state across instances.
- Tradeoff accepted: logout requires an explicit server round-trip to invalidate the refresh token (via a `tokenVersion` bump on the user document) rather than just deleting a session row; this is a few extra lines, not a real cost.

**Access token held in memory (JS variable), never `localStorage`.**
- Why: `localStorage` is readable by any script on the page — an XSS bug anywhere in the app (or a dependency) can exfiltrate a long-lived token. Keeping it in memory means a page refresh loses it, which is why the refresh-cookie flow exists (silent re-auth on load via `/auth/refresh`).
- Tradeoff: a hard refresh briefly shows a loading spinner while the app re-authenticates. Acceptable for an internal tool.

**Any authenticated user can view, edit, or assign any task; only its creator or an admin can delete it.**
- Assumption: the brief describes "a small engineering team" using an internal tool — the realistic failure mode there is not malicious teammates, it's accidental overreach, which isn't solved by ACLs anyway.
- Alternative considered: only the creator or assignee can edit/delete a task.
- Why not, for edits: building real RBAC wasn't asked for in §5, and a bad edit can simply be edited back (status/priority/assignee/due-date changes also show up in the activity log). Documented here rather than silently generalized.
- Revised, for deletes: deletion originally followed the same open rule, because the reference design's task list shows a delete action on every row. It's now creator-or-admin — the same rule comments use — because deletion is the one task operation that can't be undone, and it also destroys every teammate's comments on the task. That's exactly the "accidental overreach" named above. The UI only offers Delete to users who can use it; the API enforces the rule regardless (`403 FORBIDDEN`).
- Where I *did* restrict from the start: comment deletion is author-or-admin only, because comments are personal statements ("Sarah said X") in a way task fields aren't, and it was a small addition once `role` existed on the user model.

**Registration is open, and there's also an admin-gated invite flow.**
- The brief only needs "at least two users" to demonstrate assignment, so open self-registration alone would have satisfied §5. An admin "Invite Member" path was added afterward (see "Round 2" below) as a more realistic onboarding story for an internal tool — but self-registration was kept rather than removed, since closing it would need an explicit product decision ("is this tool invite-only?") the brief never makes.

**`GET /users` is open to any authenticated user, not admin-restricted.**
- Reviewed explicitly (an adversarial security pass flagged the asymmetry with the admin-gated invite endpoint and asked me to confirm intent rather than assume it). Decision: keep it open. It's a read-only roster (name/email/role/status) used by every member for assignee pickers, the Team page, and comment mentions — restricting it to admins would break those features for regular members, which contradicts "small trusted team" being able to see who's on it. The asymmetry with `POST /users` (admin-only) is intentional: reading the roster is low-risk, creating accounts isn't.

## Data model

**Comments are a separate collection, not embedded in the Task document.**
- Alternative: embed comments as an array field on `Task`.
- Why not: MongoDB documents have a 16MB cap and embedded arrays that grow unboundedly are a well-known anti-pattern; a separate collection also lets comments be paginated independently of the task and indexed on `task` for fast lookups.

**Deleting a task cascades to delete its comments and its activity log.**
- Assumption: orphaned comments referencing a deleted task have no product value and would just be dead data. The reference design's delete-confirmation dialog literally says "and its comments will be permanently removed" — so this was actually specified, not just assumed.
- Activity entries were originally left behind, even though the edit page's danger zone already told users that deleting "removes its comments and activity". They're unreachable once the task is gone (the activity endpoint 404s), so they were pure dead data; they're now deleted alongside the comments.
- Not atomic: the task is deleted first, then its comments and activity. A crash in between leaves orphans, which are invisible and harmless; the reverse order could lose a live task's comments. A transaction would close the gap, but it needs a replica set, which the local docker-compose MongoDB isn't.

**`status` and `priority` are fixed enums, not a user-editable list.**
- The brief's suggested values (Todo/In Progress/Done for status; Low/Medium/High for priority) were extended to match the reference design exactly: status gets a 5th value `in_review` and `blocked`; priority gets a 4th value `urgent`. Kept as backend-enforced enums (not free text) so filtering/sorting stay meaningful — a "make statuses configurable" feature was explicitly out of scope per §7 ("not every implementation detail is specified... use engineering judgment").

**`dueDate` is optional.**
- Not listed as a required field in §5.2's minimum task fields; added because the reference design's Create/Edit Task forms include it, but nothing in the brief said every task must have one.

**`completedAt` is stored, not inferred from `updatedAt`.**
- The dashboard's "completed this week" originally counted `done` tasks whose `updatedAt` fell in the last 7 days. But *any* edit bumps `updatedAt`, so fixing a typo on a task finished months ago made it count as completed again.
- `completedAt` is set when a task moves to `done` (or is created as `done`) and cleared when it moves out, so a reopened-then-finished task is dated from its latest completion. Re-saving the same status (which the edit form always does) leaves it alone.
- Tasks already `done` before the field existed are backfilled once with `npm run backfill:completed-at`: the latest "moved to done" activity entry when there is one, otherwise `updatedAt` — the value the old query used, so no task ends up worse off than before.

## API design

**Consistent response envelope (`{success, data, meta?}` / `{success:false, error}`) across every endpoint.**
- Makes the frontend's API client and error handling uniform instead of special-casing each resource's response shape.

**Server-side validation via `zod` schemas on every mutating route; client-side validation mirrors but never replaces it.**
- The brief explicitly requires server-side validation ("important user input should be validated on the server") — treated client-side checks as UX sugar only.

**Pagination is offset-based (`page`/`limit`), not cursor-based.**
- Alternative considered: cursor pagination (better for large, frequently-mutated lists).
- Why not: this app's expected data volume (a small team's tasks) doesn't justify cursor pagination's added complexity; offset pagination also makes "page 1 of 5, jump to page 3" trivial, which cursor pagination doesn't support well — and the reference design shows page numbers, not infinite scroll.

## Frontend

**ShadCN/UI components hand-built on Radix primitives + Tailwind, rather than running the `shadcn` CLI.**
- The CLI needs to reach npm's component registry at generation time; hand-authoring the same primitives (Button, Dialog, Select, DropdownMenu, Table, Toast, etc.) directly against `@radix-ui/react-*` and Tailwind produces the same result — Radix for accessible interaction primitives (focus trap, keyboard nav, portals), Tailwind classes styled to the reference design's exact tokens (colors, radius, spacing) documented in DESIGN.md §4.

**Edit Task is a mode toggle on the Task Detail route (`/tasks/:id?edit=1`), not a separate route/page.**
- The reference design shows "Edit task" as a visually distinct screen. Implementing it as a toggled state on the same component (same data already loaded, same route) is functionally identical for the user and avoids duplicating the fetch-task-by-id logic and layout across two page components.

**Create Task is a centered Dialog on both desktop and mobile, not a full-screen Sheet on mobile.**
- The reference only shows a desktop create flow implicitly (via the "Create Task" button) and an explicit **mobile** full-screen-sheet frame. A real Sheet primitive was later built for mobile navigation (see "Round 2" below) — Create Task was left as a Dialog rather than retrofitted, since a centered dialog is still fully usable at 390px and the marginal fidelity gain wasn't worth touching a working, tested flow without a concrete reason.

**Dashboard stats moved from 4 lightweight `GET /tasks?limit=1` calls to a dedicated `GET /tasks/stats/summary` endpoint.**
- The original build reused the list endpoint's pagination metadata to avoid a new endpoint for four numbers. Once the dashboard needed derived metrics that aren't a simple count (a week-over-week trend, "due this week", "assigned to you") — see "Round 2" — a single aggregation endpoint became the simpler option rather than bolting date-range query params onto the general-purpose list endpoint.

## Round 2 — features added beyond §5 requirements

After the core assessment (§5, fully covered above and tested) was complete, the following were added at the user's request to more closely match the reference design's full feature set. These go beyond what §5 asks for; each is still documented per the same assumption → implement → document rule.

**Activity log.** A new `ActivityLog` collection (task, actor, action, meta, createdAt) is written to on task creation and on any *genuine* change to status/priority/assignee/due-date during an edit (a no-op edit — e.g. resaving the same status — writes nothing). Rendered read-only in the task detail right rail, matching the reference's "Sarah moved this to In Progress" feed. Comment activity isn't logged separately since comments already have their own visible thread.

**Invite Member and Forgot Password share one token mechanism.** Both end in "let this person set a password via a link"; rather than building two separate token systems, a single `credentialTokenHash`/`credentialTokenExpires`/`credentialTokenPurpose` (`invite`|`reset`) set of fields on `User`, and one `POST /auth/set-password` endpoint, serve both. An invited user is created with `status:'invited'` and an unusable random password until they complete the flow (matching the reference's Active/Invited badge); a forgotten-password token instead targets an existing active account. Only a token's **hash** is ever persisted — the raw token exists only in memory for the one response that returns it.

**No real email service — reset/invite links are shown directly instead of emailed.** There's no SMTP/email provider wired up (out of scope for a takehome). So: outside `NODE_ENV=production`, `forgot-password` returns the reset link directly in the response body for the demo to be usable end-to-end; `invite` always returns the invite link in its response (there's no non-demo path for it regardless of environment, since there's no admin-only "check your email" alternative to fall back to). In a real deployment both would be emailed and neither returned via the API.

**Forgot-password always returns an identical response, regardless of whether the email exists.** A naive first pass generated the reset token only when a matching user existed but always sent back the same *response body* — which still leaks account existence through a timing side-channel (the "user exists" branch does an extra database write before responding). Caught in review and fixed: both branches now perform exactly one `findOneAndUpdate` attempt, so the code path — and its timing — no longer depends on whether the email matches.

**Password-token consumption is atomic.** An early version looked up the user by token, then separately saved the cleared token fields — a narrow window where two requests racing the same still-valid token could both pass the lookup before either write landed, double-spending a token meant to be single-use. Fixed to a single atomic `findOneAndUpdate` that looks up and consumes the token in one database operation.

**Comment @mentions are cosmetic only — no notifications.** Typing `@` autocompletes a teammate's name and highlights it once posted, matching the reference visually. It does not notify the mentioned person or persist mentions as structured data; that would need the notification infrastructure explicitly deferred below.

**Mobile navigation now uses a real slide-out Sheet; mobile task lists now render as cards.** Both were originally simplified (a centered dialog, a horizontally-scrolling table) to prioritize getting every §5 requirement working first. Built properly in this round: a Sheet primitive (Radix Dialog content repositioned to a left-edge slide-in panel) for navigation, and a card-per-task layout (title, badges, assignee, updated-at) shown below the `md` breakpoint alongside the existing table.

**Still not built — deliberately.**
- **Notification delivery** (the bell icon, mention notifications). Would need its own data model (persisted, per-user, read/unread) on top of the real-time transport that now exists — the transport isn't the missing piece anymore, the notification *feature* itself (what counts as notifiable, read state, a UI for it) is a separate scope decision not asked for in the brief.

## Round 3 — real-time updates (Socket.io)

Added after Round 2, on request: a Socket.io layer on top of the existing REST API (additive, not a replacement — every mutation still goes through the same validated REST endpoints; sockets only carry a "something changed, go refetch" signal).

**Broadcast, not per-user targeting.** Every connected authenticated client receives every event (`task:created`, `task:updated`, `task:deleted`, `comment:created`, `comment:deleted`). No Socket.io rooms or per-user filtering. Consistent with the existing authorization model (any authenticated user can already see any task via the REST API), so scoping broadcasts wouldn't hide anything a client couldn't already fetch — it would only add complexity.

**Payloads are IDs only, not the changed data.** An event carries just `{ taskId }` or `{ taskId, commentId }`; the client reacts by refetching via the normal REST call, not by trusting broadcast data as a source of truth. This means the socket layer can never itself serve stale or unauthorized data — the existing auth/validation on every REST endpoint still applies to the refetch that follows.

**Socket auth reuses the existing JWT**, sent via the connection handshake (`socket.handshake.auth.token`) and verified with the same `verifyAccessToken` the REST middleware uses — no separate socket-specific auth system.

**Graceful degradation is structural, not a special case.** Every part of the app that now updates live also still works exactly as before if the socket never connects or drops (manual navigation/refetch), because the socket layer only ever *triggers* the same fetch functions that already ran on mount — it doesn't introduce a second code path.
- **Settings beyond name.** Email and role are intentionally not user-editable from Settings (email is the login identity; role is an admin-controlled permission, not a self-service preference).

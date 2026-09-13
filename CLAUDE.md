# Lords of Cian Interactive Archive — Repo Ground Truth

By Abad Morel. This file is the Phase 0 "establish ground truth" deliverable named in
`lords-of-cian-archive-game-plan.md` (mirrored in `The-Reaver/Lords-of-Cian-Knowledge-Core`
at `docs/lords-of-cian/lords-of-cian-archive-game-plan.md`, and in the Claude Project) — it
records what the real, committed code actually does, so later sessions verify against this
file instead of re-deriving it from the three original source documents (Visual Direction
Document v1.0, System Explanation, Strategy Document).

**This repo is not blocked on, and does not block, canon work in the Knowledge Core repo.**
Standing instruction from Abad, 2026-09-03: canon-writing continues in the Knowledge Core
repo; new canon material is drafted so it sets up this archive for strong SEO/GEO and a
gamified five-tier reader-unlock model, but building this app is a separate, parallel track.

## Status as of 2026-09-13

Twelve commits on `claude/lovable-build-review-nmep29` (the repo's only branch; no `main`
exists yet). Well past "Phase 0: establish ground truth" as the Game Plan originally scoped
it on 20 August 2026 — a meaningful slice of Phase 1 (RLS, identity-fraud groundwork) and
Phase 2 (the reader loop's actual routes) now exists too. This file records what's been
verified as of this pass, not a fresh audit from zero each time.

**2026-09-13, same-day follow-up #3 — the reader loop's missing core.** Everything before this
pass was either admin tooling or a read-only reader surface with nowhere for a reader to
actually *become* a reader. `/admin/chronicles`' editor and `/archive/[id]` both already linked
to `/characters/[slug]`, and its own list linked to per-entry chronicle URLs, none of which
existed — this closes both, plus signup itself:
- `supabase/migrations/0007_signup_follow_character.sql`: extends `handle_new_user()` (via
  `CREATE OR REPLACE`, preserving 0003/0004's EXECUTE revocation, restated explicitly anyway)
  to read `followed_character_id` out of signup metadata and populate the column that already
  existed on `reader_profiles` with no writer. Defensive by construction: a malformed UUID
  string, a well-formed UUID with no matching `characters` row, and a missing key all fail
  safe to `null` inside a `begin/exception` block rather than erroring the signup trigger and
  blocking account creation. **Verified for real** against local Postgres: all four cases
  (valid, malformed, nonexistent, absent) produce the right `followed_character_id` outcome,
  the pre-existing referral-crediting logic still fires correctly in the same trigger run, and
  `\df+` confirms EXECUTE is held only by the function owner — no `PUBLIC`/`anon`/
  `authenticated` grant survived the replace.
- `/characters/[slug]`: the character dossier page — `dossier_cover` markdown, hook line,
  demand score, aliases, and a `chronicle_entries` list (already RLS-filtered to what this
  visitor's clearance allows). Distinguishes two different "nothing to show" states using
  `classification_status`'s own documented meaning: `pending` (nothing written yet) offers the
  request flow below; `active` with zero visible rows means Chronicles exist above this
  reader's clearance, where a request would be meaningless, so none is offered.
- `/characters/[slug]/chronicles/[entryNumber]`: the chronicle reader — every admin editor
  link and every character-page link now resolves. `entry_number` is scoped per-character
  (`unique(character_id, entry_number)`, not a global sequence), so the route resolves the
  character row first. Renders `body_markdown` plus `onyx_commentary` as a distinct
  narrator-voice block when present.
- `components/RequestChronicleButton.tsx`: writes directly to `chronicle_requests` from the
  browser (RLS `insert_own` policy + the existing `unique(character_id, reader_id)` constraint
  do the real work, same direct-write pattern `ChronicleEditor.tsx` already uses) — no
  canon-service proxy needed, this table isn't `knowledge_core`. Deliberately scoped to just
  the write: the public "N readers requested this" ledger and the release-notification loop
  (game plan Ideas 1–2) are separate features gated on their own product decisions (a
  pending-character stat-bar variant, an Activity Feed) and aren't part of this pass.
- `/signup` (+ `components/SignupForm.tsx`) and `/welcome`: the actual reader-facing signup
  flow — there was none before this, only the admin magic-link gate. Same
  `auth.signInWithOtp` mechanism as admin login, but with `shouldCreateUser: true` (admin
  login deliberately omits this — only pre-existing admins should land there) and
  `followed_character_id`/`referred_by_code` riding in signup metadata for 0007's trigger to
  consume. `?follow=<characterId>` and `?ref=<code>` query params let
  `RequestChronicleButton` (and a future referral-share flow) pre-fill the form; both stay
  editable. `/welcome` is the `next` target after the magic-link round-trip — reads the new
  profile back, shows the followed character (if any) and the reader's own referral code.
- Deliberately out of scope for this pass: reads/progress-tracking instrumentation, shares,
  quiz UI, the request-ledger/notification features named above, and anything touching demand
  score computation — the last is one of the four decisions explicitly queued for the real
  Brain Trust below, not something to guess at here.
- Verified: `npm run typecheck` and `npm run build` both clean (new routes `/characters/[slug]`,
  `/characters/[slug]/chronicles/[entryNumber]`, `/signup`, `/welcome` all present in the build
  output); `services/canon-service`'s DB-free test subset still 22 passed/19 skipped
  (unaffected — no canon-service changes this pass).

**2026-09-13, same-day follow-up #4 — reading progress tracking, plus a real gap in this
project's own RLS-testing rigor closed along the way.** `reads` (from `0001`) had no writer.
Added `components/ReadingProgressTracker.tsx`, an invisible client component mounted on the
chronicle reader page: tracks scroll depth against the whole document (this route renders
nothing else of any height, so no ref needs to cross the server/client boundary), debounces
writes 1500ms after scroll settles, and flushes immediately on tab-hide. Writes are monotonic
against *both* this session's own progress and whatever was already saved from a prior visit
(fetched once on mount) — a quick re-open that scrolls less than an earlier full read can
never regress `completion_pct` or un-flip `completed`. `completed` sets at ≥95% scrolled.
Signed-out visitors are never tracked (no `reader_id` to write against). Scoped deliberately
narrow: this is the progress-tracking half of the earlier-deferred "reads/shares
instrumentation" item — `shares` has no UI action to hook into yet and stays out of scope
here, a separate later item.

Verifying this surfaced a real, previously-unexamined gap: `supabase/testing/local_auth_stub.sql`
stubs `auth.uid()`/`auth.role()` and creates the `anon`/`authenticated`/`service_role` roles,
but never granted them anything on the `public` schema — a real Supabase project does this
automatically at provisioning (RLS is meant to be the *sole* enforcement layer; table grants
are deliberately coarse yes/no). Without it, every prior local RLS verification in this
project ran as the `postgres` superuser, which bypasses row security entirely — so RLS
policies were confirmed to exist and compile, but never actually exercised as a genuinely
restricted role. Fixed by adding the missing `grant`/`alter default privileges` to the stub
(matching Supabase's real default posture) and then, for the first time, running a real
`SET ROLE authenticated` + `request.jwt.uid` verification pass against local Postgres: a
reader's own upsert to `reads` (insert, then the update-on-conflict path) succeeds; the exact
same insert attempted with a different reader's `reader_id` (impersonation) is rejected with
Postgres error `42501`; a reader's `SELECT` returns only their own row, never another
reader's; and `anon` is blocked on both read and write (0 rows visible, insert rejected) —
matching the tracker's own design of writing nothing for signed-out visitors. This closes a
rigor gap for every future RLS-dependent feature, not just this one — the stub file is now
capable of testing what it always claimed to.

Verified: `npm run typecheck` and `npm run build` both clean; all 8 migrations (the auth stub
plus 7 real migrations) apply cleanly against a real Postgres 16 instance with the new grants
in place; the RLS-as-`authenticated`-role pass described above, done by hand this session
against a scratch database. Not yet promoted into an automated CI check (the `migrations` CI
job only confirms migrations apply, it doesn't exercise RLS as a restricted role) — a
reasonable follow-up now that the stub actually supports it, not done here to keep this pass
scoped to the feature that motivated finding the gap.

**2026-09-13, same-day follow-up #5 — Standing Requests Ledger + Request Fulfillment Loop
(game plan Ideas 1–2).** `0008_request_ledger_and_fulfillment.sql`:
- **The Ledger (Idea 1):** two views, `chronicle_request_ledger` (per-character request/reason
  counts) and `chronicle_request_reasons` (the voluntarily-typed reasons themselves, newest
  first) — both reader-identity-free (no `reader_id`, no email), same "public aggregate" shape
  P1-1 already established for `demand_scores`. Mechanism is new to this codebase though: a
  plain Postgres view checks the *owner's* privileges/RLS against its underlying tables by
  default (`security_invoker` defaults to `false`), not the querying role's — so a view owned
  by the migration role bypasses `chronicle_requests`' own-row RLS the same way a `SECURITY
  DEFINER` function would, without needing one. Verified for real rather than assumed: as
  `authenticated` reader B (who owns 1 of 2 seeded requests), `chronicle_requests` itself
  correctly returns only 1 row, while `chronicle_request_ledger` correctly returns the true
  aggregate of 2 — confirming the bypass works and nothing reader-identifying leaks (the views
  never select `reader_id` in the first place, so even a wrong assumption here would have been
  an undercount bug, not a privacy one). Wired into `/characters/[slug]`'s existing "pending"
  branch, alongside `RequestChronicleButton`.
- **The Fulfillment Loop (Idea 2), in-app half:** a new `notifications` table (RLS: select/
  update own only, no reader-driven insert policy at all — every row comes from the trigger
  below) plus `notify_chronicle_request_fulfillment()`, firing `after insert or update of
  is_live on chronicle_entries`. Fires exactly once per character, the moment its *first* live
  entry appears (per the game plan's own correction: `is_live` flipping true, not the
  `published_books` toggle) — a `NOT EXISTS` check against any other already-live row for that
  character gates it, and an `OLD.is_live IS TRUE` early-return on the `UPDATE` path stops an
  unrelated re-save of an already-live entry from re-firing. Also flips
  `characters.classification_status` from `pending` to `active` in the same pass — nothing else
  in this schema made that transition, and leaving it stuck on `pending` forever after real
  content ships was a real latent bug the character page's own `pending`/`active` branching
  would have hit. New `/notifications` page (redirect-if-signed-out, same convenience posture
  as `/welcome`) renders each reader's own rows; linked from `/welcome`. **Real email delivery
  (Idea 2's other half) is deliberately not attempted** — it needs an email-provider account/API
  key decision outside this session's authority, same posture 0006 took on signup rate
  limiting/disposable-domain blocking; flagged here rather than guessed at.
- **Verified for real against local Postgres**, not just read for plausibility: seeded two
  readers requesting one pending character (one with a reason, one without); confirmed the
  ledger/reasons views before any entry goes live; flipped a first `chronicle_entries` row
  live and confirmed both requesters get exactly one `notifications` row each, with the correct
  message, and `classification_status` flips to `active`; flipped a *second* entry live for the
  same character and confirmed zero new notifications; edited the title of the already-live
  first entry (an `UPDATE ... SET title` that leaves `is_live` unchanged) and confirmed zero
  new notifications; confirmed `notifications` RLS as `authenticated` reader A — `SELECT`
  returns only their own row, and a self-insert attempt is rejected (`42501`, no insert policy
  exists for the role at all).
- Verified: `npm run typecheck` and `npm run build` both clean, `/notifications` present in the
  build output; all 9 migrations (auth stub + 8 real) apply cleanly against real Postgres 16;
  every functional check above done by hand this session against a scratch database.

**2026-09-13 follow-up:** `app/extraction.py` and `app/ratification.py` are no longer
skeleton-only. `app/db.py` (a sync `psycopg_pool` connection pool), `app/repositories.py`
(real `PostgresKnowledgeCoreRepository` / `PostgresExtractionRepository` implementations of
those modules' Protocols), `app/admin.py` (`require_admin`, checking
`reader_profiles.is_admin` on canon-service's own DB connection), and
`app/routes_knowledge_core.py` (`POST /knowledge-core/entries/{id}/transition`,
`POST /knowledge-core/extractions`, both admin-gated, each one Postgres transaction) now give
both modules real, callable HTTP endpoints. Verified against a real local Postgres 16
instance, not just unit tests against fakes: 8 new repository-level integration tests plus 4
route-level tests via FastAPI's `TestClient` (34 tests total in the suite now, up from 22;
both new files skip themselves without `TEST_DATABASE_URL`, confirmed the base suite still
runs DB-free — 22 passed/12 skipped without it, 34 passed with it). CI's `canon-service` job
now applies the same auth-stub-plus-migrations sequence as the `migrations` job against its
own Postgres service container and runs these automatically. Added
`services/canon-service/.env.example` documenting `DATABASE_URL` (service_role, direct
Postgres — distinct from `SUPABASE_URL`'s JWKS-only use) and `TEST_DATABASE_URL`.

**2026-09-13, same-day follow-up #2 — admin UI over the Knowledge Core.** The routes above
had no human-usable front end. Added `GET /knowledge-core/entries` (optional `?status=`) and
`GET /knowledge-core/entries/{id}` to canon-service (admin-gated, backed by two new read-only
`PostgresKnowledgeCoreRepository` methods), plus `/admin/knowledge-core` (+ `/[id]`) in
apps/web. Architecturally load-bearing point: `CANON_SERVICE_URL` is a Railway
**private-network** address — the browser can never reach it directly. So `lib/canonService.ts`
(server-only: Server Components / Route Handlers / Server Actions) is the *only* place
apps/web is allowed to call canon-service from, forwarding the signed-in admin's own Supabase
access token; canon-service re-verifies it and `is_admin` itself, this helper carries no
privilege of its own. Mutations (`TransitionForm`/`ExtractionForm`, both Client Components)
therefore go through same-origin Server Actions (`actions.ts`), never straight from the
browser to canon-service. `ExtractionForm` is a general JSON-textarea tool covering all three
target types rather than three bespoke forms — honest about the underlying API; a guided
per-type UI is a reasonable future upgrade once real usage exists. 48 tests total now (was 41
after the previous follow-up), all passing against a real local Postgres instance before this
landed.

**This session's work (non-blocking scaffolding, run in parallel while the real Brain Trust
review's device-bridge session was being set up separately):**
- Patched a critical Next.js RCE (`next` 16.3.2 → 16.3.5); `npm audit` clean.
- `/archive` + `/archive/[id]`: the P1-2 reader surface for `archive_documents` — the ten
  Knowledge Core document types that had nowhere to render before this. Same RLS-gated
  server-component pattern as `/characters`.
- Admin auth gate: passwordless (magic-link) sign-in at `/admin/login`, a `proxy.ts` session
  refresh (Next.js 16's convention — see below), and an `/admin/(dashboard)` route group
  gated on `reader_profiles.is_admin`. UX convenience only; RLS is the real boundary.
- `/admin/chronicles` (+ `/new`, `/[id]`): the P1-4 side-by-side markdown editor for
  `chronicle_entries` — the game plan's own named production bottleneck (10 entries existed
  against 18 characters, nine with none, and 22 battles for Kanja alone).
- `app/extraction.py` (canon-service): the P1-3 writer-reference → reader-facing commit
  logic — pure, DB-agnostic, unit-tested like `ratification.py`. One default taken directly
  from the game plan's Phase 5 text rather than invented here: every extraction lands
  `storage_mode='vault'`, never `live` directly, regardless of `book_placement` — going live
  is always a later, separate, human action. (2026-09-13: now has a real, admin-gated HTTP
  route too — see the follow-up note above.)
- `supabase/migrations/0006_p0_4_fraud_control_mechanics.sql`: closed the two genuinely
  mechanical P0-4 gaps — a trigger that credits a `referrals` row the instant (and only the
  instant) `email_confirmed_at` flips from null, and a per-reader rate limit
  (20/hour) on `chronicle_requests` inserts, closing the gap the existing
  `unique(character_id, reader_id)` constraint didn't cover (bursting requests across many
  *different* characters). **Verified for real**: spun up a local Postgres 16 cluster,
  applied all six migrations against a scratch database (using a minimal `auth` schema stub
  plus the standard `anon`/`authenticated`/`service_role` roles — now checked into
  `supabase/testing/local_auth_stub.sql` for reuse), and exercised both triggers end to end
  before tearing the scratch database down. Confirmed genuinely NOT attempted, not silently
  skipped: signup-endpoint rate limiting and disposable-domain blocking are GoTrue
  dashboard/config on the still-paused Supabase project, not expressible in a migration;
  `referrals.signup_ip_hash_match` / `reader_profiles.signup_ip_hash` stay unpopulated
  because Supabase Auth's signup call goes straight from the browser to GoTrue, bypassing
  this app's own server — populating either needs a custom signup Route Handler, a real
  architecture change to "frictionless signup," not a mechanical fix.
- `.github/workflows/ci.yml`: no CI existed before this. Three jobs — `apps/web` (typecheck +
  build), `canon-service` (pytest), and `migrations` (applies every migration against a
  `postgres:16` service container using the checked-in auth/role stub) — each automating a
  check this session ran by hand.
- Next.js flagged the `middleware.ts` convention as deprecated in favor of `proxy.ts` mid-session
  (16.3.5's own build output); ran the official codemod rather than leave a freshly-written
  file already on a deprecated path.

**Verified working (cumulative):**
- `services/canon-service`: `pytest` — 48/48 pass. 22 DB-free (`ratification.py`'s state
  machine, 11 tests; `extraction.py`'s commit logic, 11 tests) plus 26 Postgres integration
  tests (repository-level and route-level, covering transitions, extractions, and the
  list/detail read endpoints) that skip themselves without `TEST_DATABASE_URL` set.
  `services/canon-service/.env.example` documents both `DATABASE_URL` (service_role, direct
  Postgres) and `TEST_DATABASE_URL`.
- `apps/web`: `npm run typecheck` clean, `npm run build` succeeds. Static routes: `/`,
  `/admin/login`, `/signup`. Dynamic (RLS-gated, server-rendered, or canon-service-backed):
  `/characters`, `/characters/[slug]`, `/characters/[slug]/chronicles/[entryNumber]`,
  `/archive`, `/archive/[id]`, `/admin`, `/admin/chronicles` (+ `/new`, `/[id]`),
  `/admin/knowledge-core` (+ `/[id]`), `/auth/callback`, `/welcome`, `/notifications`.
- `npm audit`: zero vulnerabilities.
- Git history and tracked files checked for leaked secrets: clean (see prior pass's note on
  the publishable anon key being safe by design).
- All 8 SQL migrations apply cleanly in order against a real Postgres 16 instance (not just
  parsed) — see `supabase/testing/local_auth_stub.sql` and `.github/workflows/ci.yml`.

## Repo layout

```
apps/web/                  Next.js 16 (App Router, Turbopack) + React 19 + Tailwind.
  app/page.tsx                Landing (static, the Level 0 door).
  app/characters/              Character Index (dynamic, RLS-gated).
  app/characters/[slug]/        Character dossier + chronicle_entries list.
  app/characters/[slug]/chronicles/[entryNumber]/  The chronicle reader.
  app/archive/                 P1-2: archive_documents reader (index + [id]).
  app/signup/, app/welcome/     Reader-facing signup (magic-link, shouldCreateUser:true)
                                 and its post-callback landing page.
  app/notifications/            Reader's own notifications rows (Idea 2's in-app half).
  app/admin/login/              Magic-link admin sign-in (outside the auth gate).
  app/admin/(dashboard)/         Gated on reader_profiles.is_admin (route group, no URL
                                 segment of its own): dashboard home + /chronicles editor.
  app/auth/callback/            Exchanges the magic-link code for a session cookie.
  proxy.ts                      Session-refresh (Next.js 16's "proxy" convention, formerly
                                 "middleware.ts" -- renamed via the official codemod).
  components/Markdown.tsx       Renders body_markdown onto the Visual Direction design
                                 tokens (no Tailwind typography plugin dependency).
  components/ChronicleEditor.tsx  Shared create/edit form + live preview, used by both
                                 /admin/chronicles/new and /admin/chronicles/[id].
  components/RequestChronicleButton.tsx  Direct browser write to chronicle_requests
                                 (RLS + unique(character_id, reader_id) do the fraud-control
                                 work); renders a sign-up prompt instead when signed out.
  components/SignupForm.tsx     Reader signup (magic-link, shouldCreateUser:true), reads
                                 ?follow=/?ref= query params to pre-fill metadata for
                                 0007's trigger.
  components/ReadingProgressTracker.tsx  Invisible; upserts reads.completion_pct/completed
                                 as a signed-in reader scrolls the chronicle reader.
                                 Monotonic + debounced, writes nothing for signed-out visitors.
  app/admin/(dashboard)/knowledge-core/  List-by-status + detail views over canon-service's
                                 /knowledge-core/entries* routes (never queries
                                 knowledge_core directly -- it's invisible to anon/
                                 authenticated by design). actions.ts holds the Server
                                 Actions TransitionForm/ExtractionForm submit to.
  lib/canonService.ts           The only place apps/web is allowed to call canon-service
                                 from -- CANON_SERVICE_URL is a Railway private-network
                                 address the browser can never reach directly, so this is
                                 server-only (Server Components/Route Handlers/Server
                                 Actions), forwarding the caller's own Supabase access token.
services/canon-service/    FastAPI (Python). Owns everything LLM-orchestration-heavy or
                            canon-graph-shaped: AI-Parse, bulk ingestion, the Knowledge
                            Core ratification engine, extraction commits, demand-score
                            computation. Never exposed publicly — reachable only over
                            Railway's private network. Auth: Supabase JWT verified against
                            the project's JWKS endpoint (asymmetric keys, no shared secret
                            held by this service).
  app/ratification.py         draft -> under_review -> ratified -> locked state machine.
  app/extraction.py            Writer-reference -> reader-facing commit logic (P1-3).
  app/db.py                    Sync psycopg_pool connection pool (lenient if DATABASE_URL unset).
  app/repositories.py          Real Postgres-backed implementations of both modules' Protocols.
  app/admin.py                 require_admin: layers reader_profiles.is_admin onto require_user.
  app/routes_knowledge_core.py  GET /knowledge-core/entries (+ ?status=), GET .../{id},
                                 POST .../{id}/transition, POST /knowledge-core/extractions --
                                 all admin-gated; the two POSTs each one Postgres transaction.
supabase/migrations/       8 migrations, applied in order:
  0001_operational_schema.sql       Reader-facing tables (characters, chronicle_entries,
                                     world_briefings, archive_documents, quiz_questions,
                                     admin_settings, reader_profiles, chronicle_requests,
                                     reads, shares, referrals, quiz_attempts, demand_scores),
                                     full RLS, signup trigger, current_clearance()/is_admin()
                                     helpers.
  0002_knowledge_core_schema.sql    knowledge_core schema (kc_documents, kc_entries,
                                     kc_references, kc_extractions, kc_fan_contributions).
                                     RLS enabled with zero policies PLUS an explicit REVOKE
                                     of all privileges from anon/authenticated — invisible,
                                     not just RLS-denied. Only service_role can touch it.
  0003/0004                         Closed an RPC surface the security advisor flagged:
                                     handle_new_user()/sync_email_confirmation() were
                                     directly callable via PostgREST by anon/authenticated
                                     despite being trigger-only functions. 0003 revoked from
                                     PUBLIC; 0004 caught that Supabase also grants EXECUTE
                                     directly to anon/authenticated independent of the PUBLIC
                                     pseudo-role, and revoked from the actual roles.
  0005_seed_verification_data.sql   Two placeholder characters + zeroed demand_scores rows,
                                     explicitly scaffold-only, meant to be deleted once real
                                     content enters through the Knowledge Core pipeline.
  0006_p0_4_fraud_control_mechanics.sql  Referral-crediting-on-confirmed-email trigger,
                                     chronicle_requests rate limiting (20/hour/reader).
  0007_signup_follow_character.sql  Extends handle_new_user() to populate
                                     reader_profiles.followed_character_id from signup
                                     metadata (fails safe to null on anything malformed).
  0008_request_ledger_and_fulfillment.sql  chronicle_request_ledger/_reasons views
                                     (public aggregate, view-owner-bypasses-RLS pattern);
                                     notifications table + fulfillment trigger, firing
                                     once per character on its first live chronicle entry.
supabase/testing/
  local_auth_stub.sql        Local/CI-only stand-in for Supabase's auth schema and
                             anon/authenticated/service_role roles, PLUS the public-schema
                             grants a real Supabase project auto-provisions (added
                             2026-09-13 -- without these, anon/authenticated hold no table
                             privileges locally, so RLS can only be tested as postgres,
                             which bypasses row security entirely). NEVER run against the
                             real Supabase project (it already has the genuine versions).
.github/workflows/ci.yml   Three jobs: apps/web (typecheck+build), canon-service (pytest),
                            migrations (apply against a postgres:16 service container).
```

## P0-2 source-document contradictions: resolved-in-code status

The Game Plan's Phase 0 named eight contradictions across the three original source
documents plus one orphan table. Reading the actual schema/code against each:

| # | Contradiction | Resolved in code as | Still open? |
|---|---|---|---|
| 1 | RLS shipped or not | Shipped — all 13 `public` tables + all 5 `knowledge_core` tables have RLS enabled with policies (or, for `knowledge_core`, RLS + a hard REVOKE). All six migrations verified to apply cleanly against a real Postgres 16 instance. | No, but a live security-advisor pass via `mcp__Supabase__get_advisors` still wants an unpaused project — see below. |
| 2 | Typography: Cormorant/Source Sans Pro vs. Playfair/Inter/JetBrains Mono | Playfair Display / Inter / JetBrains Mono, exactly as Visual Direction v1.0 mandated, wired via `next/font/google` in `app/layout.tsx` and exposed as Tailwind `font-display`/`font-body`/`font-mono`. | No. |
| 3 | Text color `#e8e6e0` vs `#E8E6E3` | `#E8E6E3` (Visual Direction value), in `tailwind.config.ts`. | No. |
| 4 | Level 2 rule: "2 of 3" vs. "3 reads OR share OR 2 requests" | **Still not implemented either way.** No application code computes a Level 1→2 transition yet. `reader_profiles.clearance_level` exists as a column but nothing writes to it beyond its default. | **Yes — still a real open decision for whoever builds the clearance-transition logic, exactly as the Game Plan flags it ("for the author's judgment, unresolvable from the documents").** |
| 5 | Landing page: character grid vs. "a door, not a brochure" | Built as the door: `app/page.tsx` is a static hero + tagline + single "Enter the Archive" CTA, no grid, no carousel. The grid lives separately at `/characters`, sorted by demand score. | No. |
| 6 | Dossier-cover visibility: Level 1 unlock vs. publicly visible | Public/Level 0 — `characters` table has an unconditional `for select using (true)` policy. | No. |
| 7 | World-briefing categories: "9 categories" naming 8, vs. "nine tabs shipped" | Nine, enumerated in `world_briefings.category`'s check constraint. | No. |
| 8 | Framework: Next.js vs. React+TanStack Router | Next.js 16 (App Router). No TanStack dependency anywhere. | No. |
| — | Orphan: `quiz_questions` (11 seeded rows in the source docs, no reader route, no admin section) | Table exists with RLS (`authenticated`-only select, matching the Game Plan's Idea 6 resolution: diagnostic, never a clearance gate) but **is not seeded** and **has no reader route yet**. | **Yes — still genuinely undecided whether/when P3-1 (quiz as diagnostic) gets built.** Not blocking anything else. |

Net: 7 of 8 named contradictions plus the RLS status question are resolved and shipped.
Two items remain genuinely open for Abad's own call: **the Level 2 unlock rule**, and
**whether/when to build the quiz_questions diagnostic (P3-1)**. Neither blocks any other
work — they only need a decision before someone writes the clearance-transition logic.

## What P0-3/P0-4 verification still needs

The Supabase project (`lords-of-cian-archive`, id `dghkxaclaeluheahdsne`) is currently
paused, per the Knowledge Core repo's own CLAUDE.md. All six migration files (including
0006) are confirmed to apply cleanly and behave correctly against a real Postgres 16
instance — but that's a local scratch database, not the actual live project. Before
treating P0-3 as fully closed: unpause the project and run `mcp__Supabase__get_advisors`
(or Supabase's dashboard equivalent) to confirm no RLS warnings on any of the 18 tables
across both schemas, and spot-check with a real Level 1 test account that it genuinely
cannot read Level 2/3 content, another user's `reader_profiles` row, or the referral graph.

P0-4 (closing the identity/fraud hole): the mechanical gaps are now closed —
`chronicle_requests` still has its `unique(character_id, reader_id)` constraint, plus (new,
0006) a 20/hour per-reader rate limit across *any* characters, and `referrals.credited` now
flips to `true` automatically and only on confirmed email (verified end-to-end against a
real Postgres instance this session, not just read from the SQL). What's still open, and
needs either a live project or a real architecture decision rather than a migration:
signup-endpoint rate limiting and disposable-domain blocking (GoTrue dashboard/config), and
populating `signup_ip_hash_match`/`signup_ip_hash` (needs a custom signup Route Handler,
since Supabase Auth's signup call bypasses this app's own server entirely today).

## Local dev

```
# Web app
cd apps/web
npm install
cp .env.example .env.local   # anon key is safe to commit/reuse; never add a service-role key here
npm run dev                   # http://localhost:3000
npm run typecheck
npm run build

# canon-service
cd services/canon-service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
pytest                        # unit tests only, no DB/network needed
uvicorn app.main:app --reload --port 8000

# Verifying migrations locally (what CI does) -- needs a local Postgres server, not Supabase:
createdb cian_dev_check
psql -d cian_dev_check -f supabase/testing/local_auth_stub.sql   # NEVER run against real Supabase
for f in supabase/migrations/*.sql; do psql -d cian_dev_check -v ON_ERROR_STOP=1 -f "$f"; done
```

To reach `/admin`, an admin account has to exist first: sign in once via `/admin/login`
(creates the `auth.users`/`reader_profiles` row through the normal magic-link flow against
a real, unpaused Supabase project), then manually set that row's `reader_profiles.is_admin`
to `true` — nothing in this app can grant that flag to itself.

`services/canon-service` needs `SUPABASE_URL` set (for JWKS verification) to serve anything
beyond `/health`; no service-role key lives in this repo or its `.env.example` anywhere —
per its own module docstring, `app/auth.py` verifies tokens against Supabase's public JWKS,
so canon-service never needs to hold a shared secret.

## Four product decisions queued for the real Brain Trust, 2026-09-13

Asked directly, Abad routed all four of the following to the real Brain Trust investigation
process (the same device-bridge session as the SEO/GEO charter review below) rather than
have them decided ad hoc from this session or accept the "recommended" option offered
alongside each. His instruction: genuinely independent investigation by Augustin and every
other Brain Trust agent, plus AJ and the four Breakers, each with no visibility into what the
others are doing, reconvening into one meta-build recommendation per decision that specifies
the workflow, the specification for the specific intended user, what the UI should do for
that user, and how the features/functions serve them. None of these four are decided yet —
do not implement any of them from a guess; wait for the Brain Trust's actual output.

1. **Reader Demand Score formula (P1-1).** `demand_scores` and its public-read RLS policy
   exist; nothing computes a real number into it. Inputs available: `chronicle_requests`,
   `reads` (`completion_pct`/`completed`), `shares`, `referrals` (credited only). The
   strategy doc's own framing: a 150-and-rising character should outrank a 200-and-flat one.
2. **The Level 2 clearance-unlock rule.** Two conflicting readings across the source docs:
   complete 2 of 3 actions (read/share/request), vs. an OR-based gate (read 3 fully, OR
   share once, OR request 2). Nothing writes to `reader_profiles.clearance_level` past its
   default yet — this blocks the reader loop from doing anything real.
3. **`quiz_questions` (P3-1):** build the in-world "correspondence" diagnostic now, defer
   past launch, or drop the table/feature entirely.
4. **Bulk Character Codex ingestion (P1-6):** how to handle the Anthropic API key
   canon-service needs for AI-Parse, and whether to build the pipeline now (dormant, no key
   set) or hold the task entirely until a key and approach exist.

## Standing blocker, unaffected by anything above

The real Brain Trust review of the proposed SEO/GEO/gamified-five-tier-unlock charter still
needs a device-bridge session (Cowork or local Claude Code with the desktop app connected) —
see the Knowledge Core repo's CLAUDE.md, "Standing blocker: real Brain Trust review needs a
device-bridge session first," for the full detail and the exact merge instructions
(`research/knowledge-home/structure-notes/core-merge-instructions.md`) to run once that
session exists. Nothing in this repo depends on that landing first; it only gates adopting
concrete schema/tagging decisions for SEO/GEO/the five-tier model as *ratified* rather than
draft.

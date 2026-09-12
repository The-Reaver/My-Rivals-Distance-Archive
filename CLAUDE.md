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

## Status as of 2026-09-12

Two real commits on `claude/lovable-build-review-nmep29` (the repo's only branch; no `main`
exists yet). This is well past "Phase 0: establish ground truth" as the Game Plan originally
scoped it on 20 August 2026 — most of Phase 0's audit and a meaningful slice of Phase 1
(RLS, identity-fraud groundwork) already landed in the first commit. What follows records
what was verified this session, not a fresh audit from zero.

**Verified working this session:**
- `services/canon-service`: `pytest` — 11/11 pass (`app/ratification.py`'s draft → under_review
  → ratified → locked state machine, tested against an in-memory fake repo, zero DB dependency).
- `apps/web`: `npm run typecheck` clean, `npm run build` succeeds (Next.js/Turbopack). Route
  output confirms `/` is static (crawlable, no JS required — the Level 0 SEO job) and
  `/characters` is dynamic (server-rendered against live Supabase data via RLS).
- `npm audit`: patched `next` 16.3.2 → 16.3.5 (was carrying a critical unauthenticated-RCE
  advisory plus a high-severity transitive `sharp` advisory pulled in by the vulnerable
  `next` range). `npm audit` now reports zero vulnerabilities. Typecheck and build re-verified
  clean after the bump.
- Git history and tracked files checked for leaked secrets (P0-1's "nearly free" hygiene
  check): clean. The only credential-shaped value anywhere is `apps/web/.env.example`'s
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` — a publishable key that is safe to commit by design (RLS,
  not secrecy, is what protects it; see `supabase/migrations/0001_operational_schema.sql`'s
  header comment). No service-role key, no Anthropic key, no `.env`/`.env.local` ever
  committed.

## Repo layout

```
apps/web/                  Next.js 16 (App Router, Turbopack) + React 19 + Tailwind.
                            Reader-facing frontend. Talks to Supabase directly with the
                            anon/publishable key; RLS is the real enforcement point.
services/canon-service/    FastAPI (Python). Owns everything LLM-orchestration-heavy or
                            canon-graph-shaped: AI-Parse, bulk ingestion, the Knowledge
                            Core ratification engine, extraction commits, demand-score
                            computation. Never exposed publicly — reachable only over
                            Railway's private network. Auth: Supabase JWT verified against
                            the project's JWKS endpoint (asymmetric keys, no shared secret
                            held by this service).
supabase/migrations/       5 migrations, applied in order:
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
```

## P0-2 source-document contradictions: resolved-in-code status

The Game Plan's Phase 0 named eight contradictions across the three original source
documents plus one orphan table. Reading the actual schema/code against each:

| # | Contradiction | Resolved in code as | Still open? |
|---|---|---|---|
| 1 | RLS shipped or not | Shipped and verified this session — all 13 `public` tables + all 5 `knowledge_core` tables have RLS enabled with policies (or, for `knowledge_core`, RLS + a hard REVOKE). | No, but full RLS re-verification via `mcp__Supabase__get_advisors` still wants a live, unpaused project — see below. |
| 2 | Typography: Cormorant/Source Sans Pro vs. Playfair/Inter/JetBrains Mono | Playfair Display / Inter / JetBrains Mono, exactly as Visual Direction v1.0 mandated, wired via `next/font/google` in `app/layout.tsx` and exposed as Tailwind `font-display`/`font-body`/`font-mono`. | No. |
| 3 | Text color `#e8e6e0` vs `#E8E6E3` | `#E8E6E3` (Visual Direction value), in `tailwind.config.ts`. | No. |
| 4 | Level 2 rule: "2 of 3" vs. "3 reads OR share OR 2 requests" | **Not yet implemented either way.** No application code computes a Level 1→2 transition yet (Phase 2 work — the reader loop isn't built). `reader_profiles.clearance_level` exists as a column but nothing writes to it beyond its default. | **Yes — still a real open decision for whoever builds Phase 2, exactly as the Game Plan flags it ("for the author's judgment, unresolvable from the documents").** |
| 5 | Landing page: character grid vs. "a door, not a brochure" | Built as the door: `app/page.tsx` is a static hero + tagline + single "Enter the Archive" CTA, no grid, no carousel. The grid lives separately at `/characters` (`app/characters/page.tsx`), sorted by demand score. | No. |
| 6 | Dossier-cover visibility: Level 1 unlock vs. publicly visible | Public/Level 0 — `characters` table has an unconditional `for select using (true)` policy, and the schema comment at `chronicle_entries` records this as the deliberate P0-2 resolution ("characters are always publicly selectable, matching the SEO discovery layer requirement"). | No. |
| 7 | World-briefing categories: "9 categories" naming 8, vs. "nine tabs shipped" | Nine, enumerated in `world_briefings.category`'s check constraint: physics, politics, factions, events, geography, arsenal, technology, locations, other. | No. |
| 8 | Framework: Next.js vs. React+TanStack Router | Next.js 16 (App Router). `apps/web/package.json` has no TanStack dependency at all. | No. |
| — | Orphan: `quiz_questions` (11 seeded rows in the source docs, no reader route, no admin section) | Table exists with RLS (`authenticated`-only select, matching the Game Plan's Idea 6 resolution: diagnostic, never a clearance gate) but **is not seeded** in this repo (0005 only seeds `characters`/`demand_scores`) and **has no reader route yet**. | **Yes — still genuinely undecided whether/when P3-1 (quiz as diagnostic) gets built.** Not blocking anything else. |

Net: 7 of 8 named contradictions plus the RLS status question are resolved and shipped.
Two items remain genuinely open for Abad's own call, exactly as the Game Plan itself says
only he can ratify them: **the Level 2 unlock rule**, and **whether/when to build the
quiz_questions diagnostic (P3-1)**. Neither blocks any other work — they only need a
decision before whoever builds Phase 2's reader-loop completion (P1-1 through P1-6) writes
the clearance-transition logic.

## What P0-3/P0-4 verification still needs

The Supabase project (`lords-of-cian-archive`, id `dghkxaclaeluheahdsne`) is currently
paused, per the Knowledge Core repo's own CLAUDE.md. This session confirmed the *migration
files* implement default-deny RLS, per-table clearance-aware policies, and the
`knowledge_core` isolation the Game Plan's Phase 1 calls for — but that is a read of the SQL,
not a live security-advisor pass against a running database. Before treating P0-3 as fully
closed: unpause the project and run `mcp__Supabase__get_advisors` (or Supabase's dashboard
equivalent) to confirm no RLS warnings on any of the 18 tables across both schemas, and spot-
check with a real Level 1 test account that it genuinely cannot read Level 2/3 content,
another user's `reader_profiles` row, or the referral graph.

P0-4 (closing the identity/fraud hole) is partially in place at the schema level already:
`chronicle_requests` has a `unique (character_id, reader_id)` constraint (stops one account
from inflating its own request count), `reader_profiles.email_confirmed_at` is synced from
`auth.users` via trigger, and `referrals` carries a `signup_ip_hash_match` flag for review.
Not yet built: gating referral-crediting and request-counting on confirmed email (the
Game Plan's actual P0-4 minimum-viable fix, item 2), rate limiting on signup/request
endpoints, and anomaly surfacing. `referrals.credited` is never set to `true` anywhere in
this codebase yet — the schema comment on the signup trigger says this is deliberate
("referral crediting itself happens later, out-of-band, once fraud heuristics clear it").

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
```

`services/canon-service` needs `SUPABASE_URL` set (for JWKS verification) to serve anything
beyond `/health`; no service-role key lives in this repo or its `.env.example` anywhere —
per its own module docstring, `app/auth.py` verifies tokens against Supabase's public JWKS,
so canon-service never needs to hold a shared secret.

## Standing blocker, unaffected by anything above

The real Brain Trust review of the proposed SEO/GEO/gamified-five-tier-unlock charter still
needs a device-bridge session (Cowork or local Claude Code with the desktop app connected) —
see the Knowledge Core repo's CLAUDE.md, "Standing blocker: real Brain Trust review needs a
device-bridge session first," for the full detail and the exact merge instructions
(`research/knowledge-home/structure-notes/core-merge-instructions.md`) to run once that
session exists. Nothing in this repo depends on that landing first; it only gates adopting
concrete schema/tagging decisions for SEO/GEO/the five-tier model as *ratified* rather than
draft.

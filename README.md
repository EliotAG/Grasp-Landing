# Grasp

This monorepo contains three independently deployed pieces:


| Path         | What it is                                                            | Deployed as          |
| ------------ | --------------------------------------------------------------------- | -------------------- |
| `/`          | Static marketing site (`index.html`)                                  | `withgrasp.com`      |
| `app/`       | Next.js 16 web app — auth, org chart, plans                           | `app.withgrasp.com`  |
| `simulator/` | Standalone fake-Teams chat platform Grasp integrates with for testing | local-only (`:4000`) |


Splitting marketing from the product lets the landing page stay zero-JS
(and stay fast) while the app is free to ship a real React stack. The
simulator is a true third app — Grasp talks to it over HTTP exactly the
way it talks to Teams (REST out, webhook in), so swapping in real Teams
later is a config change, not a code change.

---

## Marketing site (root)

It's a single hand-written `index.html` plus a few svgs. No build step,
no framework, no JS dependencies. Already deployed as the Vercel project
`grasp-landing`.

The only product-related change here is one extra `<a>` in the nav that
points at `https://app.withgrasp.com`. It's plain HTML — does not affect
Lighthouse, bundle size, or LCP.

```bash
# preview locally
npx serve .
```

---

## Web app (`app/`)

Next.js 16 (App Router, Turbopack) + Auth.js v5 + Prisma ORM on Neon
Postgres + Tailwind v4. Theme tokens match the marketing site
(Newsreader/DM Sans, the off-white canvas, forest-green accents).

### What's wired

- **Auth** — Auth.js v5 with the Prisma adapter. Two providers: Google
OAuth (when `AUTH_GOOGLE_ID/SECRET` are set) and email magic-link via
Nodemailer. **In dev without SMTP, the magic link is printed to your
terminal**, so you can sign in with zero email setup.
- **Tenancy** — One `organization` per pilot company, with `membership`
rows linking users in (owner / admin / member).
- **Org chart upload** — CSV upload (`name`, `email`, `title`, `team`,
`manager_email`) with header-alias tolerance, dedupe, and manager
resolution by email.
- **Change-plan data model** — `ChangePlan` + `StakeholderGroup` +
`StakeholderGroupMember` modeled exactly to the field set in
`Spec.MD §"Step 1: Leadership opens the planning wizard"`. Schema lives
in `app/prisma/schema.prisma`. The conversational agent will execute
against this same schema, per spec.
- **Routes**
  - `/sign-in`, `/verify` — auth surface
  - `/onboarding` — first-time workspace creation
  - `/dashboard` — counts + suggested next step
  - `/org-chart`, `/org-chart/upload` — view + CSV upload
  - `/changes`, `/changes/new`, `/changes/[id]` — plan list / draft / detail

### Local development

```bash
cd app
pnpm install
cp .env.example .env.local

# Required:
#   DATABASE_URL  — get one free at https://neon.tech
#   AUTH_SECRET   — `openssl rand -base64 32`
# Optional but recommended:
#   AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET

pnpm db:push     # creates tables in your Neon DB
pnpm dev         # http://localhost:3000
```

First sign-in flow:

1. Open [http://localhost:3000](http://localhost:3000) → bounced to `/sign-in`.
2. Enter your email → Auth.js prints the magic link to your terminal.
3. Click it → land on `/onboarding` → create a workspace → `/dashboard`.

### Production deployment

Two separate Vercel projects under the same Vercel team:

1. `**grasp-landing**` (already exists) — root directory `/`, no build
  step. Domain: `withgrasp.com`.
2. `**grasp-app**` (new) — root directory `app/`, framework Next.js.
  Domain: `app.withgrasp.com`.
   Add these env vars in the Vercel project:

  | Var                                     | Notes                           |
  | --------------------------------------- | ------------------------------- |
  | `DATABASE_URL`                          | Neon pooled connection string   |
  | `AUTH_SECRET`                           | `openssl rand -base64 32`       |
  | `AUTH_URL`                              | `https://app.withgrasp.com`     |
  | `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Optional                        |
  | `EMAIL_SERVER_*` / `EMAIL_FROM`         | For production magic-link email |

   To create the project:

### Stack rationale (short)

- **Next.js 16 + RSC + Turbopack** — small client bundle, fast nav.
- **Auth.js v5** — free, owns the user table outright via Prisma adapter.
- **Prisma 6 + Neon Postgres** — type-safe schema in one `.prisma` file,
`prisma db push` for zero-friction iteration, Neon's pgBouncer-pooled
connection string handles serverless concurrency.
- **Tailwind v4** — design tokens in `globals.css` `@theme` block; matches
the marketing site's palette so the two surfaces feel like one product.

---

## Simulator (`simulator/`)

A standalone Next.js app that pretends to be Microsoft Teams. Grasp's
agent calls it the same way it would call Bot Framework: outbound REST
to send a DM, inbound webhook when the "user" replies.

```bash
cd simulator
pnpm install
cp .env.example .env.local
# set SIMULATOR_SHARED_SECRET (any string >= 32 chars)
# set GRASP_WEBHOOK_URL=http://localhost:3001/api/sim/incoming
pnpm dev      # http://localhost:4000
```

Then in `app/.env.local` set the matching values:

```
SIMULATOR_URL="http://localhost:4000"
NEXT_PUBLIC_SIMULATOR_URL="http://localhost:4000"
SIMULATOR_SHARED_SECRET="<same string>"
```

Now activating any change plan in Grasp will mirror its kickoff DMs to
the simulator UI. Reply there → the simulator POSTs your reply to
Grasp's `/api/sim/incoming` → the agent (currently echo) responds back
through the same channel. See `simulator/README.md` for the API.

---

### What's deliberately not built (next steps)

The skeleton ends where the spec's "Step 1" wizard begins. Logical next
slices:

1. **Stakeholder group editor** on `/changes/[id]` — pull employees from
  the org chart, group them, write per-group `behaviorSpec`.
2. **AI-assisted planning wizard** — LLM-backed conversational form that
  writes into the `change_plan` + `stakeholder_group` tables.
3. **Announcement scoring** — Deci & Ryan three-factor, Bridges 4P's,
  loss-aversion check; surfaced inline in the wizard.
4. **Training-doc upload** — Vercel Blob + per-change vector index.
5. **Agent integration** — Teams / Zoom bots execute against the
  change-plan object via the same DB.


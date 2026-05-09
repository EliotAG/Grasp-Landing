# Grasp Simulator

A standalone Next.js app that pretends to be Microsoft Teams. Use it to drive
the Grasp agent end-to-end without going through Azure Bot Service / Teams
admin install.

## How it fits in

```
┌─────────────┐    POST /api/messages    ┌─────────────────┐
│             │ ───────────────────────► │                 │
│   Grasp     │                          │  Grasp Simulator│
│   (app/)    │ ◄─────────────────────── │  (this app)     │
│             │   POST /api/sim/incoming │                 │
└─────────────┘                          └─────────────────┘
                                                  ▲
                                                  │  HTTP (browser)
                                                  │
                                          ┌───────┴────────┐
                                          │  You, pretending│
                                          │  to be employees│
                                          └────────────────┘
```

Same integration shape Grasp uses for Teams: outbound REST + inbound webhook,
authenticated by a shared secret.

## Run

```bash
cd simulator
cp .env.example .env.local
# fill in SIMULATOR_SHARED_SECRET (any string) and GRASP_WEBHOOK_URL
pnpm install
pnpm dev          # http://localhost:4000
```

In `app/.env.local` set the matching values:

```
SIMULATOR_URL="http://localhost:4000"
SIMULATOR_SHARED_SECRET="<same string>"
```

## API

### `POST /api/messages` (Grasp → Simulator)

```json
{
  "user": { "email": "alice@acme.com", "name": "Alice Chen" },
  "text": "Welcome to the rollout…",
  "kind": "kickoff"
}
```

Auto-creates the user if unknown. Returns `{ "id": "...", "createdAt": "..." }`.

### `GET /api/threads` (Simulator UI)

Returns all known users and a one-line preview of the latest message.

### `POST /api/threads/[email]/reply` (UI → Simulator → Grasp)

Stores the user's reply, then POSTs it to `GRASP_WEBHOOK_URL` for the agent
to handle. Returns the saved message and the agent's reply (if any) so the
UI can render both turns at once.

All endpoints require `Authorization: Bearer ${SIMULATOR_SHARED_SECRET}`,
**except** the UI endpoints (`GET /api/threads`, `POST /api/threads/.../reply`)
which are called by the browser and rely on the simulator being reachable
only on localhost. In a hosted setup, put it behind your VPN or basic-auth.

## Storage

Single JSON file at `data/store.json`. Concurrent writes are serialized with
an async lock — fine for a single tester, not designed for production load.
Wipe with `rm data/store.json`.

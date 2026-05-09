/**
 * Simulator persistence.
 *
 * Hosted simulator instances use Postgres when DATABASE_URL is present.
 * Local dev can still run without setup; in that case we fall back to
 * the original file-backed JSON store. Route handlers call the same
 * functions either way.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

export interface SimUser {
  email: string;
  name: string;
  title?: string | null;
  photoUrl?: string | null;
  createdAt: string;
}

export type SimMessageFrom = "bot" | "user";
export type SimMessageKind = "message" | "kickoff" | "system";

export interface SimMessage {
  id: string;
  userEmail: string;
  from: SimMessageFrom;
  kind: SimMessageKind;
  text: string;
  createdAt: string;
}

interface StoreShape {
  users: SimUser[];
  messages: SimMessage[];
}

const STORE_PATH =
  process.env.SIMULATOR_STORE_PATH ??
  join(process.cwd(), "data", "store.json");
const DATABASE_URL = process.env.DATABASE_URL?.trim();

const globalForPg = globalThis as unknown as {
  simulatorPgPool: Pool | undefined;
  simulatorPgReady: Promise<void> | undefined;
};

function pool() {
  if (!DATABASE_URL) return null;
  globalForPg.simulatorPgPool ??= new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes("sslmode=require")
      ? { rejectUnauthorized: false }
      : undefined,
  });
  return globalForPg.simulatorPgPool;
}

async function ensureDb() {
  const pg = pool();
  if (!pg) return null;
  globalForPg.simulatorPgReady ??= pg.query(`
    CREATE TABLE IF NOT EXISTS simulator_user (
      email TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      title TEXT,
      photo_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS simulator_message (
      id UUID PRIMARY KEY,
      user_email TEXT NOT NULL REFERENCES simulator_user(email) ON DELETE CASCADE,
      sender TEXT NOT NULL CHECK (sender IN ('bot', 'user')),
      kind TEXT NOT NULL CHECK (kind IN ('message', 'kickoff', 'system')),
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS simulator_message_user_created_idx
      ON simulator_message(user_email, created_at);
  `).then(() => undefined);
  await globalForPg.simulatorPgReady;
  return pg;
}

let writeLock: Promise<void> = Promise.resolve();

async function read(): Promise<StoreShape> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    return {
      users: parsed.users ?? [],
      messages: parsed.messages ?? [],
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { users: [], messages: [] };
    }
    throw err;
  }
}

async function write(state: StoreShape): Promise<void> {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(state, null, 2), "utf8");
}

async function withLock<T>(fn: (state: StoreShape) => Promise<T> | T): Promise<T> {
  let release: () => void = () => {};
  const next = new Promise<void>((res) => {
    release = res;
  });
  const prev = writeLock;
  writeLock = prev.then(() => next);
  try {
    await prev;
    const state = await read();
    const result = await fn(state);
    await write(state);
    return result;
  } finally {
    release();
  }
}

export async function listUsers(): Promise<SimUser[]> {
  const pg = await ensureDb();
  if (pg) {
    const res = await pg.query<{
      email: string;
      name: string;
      title: string | null;
      photo_url: string | null;
      created_at: Date;
    }>(`
      SELECT email, name, title, photo_url, created_at
      FROM simulator_user
      ORDER BY name ASC
    `);
    return res.rows.map((r) => ({
      email: r.email,
      name: r.name,
      title: r.title,
      photoUrl: r.photo_url,
      createdAt: r.created_at.toISOString(),
    }));
  }
  const state = await read();
  return state.users.slice().sort((a, b) => a.name.localeCompare(b.name));
}

export async function getUser(email: string): Promise<SimUser | null> {
  const pg = await ensureDb();
  if (pg) {
    const res = await pg.query<{
      email: string;
      name: string;
      title: string | null;
      photo_url: string | null;
      created_at: Date;
    }>(
      `
        SELECT email, name, title, photo_url, created_at
        FROM simulator_user
        WHERE email = $1
      `,
      [email.toLowerCase()],
    );
    const row = res.rows[0];
    return row
      ? {
          email: row.email,
          name: row.name,
          title: row.title,
          photoUrl: row.photo_url,
          createdAt: row.created_at.toISOString(),
        }
      : null;
  }
  const state = await read();
  return (
    state.users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ??
    null
  );
}

export async function upsertUser(input: {
  email: string;
  name: string;
  title?: string | null;
  photoUrl?: string | null;
}): Promise<SimUser> {
  const normalized = input.email.toLowerCase();
  const pg = await ensureDb();
  if (pg) {
    const res = await pg.query<{
      email: string;
      name: string;
      title: string | null;
      photo_url: string | null;
      created_at: Date;
    }>(
      `
        INSERT INTO simulator_user (email, name, title, photo_url)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (email) DO UPDATE SET
          name = CASE
            WHEN length(EXCLUDED.name) > length(simulator_user.name)
            THEN EXCLUDED.name
            ELSE simulator_user.name
          END,
          title = COALESCE(EXCLUDED.title, simulator_user.title),
          photo_url = COALESCE(EXCLUDED.photo_url, simulator_user.photo_url)
        RETURNING email, name, title, photo_url, created_at
      `,
      [
        normalized,
        input.name || normalized,
        input.title ?? null,
        input.photoUrl ?? null,
      ],
    );
    const row = res.rows[0]!;
    return {
      email: row.email,
      name: row.name,
      title: row.title,
      photoUrl: row.photo_url,
      createdAt: row.created_at.toISOString(),
    };
  }
  return withLock(async (state) => {
    const existing = state.users.find(
      (u) => u.email.toLowerCase() === normalized,
    );
    if (existing) {
      // Don't overwrite a more specific name with a less-specific one
      // (e.g. don't replace "Alice Chen" with just "alice").
      if (input.name && input.name.length > existing.name.length) {
        existing.name = input.name;
      }
      if (input.title !== undefined) existing.title = input.title;
      if (input.photoUrl !== undefined) existing.photoUrl = input.photoUrl;
      return existing;
    }
    const created: SimUser = {
      email: normalized,
      name: input.name || normalized,
      title: input.title ?? null,
      photoUrl: input.photoUrl ?? null,
      createdAt: new Date().toISOString(),
    };
    state.users.push(created);
    return created;
  });
}

export async function appendMessage(input: {
  userEmail: string;
  from: SimMessageFrom;
  kind?: SimMessageKind;
  text: string;
}): Promise<SimMessage> {
  const pg = await ensureDb();
  if (pg) {
    const id = randomUUID();
    const normalized = input.userEmail.toLowerCase();
    await pg.query(
      `
        INSERT INTO simulator_user (email, name)
        VALUES ($1, $1)
        ON CONFLICT (email) DO NOTHING
      `,
      [normalized],
    );
    const res = await pg.query<{
      id: string;
      user_email: string;
      sender: SimMessageFrom;
      kind: SimMessageKind;
      text: string;
      created_at: Date;
    }>(
      `
        INSERT INTO simulator_message (id, user_email, sender, kind, text)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, user_email, sender, kind, text, created_at
      `,
      [
        id,
        normalized,
        input.from,
        input.kind ?? "message",
        input.text,
      ],
    );
    const row = res.rows[0]!;
    return {
      id: row.id,
      userEmail: row.user_email,
      from: row.sender,
      kind: row.kind,
      text: row.text,
      createdAt: row.created_at.toISOString(),
    };
  }
  return withLock(async (state) => {
    const created: SimMessage = {
      id: randomUUID(),
      userEmail: input.userEmail.toLowerCase(),
      from: input.from,
      kind: input.kind ?? "message",
      text: input.text,
      createdAt: new Date().toISOString(),
    };
    state.messages.push(created);
    return created;
  });
}

export async function listMessagesFor(email: string): Promise<SimMessage[]> {
  const pg = await ensureDb();
  if (pg) {
    const res = await pg.query<{
      id: string;
      user_email: string;
      sender: SimMessageFrom;
      kind: SimMessageKind;
      text: string;
      created_at: Date;
    }>(
      `
        SELECT id, user_email, sender, kind, text, created_at
        FROM simulator_message
        WHERE user_email = $1
        ORDER BY created_at ASC
      `,
      [email.toLowerCase()],
    );
    return res.rows.map(rowToMessage);
  }
  const state = await read();
  const lower = email.toLowerCase();
  return state.messages
    .filter((m) => m.userEmail === lower)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function listLatestPerUser(): Promise<Map<string, SimMessage>> {
  const pg = await ensureDb();
  if (pg) {
    const res = await pg.query<{
      id: string;
      user_email: string;
      sender: SimMessageFrom;
      kind: SimMessageKind;
      text: string;
      created_at: Date;
    }>(`
      SELECT DISTINCT ON (user_email)
        id, user_email, sender, kind, text, created_at
      FROM simulator_message
      ORDER BY user_email, created_at DESC
    `);
    return new Map(res.rows.map((row) => [row.user_email, rowToMessage(row)]));
  }
  const state = await read();
  const latest = new Map<string, SimMessage>();
  for (const m of state.messages) {
    const cur = latest.get(m.userEmail);
    if (!cur || cur.createdAt < m.createdAt) latest.set(m.userEmail, m);
  }
  return latest;
}

export async function clearThread(email: string): Promise<void> {
  const lower = email.toLowerCase();
  const pg = await ensureDb();
  if (pg) {
    await pg.query("DELETE FROM simulator_message WHERE user_email = $1", [
      lower,
    ]);
    return;
  }
  await withLock(async (state) => {
    state.messages = state.messages.filter((m) => m.userEmail !== lower);
  });
}

export async function deleteUser(email: string): Promise<void> {
  const lower = email.toLowerCase();
  const pg = await ensureDb();
  if (pg) {
    await pg.query("DELETE FROM simulator_user WHERE email = $1", [lower]);
    return;
  }
  await withLock(async (state) => {
    state.users = state.users.filter((u) => u.email !== lower);
    state.messages = state.messages.filter((m) => m.userEmail !== lower);
  });
}

function rowToMessage(row: {
  id: string;
  user_email: string;
  sender: SimMessageFrom;
  kind: SimMessageKind;
  text: string;
  created_at: Date;
}): SimMessage {
  return {
    id: row.id,
    userEmail: row.user_email,
    from: row.sender,
    kind: row.kind,
    text: row.text,
    createdAt: row.created_at.toISOString(),
  };
}

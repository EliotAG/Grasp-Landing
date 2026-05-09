/**
 * Tiny file-backed JSON store.
 *
 * The simulator is single-tester scale — one operator on localhost. We
 * serialize concurrent writes through a per-process async mutex so that
 * two near-simultaneous POSTs (e.g. kickoff fan-out of 50 employees from
 * Grasp) don't clobber each other's appends.
 *
 * Schema is intentionally flat. If you outgrow JSON, swap the body of
 * `read` / `write` for SQLite without touching callers.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

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
  const state = await read();
  return state.users.slice().sort((a, b) => a.name.localeCompare(b.name));
}

export async function getUser(email: string): Promise<SimUser | null> {
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
  const state = await read();
  const lower = email.toLowerCase();
  return state.messages
    .filter((m) => m.userEmail === lower)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function listLatestPerUser(): Promise<Map<string, SimMessage>> {
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
  await withLock(async (state) => {
    state.messages = state.messages.filter((m) => m.userEmail !== lower);
  });
}

export async function deleteUser(email: string): Promise<void> {
  const lower = email.toLowerCase();
  await withLock(async (state) => {
    state.users = state.users.filter((u) => u.email !== lower);
    state.messages = state.messages.filter((m) => m.userEmail !== lower);
  });
}

/**
 * Saved Ask conversations, kept on this device only (IndexedDB: localStorage is too small for many chats).
 * One record per chat. Only the answer text, follow-up suggestions and a short readable list of sources are
 * stored, never full lookup results. The newest 50 chats are kept. If IndexedDB is not available (a private
 * window, blocked storage), chats live in memory for the session and `persistent` says so.
 */
export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  suggestions?: string[];
  sources?: string[];
  at: number;
}
export interface Chat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMsg[];
}

const DB = "halfspace-chats";
const STORE = "chats";
export const MAX_CHATS = 50;

const memory = new Map<string, Chat>();
let dbp: Promise<IDBDatabase | null> | null = null;
export let persistent = true;

function open(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { persistent = false; resolve(null); };
      req.onblocked = () => { persistent = false; resolve(null); };
    } catch {
      persistent = false;
      resolve(null);
    }
  });
  return dbp;
}

function run<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listChats(): Promise<Chat[]> {
  const db = await open();
  let all: Chat[];
  try {
    all = db ? await run(db, "readonly", (s) => s.getAll() as IDBRequest<Chat[]>) : [...memory.values()];
  } catch {
    persistent = false;
    all = [...memory.values()];
  }
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveChat(chat: Chat): Promise<void> {
  const db = await open();
  memory.set(chat.id, chat); // always mirrored, so a failed write never loses what is on screen
  if (db) {
    try { await run(db, "readwrite", (s) => s.put(chat)); } catch { persistent = false; }
  }
  const all = await listChats();
  for (const old of all.slice(MAX_CHATS)) await deleteChat(old.id);
}

export async function deleteChat(id: string): Promise<void> {
  memory.delete(id);
  const db = await open();
  if (db) { try { await run(db, "readwrite", (s) => s.delete(id)); } catch { /* ignore */ } }
}

export async function clearChats(): Promise<void> {
  memory.clear();
  const db = await open();
  if (db) { try { await run(db, "readwrite", (s) => s.clear()); } catch { /* ignore */ } }
}

export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
export const titleOf = (q: string) => (q.length > 60 ? q.slice(0, 57).trimEnd() + "…" : q);

export function toMarkdown(c: Chat): string {
  const lines = [`# ${c.title}`, "", `Saved from The Halfspace, ${new Date(c.updatedAt).toLocaleString()}`, ""];
  for (const m of c.messages) {
    lines.push(m.role === "user" ? `**You:** ${m.content}` : `**Analyst:**\n\n${m.content}`, "");
    if (m.sources?.length) lines.push(`_Based on: ${m.sources.join(", ")}_`, "");
  }
  return lines.join("\n");
}

export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

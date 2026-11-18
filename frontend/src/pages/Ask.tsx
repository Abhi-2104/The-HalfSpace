import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { api, type AskAnswer } from "../lib/api";
import { Markdown } from "../components/Markdown";
import { GoalCelebration, Thinking } from "../components/Thinking";
import { clearChats, deleteChat, download, listChats, newId, persistent, saveChat, titleOf, toMarkdown, type Chat, type ChatMsg } from "../lib/chatStore";

interface Msg extends ChatMsg {
  failed?: boolean;
  caveats?: string[];
}

const STARTERS = [
  "Who are the best pressing teams in the data?",
  "Compare two strikers from the same season for me.",
  "What does a high press actually look like?",
  "Which players are most like a given midfielder?",
];

// internal error text (stack traces, function names) is for logs, never for readers
const visibleCaveats = (cs: string[]) => cs.filter((c) => !/error|exception|traceback|argument|\(\)|\bhalfspace\b/i.test(c));

function friendly(message: string): string {
  if (/not set|unavailable|503/i.test(message)) return "The analyst is offline right now. Please try again later.";
  if (/429|rate/i.test(message)) return "The analyst is getting a lot of questions at the moment. Give it a few seconds and ask again.";
  return "I couldn't get an answer just now. Please try again in a moment.";
}

/** A short, readable account of what an answer drew on. No internal names. */
function sourcesOf(answer: AskAnswer): string[] {
  const labels = new Set<string>();
  for (const p of answer.provenance ?? []) {
    const t = p.tool.toLowerCase();
    if (/compar/.test(t)) labels.add("Comparisons");
    else if (/player/.test(t)) labels.add("Player statistics");
    else if (/team/.test(t)) labels.add("Team statistics");
    else if (/match|fixture/.test(t)) labels.add("Match data");
    else if (/tactic|concept/.test(t)) labels.add("The tactics guide");
    else if (/competition|season/.test(t)) labels.add("League and season data");
  }
  return [...labels];
}

const ago = (t: number) => {
  const d = Date.now() - t;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

export function Ask() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatId, setChatId] = useState<string>(() => newId());
  const [createdAt, setCreatedAt] = useState(() => Date.now());
  const [title, setTitle] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [scored, setScored] = useState(false); // the short goal animation between the data arriving and the answer showing
  const [drawer, setDrawer] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => listChats().then(setChats), []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, busy]);

  const persist = useCallback(async (id: string, ttl: string, created: number, list: Msg[], renamed?: string) => {
    const saved = list.filter((m) => !m.failed).map(({ role, content, suggestions, sources, at }) => ({ role, content, suggestions, sources, at }));
    if (saved.length === 0) return;
    await saveChat({ id, title: renamed ?? ttl, createdAt: created, updatedAt: Date.now(), messages: saved });
    refresh();
  }, [refresh]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    const history = msgs.filter((m) => !m.failed).map((m) => ({ role: m.role, content: m.content }));
    const ttl = title || titleOf(question);
    if (!title) setTitle(ttl);
    const asked: Msg[] = [...msgs, { role: "user", content: question, at: Date.now() }];
    setMsgs(asked);
    setQ("");
    setBusy(true);
    persist(chatId, ttl, createdAt, asked);
    try {
      const answer = await api.ask(question, history);
      setScored(true);
      await new Promise((r) => setTimeout(r, 1500));
      const done: Msg[] = [...asked, { role: "assistant", content: answer.text, at: Date.now(), suggestions: answer.suggestions?.slice(0, 3), sources: sourcesOf(answer), caveats: visibleCaveats(answer.unresolved_caveats ?? []) }];
      setMsgs(done);
      persist(chatId, ttl, createdAt, done);
    } catch (e) {
      setMsgs([...asked, { role: "assistant", content: friendly((e as Error).message), failed: true, at: Date.now() }]);
    } finally {
      setScored(false);
      setBusy(false);
    }
  }

  function startNew() {
    setChatId(newId()); setCreatedAt(Date.now()); setTitle(""); setMsgs([]); setQ(""); setDrawer(false);
  }
  function open(c: Chat) {
    setChatId(c.id); setCreatedAt(c.createdAt); setTitle(c.title); setMsgs(c.messages); setDrawer(false);
  }
  async function remove(c: Chat) {
    await deleteChat(c.id);
    if (c.id === chatId) startNew();
    refresh();
  }
  async function rename(c: Chat, name: string) {
    const t = name.trim();
    setRenaming(null);
    if (!t || t === c.title) return;
    await saveChat({ ...c, title: t, updatedAt: c.updatedAt });
    if (c.id === chatId) setTitle(t);
    refresh();
  }
  const current = (): Chat => ({ id: chatId, title: title || "New chat", createdAt, updatedAt: Date.now(), messages: msgs.filter((m) => !m.failed) });
  const lastAnswer = [...msgs].reverse().find((m) => m.role === "assistant");

  const fileName = (title || "chat").replace(/[^\w-]+/g, "-");
  const sidebar = (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-pitch-800 bg-pitch-900">
      <div className="flex items-center justify-between gap-2 border-b border-pitch-800 px-4 py-3">
        <h2 className="text-sm font-semibold text-ink-0">Conversations</h2>
        <button type="button" onClick={startNew} aria-label="New chat" title="New chat" className="grid h-8 w-8 place-items-center rounded-full bg-marker text-on-accent transition hover:-translate-y-0.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </div>

      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2" data-lenis-prevent>
        {chats.length === 0 && <li className="px-3 py-8 text-center text-sm leading-relaxed text-ink-2">No conversations yet. Ask a question to start one.</li>}
        {chats.map((c) => (
          <li key={c.id} className={`relative rounded-xl transition-colors ${c.id === chatId ? "bg-marker/10" : "hover:bg-pitch-800/50"}`}>
            {renaming === c.id ? (
              <div className="p-2">
                <input autoFocus defaultValue={c.title} maxLength={80} aria-label="Conversation name" onBlur={(e) => rename(c, e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRenaming(null); }}
                  className="w-full rounded-lg border border-marker bg-pitch-950/60 px-2.5 py-1.5 text-sm text-ink-0 outline-none" />
              </div>
            ) : (
              <>
                <button type="button" onClick={() => open(c)} aria-current={c.id === chatId} className="block w-full rounded-xl px-3 py-2.5 pr-10 text-left">
                  <span className="block truncate text-sm font-medium text-ink-0">{c.title}</span>
                  <span className="mt-0.5 block text-xs text-ink-2">{ago(c.updatedAt)} · {Math.ceil(c.messages.length / 2)} {c.messages.length <= 2 ? "question" : "questions"}</span>
                </button>
                <button type="button" onClick={() => setMenu(menu === c.id ? null : c.id)} aria-label="Conversation options" aria-expanded={menu === c.id} className="absolute right-1.5 top-2 grid h-7 w-7 place-items-center rounded-full text-ink-2 hover:bg-pitch-800 hover:text-ink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
                </button>
                {menu === c.id && (
                  <div className="absolute right-1.5 top-10 z-10 w-36 overflow-hidden rounded-xl border border-pitch-800 bg-pitch-900 py-1 text-sm shadow-lg">
                    <button type="button" onClick={() => { setMenu(null); setRenaming(c.id); }} className="block w-full px-3 py-2 text-left text-ink-0 hover:bg-pitch-800/60">Rename</button>
                    <button type="button" onClick={() => { setMenu(null); remove(c); }} className="block w-full px-3 py-2 text-left text-clay hover:bg-pitch-800/60">Delete</button>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>

      <div className="space-y-3 border-t border-pitch-800 p-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="relative">
            <button type="button" disabled={chats.length === 0 && msgs.length === 0} onClick={() => setExportOpen((v) => !v)} aria-expanded={exportOpen} className="w-full rounded-xl border border-pitch-800 px-3 py-2 text-xs font-medium text-ink-0 transition-colors hover:border-pitch-700 disabled:opacity-40">Export ▾</button>
            {exportOpen && (
              <div className="absolute bottom-full left-0 z-10 mb-1 w-48 overflow-hidden rounded-xl border border-pitch-800 bg-pitch-900 py-1 text-xs shadow-lg">
                <button type="button" disabled={msgs.length === 0} onClick={() => { setExportOpen(false); download(`${fileName}.md`, toMarkdown(current()), "text/markdown"); }} className="block w-full px-3 py-2 text-left text-ink-0 hover:bg-pitch-800/60 disabled:opacity-40">This chat (Markdown)</button>
                <button type="button" disabled={msgs.length === 0} onClick={() => { setExportOpen(false); download(`${fileName}.json`, JSON.stringify(current(), null, 2), "application/json"); }} className="block w-full px-3 py-2 text-left text-ink-0 hover:bg-pitch-800/60 disabled:opacity-40">This chat (JSON)</button>
                <button type="button" disabled={chats.length === 0} onClick={() => { setExportOpen(false); download("halfspace-chats.json", JSON.stringify(chats, null, 2), "application/json"); }} className="block w-full px-3 py-2 text-left text-ink-0 hover:bg-pitch-800/60 disabled:opacity-40">All chats (JSON)</button>
              </div>
            )}
          </div>
          {confirmClear ? (
            <button type="button" onClick={async () => { await clearChats(); setConfirmClear(false); startNew(); refresh(); }} onBlur={() => setConfirmClear(false)} className="rounded-xl border border-clay/60 px-3 py-2 text-xs font-semibold text-clay">Confirm delete</button>
          ) : (
            <button type="button" disabled={chats.length === 0} onClick={() => setConfirmClear(true)} className="rounded-xl border border-pitch-800 px-3 py-2 text-xs font-medium text-ink-1 transition-colors hover:border-clay/60 hover:text-clay disabled:opacity-40">Clear all</button>
          )}
        </div>
        <p className="flex gap-2 text-[11px] leading-relaxed text-ink-2">
          <svg className="mt-0.5 shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
          <span>{persistent ? "Saved on this device only. Clearing browser data or using a private window removes them." : "Saving isn't available in this browser, so conversations last only until you close this tab."}</span>
        </p>
      </div>
    </aside>
  );

  return (
    <div onClick={(e) => { if (!(e.target as HTMLElement).closest("button")) { setMenu(null); setExportOpen(false); } }} className="mx-auto flex min-h-[calc(100dvh-72px)] max-w-[1440px] flex-col px-6 py-6 lg:h-[calc(100dvh-72px)] lg:overflow-hidden lg:px-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-[-0.03em] text-ink-0 sm:text-4xl">Ask the analyst</h1>
          <p className="mt-1 max-w-xl text-sm text-ink-1 sm:text-base">Ask about players, teams and tactics. Every answer is built from the match and player data.</p>
        </div>
        <button type="button" onClick={() => setDrawer(true)} className="rounded-full border border-pitch-800 px-4 py-2 text-sm font-medium text-ink-0 lg:hidden">Chats{chats.length > 0 ? ` (${chats.length})` : ""}</button>
      </div>

      <div className="mt-5 grid min-h-0 flex-1 gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <div className="hidden min-h-0 lg:block">{sidebar}</div>

        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="min-h-[50vh] flex-1 space-y-4 lg:min-h-0 lg:overflow-y-auto lg:pr-2" aria-live="polite" data-lenis-prevent>
            {msgs.length === 0 && (
              <div className="flex flex-wrap gap-2">
                {STARTERS.map((s) => (
                  <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-pitch-800 bg-pitch-900 px-4 py-2 text-sm text-ink-1 transition hover:border-marker hover:text-ink-0">{s}</button>
                ))}
              </div>
            )}
            {msgs.map((m, i) => (
              <motion.div key={`${chatId}-${i}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`flex ${m.role === "user" ? "justify-end" : ""}`}>
                <div className={`max-w-[52rem] rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${m.role === "user" ? "bg-marker text-on-accent" : m.failed ? "border border-clay/40 bg-pitch-900 text-ink-1" : "border border-pitch-800 bg-pitch-900 text-ink-0"}`}>
                  {m.role === "assistant" && !m.failed ? <Markdown text={m.content} /> : <p className="whitespace-pre-wrap">{m.content}</p>}
                  {m.caveats && m.caveats.length > 0 && (
                    <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-clay">{m.caveats.map((c, j) => <li key={j}>{c}</li>)}</ul>
                  )}
                  {m.sources && m.sources.length > 0 && <p className="mt-3 text-xs text-ink-2">Based on: {m.sources.join(", ")}</p>}
                </div>
              </motion.div>
            ))}
            {!busy && lastAnswer && !lastAnswer.failed && lastAnswer.suggestions && lastAnswer.suggestions.length > 0 && msgs[msgs.length - 1] === lastAnswer && (
              <div className="flex flex-wrap gap-2 pt-1">
                {lastAnswer.suggestions.map((s) => (
                  <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-pitch-800 bg-pitch-900 px-4 py-2 text-left text-sm text-ink-1 transition hover:border-marker hover:text-ink-0">{s}</button>
                ))}
              </div>
            )}
            {busy && (scored ? <GoalCelebration /> : <Thinking />)}
            <div ref={end} />
          </div>

          <form onSubmit={(e) => { e.preventDefault(); send(q); }} className="sticky bottom-4 mt-4 flex shrink-0 gap-2 rounded-full border border-pitch-700 bg-pitch-900 p-1.5 shadow-lg lg:static">
            <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={1000} placeholder="Ask a football question…" aria-label="Your question" className="min-w-0 flex-1 bg-transparent px-4 text-ink-0 outline-none placeholder:text-ink-2" />
            <button type="submit" disabled={busy || !q.trim()} className="rounded-full bg-marker px-5 py-2.5 font-semibold text-on-accent transition disabled:opacity-40">Ask</button>
          </form>
        </div>
      </div>

      <AnimatePresence>
        {drawer && (
          <motion.div className="fixed inset-0 z-50 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true" aria-label="Your chats">
            <div className="absolute inset-0 bg-pitch-950/60 backdrop-blur-sm" onClick={() => setDrawer(false)} />
            <motion.div className="absolute inset-y-0 left-0 w-[85%] max-w-sm p-3" initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }} transition={{ type: "spring", stiffness: 300, damping: 32 }}>
              {sidebar}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

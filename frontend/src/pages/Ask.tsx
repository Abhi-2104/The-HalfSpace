import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { api, type AskAnswer } from "../lib/api";
import { Markdown } from "../components/Markdown";
import { GoalCelebration, Thinking } from "../components/Thinking";

interface Msg {
  role: "user" | "assistant";
  content: string;
  answer?: AskAnswer;
  failed?: boolean;
}

const SUGGESTIONS = [
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

export function Ask() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [scored, setScored] = useState(false); // the short goal animation between the data arriving and the answer showing
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, busy]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    const history = msgs.filter((m) => !m.failed).map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: "user", content: question }]);
    setQ("");
    setBusy(true);
    try {
      const answer = await api.ask(question, history);
      setScored(true);
      await new Promise((r) => setTimeout(r, 1500));
      setMsgs((m) => [...m, { role: "assistant", content: answer.text, answer }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", content: friendly((e as Error).message), failed: true }]);
    } finally {
      setScored(false);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-72px)] max-w-[1440px] flex-col px-6 py-12 lg:px-10">
      <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] text-ink-0">Ask the analyst</h1>
      <p className="mt-2 max-w-xl text-ink-1">
        Ask about players, teams and tactics. Every answer is built from the match and player data.
      </p>

      <div className="mt-8 flex-1 space-y-4" aria-live="polite">
        {msgs.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-pitch-800 bg-pitch-900 px-4 py-2 text-sm text-ink-1 transition hover:border-marker hover:text-ink-0">
                {s}
              </button>
            ))}
          </div>
        )}
        {msgs.map((m, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`flex ${m.role === "user" ? "justify-end" : ""}`}>
            <div className={`max-w-[52rem] rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${m.role === "user" ? "bg-marker text-on-accent" : m.failed ? "border border-clay/40 bg-pitch-900 text-ink-1" : "border border-pitch-800 bg-pitch-900 text-ink-0"}`}>
              {m.role === "assistant" && !m.failed ? <Markdown text={m.content} /> : <p className="whitespace-pre-wrap">{m.content}</p>}
              {m.answer && visibleCaveats(m.answer.unresolved_caveats).length > 0 && (
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-clay">
                  {visibleCaveats(m.answer.unresolved_caveats).map((c, j) => <li key={j}>{c}</li>)}
                </ul>
              )}
            </div>
          </motion.div>
        ))}
        {busy && (scored ? <GoalCelebration /> : <Thinking />)}
        <div ref={end} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); send(q); }} className="sticky bottom-4 mt-6 flex gap-2 rounded-full border border-pitch-700 bg-pitch-900 p-1.5 shadow-lg">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={1000}
          placeholder="Ask a football question…"
          aria-label="Your question"
          className="min-w-0 flex-1 bg-transparent px-4 text-ink-0 outline-none placeholder:text-ink-2"
        />
        <button type="submit" disabled={busy || !q.trim()} className="rounded-full bg-marker px-5 py-2.5 font-semibold text-on-accent transition disabled:opacity-40">
          Ask
        </button>
      </form>
    </div>
  );
}

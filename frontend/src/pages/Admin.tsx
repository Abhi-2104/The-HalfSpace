import { useCallback, useEffect, useRef, useState } from "react";
import { api, type AdminJob, type AdminStatus } from "../lib/api";

const BIG = new Set(["pack_frames", "ingest_idsse"]);
const KEY = "halfspace-admin-token"; // sessionStorage only: it is gone when the tab closes
const when = (t: number | null) => (t ? new Date(t * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "–");
const took = (j: AdminJob) => (j.finished_at ? `${Math.max(1, Math.round(j.finished_at - j.started_at))} s` : "running");

function explain(e: Error & { status?: number }) {
  if (e.status === 401) return "That token isn't right.";
  if (e.status === 429) return "Too many wrong attempts. This address is locked out for 15 minutes.";
  if (e.status === 503) return "The admin area is switched off on the server (no admin token is set).";
  return "Couldn't reach the server.";
}

export function Admin() {
  const [token, setToken] = useState(() => { try { return sessionStorage.getItem(KEY) ?? ""; } catch { return ""; } });
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [active, setActive] = useState<string | number | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [steps, setSteps] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<string | null>(null);
  const logEnd = useRef<HTMLPreElement>(null);

  const load = useCallback(async (t: string) => {
    try {
      const [s, j] = await Promise.all([api.admin.status(t), api.admin.jobs(t)]);
      setStatus(s); setJobs(j.jobs); setError(null);
      if (s.running_job) setActive((a) => a ?? s.running_job!.id);
    } catch (e) {
      setError(explain(e as Error)); setStatus(null);
      if ((e as { status?: number }).status === 401) { setToken(""); try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } }
    }
  }, []);
  useEffect(() => { if (token) load(token); }, [token, load]);

  // follow the chosen job's log every two seconds while it runs
  const job = jobs.find((j) => String(j.id) === String(active));
  useEffect(() => {
    if (!token || active == null) return;
    let live = true;
    const tick = async () => {
      try {
        const j = await api.admin.job(token, active);
        if (!live) return;
        setLog(j.log ?? j.lines ?? []);
        if (j.status !== "running") { load(token); return; }
        timer = setTimeout(tick, 2000);
      } catch { /* the next poll will retry */ timer = setTimeout(tick, 4000); }
    };
    let timer = setTimeout(tick, 0);
    return () => { live = false; clearTimeout(timer); };
  }, [token, active, load]);
  useEffect(() => { logEnd.current?.scrollTo({ top: logEnd.current.scrollHeight }); }, [log]);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    const t = input.trim();
    if (!t) return;
    try { sessionStorage.setItem(KEY, t); } catch { /* kept in memory only */ }
    setToken(t); setInput("");
  }
  async function start(name: string) {
    try { const j = await api.admin.start(token, name, name === "build_models" ? steps : undefined); setActive(j.id); setLog([]); setConfirm(null); load(token); }
    catch (e) { setError((e as { status?: number }).status === 409 ? "Another job is already running." : explain(e as Error)); }
  }
  async function cancel() { if (active != null) { try { await api.admin.cancel(token, active); load(token); } catch (e) { setError(explain(e as Error)); } } }
  const signOut = () => { setToken(""); setStatus(null); try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } };

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-12 lg:px-10">
      <h1 className="font-display text-3xl font-extrabold tracking-[-0.03em] text-ink-0">Admin</h1>
      <p className="mt-1 text-sm text-ink-1">Run data jobs and watch them. The token is kept for this browser tab only.</p>

      {!token && (
        <form onSubmit={connect} className="mt-6 flex max-w-md gap-2">
          <input type="password" autoComplete="off" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Admin token" aria-label="Admin token" className="min-w-0 flex-1 rounded-xl border border-pitch-700 bg-pitch-900 px-4 py-2.5 text-sm text-ink-0 outline-none focus:border-marker-bright" />
          <button type="submit" className="rounded-xl bg-marker px-5 py-2.5 text-sm font-semibold text-on-accent">Connect</button>
        </form>
      )}
      {error && <p role="alert" className="mt-4 rounded-xl border border-clay/40 bg-pitch-900 px-4 py-3 text-sm text-clay">{error}</p>}

      {token && status && (
        <>
          <div className="mt-6 flex items-center justify-between"><h2 className="text-sm font-semibold text-ink-0">Status</h2><button type="button" onClick={signOut} className="text-xs text-ink-2 hover:text-ink-0">Sign out</button></div>
          <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([["Matches", status.data.matches.toLocaleString()], ["Events", status.data.events.toLocaleString()], ["With 360 data", status.data.matches_with_360.toLocaleString()], ["Tracked matches", status.data.tracking_matches],
              ["Models built", `${status.models.count}${status.models.last_built ? ` · ${when(status.models.last_built)}` : ""}`], ["Database", `${status.files_gb.database.toFixed(1)} GB`], ["Derived data", `${status.files_gb.derived_db.toFixed(1)} GB`], ["Disk free", `${status.disk_free_gb.toFixed(0)} GB`]] as const).map(([k, v]) => (
              <div key={k} className="rounded-2xl border border-pitch-800 bg-pitch-900 p-3"><dt className="text-xs text-ink-2">{k}</dt><dd className="mt-0.5 font-mono text-sm text-ink-0">{v}</dd></div>
            ))}
          </dl>

          <h2 className="mt-8 text-sm font-semibold text-ink-0">Jobs</h2>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {Object.entries(status.jobs_available).map(([name, desc]) => (
              <div key={name} className="rounded-2xl border border-pitch-800 bg-pitch-900 p-4">
                <div className="font-mono text-sm font-semibold text-ink-0">{name}</div>
                <p className="mt-1 text-sm text-ink-1">{desc}</p>
                {name === "build_models" && status.build_steps && (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-1">
                    {status.build_steps.map((s) => (
                      <label key={s} className="flex items-center gap-1.5"><input type="checkbox" checked={steps.includes(s)} onChange={(e) => setSteps((cur) => e.target.checked ? [...cur, s] : cur.filter((x) => x !== s))} />{s}</label>
                    ))}
                    <span className="text-ink-2">{steps.length === 0 ? "(all steps)" : ""}</span>
                  </div>
                )}
                {confirm === name ? (
                  <div className="mt-3 flex items-center gap-3 text-xs"><span className="text-ink-1">This one is large. Run it?</span><button type="button" onClick={() => start(name)} className="font-semibold text-clay hover:underline">Yes, run</button><button type="button" onClick={() => setConfirm(null)} className="text-ink-1 hover:text-ink-0">Cancel</button></div>
                ) : (
                  <button type="button" disabled={!!status.running_job} onClick={() => (BIG.has(name) ? setConfirm(name) : start(name))} className="mt-3 rounded-full bg-marker px-4 py-1.5 text-xs font-semibold text-on-accent disabled:opacity-40">Run</button>
                )}
              </div>
            ))}
          </div>

          {active != null && (
            <section className="mt-8">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-ink-0">Log{job ? `: ${job.name} (${job.status})` : ""}</h2>
                {job?.status === "running" && <button type="button" onClick={cancel} className="rounded-full border border-clay/50 px-3 py-1 text-xs font-semibold text-clay hover:bg-clay/10">Cancel job</button>}
              </div>
              <pre ref={logEnd} data-lenis-prevent className="mt-2 h-72 overflow-auto rounded-2xl border border-pitch-800 bg-pitch-950/60 p-4 font-mono text-xs leading-relaxed text-ink-1">{log.length ? log.join("\n") : "Waiting for output…"}</pre>
            </section>
          )}

          <h2 className="mt-8 text-sm font-semibold text-ink-0">History</h2>
          <div className="mt-2 overflow-x-auto rounded-2xl border border-pitch-800 bg-pitch-900">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-pitch-800 text-ink-2"><tr><th className="px-4 py-2 font-semibold">Job</th><th className="px-4 py-2 font-semibold">Status</th><th className="px-4 py-2 font-semibold">Started</th><th className="px-4 py-2 font-semibold">Took</th><th /></tr></thead>
              <tbody className="divide-y divide-pitch-800">
                {jobs.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-ink-2">No jobs yet.</td></tr>}
                {jobs.map((j) => (
                  <tr key={j.id} className="hover:bg-pitch-800/40">
                    <td className="px-4 py-2 font-mono text-ink-0">{j.name}</td>
                    <td className={`px-4 py-2 ${j.status === "succeeded" ? "text-pitch-green" : j.status === "running" ? "text-marker-bright" : "text-clay"}`}>{j.status}</td>
                    <td className="px-4 py-2 text-ink-1">{when(j.started_at)}</td>
                    <td className="px-4 py-2 text-ink-1">{took(j)}</td>
                    <td className="px-4 py-2 text-right"><button type="button" onClick={() => { setActive(j.id); setLog([]); }} className="text-marker-bright hover:underline">View log</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

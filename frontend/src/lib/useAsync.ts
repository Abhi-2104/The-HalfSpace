import { useEffect, useState } from "react";

/** Runs an async loader whenever `deps` change. `data` is null while loading and after a failure; `failed` says which. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[], enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setData(null);
    setFailed(false);
    load().then((d) => live && setData(d)).catch(() => live && setFailed(true));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, failed, loading: !data && !failed };
}

import { useCallback, useEffect, useState } from "react";
import { ApiError, getStatus } from "./api.js";

export type ResultState =
  | { phase: "loading" }
  | { phase: "waiting" }
  | { phase: "confirmed"; bib: number }
  | { phase: "expired" }
  | { phase: "not_found" }
  | { phase: "timed_out" };

export const POLL_MS = 3000;
export const MAX_POLLS = 60;

/** The only place that decides what a server status means. A BIB needs status "confirmed". */
export function classify(s: { status: string; bib?: number }): ResultState {
  if (s.status === "confirmed" && s.bib !== undefined) return { phase: "confirmed", bib: s.bib };
  if (s.status === "expired") return { phase: "expired" };
  return { phase: "waiting" };
}

export function useRegistrationStatus(id: string, pollMs = POLL_MS, maxPolls = MAX_POLLS) {
  const [state, setState] = useState<ResultState>({ phase: "loading" });
  const [round, setRound] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll(n: number) {
      let next: ResultState;
      try {
        next = classify(await getStatus(id));
      } catch (e) {
        // 400/404: no such registration. Anything else (network, 429, 5xx) is temporary: keep trying.
        const unknown = e instanceof ApiError && (e.httpStatus === 404 || e.httpStatus === 400);
        next = unknown ? { phase: "not_found" } : { phase: "waiting" };
      }
      if (cancelled) return;
      if (next.phase !== "waiting") {
        setState(next);
        return;
      }
      if (n + 1 >= maxPolls) {
        setState({ phase: "timed_out" });
        return;
      }
      setState(next);
      timer = setTimeout(() => void poll(n + 1), pollMs);
    }

    void poll(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, round, pollMs, maxPolls]);

  const checkAgain = useCallback(() => {
    setState({ phase: "loading" });
    setRound((r) => r + 1);
  }, []);

  return { state, checkAgain };
}

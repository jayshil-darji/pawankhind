import type { ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router";
import BibActions from "./BibActions.js";
import BibCard from "./BibCard.js";
import SiteFooter from "./SiteFooter.js";
import SiteHeader from "./SiteHeader.js";
import { useRegistrationStatus, type ResultState } from "./useRegistrationStatus.js";

const HEADINGS: Record<ResultState["phase"], string> = {
  loading: "Checking your registration",
  waiting: "Confirming your payment",
  confirmed: "You are registered",
  expired: "Registration expired",
  not_found: "Registration not found",
  timed_out: "Still waiting for confirmation",
};

const TONES = {
  plain: "border-white/15 bg-white/5",
  warn: "border-amber-400/40 bg-amber-400/10",
  bad: "border-red-400/40 bg-red-400/10",
};

function Panel({ tone = "plain", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <div className={`rounded-xl border p-5 text-stone-200 ${TONES[tone]}`}>{children}</div>;
}

function Reference({ id }: { id: string }) {
  return (
    <p className="text-center text-sm text-stone-400">
      Reference: <code className="text-stone-200">{id}</code>
    </p>
  );
}

const linkButton =
  "mt-3 inline-block rounded-full bg-orange-600 px-6 py-2 text-sm font-semibold text-white";

function ResultView({ id }: { id: string }) {
  const { state, checkAgain } = useRegistrationStatus(id);
  const location = useLocation();
  const supportNotice =
    (location.state as { supportNotice?: boolean } | null)?.supportNotice === true;

  return (
    <>
      <SiteHeader basePath="/" />
      <main className="bg-stone-950 px-4 py-12 text-white">
        <div className="mx-auto max-w-md">
          <p className="text-center text-sm font-semibold uppercase tracking-[0.3em] text-orange-300">
            Pawankhind · Season 3
          </p>
          <h1 className="mt-2 text-center font-display text-4xl tracking-wide sm:text-5xl">
            {HEADINGS[state.phase]}
          </h1>

          <div className="mt-8 space-y-4">
            {supportNotice && state.phase !== "confirmed" && (
              <p role="alert" className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">
                Your payment was received but we could not finish the registration. Contact the
                organisers with the reference below.
              </p>
            )}

            {state.phase === "confirmed" && (
              <>
                <BibCard bib={state.bib} reference={id} />
                <BibActions />
                <p className="text-center text-xs text-stone-400">
                  Keep this page&apos;s link. Open it any time to see your BIB again.
                </p>
              </>
            )}

            {state.phase === "loading" && (
              <Panel>
                <p>One moment…</p>
              </Panel>
            )}

            {state.phase === "waiting" && (
              <>
                <Panel>
                  <p>Waiting for payment confirmation… This page updates by itself.</p>
                </Panel>
                <Reference id={id} />
              </>
            )}

            {state.phase === "expired" && (
              <>
                <Panel tone="bad">
                  <p>This registration has expired because payment was not completed in time.</p>
                  <p className="mt-1 text-sm">
                    If money was deducted, contact the organisers with the reference below.
                  </p>
                  <Link to="/#register" className={linkButton}>
                    Start again
                  </Link>
                </Panel>
                <Reference id={id} />
              </>
            )}

            {state.phase === "timed_out" && (
              <>
                <Panel tone="warn">
                  <p>We have not received confirmation yet.</p>
                  <p className="mt-1 text-sm">
                    If money was deducted, keep the reference below and contact the organisers.
                  </p>
                  <button type="button" className={linkButton} onClick={checkAgain}>
                    Check again
                  </button>
                </Panel>
                <Reference id={id} />
              </>
            )}

            {state.phase === "not_found" && (
              <Panel tone="bad">
                <p>We could not find this registration.</p>
                <Link to="/" className={linkButton}>
                  Register here
                </Link>
              </Panel>
            )}
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

export default function ResultPage() {
  const { id } = useParams();
  return id ? <ResultView key={id} id={id} /> : null;
}

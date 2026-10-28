import { Link, useLocation, useParams } from "react-router";
import { useRegistrationStatus } from "./useRegistrationStatus.js";

function Reference({ id }: { id: string }) {
  return (
    <p className="mt-2 text-sm">
      Reference: <code>{id}</code>
    </p>
  );
}

function ResultView({ id }: { id: string }) {
  const { state, checkAgain } = useRegistrationStatus(id);
  const location = useLocation();
  const supportNotice =
    (location.state as { supportNotice?: boolean } | null)?.supportNotice === true;

  if (state.phase === "confirmed") {
    return (
      <div className="rounded-lg border border-green-300 bg-green-50 p-6 text-center">
        <p className="text-sm text-green-800">You are registered. Your BIB number</p>
        <p className="my-2 text-5xl font-bold">{state.bib}</p>
        <p className="text-sm text-slate-600">
          Collect your kit 15 to 17 January. Carry a photo ID. Keep this page's link to see your BIB
          again.
        </p>
        <Reference id={id} />
      </div>
    );
  }

  if (state.phase === "not_found") {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 p-4">
        <p>We could not find this registration.</p>
        <Link to="/" className="mt-2 inline-block text-sm underline">
          Register here
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {supportNotice && (
        <p role="alert" className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">
          Your payment was received but we could not finish the registration. Contact the organisers
          with the reference below.
        </p>
      )}

      {state.phase === "loading" && <p>Checking your registration…</p>}

      {state.phase === "waiting" && (
        <p>Waiting for payment confirmation… This page updates by itself.</p>
      )}

      {state.phase === "expired" && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4">
          <p>This registration has expired because payment was not completed in time.</p>
          <p className="mt-1 text-sm">
            If money was deducted, contact the organisers with the reference below.
          </p>
          <Link to="/" className="mt-2 inline-block text-sm underline">
            Start again
          </Link>
        </div>
      )}

      {state.phase === "timed_out" && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p>We have not received confirmation yet.</p>
          <p className="mt-1 text-sm">
            If money was deducted, keep the reference below and contact the organisers.
          </p>
          <button
            className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            onClick={checkAgain}
          >
            Check again
          </button>
        </div>
      )}

      <Reference id={id} />
    </div>
  );
}

export default function ResultPage() {
  const { id } = useParams();
  return id ? <ResultView key={id} id={id} /> : null;
}

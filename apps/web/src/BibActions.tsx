import { useState } from "react";

export default function BibActions() {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-wrap justify-center gap-3 print:hidden">
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-full bg-orange-600 px-6 py-2 text-sm font-semibold text-white"
      >
        Save or print
      </button>
      <button
        type="button"
        onClick={() => void copyLink()}
        className="rounded-full border border-white/70 px-6 py-2 text-sm font-semibold text-white"
      >
        {copied ? "Link copied" : "Copy link"}
      </button>
    </div>
  );
}

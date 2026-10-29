import { Link } from "react-router";

export default function SiteFooter() {
  return (
    <footer className="bg-stone-800 px-4 py-4 text-xs text-stone-300">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:justify-between">
        <p>Copyright © 2026 Pawankhind Season 3</p>
        <nav aria-label="Legal" className="flex flex-wrap gap-4">
          <Link to="/terms">Terms of Use</Link>
          <Link to="/privacy">Privacy Policy</Link>
          <Link to="/refunds">Refund Policy</Link>
          <a href="#faq">FAQ</a>
        </nav>
      </div>
    </footer>
  );
}

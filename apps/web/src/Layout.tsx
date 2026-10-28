import { Outlet } from "react-router";

export default function Layout() {
  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-2xl font-bold">Pawankhind Season 3 · 5 KM Run</h1>
      <p className="mb-6 mt-1 text-sm text-slate-600">
        Sunday 17 January 2027 · Fee ₹200 · No refunds, no BIB transfer
      </p>
      <Outlet />
    </main>
  );
}

"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { RadioTower } from "lucide-react";
import { Suspense, useState, type FormEvent } from "react";

function LoginForm() {
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") || "/";
  const [error, setError] = useState<string | null>(params.get("error") ? "Sign-in failed" : null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const r = await signIn("credentials", {
      email: form.get("email"),
      password: form.get("password"),
      redirect: false,
    });
    setBusy(false);
    if (r?.ok) window.location.href = callbackUrl;
    else if (!r || r.error === "CredentialsSignin") setError("Wrong email or password");
    else setError("Sign-in failed: server error (is the database running?)");
  }

  return (
    <form
      onSubmit={onSubmit}
      className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <div className="flex items-center gap-3 pb-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
          <RadioTower className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-lg font-semibold leading-tight">Alarm Filter</h1>
          <p className="text-sm text-slate-500">Sign in to continue</p>
        </div>
      </div>
      <label className="block space-y-1 text-sm">
        <span className="font-medium text-slate-700">Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="username"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium text-slate-700">Password</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
        />
      </label>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-slate-900 px-3 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}

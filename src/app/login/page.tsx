"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const email = form.get("email") as string;
    const password = form.get("password") as string;

    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);
    if (res?.error) {
      setError(res.error);
    } else {
      // Redirection selon rôle - on récupère la session pour savoir
      router.push("/offres");
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 px-4">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl border p-8 shadow-sm">
        <h1 className="text-2xl font-bold">Connexion JOB4Us</h1>
        <p className="mt-1 text-sm text-zinc-500">Équivalent Laravel: Auth::attempt()</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="text-sm font-medium">Email</label>
            <input name="email" type="email" required className="mt-1 w-full rounded-lg border px-3 py-2 bg-white dark:bg-zinc-800" placeholder="vous@exemple.com" />
          </div>
          <div>
            <label className="text-sm font-medium">Mot de passe</label>
            <input name="password" type="password" required className="mt-1 w-full rounded-lg border px-3 py-2 bg-white dark:bg-zinc-800" />
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-950 p-2 rounded">{error}</p>}

          <button disabled={loading} className="w-full rounded-full bg-black text-white dark:bg-white dark:text-black py-2.5 font-medium hover:opacity-90 disabled:opacity-50">
            {loading ? "Connexion..." : "Se connecter"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-500">
          Pas de compte ? <Link href="/register" className="underline font-medium text-black dark:text-white">S&apos;inscrire</Link>
        </p>
        <Link href="/" className="mt-4 block text-center text-xs underline">← Accueil</Link>
      </div>
    </div>
  );
}

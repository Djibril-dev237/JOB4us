"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const data = {
      name: form.get("name") as string,
      email: form.get("email") as string,
      password: form.get("password") as string,
      role: form.get("role") as string,
    };

    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(json.error || "Erreur");
    } else {
      router.push("/login");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 px-4">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl border p-8 shadow-sm">
        <h1 className="text-2xl font-bold">Créer un compte</h1>
        <p className="mt-1 text-sm text-zinc-500">Choisis ton rôle comme dans Laravel (candidat / recruteur)</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="text-sm font-medium">Nom / Entreprise</label>
            <input name="name" required className="mt-1 w-full rounded-lg border px-3 py-2 bg-white dark:bg-zinc-800" placeholder="Jean Dupont ou Ma Société" />
          </div>
          <div>
            <label className="text-sm font-medium">Email</label>
            <input name="email" type="email" required className="mt-1 w-full rounded-lg border px-3 py-2 bg-white dark:bg-zinc-800" />
          </div>
          <div>
            <label className="text-sm font-medium">Mot de passe</label>
            <input name="password" type="password" required minLength={6} className="mt-1 w-full rounded-lg border px-3 py-2 bg-white dark:bg-zinc-800" />
          </div>
          <div>
            <label className="text-sm font-medium">Je suis</label>
            <select name="role" required className="mt-1 w-full rounded-lg border px-3 py-2 bg-white dark:bg-zinc-800">
              <option value="candidat">Candidat - je cherche un emploi</option>
              <option value="recruteur">Recruteur - je publie des offres</option>
            </select>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-950 p-2 rounded">{error}</p>}

          <button disabled={loading} className="w-full rounded-full bg-black text-white dark:bg-white dark:text-black py-2.5 font-medium hover:opacity-90 disabled:opacity-50">
            {loading ? "Création..." : "S'inscrire"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-500">
          Déjà inscrit ? <Link href="/login" className="underline font-medium text-black dark:text-white">Se connecter</Link>
        </p>
      </div>
    </div>
  );
}

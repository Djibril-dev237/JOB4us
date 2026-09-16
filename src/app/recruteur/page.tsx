import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function RecruteurDashboard() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (session.user.role !== "recruteur" && session.user.role !== "admin") redirect("/login");

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-bold">Dashboard Recruteur</h1>
      <p className="mt-2 text-zinc-600">Bienvenue {session.user.name} - rôle: {session.user.role}</p>
      <div className="mt-6 grid md:grid-cols-3 gap-4">
        <Link href="/api/offres" className="rounded-xl border p-5 bg-white dark:bg-zinc-900 hover:bg-zinc-50">➕ Créer offre (API POST)</Link>
        <div className="rounded-xl border p-5 bg-white dark:bg-zinc-900">👥 Candidatures reçues (à venir)</div>
        <div className="rounded-xl border p-5 bg-white dark:bg-zinc-900">🏢 Mon entreprise (à venir)</div>
      </div>
    </div>
  );
}

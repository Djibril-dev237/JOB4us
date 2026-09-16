import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function CandidatDashboard() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (session.user.role !== "candidat" && session.user.role !== "admin") redirect("/login");

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-bold">Dashboard Candidat</h1>
      <p className="mt-2 text-zinc-600">Bienvenue {session.user.name} ({session.user.email}) - rôle: {session.user.role}</p>
      <div className="mt-6 grid md:grid-cols-3 gap-4">
        <Link href="/offres" className="rounded-xl border p-5 bg-white dark:bg-zinc-900 hover:bg-zinc-50">🔍 Voir offres</Link>
        <div className="rounded-xl border p-5 bg-white dark:bg-zinc-900">📄 Mes candidatures (à venir)</div>
        <div className="rounded-xl border p-5 bg-white dark:bg-zinc-900">💬 Messages (à venir)</div>
      </div>
    </div>
  );
}

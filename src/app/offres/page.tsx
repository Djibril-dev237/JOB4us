import { prisma } from "@/lib/prisma";
import Link from "next/link";

export const dynamic = "force-dynamic";

async function getOffres() {
  try {
    return await prisma.offre.findMany({
      where: { isActive: true },
      include: { entreprise: true, categorie: true },
      orderBy: { createdAt: "desc" },
    });
  } catch {
    return null; // BDD pas encore connectée
  }
}

export default async function OffresPage() {
  const offres = await getOffres();

  if (offres === null) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-12">
        <h1 className="text-2xl font-bold">Offres d&apos;emploi</h1>
        <div className="mt-6 rounded-xl border border-yellow-200 bg-yellow-50 p-6">
          <p className="font-medium text-yellow-900">BDD non connectée</p>
          <p className="mt-2 text-sm text-yellow-800">
            Configure <code>.env</code> et lance <code>npx prisma db push</code>.
            Ensuite relance <code>npm run dev</code>.
          </p>
          <p className="mt-3 text-sm font-mono bg-white p-3 rounded border">
            DATABASE_URL=&quot;mysql://root:@localhost:3306/job4us&quot;
          </p>
        </div>
        <Link href="/" className="mt-6 inline-block text-sm underline">← Retour</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Offres ({offres.length})</h1>
        <Link href="/" className="text-sm underline">← Accueil</Link>
      </div>

      {offres.length === 0 ? (
        <p className="mt-8 text-zinc-500">Aucune offre pour l&apos;instant. Crée-en via Prisma Studio ou l&apos;API POST /api/offres.</p>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {offres.map((o) => (
            <div key={o.id} className="rounded-xl border bg-white p-5 dark:bg-zinc-900">
              <div className="flex items-start justify-between">
                <h3 className="font-semibold">{o.titre}</h3>
                <span className="text-xs bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded-full">{o.typeContrat}</span>
              </div>
              <p className="mt-1 text-sm text-zinc-500">{o.entreprise?.nom} • {o.ville} • {o.niveauExperience}</p>
              <p className="mt-3 text-sm line-clamp-3 text-zinc-600 dark:text-zinc-400">{o.description}</p>
              <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
                <span>{o.categorie?.nom}</span>
                <span>•</span>
                <span>{o.vues} vues</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

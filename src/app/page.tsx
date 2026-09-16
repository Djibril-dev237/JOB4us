import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <header className="border-b bg-white dark:bg-black">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">JOB4Us</h1>
          <nav className="flex gap-4 text-sm font-medium">
            <Link href="/offres" className="hover:underline">Offres</Link>
            <Link href="/api/offres" className="hover:underline">API</Link>
            <Link href="http://localhost:5555" className="text-zinc-500">Prisma Studio</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="rounded-2xl bg-white dark:bg-zinc-900 p-8 shadow-sm border">
          <h2 className="text-3xl font-semibold">Converti depuis Laravel → Next.js ✅</h2>
          <p className="mt-3 text-zinc-600 dark:text-zinc-400">
            Ton projet <code className="bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">emploi-app</code> (Laravel 10)
            a été migré en <b>Next.js 16 + Prisma + MySQL</b>.
          </p>

          <div className="mt-8 grid md:grid-cols-2 gap-6">
            <div className="rounded-xl border p-5">
              <h3 className="font-semibold">📦 Stack Backend</h3>
              <ul className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 list-disc list-inside space-y-1">
                <li>Next.js 16 App Router (remplace Laravel)</li>
                <li>Prisma 6.8 (remplace Eloquent) - 16 tables migrées</li>
                <li>MySQL - garde ta BDD <code>emploi_app</code></li>
                <li>API Route: <code>/api/offres</code></li>
              </ul>
            </div>
            <div className="rounded-xl border p-5">
              <h3 className="font-semibold">🎨 Frontend</h3>
              <ul className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 list-disc list-inside space-y-1">
                <li>Tailwind CSS 4 + TypeScript</li>
                <li>Prêt pour shadcn/ui</li>
                <li>Server Components</li>
              </ul>
            </div>
          </div>

          <div className="mt-8 rounded-xl bg-zinc-900 text-zinc-100 p-5 font-mono text-sm">
            <p className="text-zinc-400"># Prisma = Eloquent en JS</p>
            <p className="mt-2"><span className="text-green-400">Laravel:</span> Offre::active()-&gt;with(&apos;entreprise&apos;)-&gt;get()</p>
            <p><span className="text-blue-400">Prisma:</span> prisma.offre.findMany(&#123; where: &#123; isActive: true &#125;, include: &#123; entreprise: true &#125; &#125;)</p>
            <p className="mt-4 text-zinc-400"># Lancer le projet</p>
            <p>npm run dev → http://localhost:3000</p>
            <p>npx prisma studio → http://localhost:5555</p>
            <p>npx prisma db push → crée les tables MySQL</p>
          </div>

          <div className="mt-8 flex gap-3">
            <Link href="/offres" className="rounded-full bg-black text-white dark:bg-white dark:text-black px-6 py-3 text-sm font-medium hover:opacity-90">
              Voir les offres →
            </Link>
            <a href="/api/offres" className="rounded-full border px-6 py-3 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800">
              Tester l&apos;API
            </a>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900 dark:bg-yellow-950 dark:border-yellow-800 dark:text-yellow-100">
          <b>Prochaine étape :</b> Configure ton <code>DATABASE_URL</code> dans <code>.env</code> puis lance <code>npx prisma db push</code> pour créer les tables dans MySQL.
          Si tu n&apos;as pas MySQL, change le provider en <code>sqlite</code> dans <code>prisma/schema.prisma</code>.
        </div>
      </main>
    </div>
  );
}

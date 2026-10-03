import type { MetadataRoute } from 'next'

import { slugsOffresVisibles } from '@/lib/offres-public'
import { SITE_URL } from '@/lib/site-url'

// ─── Sitemap public (M5, task 6) ─────────────────────────────────────────────
//
// ABSENT du legacy (vérifié : aucune route sitemap/robots côté PHP) — les
// critères M5 l'exigent (« brouillon/expirée/supprimée → 404 (URL directe
// ET sitemap) »). Garanties :
// - seules les offres du prédicat unique y sont listées (slugsOffresVisibles
//   porte offreVisible() : brouillon, expirée et recruteur suspendu n'ont
//   AUCUNE URL dans ce fichier) ;
// - contenu strictement public : slug + date de mise à jour, rien d'autre
//   (aucune donnée personnelle, aucun nom de candidat, aucun champ brouillon) ;
// - pages auth (login, register, unauthorized) volontairement écartées :
//   elles ne doivent pas être indexées ;
// - <loc> absolus exigés par le protocole sitemap → SITE_URL
//   (NEXT_PUBLIC_APP_URL, env M1 ; dev = localhost:3000, prod = domaine
//   réel configuré au déploiement — aucun domaine inventé).
//
// Pas de priorité/changeFrequency : ce sont des hints que le legacy n'a
// jamais émis et dont l'effet réel est débattu — on ne code pas d'opinion
// SEO invérifiable, on publie les URL vraies avec leur lastModified réel.
//
// Task 7 (cache) : un `sitemap.js` est un Route Handler CACHÉ PAR DÉFAUT
// (doc Next : « cached by default unless it uses a Request-time API or
// dynamic config ») — sans cela, la liste serait figée au build : une
// offre publiée après le build n'y apparaîtrait JAMAIS et une offre
// expirée y resterait INDÉFINIMENT, ce qui viole le critère M5
// « expirée → 404 (URL directe ET sitemap) ». Coût assumé : une requête
// findMany indexée (quelques lignes) par passage de robot — dérisoire,
// et le build n'a plus besoin d'accéder à la base pour ce fichier.
// Aucun cache de résultat sur les pages non plus : la fraîcheur de la
// règle de visibilité prime sur un gain microscopique.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const offres = await slugsOffresVisibles()

  return [
    { url: SITE_URL },
    { url: `${SITE_URL}/offres` },
    ...offres.map((offre) => ({
      url: `${SITE_URL}/offres/${offre.slug}`,
      lastModified: offre.updatedAt,
    })),
  ]
}

'use client'

import { useEffect, useState } from 'react'

// ─── Statistiques réelles du hero ───────────────────────────────────────────
// Composant client : la page d'accueil reste synchrone (règle #98097) et les
// chiffres proviennent de GET /api/home/stats (route handler).
// Rendu strictement conditionnel : rien tant que la réponse n'arrive pas,
// puis uniquement les compteurs > 0 — aucun faux chiffre, aucun placeholder
// (règle anti-vibecoding ; sur la base de dev, 0 offre = bloc absent).
// Texte blanc plein sur bleu (4,84:1) : le PHP utilisait rgba(255,255,255,.7)
// pour les libellés ≈ 3,1:1, sous le seuil AA — la hiérarchie passe par la
// taille et le graisse, pas par la transparence.
// ---------------------------------------------------------------------------

interface HomeStatsData {
  offres: number
  entreprises: number
  candidats: number
}

export function HomeStats() {
  const [stats, setStats] = useState<HomeStatsData | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/home/stats', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: HomeStatsData | null) => {
        if (data && typeof data.offres === 'number') {
          setStats(data)
        }
      })
      .catch(() => {
        // Annulation ou erreur réseau : pas de stats plutôt que des douteuses.
      })
    return () => controller.abort()
  }, [])

  if (!stats) return null

  const items = [
    {
      value: stats.offres,
      label: stats.offres > 1 ? 'Offres actives' : 'Offre active',
    },
    {
      value: stats.entreprises,
      label: stats.entreprises > 1 ? 'Entreprises' : 'Entreprise',
    },
    {
      value: stats.candidats,
      label: stats.candidats > 1 ? 'Candidats' : 'Candidat',
    },
  ].filter((item) => item.value > 0)

  if (items.length === 0) return null

  return (
    <ul className="mt-10 flex flex-wrap gap-x-10 gap-y-5">
      {items.map((item) => (
        <li key={item.label}>
          <p className="text-3xl font-black leading-none tracking-tight text-white">
            {item.value}
          </p>
          <p className="mt-1.5 text-xs font-medium text-white">{item.label}</p>
        </li>
      ))}
    </ul>
  )
}

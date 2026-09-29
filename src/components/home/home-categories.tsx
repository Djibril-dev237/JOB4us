'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

// ─── Section « Parcourir par catégorie » (ancre #categories) ────────────────
// Composant client : la page d'accueil reste synchrone (règle #98097) ;
// GET /api/home/categories ne renvoie que les catégories avec au moins une
// offre active — base vide = section entièrement masquée (aucun faux contenu).
//
// Réf. accueil.blade.php : en-tête « titre + sous-titre » à gauche, lien
// « Voir toutes les offres » à droite (masqué sous md), cartes fond #F8FAFF
// (= token surface-alt), grille 2 / 3 / 6 colonnes (col-6/md-3/lg-2 PHP),
// lien /offres?categorie={id} — contrat legacy conservé pour le module M3.
// Cartes sans icône : le PHP associait 15 noms bootstrap-icons ; le jeu
// d'icônes maison n'a pas d'équivalent et une table de correspondance sort du
// périmètre M2. Ombre card au repos / shadow-lift au survol (règle réservée
// aux listes de cartes cliquables).
// ---------------------------------------------------------------------------

interface HomeCategory {
  id: number
  nom: string
  offres: number
}

export function HomeCategories() {
  const [categories, setCategories] = useState<HomeCategory[] | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/home/categories', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: HomeCategory[] | null) => {
        if (Array.isArray(data)) {
          setCategories(data)
        }
      })
      .catch(() => {
        // Annulation ou erreur réseau : section masquée plutôt que fausse.
      })
    return () => controller.abort()
  }, [])

  if (!categories || categories.length === 0) return null

  return (
    <section id="categories" className="py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight text-ink">
              Parcourir par catégorie
            </h2>
            <p className="mt-1 text-base text-ink-muted">
              Trouvez des offres dans votre domaine
            </p>
          </div>
          <Link
            href="/offres"
            className="hidden h-10 items-center rounded-sm border border-brand px-4 text-sm font-medium text-brand transition-colors duration-fast hover:bg-brand-tint md:inline-flex"
          >
            Voir toutes les offres
          </Link>
        </div>

        <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {categories.map((category) => (
            <li key={category.id}>
              <Link
                href={`/offres?categorie=${category.id}`}
                className="block h-full rounded-md border border-line bg-surface-alt p-4 shadow-card transition-all duration-fast hover:border-brand hover:shadow-lift"
              >
                <p className="font-semibold leading-snug text-ink">
                  {category.nom}
                </p>
                <p className="mt-1 text-sm text-ink-muted">
                  {category.offres} offre{category.offres > 1 ? 's' : ''}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

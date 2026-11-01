import { IconMapPin, IconTag } from '@/components/icons'
import { StatutBadge } from '@/components/offres/statut-badge'
import { Button } from '@/components/ui/button'
import { releverOffre, suspendreOffre } from '@/app/actions/offres-admin'
import type { OffreAdminLigne } from '@/lib/offres-admin-dal'
import { dateRelativeFr } from '@/lib/dates'
import { OPTIONS_MOTIF_SUSPENSION_OFFRE } from '@/lib/moderation-labels'
import { statutAffiche } from '@/lib/offres-labels'

// ─── Ligne de la liste admin des offres (M6, D5) ─────────────────────────────
// Motif du blade admin.offres/index : initiales de l'entreprise, titre,
// nom d'entreprise, méta (ville · catégorie · expiration), badge de statut
// + date de création relative, puis l'action de bascule Suspendre/Relever.
// Rendu SERVEUR pur : le formulaire appelle directement une server action
// (aucun ilot client, aucune confirmation — le legacy n'en avait pas).
//
// Responsiveness 360/768/1280 : le conteneur passe en `flex-wrap`, l'info
// démarre sur 224 px de base et grandit ensuite — à 360 px le bloc d'infos
// reste sur sa ligne et statut + bouton passent à la ligne suivante, sans
// défilement horizontal et sans que le bouton devienne inaccessible.
// ---------------------------------------------------------------------------

/** Dates publiques figées sur le fuseau de la cible (motif M5). */
const FORMATEUR_DATE = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Douala',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

/**
 * Repli legacy exact : `strtoupper(substr($offre->entreprise->nom ?? 'E',
 * 0, 2))` — 2 lettres majuscules, « E » quand l'entreprise manque.
 */
function initialesEntreprise(nom: string | null | undefined): string {
  return (nom ?? 'E').slice(0, 2).toUpperCase()
}

/**
 * Contour « success » de Relever : ui/button (fichier partagé M2, hors
 * périmètre 2D) ne propose que primary/secondary/danger, et surcharger
 * `border-line-strong` par `border-ok` en classe additionnelle dépendrait
 * de l'ordre final dans la feuille Tailwind. Gabarit repris de
 * buttonClassName('danger') : legacy « Activer » = btn-outline-success.
 */
const CLASSE_BOUTON_RELEVER = [
  'inline-flex h-9 items-center justify-center gap-2 rounded-sm border border-ok bg-surface px-3',
  'text-sm font-medium text-ok transition-colors duration-fast hover:bg-ok-tint',
  'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
].join(' ')

interface LigneOffreAdminProps {
  offre: OffreAdminLigne
  /** Frontière d'affichage unique : même « maintenant » pour toute la liste. */
  maintenant: Date
}

export function LigneOffreAdmin({ offre, maintenant }: LigneOffreAdminProps) {
  const suspendue = offre.statut === 'suspendue'
  const libelleAction = suspendue ? 'Relever' : 'Suspendre'

  return (
    <li className="flex flex-wrap items-start gap-3 p-3">
      {/* Initiales : décoratives, le nom de l'entreprise est déjà affiché. */}
      <div
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-brand-tint text-sm font-bold text-brand-dark"
      >
        {initialesEntreprise(offre.entreprise?.nom)}
      </div>

      <div className="min-w-0 grow basis-56">
        <h2 className="truncate text-sm font-semibold text-ink">{offre.titre}</h2>
        <p className="mt-0.5 text-xs font-medium text-brand">
          {offre.entreprise?.nom ?? 'Entreprise'}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-muted">
          <IconMapPin size={14} />
          <span>{offre.ville}</span>
          <span aria-hidden="true">·</span>
          <IconTag size={14} />
          <span>{offre.categorie?.nom ?? 'Sans catégorie'}</span>
          <span aria-hidden="true">·</span>
          <span>Expire {FORMATEUR_DATE.format(offre.dateExpiration)}</span>
        </p>
      </div>

      <div className="ml-auto flex shrink-0 flex-col items-end gap-1">
        {/* Statut DÉRIVÉ ici (D12) : « expirée » n'est jamais stockée. */}
        <StatutBadge statut={statutAffiche(offre, maintenant)} />
        <span className="text-xs text-ink-muted">
          {dateRelativeFr(offre.createdAt, maintenant)}
        </span>
      </div>

      {/* Un seul formulaire par ligne : l'offre suit via l'id caché.
          Noms de contrôles identiques d'une ligne à l'autre : le contexte
          du titre reste explicite pour un lecteur d'écran en liste. */}
      <form
        action={suspendue ? releverOffre : suspendreOffre}
        className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto"
      >
        <input type="hidden" name="id" value={offre.id} />
        <select
          name="motif"
          aria-label={
            suspendue ? 'Motif de la réactivation' : 'Motif de la suspension'
          }
          defaultValue={suspendue ? 'autre' : 'qualite'}
          className="h-9 min-w-0 grow rounded-sm border-[1.5px] border-line bg-surface px-2 text-sm text-ink transition-colors duration-fast focus:border-brand sm:grow-0"
        >
          {OPTIONS_MOTIF_SUSPENSION_OFFRE.map((option) => (
            <option key={option.valeur} value={option.valeur}>
              {option.libelle}
            </option>
          ))}
        </select>
        {suspendue ? (
          <button
            type="submit"
            aria-label={`${libelleAction} l’offre « ${offre.titre} »`}
            className={CLASSE_BOUTON_RELEVER}
          >
            {libelleAction}
          </button>
        ) : (
          <Button
            variant="danger"
            size="sm"
            type="submit"
            aria-label={`${libelleAction} l’offre « ${offre.titre} »`}
          >
            {libelleAction}
          </Button>
        )}
      </form>
    </li>
  )
}

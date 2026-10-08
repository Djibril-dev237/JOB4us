'use client'

import { useActionState, useRef, useState } from 'react'
import Link from 'next/link'

import { FicheOffre } from '@/components/offres/fiche-offre'
import { Button, buttonClassName } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  NIVEAU_EXPERIENCE_VALUES,
  TYPE_CONTRAT_LABELS,
  TYPE_CONTRAT_VALUES,
  type FormState,
} from '@/lib/definitions'
import type { EntrepriseFiche } from '@/lib/offres-form-dal'
import {
  construireOffreApercu,
  estNiveauExperience,
  estTypeContrat,
  lireValeursOffre,
  valeursOffresVides,
  type ValeursOffre,
} from './valeurs-offre'

// ─── Formulaire de création / d'édition d'une offre (M6, agent 2C) ───────────
//
// Ilot client MINIMAL (motif : recruteur/entreprise/entreprise-form.tsx) :
// useActionState → erreurs par champ rendues SOUS le champ, `_form` au-dessus
// des boutons (couvre D3/D4/D6 renvoyées par l'action, déjà formatées par
// MESSAGES_ERREUR_TRANSITION), succès = redirect côté action (le redirect
// throw est propagé par useActionState : jamais de `message` ici).
//
// Champs CONTRÔLÉS : l'état client est la source des inputs — c'est ce qui
// garantit « aucune valeur perdue » entre deux allers-retours vers l'aperçu
// ET après un envoi refusé (le serveur renvoie le formulaire, l'état n'a pas
// bougé). L'aperçu, lui, relit le FormData au moment du clic : il affiche
// donc exactement le payload que l'action recevra, sans validation.
//
// Ordre, sections et libellés = create.blade.php / edit.blade.php lus un à
// un (« Informations générales » → « Compétences requises » | « Détails du
// poste » → « Salaire (optionnel) » → boutons). Différences de mode
// verrouillées par le contrat : option vide « -- Choisir -- » sur contrat et
// niveau EN CRÉATION SEULEMENT, `min` demain sur la date EN CRÉATION
// SEULEMENT, libellé de case salaire différent par page, aucun équivalent de
// l'ancien `is_active` (D7 supprimé), et UN SEUL champ caché : `id`
// (liste blanche anti mass-assignment : statut/entrepriseId/slug ne
// traversent pas la frontière).
// ---------------------------------------------------------------------------

type ActionOffre = (precedent: FormState, formData: FormData) => Promise<FormState>

interface OptionListe {
  value: string
  label: string
}

/** Valeurs du blade de création (CDI, CDD, Stage…), libellés identiques à
 *  `TYPE_CONTRAT_LABELS` — l'option vide du mode création est portée par
 *  `withEmpty`, jamais dans la liste. */
const OPTIONS_TYPE_CONTRAT: OptionListe[] = TYPE_CONTRAT_VALUES.map((valeur) => ({
  value: valeur,
  label: TYPE_CONTRAT_LABELS[valeur],
}))

/** Intitulés AFFICHÉS du blade d'offre (plus longs que la section Libellés
 *  M5 : « Junior (1-2 ans) » et non « Junior » — c'est ce que le schéma
 *  rappelle aussi dans son message d'erreur). */
const OPTIONS_NIVEAU_EXPERIENCE: OptionListe[] = NIVEAU_EXPERIENCE_VALUES.map(
  (valeur) => ({
    value: valeur,
    label:
      valeur === 'sans_experience'
        ? 'Sans expérience'
        : valeur === 'junior'
          ? 'Junior (1-2 ans)'
          : valeur === 'intermediaire'
            ? 'Intermédiaire (3-5 ans)'
            : 'Senior (5+ ans)',
  }),
)

const ALERTE_ERREUR =
  'rounded-sm border border-danger bg-danger-tint px-3 py-2 text-sm text-danger'

const CLASSES_CASE =
  'flex cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-sm text-ink hover:bg-surface-alt'

interface OffreFormProps {
  /** `creerOffre` ou `enregistrerModificationsOffre` (@/app/actions/offres). */
  action: ActionOffre
  mode: 'creer' | 'editer'
  /** Création seule : `min` du calendrier (demain, fuseau cible). Édition :
   *  AUCUN min (prolonger une date passée est légitime, cf. T7). */
  dateMin?: string | undefined
  /** Édition seule : id de l'offre — unique champ caché du formulaire. */
  idOffre?: number | undefined
  categories: Array<{ id: number; nom: string }>
  competences: Array<{ id: number; nom: string }>
  /** Entreprise RÉELLE du compte : en-tête de l'aperçu (logo/initiales). */
  entreprise: EntrepriseFiche
  /** Pré-remplissage d'édition (aucun prefill en création). */
  valeursInitiales?: ValeursOffre | undefined
}

export function OffreForm(props: OffreFormProps) {
  const [state, formAction, pending] = useActionState(props.action, undefined)
  const [valeurs, setValeurs] = useState<ValeursOffre>(
    () => props.valeursInitiales ?? valeursOffresVides(),
  )
  // `null` = formulaire visible ; sinon les valeurs gelées au moment du clic
  // sur [Aperçu] — l'état reste intact, donc rien n'est perdu au retour.
  const [apercu, setApercu] = useState<ValeursOffre | null>(null)
  const refFormulaire = useRef<HTMLFormElement>(null)

  const erreur = (cle: string): string | undefined => state?.errors?.[cle]?.[0]

  // L'aperçu est lu dans le FormData au moment du clic : c'est EXACTEMENT le
  // payload que l'action recevra à la soumission (jamais une copie d'état qui
  // pourrait diverger du DOM — autofill compris).
  function ouvrirApercu() {
    const formulaire = refFormulaire.current
    if (formulaire === null) return
    setApercu(lireValeursOffre(new FormData(formulaire)))
  }

  // ── Aperçu (D10) : bascule formulaire ↔ fiche publique rendue en local ────
  if (apercu !== null) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <Button type="button" onClick={() => setApercu(null)}>
            Retour au formulaire
          </Button>
        </div>
        {/* Aperçu = reflet SANS validation : les champs vides s'affichent
            tels quels, aucun contrôle de formulaire n'est rejoué ici. */}
        <FicheOffre
          offre={construireOffreApercu(
            apercu,
            props.categories,
            props.competences,
            props.entreprise,
          )}
          similaires={[]}
        />
      </div>
    )
  }

  const optionsCategories: OptionListe[] = props.categories.map((categorie) => ({
    value: String(categorie.id),
    label: categorie.nom,
  }))

  return (
    <form ref={refFormulaire} action={formAction} className="space-y-4">
      {/* Seul champ caché : l'id sert à T3 (édition) — statut, entrepriseId
          et slug sont lus CÔTÉ SERVEUR depuis la base, jamais reçus. */}
      {props.mode === 'editer' && props.idOffre !== undefined ? (
        <input type="hidden" name="id" value={props.idOffre} />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ── Colonne principale ─────────────────────────────────────────── */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <h2 className="text-base font-semibold text-ink">Informations générales</h2>
            <div className="mt-4 space-y-4">
              {/* Placeholders portés par create.blade uniquement :
                  edit.blade n'en pose pas sur ces deux champs. */}
              <Input
                id="titre"
                name="titre"
                type="text"
                label="Titre du poste *"
                placeholder={
                  props.mode === 'creer' ? 'Ex: Développeur Web Full Stack' : undefined
                }
                required
                maxLength={200}
                value={valeurs.titre}
                onChange={(event) =>
                  setValeurs({ ...valeurs, titre: event.target.value })
                }
                error={erreur('titre')}
              />
              <Select
                id="categorie_id"
                name="categorie_id"
                label="Catégorie *"
                required
                withEmpty
                emptyLabel="-- Choisir une catégorie --"
                options={optionsCategories}
                value={valeurs.categorie_id}
                onChange={(event) =>
                  setValeurs({ ...valeurs, categorie_id: event.target.value })
                }
                error={erreur('categorie_id')}
              />
              <Textarea
                id="description"
                name="description"
                label="Description du poste *"
                rows={8}
                maxLength={10_000}
                placeholder={
                  props.mode === 'creer'
                    ? 'Décrivez le poste, les missions, les responsabilités...'
                    : undefined
                }
                required
                value={valeurs.description}
                onChange={(event) =>
                  setValeurs({ ...valeurs, description: event.target.value })
                }
                error={erreur('description')}
              />
            </div>
          </Card>

          {/* fieldset + legend : le groupe de cases porte SON titre de carte
              (une legend n'est pas un heading, la hiérarchie h1/h2 reste
              continue ailleurs) — motif profil-form.tsx. */}
          <Card>
            <fieldset>
              <legend className="text-base font-semibold text-ink">
                Compétences requises
              </legend>
              {props.competences.length === 0 ? (
                /* État vide du blade SANS le lien mort « Ajouter des
                   compétences » (aucune cible réelle côté recruteur). */
                <p className="mt-3 text-sm text-ink-muted">
                  Aucune compétence disponible.
                </p>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3">
                  {props.competences.map((competence) => (
                    <label key={competence.id} className={CLASSES_CASE}>
                      <input
                        type="checkbox"
                        name="competences"
                        value={competence.id}
                        checked={valeurs.competences.includes(competence.id)}
                        onChange={(event) =>
                          setValeurs({
                            ...valeurs,
                            competences: event.target.checked
                              ? [...valeurs.competences, competence.id]
                              : valeurs.competences.filter(
                                  (id) => id !== competence.id,
                                ),
                          })
                        }
                        className="size-4 shrink-0 accent-brand"
                      />
                      <span className="truncate">{competence.nom}</span>
                    </label>
                  ))}
                </div>
              )}
              {erreur('competences') !== undefined ? (
                <p className="mt-1.5 text-xs text-danger">{erreur('competences')}</p>
              ) : null}
            </fieldset>
          </Card>
        </div>

        {/* ── Colonne droite ─────────────────────────────────────────────── */}
        <div className="space-y-4">
          <Card>
            <h2 className="text-base font-semibold text-ink">Détails du poste</h2>
            <div className="mt-4 space-y-4">
              <Select
                id="type_contrat"
                name="type_contrat"
                label="Type de contrat *"
                required
                withEmpty={props.mode === 'creer'}
                emptyLabel="-- Choisir --"
                options={OPTIONS_TYPE_CONTRAT}
                value={valeurs.type_contrat}
                onChange={(event) => {
                  const valeur = event.target.value
                  setValeurs({
                    ...valeurs,
                    type_contrat: estTypeContrat(valeur) ? valeur : '',
                  })
                }}
                error={erreur('type_contrat')}
              />
              <Select
                id="niveau_experience"
                name="niveau_experience"
                label="Niveau d'expérience *"
                required
                withEmpty={props.mode === 'creer'}
                emptyLabel="-- Choisir --"
                options={OPTIONS_NIVEAU_EXPERIENCE}
                value={valeurs.niveau_experience}
                onChange={(event) => {
                  const valeur = event.target.value
                  setValeurs({
                    ...valeurs,
                    niveau_experience: estNiveauExperience(valeur) ? valeur : '',
                  })
                }}
                error={erreur('niveau_experience')}
              />
              <Input
                id="ville"
                name="ville"
                type="text"
                label="Ville *"
                placeholder="Ex: Douala"
                required
                maxLength={100}
                value={valeurs.ville}
                onChange={(event) =>
                  setValeurs({ ...valeurs, ville: event.target.value })
                }
                error={erreur('ville')}
              />
              <Input
                id="pays"
                name="pays"
                type="text"
                label="Pays"
                maxLength={100}
                value={valeurs.pays}
                onChange={(event) =>
                  setValeurs({ ...valeurs, pays: event.target.value })
                }
                error={erreur('pays')}
              />
              <Input
                id="date_expiration"
                name="date_expiration"
                type="date"
                label="Date d'expiration *"
                required
                min={props.mode === 'creer' ? props.dateMin : undefined}
                value={valeurs.date_expiration}
                onChange={(event) =>
                  setValeurs({ ...valeurs, date_expiration: event.target.value })
                }
                error={erreur('date_expiration')}
              />
            </div>
          </Card>

          <Card>
            <h2 className="text-base font-semibold text-ink">Salaire (optionnel)</h2>
            <div className="mt-4 space-y-4">
              <Input
                id="salaire_min"
                name="salaire_min"
                type="number"
                label="Salaire minimum (FCFA)"
                placeholder="Ex: 150000"
                value={valeurs.salaire_min}
                onChange={(event) =>
                  setValeurs({ ...valeurs, salaire_min: event.target.value })
                }
                error={erreur('salaire_min')}
              />
              <Input
                id="salaire_max"
                name="salaire_max"
                type="number"
                label="Salaire maximum (FCFA)"
                placeholder="Ex: 300000"
                value={valeurs.salaire_max}
                onChange={(event) =>
                  setValeurs({ ...valeurs, salaire_max: event.target.value })
                }
                error={erreur('salaire_max')}
              />
              {/* Libellé EXACT différent par page : create = « Afficher le
                  salaire sur l'offre », edit = « Afficher le salaire ». */}
              <label className={CLASSES_CASE}>
                <input
                  type="checkbox"
                  name="salaire_visible"
                  checked={valeurs.salaire_visible}
                  onChange={(event) =>
                    setValeurs({ ...valeurs, salaire_visible: event.target.checked })
                  }
                  className="size-4 shrink-0 accent-brand"
                />
                <span>
                  {props.mode === 'creer'
                    ? "Afficher le salaire sur l'offre"
                    : 'Afficher le salaire'}
                </span>
              </label>
            </div>
          </Card>

          {/* Erreurs globales (schéma + D3/D4/D6 de l'action) : juste au-
              dessus des boutons, jamais loin du clic qui les a produites. */}
          {erreur('_form') !== undefined ? (
            <p role="alert" className={ALERTE_ERREUR}>
              {erreur('_form')}
            </p>
          ) : null}

          <div className="space-y-2">
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              disabled={pending}
              onClick={ouvrirApercu}
            >
              Aperçu
            </Button>

            {props.mode === 'creer' ? (
              <>
                <Button
                  type="submit"
                  name="intention"
                  value="publier"
                  disabled={pending}
                  className="w-full"
                >
                  Publier l&apos;offre
                </Button>
                <Button
                  type="submit"
                  variant="secondary"
                  name="intention"
                  value="enregistrer"
                  disabled={pending}
                  className="w-full"
                >
                  Enregistrer
                </Button>
              </>
            ) : (
              <Button type="submit" disabled={pending} className="w-full">
                {pending ? 'Enregistrement…' : 'Enregistrer les modifications'}
              </Button>
            )}

            <Link
              href="/recruteur/offres"
              className={buttonClassName('secondary', 'md', 'w-full')}
            >
              Annuler
            </Link>
          </div>
        </div>
      </div>
    </form>
  )
}

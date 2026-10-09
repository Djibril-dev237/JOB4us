import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MAX_CV_BYTES } from '@/lib/files'
import {
  copyPrivateObject,
  deleteObject,
  downloadMeta,
  generateKey,
  putPrivateObject,
} from '@/lib/storage'

import { annulerSnapshotCv, preparerSnapshotCv, type ResultatSnapshotCv } from './candidature-cv'

// ─── Tests du snapshot de CV par candidature (M7) ─────────────────────────────
// Critère M7 verrouillé ici : le CV rattaché à une candidature est un objet
// PHYSIQUE distinct du CV de profil — une postulation crée une copie sous
// `candidatures/<uuid>` ; remplacer ou supprimer le profil n'y touche pas.
// Verrous :
// 1. la clé cible vient TOUJOURS de generateKey (aucune clé client, aucun
//    identifiant dans la clé) ;
// 2. la source « profil » lit le cvPath DU candidat de la session — jamais
//    une clé fournie de l'extérieur ;
// 3. la validation (taille 5 Mo, signature binaire) est celle de files.ts :
//    aucun octet n'est écrit avant qu'elle n'ait réussi ;
// 4. aucun cas documenté ne lève : le retour est une union ;
// 5. annulerSnapshotCv ne supprime QUE sous `candidatures/`.
// Seuls storage et Prisma sont mockés : validateUpload / detectFile /
// downloadMeta / generateKey exécutent leur VRAI code (l'environnement de
// test n'a besoin d'aucun R2).
// ---------------------------------------------------------------------------

/** Colonnes lues sur Candidat (`select { cvPath: true }`). */
interface ArgsCandidatFindUnique {
  where: { id: number }
  select: { cvPath: boolean }
}

const { candidatFindUnique } = vi.hoisted(() => ({
  candidatFindUnique: vi.fn<
    (args: ArgsCandidatFindUnique) => Promise<{ cvPath: string | null } | null>
  >(),
}))

// Seules les opérations DISTANTES sont neutralisées ; le reste du module
// storage.ts (générateur de clés, métadonnées) tourne pour de vrai mais est
// instrumenté, afin de prouver l'origine de la clé retournée.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    candidat: { findUnique: candidatFindUnique },
  },
}))
vi.mock('@/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage')>()
  return {
    ...actual,
    generateKey: vi.fn(actual.generateKey),
    downloadMeta: vi.fn(actual.downloadMeta),
    copyPrivateObject: vi.fn(),
    putPrivateObject: vi.fn(),
    deleteObject: vi.fn(),
  }
})

// ─── Fabrication d'octets et de fichiers de test ─────────────────────────────

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]) // "%PDF-1.7"
const TEXTE = new TextEncoder().encode('celui-ci n est pas un pdf')

function fileOf(bytes: Uint8Array, name: string, type: string): File {
  return new File([bytes as unknown as BlobPart], name, { type })
}

/** Nécessite `ok: true` pour poursuivre les assertions (sinon échec net). */
function cleDe(resultat: ResultatSnapshotCv): string {
  if (!resultat.ok) {
    throw new Error(`snapshot attendu, obtenu : ${JSON.stringify(resultat)}`)
  }
  return resultat.cle
}

const CLE_PROFIL = 'cvs/profil-de-candidat.pdf'

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── source : profil ──────────────────────────────────────────────────────────

describe('preparerSnapshotCv — source « profil »', () => {
  it('copie physiquement le CV de profil sous une clé générée par le serveur', async () => {
    candidatFindUnique.mockResolvedValue({ cvPath: CLE_PROFIL })

    const resultat = await preparerSnapshotCv({ candidatId: 7, source: 'profil' })

    const cle = cleDe(resultat)
    // La source est le champ du profil du candidat de la session, lu avec
    // l'id transmis par l'appelant (aucune clé dans le payload)…
    expect(candidatFindUnique).toHaveBeenCalledWith({
      where: { id: 7 },
      select: { cvPath: true },
    })
    // …et l'origine, le format et le type de la clé cible sont servis.
    expect(downloadMeta).toHaveBeenCalledWith(CLE_PROFIL, 'pdf')
    expect(generateKey).toHaveBeenCalledWith('candidatures', 'pdf')
    expect(cle).toMatch(/^candidatures\/[0-9a-f-]{36}\.pdf$/)
    expect(copyPrivateObject).toHaveBeenCalledTimes(1)
    expect(copyPrivateObject).toHaveBeenCalledWith(CLE_PROFIL, cle, 'application/pdf')
    // Jamais d'écriture directe sur le fichier de profil : la copie suffit.
    expect(putPrivateObject).not.toHaveBeenCalled()
  })

  it('sans CV sur le profil → profil-incomplet, aucune écriture', async () => {
    candidatFindUnique.mockResolvedValue({ cvPath: null })

    const resultat = await preparerSnapshotCv({ candidatId: 7, source: 'profil' })

    expect(resultat).toEqual({ ok: false, code: 'profil-incomplet' })
    expect(candidatFindUnique).toHaveBeenCalledWith({
      where: { id: 7 },
      select: { cvPath: true },
    })
    expect(downloadMeta).not.toHaveBeenCalled()
    expect(generateKey).not.toHaveBeenCalled()
    expect(copyPrivateObject).not.toHaveBeenCalled()
    expect(putPrivateObject).not.toHaveBeenCalled()
  })

  it('candidat introuvable → profil-incomplet, aucune écriture', async () => {
    candidatFindUnique.mockResolvedValue(null)

    const resultat = await preparerSnapshotCv({ candidatId: 404, source: 'profil' })

    expect(resultat).toEqual({ ok: false, code: 'profil-incomplet' })
    expect(copyPrivateObject).not.toHaveBeenCalled()
    expect(putPrivateObject).not.toHaveBeenCalled()
  })

  it("échec de la copie R2 → echec-stockage, jamais d'exception", async () => {
    candidatFindUnique.mockResolvedValue({ cvPath: CLE_PROFIL })
    vi.mocked(copyPrivateObject).mockRejectedValueOnce(new Error('R2 injoignable'))

    const resultat = await preparerSnapshotCv({ candidatId: 7, source: 'profil' })

    expect(resultat).toEqual({ ok: false, code: 'echec-stockage' })
    // Clé générée puis abandonnée : rien n'est retourné, donc rien à nettoyer
    // côté appelant (le contrat de rollback ne s'applique qu'à ok: true).
    expect(deleteObject).not.toHaveBeenCalled()
  })

  it('retourne exactement la clé que generateKey a produite', async () => {
    candidatFindUnique.mockResolvedValue({ cvPath: CLE_PROFIL })
    vi.mocked(generateKey).mockReturnValueOnce('candidatures/cle-du-serveur.pdf')

    const resultat = await preparerSnapshotCv({ candidatId: 7, source: 'profil' })

    expect(resultat).toEqual({ ok: true, cle: 'candidatures/cle-du-serveur.pdf' })
    expect(generateKey).toHaveBeenCalledWith('candidatures', 'pdf')
    expect(copyPrivateObject).toHaveBeenCalledWith(
      CLE_PROFIL,
      'candidatures/cle-du-serveur.pdf',
      'application/pdf',
    )
  })
})

// ─── source : fichier ─────────────────────────────────────────────────────────

describe('preparerSnapshotCv — source « fichier »', () => {
  it("PDF authentique → écriture sous candidatures/ avec le type réel détecté", async () => {
    const fichier = fileOf(PDF, 'cv.pdf', 'application/pdf')

    const resultat = await preparerSnapshotCv({ candidatId: 7, source: 'fichier', fichier })

    const cle = cleDe(resultat)
    expect(cle).toMatch(/^candidatures\/[0-9a-f-]{36}\.pdf$/)
    expect(generateKey).toHaveBeenCalledWith('candidatures', 'pdf')
    expect(putPrivateObject).toHaveBeenCalledTimes(1)
    const [cleEcriture, corps, contentType] = vi.mocked(putPrivateObject).mock.calls[0]
    expect(cleEcriture).toBe(cle)
    expect(corps).toEqual(PDF)
    expect(contentType).toBe('application/pdf')
    // Aucune lecture de profil ni copie : la source est le fichier envoyé.
    expect(candidatFindUnique).not.toHaveBeenCalled()
    expect(copyPrivateObject).not.toHaveBeenCalled()
  })

  it("mauvaise signature (texte brut en .pdf) → fichier-invalide, aucune écriture", async () => {
    const fichier = fileOf(TEXTE, 'cv.pdf', 'application/pdf')

    const resultat = await preparerSnapshotCv({ candidatId: 7, source: 'fichier', fichier })

    expect(resultat).toEqual({ ok: false, code: 'fichier-invalide' })
    expect(putPrivateObject).not.toHaveBeenCalled()
    expect(generateKey).not.toHaveBeenCalled()
    expect(candidatFindUnique).not.toHaveBeenCalled()
  })

  it(`fichier plus gros que MAX_CV_BYTES (${MAX_CV_BYTES} octets) → fichier-invalide`, async () => {
    const fichier = fileOf(new Uint8Array(MAX_CV_BYTES + 1), 'gros.pdf', 'application/pdf')

    const resultat = await preparerSnapshotCv({ candidatId: 7, source: 'fichier', fichier })

    expect(resultat).toEqual({ ok: false, code: 'fichier-invalide' })
    expect(putPrivateObject).not.toHaveBeenCalled()
    expect(generateKey).not.toHaveBeenCalled()
  })

  it('aucun fichier fourni → fichier-invalide, aucune écriture', async () => {
    const resultat = await preparerSnapshotCv({ candidatId: 7, source: 'fichier' })

    expect(resultat).toEqual({ ok: false, code: 'fichier-invalide' })
    expect(putPrivateObject).not.toHaveBeenCalled()
    expect(copyPrivateObject).not.toHaveBeenCalled()
    expect(candidatFindUnique).not.toHaveBeenCalled()
  })

  it("échec d'écriture R2 → echec-stockage, sans rollback maison", async () => {
    const fichier = fileOf(PDF, 'cv.pdf', 'application/pdf')
    vi.mocked(putPrivateObject).mockRejectedValueOnce(new Error('R2 injoignable'))

    const resultat = await preparerSnapshotCv({ candidatId: 7, source: 'fichier', fichier })

    expect(resultat).toEqual({ ok: false, code: 'echec-stockage' })
    expect(generateKey).toHaveBeenCalledWith('candidatures', 'pdf')
    expect(deleteObject).not.toHaveBeenCalled()
  })
})

// ─── annulerSnapshotCv : garde anti-suppression abusive ───────────────────────

describe('annulerSnapshotCv', () => {
  it("supprime un snapshot sous l'antéfixe candidatures/", async () => {
    await annulerSnapshotCv('candidatures/x.pdf')

    expect(deleteObject).toHaveBeenCalledTimes(1)
    expect(deleteObject).toHaveBeenCalledWith('candidatures/x.pdf')
  })

  it("refuse une clé d'un autre préfixe (CV de profil intact)", async () => {
    await annulerSnapshotCv('cvs/x.pdf')

    expect(deleteObject).not.toHaveBeenCalled()
  })

  it('refuse un chemin relatif', async () => {
    await annulerSnapshotCv('../../evil')

    expect(deleteObject).not.toHaveBeenCalled()
  })

  it('refuse un sous-chemin imbriqué ou une traversée déguisée', async () => {
    await annulerSnapshotCv('candidatures/autre/objet.pdf')
    await annulerSnapshotCv('candidatures/../../evil')

    expect(deleteObject).not.toHaveBeenCalled()
  })

  it('refuse une clé vide, l’antéfixe seul et une traversée percent-encodée', async () => {
    // Revue Vague 1 (O5) : verrouille la garde sur les variantes les plus
    // trompeuses — aucune ne doit jamais atteindre deleteObject.
    await annulerSnapshotCv('')
    await annulerSnapshotCv('candidatures/')
    await annulerSnapshotCv('candidatures/.')
    await annulerSnapshotCv('candidatures/%2e%2e/objet.pdf')
    await annulerSnapshotCv('candidatures\\..\\objet.pdf')

    expect(deleteObject).not.toHaveBeenCalled()
  })
})

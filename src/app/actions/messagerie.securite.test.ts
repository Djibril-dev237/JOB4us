import type { StatutCandidature, StatutOffre } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { verifySession } from '@/lib/dal'
import { checkRateLimit, resetAttempts } from '@/lib/rate-limit'

import { envoyerMessage } from './messagerie'

// ─── Matrice de SÉCURITÉ M8 (M8, Vague 4) ────────────────────────────────────
// Chaque ligne reproduit UN vecteur d'erreur 500 du contrôleur legacy
// (legacy_laravel/app/Http/Controllers/MessageController.php, analysé en
// Étape 1) contre la NOUVELLE implémentation, et prouve le verdict contrôlé
// qui l'a remplacé. Patron repris de candidatures.securite.test.ts.
//
// Matrice Étape 1 → verrou M8 :
//   V1  store l.56-58  candidat → destinataire sans `entreprise`
//       (`$destinataire->enterprise->id` sur null) ......... cas 1
//   V2  store l.59-61  recruteur → destinataire sans `candidat`
//       (`$destinataire->candidat->id` sur null) .......... cas 1
//   V3  store l.57 / getConversations l.157 : profil
//       `$user->candidat` absent (null deref) .............. cas 2
//   V4  store l.61 / getConversations : profil `$user->entreprise`
//       absent (null deref) ............................... cas 2
//   V5  envoyer l.112-113 `$conversation->recruteur->user`
//       (lien participant cassé → notification) ............ cas 3
//   V6  envoyer l.114-115 `$conversation->candidat->user` .. cas 3
//   V7  show/envoyer : id conversation hors type (binding SQL)
//       → bornage MAX_IDENTIFIANT : schemas (ids), actions
//       ('x', hors Int32), route.test.ts (400) — pas doublé ici
//   V8  store l.50,73 `offre_id` forgé ..................... cas 1
//   V9  autoriser l.149 : 403 non-participant
//       → 404 indiscernable : actions (non-participant) +
//       route.test.ts (même corps) — pas doublé ici
//   V10 autoriser l.145-146 : admin `$acces = true` universel
//       → route.test.ts (admin ≡ 404 identique) + file de
//       modération V3 (lecture par signalement + audit) — pas doublé ici
//   V11 show l.32-35 : écriture de masse dans un GET (`is_lu`)
//       → route.test.ts (zéro écriture) + avancerLecture
//       (garde participant) — pas doublé ici
//   V12 notifierMessage l.125-135 : Notification non bornée écrite
//       par le GET/POST .................................... cas 3
//
// Doctrine inchangée : prisma mocké AVEC UN PÉRIMÈTRE EXACT (les modèles
// absents du double rendraient toute tentative d'écriture impossible à
// manquer — TypeError), DAL/Zod/nettoyage tournant POUR DE VRAI, seau
// réel en mémoire (reset par test).
// ---------------------------------------------------------------------------

// ─── Types des doubles (aucun `any`) ─────────────────────────────────────────

interface ArgsConversationFindFirst {
  where?: unknown
  include?: unknown
}

interface ArgsBlocageFindFirst {
  where?: unknown
  select?: unknown
}

interface ArgsMessageCreate {
  data: { conversationId: number; senderId: number; contenu: string }
}

interface UserSim {
  id: number
  name: string
}

interface ConversationSim {
  id: number
  candidatureId: number
  candidature: {
    id: number
    offreId: number
    statut: StatutCandidature
    candidat: { userId: number; user: UserSim }
    offre: {
      id: number
      titre: string
      statut: StatutOffre
      deletedAt: Date | null
      entreprise: { userId: number; user: UserSim }
    }
  }
}

const { conversationFindFirst, messageCreate, blocageFindFirst } = vi.hoisted(() => ({
  conversationFindFirst: vi.fn<(args: ArgsConversationFindFirst) => Promise<unknown>>(),
  messageCreate: vi.fn<(args: ArgsMessageCreate) => Promise<unknown>>(),
  blocageFindFirst: vi.fn<(args: ArgsBlocageFindFirst) => Promise<unknown>>(),
}))

// PÉRIMÈTRE EXACT : seuls conversation/message/blocage existent dans ce
// double. Toute écriture de notification (V12) ou `conversation.touch()`
// legacy lèverait une TypeError et casserait le test — la preuve est par
// l'absence, pas par un spy. (Le résolveur M9 est stubbé plus bas : c'est
// l'ACTION qu'on éprouve ici, pas la couche notification.)
vi.mock('@/lib/prisma', () => ({
  prisma: {
    conversation: { findFirst: conversationFindFirst },
    message: { create: messageCreate },
    blocage: { findFirst: blocageFindFirst },
  },
}))

vi.mock('@/lib/dal', () => ({
  verifyRole: vi.fn(),
  verifySession: vi.fn(),
}))

// Seau RÉEL en mémoire, spyé « call-through » : le refus prouve qu'aucune
// tentative n'a été comptée, le succès prouve le budget honnête.
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/rate-limit')>()
  return {
    ...original,
    checkRateLimit: vi.fn(
      (key: string, max: number, windowMs: number) => original.checkRateLimit(key, max, windowMs),
    ),
    recordAttempt: vi.fn((key: string, windowMs?: number) => original.recordAttempt(key, windowMs)),
  }
})

// Résolveurs M9 stubbés : les hooks réels (non mockés ici) leur délèguent
// en fire-and-forget — les événements partent, mais AUCUNE écriture de
// notification n'atteint jamais le client restreint ci-dessus.
vi.mock('@/lib/notifications-evenements', () => ({
  notifierMessageEnvoye: vi.fn(async () => undefined),
  notifierSignalementRecu: vi.fn(async () => undefined),
}))

// ─── Fixtures ────────────────────────────────────────────────────────────────

const USER_ID = 11
const AUTRE_USER_ID = 22
const CONV_ID = 5
const CANDIDATURE_ID = 9
const MESSAGE_ID = 101
const CLE_SEAU = `messagerie:envoi:${USER_ID}`
const MESSAGE_DATE = new Date('2026-03-01T10:00:00.000Z')

function conversationValide(): ConversationSim {
  return {
    id: CONV_ID,
    candidatureId: CANDIDATURE_ID,
    candidature: {
      id: CANDIDATURE_ID,
      offreId: 3,
      statut: 'envoyee',
      candidat: { userId: USER_ID, user: { id: USER_ID, name: 'Awa' } },
      offre: {
        id: 3,
        titre: 'Developpeur back-end',
        statut: 'publiee',
        deletedAt: null,
        entreprise: { userId: AUTRE_USER_ID, user: { id: AUTRE_USER_ID, name: 'ACME' } },
      },
    },
  }
}

/** Base : `null` = aucune conversation trouvée (profil absent ou étranger). */
const base: { conversation: ConversationSim | null } = { conversation: null }

beforeEach(() => {
  vi.clearAllMocks()

  base.conversation = conversationValide()
  resetAttempts(CLE_SEAU)

  vi.mocked(verifySession).mockResolvedValue({ userId: USER_ID, role: 'candidat' })
  blocageFindFirst.mockImplementation(async () => null)
  conversationFindFirst.mockImplementation(async () => base.conversation)
  messageCreate.mockImplementation(async (args) => ({
    id: MESSAGE_ID,
    conversationId: args.data.conversationId,
    senderId: args.data.senderId,
    contenu: args.data.contenu,
    createdAt: MESSAGE_DATE,
  }))
})

// ─── cas 1 — vecteurs du `store` legacy : plus aucun destinataire ────────────

type PayloadEnvoi = { conversationId: number; contenu: string }

describe("cas 1 — vecteurs du store legacy : destinataire et offre n'existent plus", () => {
  it("payload forgé `destinataireId` + `offre_id` (clés PHP) : 'inconnue', AUCUN accès base", async () => {
    // V1/V2/V8 : le legacy acceptait `destinataire_id` puis DÉRÉFÉRENÇAIT
    // `$destinataire->entreprise->id` / `$destinataire->candidat->id` — un
    // destinataire sans profil correspondant valait 500. Ici la conversation
    // dérive de la CANDIDATURE : ces clés n'ont aucun sens, `.strict()` les
    // tue AVANT la moindre lecture (zéro requête, zéro seau).
    const resultat = await envoyerMessage({
      conversationId: CONV_ID,
      contenu: 'Bonjour',
      destinataireId: 666,
      offre_id: 3,
    } as unknown as PayloadEnvoi)

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(conversationFindFirst).not.toHaveBeenCalled()
    expect(blocageFindFirst).not.toHaveBeenCalled()
    expect(messageCreate).not.toHaveBeenCalled()
    expect(checkRateLimit).not.toHaveBeenCalled()
  })

  it("identité forgée `senderId`/`emetteurId` : 'inconnue', AUCUN accès base", async () => {
    // L'expéditeur du legacy sortait d'Auth, mais son `store` acceptait un
    // payload riche : ici TOUTE clé hors `{ conversationId, contenu }` est
    // un refus, et l'identité ne sort QUE de la session serveur.
    const resultat = await envoyerMessage({
      conversationId: CONV_ID,
      contenu: 'Bonjour',
      senderId: 666,
      emetteurId: 666,
    } as unknown as PayloadEnvoi)

    expect(resultat).toEqual({ ok: false, erreur: 'inconnue' })
    expect(conversationFindFirst).not.toHaveBeenCalled()
    expect(messageCreate).not.toHaveBeenCalled()
  })
})

// ─── cas 2 — compte sans profil participant : le null deref devient refus ────

describe('cas 2 — profil participant absent : refus contrôlé, jamais de null deref', () => {
  it("aucune conversation dérivée : 'inconnue' IDENTIQUE à la conversation d'autrui", async () => {
    // V3/V4 : `$user->candidat->id` / `$user->entreprise->id` valait 500 pour
    // un compte sans profil. Ici les participants se DÉRIVENT de la
    // candidature : sans profil, la requête de participation rend `null` —
    // le même verdict que pour une conversation d'autrui (le `where` qui
    // distingue les deux cas est épinglé dans messagerie-dal.test.ts).
    base.conversation = null

    const sansProfil = await envoyerMessage({
      conversationId: CONV_ID,
      contenu: 'Bonjour',
    })

    // Le verdict du cas « conversation d'autrui » (même null simulé) :
    expect(sansProfil).toEqual({ ok: false, erreur: 'inconnue' })
    expect(messageCreate).not.toHaveBeenCalled()
    // Le refus vient de la lecture (aucun court-circuit de forme), et le
    // seau n'a pas été touché : un refus de droit ne paie jamais.
    expect(conversationFindFirst).toHaveBeenCalledTimes(1)
    expect(checkRateLimit).not.toHaveBeenCalled()
  })
})

// ─── cas 3 — liens de notification cassés : aucune écriture de notification ──

describe('cas 3 — liens de notification cassés : aucune écriture de notification', () => {
  it('envoi réussi sur un client SANS modèle notification : seul message.create est touché', async () => {
    // V5/V6/V12 : le legacy résolvait `$conversation->recruteur->user` puis
    // écrivait une Notification — lien cassé = 500, et le GET/POST créait du
    // déchet non borné. Ici le double n'expose AUCUN modèle notification : le
    // succès de l'envoi PRÈVE qu'aucune telle écriture n'est tentée (une
    // tentative lèverait une TypeError et ferait échouer ce test).
    const resultat = await envoyerMessage({
      conversationId: CONV_ID,
      contenu: 'Bonjour',
    })

    expect(resultat).toEqual({
      ok: true,
      message: {
        id: MESSAGE_ID,
        contenu: 'Bonjour',
        emetteurId: USER_ID,
        createdAt: MESSAGE_DATE.toISOString(),
      },
    })
    expect(messageCreate).toHaveBeenCalledTimes(1)
    // Les hooks M9 sont BRANCHÉS vers leur résolveur (stubbé ci-dessus) :
    // les événements partent en fire-and-forget — jamais d'écriture
    // notification INLINE depuis l'action.
  })
})

// ─── cas 4 — script/HTML neutralisé À l'écriture ─────────────────────────────

describe("cas 4 — script/HTML : neutralisé à l'écriture (l'affichage reste du texte brut)", () => {
  it('<script> complet : le contenu écrit ne porte ni balise ni chevron', async () => {
    // Le legacy stockait le HTML brut (les vues legacy l'affichaient via
    // l'échappement partiel de Blade) ; la matrice module exige la
    // neutralisation. `nettoyerMessage` RETIRE les balises : ce qui part en
    // base — et donc ce que l'interface affichera en texte brut — ne peut
    // pas contenir de balise, quel que soit le vecteur.
    const resultat = await envoyerMessage({
      conversationId: CONV_ID,
      contenu: "<script>alert('pwn')</script><img src=x onerror=alert(1)>",
    })

    expect(resultat.ok).toBe(true)
    expect(messageCreate).toHaveBeenCalledTimes(1)
    const contenuEcrit = messageCreate.mock.calls[0]?.[0].data.contenu
    expect(contenuEcrit).not.toContain('<')
    expect(contenuEcrit).not.toContain('>')
    expect(contenuEcrit).not.toContain('script')
    // Ce qui REVIENT côté client (affichage du fil) est exactement ce qui a
    // été nettoyé : aucune copie sale n'est réintroduite en bordure serveur.
    expect(resultat.ok && resultat.message.contenu).toBe(contenuEcrit)
  })
})

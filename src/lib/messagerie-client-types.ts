// ─── Types purs partagés serveur → client (M8, Vague 2) ──────────────────────
//
// Pourquoi un module DÉDIÉ sans `import 'server-only'` : c'est le SEUL fichier
// de messagerie importable depuis un composant client (liste de
// conversations, fil de messages). Il ne contient que des `interface` —
// zéro runtime, zéro import Prisma, zéro fonction : rien qui puisse fuir à
// travers la frontière server → client, seulement la forme des données que
// les actions serveur acceptent déjà de rendre.
//
// Pourquoi `createdAt: string` (ISO-8601) et non `Date` : une Server Action
// serialize ses retours par le protocole Next ; une `Date` qui traverse la
// frontière doit être sérialisée de façon EXPLICITE et TESTÉE au bord du
// serveur (`.toISOString()` dans les actions, asserté dans
// src/app/actions/messagerie.test.ts). Côté client, la comparaison
// chronologique d'un curseur de pagination sur une string ISO est lisible et
// sûre (même fuseau = offset Z imposé par toISOString), alors qu'un objet
// Date reconstitué de travers ou une string opaque rendraient le tri et le
// « plus ancien que » dépendants du navigateur.
// ---------------------------------------------------------------------------

/** Message prêt pour le client : dates sérialisées en ISO (server → client). */
export interface MessageAffiche {
  id: number
  contenu: string
  emetteurId: number
  createdAt: string
}

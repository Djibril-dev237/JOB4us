// Stub neutre du paquet `server-only` pour les tests Vitest (environnement
// Node, hors compilateur React serveur) : le vrai paquet lève une erreur
// dès son import ; seul son effet de bord « interdit en client » nous
// intéresse en production, pas en test.
export {}

# Recette finale et passation - M10

Date : 4 novembre 2026
Périmètre : administration et modération Job4Us (M10)
Statut : recette technique terminée, réserve PHP documentée

## 1. Objectif

M10 livre les écrans et les actions d'administration : utilisateurs, offres,
signalements, statistiques et journal d'audit. Le module réutilise les règles
d'accès de M1, les signalements de M8 et les notifications de M9. Aucune
fonction métier hors administration n'a été ajoutée.

Principes appliqués :

- un seul rôle `admin`, sans super-administrateur ;
- aucun compte admin créé ou promu depuis l'interface ;
- 404 strict pour les invités et les non-admins, côté proxy et côté serveur ;
- aucune suppression physique depuis l'interface admin ;
- aucune lecture de contenu privé sans signalement, motif et audit ;
- journal d'audit append-only ;
- métriques issues uniquement de requêtes réelles.

## 2. Environnement requis

- Node.js 24 ou version compatible avec le type stripping utilisé par la CLI.
- npm et les dépendances de `package.json`.
- MySQL 8 accessible par `DATABASE_URL`.
- Un bucket R2 privé pour les CV, avatars et logos.
- Les variables de `.env` suivantes :

```text
DATABASE_URL
NEXT_PUBLIC_APP_URL
AUTH_SECRET
ADMIN_2FA_KEY
R2_ENDPOINT
R2_BUCKET
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

`ADMIN_2FA_KEY` doit être une clé AES-256-GCM de 32 octets encodée en base64.
`AUTH_SECRET` signe les sessions et les grants courts. Ces valeurs ne doivent
jamais être commitées ni exposées au client.

## 3. Installation et vérifications

```bash
npm ci
npx prisma migrate deploy
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
npm start
```

`npm run dev` reste disponible pour le développement local.

## 4. Résultats de la recette

### 4.1 Compilation, typage et lint

| Contrôle | Résultat |
| --- | --- |
| `npx tsc --noEmit` | succès, aucune erreur |
| `npm run lint` | succès, aucune erreur ni avertissement |
| `npm run build` | succès, 35 pages générées, routes admin présentes |
| `npx vitest run` | 79 fichiers, 1293 tests réussis |

`legacy_laravel/**` est exclu du lint Next.js : ce dépôt PHP historique a son
propre outillage et son vendor. Cette exclusion ne concerne pas le code livré.

### 4.2 Rejeu ciblé des matrices de sécurité

Commande exécutée :

```bash
npx vitest run \
  src/app/api/files/cv/route.securite.test.ts \
  src/app/api/files/cv/route.test.ts \
  src/app/api/files/avatar/route.test.ts \
  src/app/api/files/logo/route.test.ts \
  src/lib/admin-utilisateurs-dal.test.ts \
  src/app/actions/profile.test.ts \
  src/app/actions/offres.test.ts \
  src/lib/admin-gestion-schemas.test.ts \
  src/lib/admin-schemas.test.ts \
  src/app/actions/candidatures.securite.test.ts \
  src/app/actions/messagerie.securite.test.ts \
  src/proxy.test.ts \
  'src/app/(app)/admin/securite-m10.test.ts' \
  src/app/actions/admin-auth.test.ts \
  src/app/actions/admin-utilisateurs.test.ts \
  src/app/actions/offres-admin.test.ts \
  src/app/actions/admin-messagerie.test.ts \
  src/lib/admin-statistiques.test.ts \
  src/lib/journal-audit.test.ts \
  src/lib/csv-audit.test.ts \
  src/lib/audit-url.test.ts
```

Résultat : 21 fichiers, 312 tests réussis.

Couverture des points demandés :

- exposition CV/PII : routes fichiers, scoping candidat/recruteur, refus admin
  des CV et avatars, logo limité au contournement métier prévu ;
- mass assignment : profils, offres, schémas admin stricts, clés inconnues
  refusées, rôle et identifiants non modifiables ;
- matrice messagerie 500 : rôle x action, destinataires incomplets, profils
  absents, conversations et permissions ;
- matrice de routes : toutes les routes admin renvoient 404 à un invité ;
- réauthentification, dernier admin actif, suspension immédiate ;
- audit append-only, export CSV protégé contre l'injection de formules ;
- égalité des statistiques avec les requêtes de base.

### 4.3 Routes admin et 404

Vérification manuelle des routes suivantes sans session admin :

```text
/admin/dashboard
/admin/utilisateurs
/admin/utilisateurs/1
/admin/offres
/admin/signalements
/admin/signalements/1
/admin/statistiques
/admin/audit
/admin/audit/export
/admin/reauth
```

Résultat : `404` pour les dix routes. Le contrôle est aussi verrouillé par
`src/proxy.test.ts` et `src/app/(app)/admin/securite-m10.test.ts`.

### 4.4 En-têtes, cookies et secrets

En-têtes vérifiés sur une réponse de production :

```text
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

HSTS n'est émis qu'en production, jamais sur le HTTP local. Les cookies de
challenge, de réauthentification et de consultation privée sont `httpOnly`,
`SameSite=Lax` et `Secure` en production. Les grants expirent après 5 minutes.

Recherche de secrets dans le bundle client : aucun des noms
`AUTH_SECRET`, `ADMIN_2FA_KEY`, `DATABASE_URL`, `R2_SECRET_ACCESS_KEY`,
`RESEND_API_KEY` ou `CRON_SECRET` n'apparaît dans `.next/static`.
`.env` est ignoré par Git.

### 4.5 Base de données et migrations

`npx prisma migrate status` indique 12 migrations et
`Database schema is up to date!`.

Triggers append-only vérifiés en base :

- `journal_audit_avant_update` et `journal_audit_avant_delete` ;
- `message_moderation_avant_update` et `message_moderation_avant_delete` ;
- `audit_candidatures_avant_update` et `audit_candidatures_avant_delete` ;
- `audit_conversations_avant_update` et `audit_conversations_avant_delete` ;
- `acces_fichiers_avant_update` et `acces_fichiers_avant_delete`.

La vue `vue_journal_audit` existe et agrège le journal générique et les
journaux M7/M8 en lecture seule.

### 4.6 Responsive 360 / 768 / 1280

Contrôle Edge headless via CDP, avec émulation de largeur réelle, sur huit
écrans : tableau de bord, utilisateurs, détail utilisateur, offres,
signalements, statistiques, audit et réauthentification.

Résultat : 24 mesures, `innerWidth` conforme à la largeur demandée,
`scrollWidth <= innerWidth`, aucun débordement horizontal, `main` visible et
de hauteur non nulle sur les trois largeurs.

### 4.7 Lighthouse

Lighthouse intégré exécuté sur les six écrans admin principaux :

| Écran | Accessibilité | Bonnes pratiques | SEO |
| --- | --- | --- | --- |
| Tableau de bord | 1.0 | 1.0 | 1.0 |
| Utilisateurs | 1.0 | 1.0 | 1.0 |
| Offres | 1.0 | 1.0 | 1.0 |
| Signalements | 1.0 | 1.0 | 1.0 |
| Statistiques | 1.0 | 1.0 | 1.0 |
| Audit | 1.0 | 1.0 | 1.0 |

Aucun échec d'accessibilité, de bonnes pratiques ou de SEO. L'outil navigateur
disponible ne fournit ni score de performance ni émulation mobile Lighthouse.
La vérification mobile a donc été faite séparément via Edge CDP aux largeurs
360, 768 et 1280.

### 4.8 Correction de recette : chargement global

Le fichier `src/app/loading.tsx` a été retiré. Avec Next.js 16.3.6, ce boundary
global laissait le contenu admin dans un `div` masqué et le `main` à une taille
0 x 0, alors que le HTML était bien rendu. La suppression rétablit
l'hydratation, le `main` visible et les audits Lighthouse sans échec.

### 4.9 Migration et rollback PHP legacy

La migration et le rollback PHP n'ont pas pu être exécutés sur ce poste.
Commande tentée :

```powershell
& 'C:\xampp\php\php.exe' legacy_laravel/artisan migrate:status --no-interaction
```

Échec bloquant de Windows Defender :

```text
Le programme « php.exe » n'a pas pu s'exécuter : Impossible de terminer
l'opération, car le fichier contient un virus ou un logiciel potentiellement
indésirable.
```

Docker et WSL ne sont pas disponibles. Ce point doit être rejoué sur un poste
autorisé avant de déclarer la migration PHP validée. Le périmètre Next.js,
Prisma et MySQL est, lui, vérifié.

## 5. Procédures d'administration

### 5.1 Créer une invitation admin

```bash
npm run admin -- invite --email admin@exemple.cm --name "Admin Exemple"
```

La commande crée un compte admin inactif et affiche une URL d'activation
valable 24 heures. Le jeton n'est affiché qu'une fois et seul son hash est
stocké. Un email déjà utilisé par un candidat ou un recruteur est refusé.

Pour un admin existant qui n'a pas encore de TOTP :

```bash
npm run admin -- reprise --email admin@exemple.cm
```

### 5.2 Activer un compte

Ouvrir `/activation-admin/<jeton>`, définir un mot de passe d'au moins 12
caractères avec minuscule, majuscule et chiffre, puis enregistrer le secret
TOTP dans une application d'authentification. Les 10 codes de récupération
sont affichés une seule fois et doivent être conservés hors ligne.

### 5.3 Se connecter

1. Aller sur `/login`.
2. Saisir l'email et le mot de passe admin.
3. Le compte admin est redirigé vers `/login/2fa`.
4. Saisir le code TOTP à 6 chiffres ou un code de récupération.

Le fournisseur de credentials normal refuse les admins : le second facteur ne
peut pas être contourné par un POST direct.

### 5.4 Réauthentification

Les actions sensibles exigent un grant de 5 minutes. Utiliser
`/admin/reauth` avant une suspension, une réactivation, une décision de
signalement ou un export d'audit. Un grant expiré impose de recommencer.

### 5.5 Modération d'un signalement

1. Ouvrir `/admin/signalements`.
2. Ouvrir le détail du signalement.
3. Choisir un motif d'accès et se réauthentifier.
4. Lire le contexte limité à 30 messages, en lecture seule.
5. Choisir une décision : `sans_suite`, `avertissement`, `masquage` ou
   `suspension`.
6. Renseigner un motif et, éventuellement, une note interne.

La décision `suspension` masque aussi le message signalé. Le masquage est
append-only : `Message` reste immuable et `MessageModeration` porte la décision.
Les participants voient un texte neutre. Le rétablissement est une action
séparée, elle aussi auditée.

### 5.6 Suspendre ou réactiver un compte

Depuis `/admin/utilisateurs/<id>`, choisir un motif fermé et, si besoin, une
note interne. La suspension passe `isActive` à `false`, incrémente
`sessionVersion` et invalide la session en cours. Un compte admin ou anonymisé
est refusé. La réactivation est elle aussi auditée.

### 5.7 Consulter et exporter l'audit

`/admin/audit` affiche le journal fusionné, filtrable par source, action,
cible, motif et date. L'export CSV est une route séparée, protégée et auditée.
Les cellules commençant par un caractère de formule sont neutralisées.

### 5.8 Suppression et anonymisation

Aucun bouton de suppression physique n'existe dans l'interface admin. Les
comptes peuvent être suspendus, jamais supprimés depuis l'UI. La procédure
d'anonymisation par CLI n'est pas livrée dans cette vague : elle doit être
ajoutée avant une mise en production qui exigerait l'effacement des données
personnelles. Le champ `anonymizedAt` et les gardes de lecture sont déjà en
place pour l'accueillir.

## 6. Exploitation

### 6.1 Démarrage

```bash
npx prisma migrate deploy
npm run build
npm start
```

Le serveur écoute sur `3000` par défaut. `NEXT_PUBLIC_APP_URL` doit correspondre
au domaine public réel, sans barre oblique finale.

### 6.2 Migrations

Utiliser `npx prisma migrate deploy` en production. Ne jamais lancer
`prisma migrate reset` sur une base contenant des données. Sur ce poste,
`prisma migrate dev` est inutilisable car la migration M7 déjà appliquée est
détectée comme modifiée ; `migrate deploy` fonctionne.

### 6.3 Tâche planifiée des notifications

La route `/api/cron/notifications` doit être appelée par le planificateur avec
le secret `CRON_SECRET`. Elle envoie les emails de notification selon les
préférences des comptes.

### 6.4 Fichiers privés

Les CV, avatars et logos sont dans un bucket R2 strictement privé. Les
téléchargements passent par `/api/files/*`, après contrôle d'accès et signature
d'une URL de 5 minutes. Aucune URL publique permanente ne doit être créée.

### 6.5 Limite de débit

Le store de rate limiting est en mémoire et monoprocessus. Une production
multi-instances doit utiliser un store partagé (Redis ou équivalent) pour
conserver la limitation entre les processus.

## 7. Rollback

Avant toute opération, sauvegarder la base et le bucket. Le rollback applicatif
consiste à redéployer le commit M9 `e26bcb0`, mais les migrations M10 doivent
être traitées séparément.

Option recommandée : restaurer une sauvegarde prise avant M10 dans une fenêtre
de maintenance. Cela restaure le schéma et les données, mais annule aussi les
audits M10 écrits depuis la sauvegarde.

Option manuelle, si la conservation des audits est exigée :

1. arrêter l'application ;
2. sauvegarder `journal_audit`, `message_moderation` et les journaux M7/M8 ;
3. supprimer la vue et les triggers M10 ;
4. retirer les colonnes et tables M10 dans l'ordre inverse des migrations ;
5. marquer les migrations M10 comme annulées avec `prisma migrate resolve`
   après vérification ;
6. redéployer le commit M9 ;
7. rejouer les tests de sécurité et vérifier les 404 admin.

Ne jamais supprimer le journal d'audit sans sauvegarde. Ne jamais exécuter de
rollback PHP ou Prisma sur une base de production sans sauvegarde vérifiée.

## 8. Passation

### 8.1 État du dépôt

Les commits M10 sont locaux et non poussés. La vague 5 ajoute la recette, les
en-têtes de sécurité, la correction du chargement global et la déduplication
des motifs d'audit.

Chaîne récente :

```text
e26bcb0  M9
9d80858  M10 0.1
910d775  M10 0.2
f148c7f  M10 0.3
c023646  M10 0.4
af55d77  M10 0.5
add9a9a  M10 vague 1
e3ee00c  M10 vague 2
e73ebaa  M10 vague 3
4a99e4f  M10 vague 4
```

### 8.2 Points à transmettre

- Les secrets sont dans le coffre de l'équipe, pas dans le dépôt.
- Les comptes admin sont créés uniquement par la CLI.
- Le dernier admin actif est protégé structurellement : aucun admin ne peut
  être suspendu depuis l'interface.
- Toute action sensible laisse une trace dans `journal_audit`.
- Les métriques du tableau de bord et des statistiques sont des requêtes
  réelles, sans valeur simulée.
- Le contrôle PHP legacy reste à rejouer sur un poste autorisé.
- La performance Lighthouse mobile et la CLI d'anonymisation restent des
  réserves explicites.

## 9. Réserves connues

1. PHP legacy bloqué par Windows Defender sur ce poste.
2. `prisma migrate dev` inutilisable à cause de la migration M7 modifiée ;
   utiliser `migrate deploy`.
3. Lighthouse navigateur sans score de performance ni émulation mobile.
4. Rate limiting en mémoire, non partagé entre instances.
5. Procédure CLI d'anonymisation non livrée.
6. `legacy_laravel` exclu du lint Next.js.

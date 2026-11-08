# Job4Us

[![CI](https://github.com/Djibril-dev237/JOB4us/actions/workflows/ci.yml/badge.svg)](https://github.com/Djibril-dev237/JOB4us/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Plateforme d'emploi pour le Cameroun : offres, candidatures, messagerie,
notifications et administration. L'application est construite avec Next.js App
Router, Prisma et MySQL.

## Stack

- Next.js 16.3.6 et React 19
- TypeScript strict
- Prisma 6 et MySQL 8
- Auth.js v5 avec contrôle d'accès par rôle
- Double authentification TOTP pour les administrateurs
- Tailwind CSS v4 et tokens de design M2
- Cloudflare R2 pour les fichiers privés (CV, avatars, logos)
- Vitest pour les tests

## Périmètre fonctionnel

Le dépôt couvre les modules M0 à M10 :

- socle technique, design et authentification ;
- profils candidat et entreprise ;
- fichiers privés et journal d'accès ;
- consultation publique des offres ;
- espace recruteur et gestion des offres ;
- candidatures et cycle de vie ;
- messagerie, signalements et blocage ;
- notifications et préférences ;
- administration et modération M10.

Le détail de la recette, des procédures d'administration et des réserves de
livraison se trouve dans [`RECETTE-M10.md`](./RECETTE-M10.md).

## Prérequis

- Node.js 24 recommandé, notamment pour la CLI admin qui utilise le type
  stripping natif.
- npm.
- MySQL 8 accessible par `DATABASE_URL`.
- Un bucket Cloudflare R2 privé pour les fichiers.
- Facultatif : une clé Resend pour les emails de notification.

## Installation

```bash
npm ci
cp .env.example .env
npx prisma migrate deploy
npm run dev
```

L'application démarre sur `http://localhost:3000`.

En production :

```bash
npx prisma migrate deploy
npm run build
npm start
```

Ne jamais lancer `prisma migrate reset` sur une base contenant des données.

## Variables d'environnement

Les variables attendues sont documentées dans `.env.example` :

```text
DATABASE_URL
NEXT_PUBLIC_APP_URL
AUTH_SECRET
ADMIN_2FA_KEY
R2_ENDPOINT
R2_BUCKET
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
RESEND_API_KEY
EMAIL_FROM
CRON_SECRET
```

`AUTH_SECRET`, `ADMIN_2FA_KEY` et `CRON_SECRET` se génèrent avec
`openssl rand -base64 32`. `ADMIN_2FA_KEY` doit décoder exactement 32 octets.
Aucun secret ne doit être commité.

## Commandes utiles

```bash
npm run dev          # serveur de développement
npm run build        # build de production
npm start            # serveur de production
npm run lint         # ESLint
npm test             # suite Vitest
npx tsc --noEmit     # vérification TypeScript
```

## Administration

Les comptes admin ne sont jamais créés ni promus depuis l'interface. Une
invitation est émise par la CLI :

```bash
npm run admin -- invite --email admin@exemple.cm --name "Admin Exemple"
```

Le jeton d'activation est affiché une seule fois et expire après 24 heures.
L'activation se fait sur `/activation-admin/<jeton>`, avec mot de passe et
enregistrement du secret TOTP. La connexion admin passe ensuite par `/login`
puis `/login/2fa`.

Les actions sensibles exigent une réauthentification de 5 minutes via
`/admin/reauth`. Les détails des parcours de modération, de suspension et
d'export d'audit sont dans [`RECETTE-M10.md`](./RECETTE-M10.md).

## Structure

```text
src/app/          routes et écrans Next.js
src/app/actions/  Server Actions
src/lib/          accès base, règles métier, sécurité et libellés
prisma/           schéma et migrations
scripts/          CLI admin et migration des fichiers legacy
```

## Tests et qualité

La suite couvre les matrices d'accès, les fichiers privés, les candidatures,
la messagerie, les notifications et l'administration M10.

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

## Sécurité

Les vulnérabilités doivent être signalées en privé via GitHub Security
Advisories. Ne pas ouvrir d'issue publique contenant un secret, un mot de passe
ou une donnée personnelle.

La politique complète est dans [`SECURITY.md`](./SECURITY.md).

## Licence

Ce projet est distribué sous licence MIT. Voir [`LICENSE`](./LICENSE).

## Fichiers locaux

`AGENTS.md` est généré localement par `next dev` et ignoré par Git. Il ne fait
pas partie du code livré.

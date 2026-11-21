# Déploiement Vercel

Ce guide prépare une démo publique sur Vercel avec une base MySQL 8 managée.
Il ne contient aucun secret : les valeurs réelles doivent être saisies dans
Vercel ou dans un fichier local ignoré par Git.

## 1. Base de données

1. Créer une base MySQL 8 chez un hébergeur managé (Railway, Aiven, Clever
   Cloud, etc.).
2. Récupérer l'URL de connexion complète.
3. Depuis un poste disposant du dépôt et de l'URL de production :

```bash
DATABASE_URL="mysql://user:password@host:3306/job4us" npx prisma migrate deploy
```

Ne jamais lancer `prisma migrate reset` sur cette base.

Pour un hébergement serverless, ajouter si possible une limite de connexions
au paramètre `DATABASE_URL`, par exemple `?connection_limit=5`.

## 2. Projet Vercel

1. Importer le dépôt `Djibril-dev237/JOB4us` dans Vercel.
2. Garder le preset **Next.js**.
3. Utiliser Node.js 24.
4. Laisser la commande d'installation par défaut (`npm ci`) et la commande de
   build par défaut (`npm run build`).

## 3. Variables d'environnement

Configurer au minimum :

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

Variables optionnelles selon les fonctionnalités activées :

```text
RESEND_API_KEY
EMAIL_FROM
CRON_SECRET
```

Générer les secrets avec :

```bash
openssl rand -base64 32
```

`NEXT_PUBLIC_APP_URL` doit être le domaine Vercel final, sans barre oblique
finale. Après le premier déploiement, mettre à jour cette variable avec l'URL
de production puis redéployer.

## 4. Premier admin

Créer ou promouvoir un administrateur avec la CLI prévue :

```bash
npm run admin
```

La commande doit être lancée avec le `DATABASE_URL` de production et les mêmes
`ADMIN_2FA_KEY` que Vercel. Ne pas réutiliser le compte de test local.

## 5. Vérifications après déploiement

- `/` et `/offres` répondent en 200.
- `/login` permet une connexion candidat ou recruteur.
- `/admin/dashboard` renvoie 404 pour un visiteur non admin.
- La connexion admin demande le TOTP.
- Un fichier privé n'est accessible que par sa route autorisée.
- Les en-têtes de sécurité sont présents en production.
- Le cron `/api/cron/notifications` répond 503 sans `CRON_SECRET`, puis 200
  avec le secret.

## 6. Limites à garder en tête

- Le rate limiting est en mémoire et monoprocessus. Une démo à une seule
  instance convient ; une production multi-instances doit utiliser un store
  partagé (Redis ou équivalent).
- Une base MySQL managée doit être accessible depuis Vercel. Vérifier les
  règles réseau et le pool de connexions.
- Les emails ne partent que si `RESEND_API_KEY` et `EMAIL_FROM` sont valides.
- Les fichiers ne fonctionnent que si le bucket R2 est privé et les clés
  limitées au strict nécessaire.

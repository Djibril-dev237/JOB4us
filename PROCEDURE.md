# JOB4Us - Procédure de conversion Laravel → Next.js

## Projet source
- **Source**: `C:\Users\paule\OneDrive\Desktop\emploi-app` (Laravel 10, PHP 8.1, MySQL)
- **Cible**: `C:\Users\paule\OneDrive\Desktop\JOB4Us` (Next.js 16, TypeScript, Prisma)
- **Date**: 16 septembre 2026

## Stack cible (Backend Pro)

| Couche | Technologie | Équivalence Laravel |
|--------|-------------|---------------------|
| Framework | Next.js 16 App Router | Laravel 10 |
| Langage | TypeScript | PHP 8.1 |
| UI | Tailwind CSS 4 | Bootstrap 5.2 |
| ORM | Prisma 6.8 | Eloquent |
| BDD | MySQL (job4us) | MySQL (emploi_app) |
| Auth | Auth.js (NextAuth) | laravel/ui |
| Validation | Zod | FormRequest |
| Fichiers | UploadThing / public/uploads | storage/app |

## BDD - 16 tables migrées
`users`, `candidats`, `entreprises`, `categories`, `competences`, `offres`, `experiences`, `formations`, `candidat_competences`, `offre_competences`, `candidatures`, `conversations`, `messages`, `notifications`, `offres_sauvegardees`

Fichier: `prisma/schema.prisma`
- Enums: Role, Genre, Disponibilite, TypeContrat, NiveauExperience, StatutCandidature, NiveauCompetence
- Relations conservées 1:1, 1:N, N:N

## Étapes réalisées

### 1. Scaffold Next.js
```bash
npx create-next-app@latest job4us-temp --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm
mv job4us-temp/* JOB4Us/
npm install
```

### 2. Prisma
```bash
npm install --save-dev prisma@6.8.2
npm install @prisma/client@6.8.2
# Création manuelle de prisma/schema.prisma (16 tables)
npx prisma generate
# Puis (quand MySQL prêt)
npx prisma db push
npx prisma studio
```

### 3. Backend Pro (Next.js Fullstack - pas de backend séparé)
- `src/lib/prisma.ts` - singleton client
- `src/app/api/offres/route.ts` - API GET/POST (équivalent OffreController)
- `src/app/offres/page.tsx` - liste offres (Server Component)
- `src/lib/auth.ts` - helpers rôle (hasRole)
- `src/middleware.ts` - protection routes /candidat /recruteur /admin

### 4. Configuration
- `.env` - DATABASE_URL + NEXTAUTH_SECRET
- `package.json` scripts: db:generate, db:push, db:studio

## Commandes

```bash
cd JOB4Us
npm run dev          # http://localhost:3000
npx prisma db push   # créer tables
npx prisma studio    # http://localhost:5555
npm run build        # vérifie tout compile
```

## Si pas de MySQL
Dans `prisma/schema.prisma`: `provider = "sqlite"`
Dans `.env`: `DATABASE_URL="file:./dev.db"`

## Prochaines étapes
- [ ] Installer Auth.js: `npm install next-auth@4 bcryptjs`
- [ ] Seed données: `prisma/seed.ts`
- [ ] Importer BDD emploi_app existante
- [ ] Dashboard candidat/recruteur/admin

## Notes Prisma (pour dev Laravel)
```ts
// Laravel: Offre::where('is_active', true)->with('entreprise')->get()
// Prisma:  prisma.offre.findMany({ where: { isActive: true }, include: { entreprise: true } })

// Laravel: Candidature::where('statut','retenue')->count()
// Prisma:  prisma.candidature.count({ where: { statut: 'retenue' } })
```

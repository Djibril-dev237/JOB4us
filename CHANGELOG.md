# Changelog

Toutes les évolutions notables de Job4Us sont documentées ici.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Le projet utilise le versionnage sémantique.

## [1.0.0] - 2026-11-21

Première version complète du projet, couvrant les modules M0 à M10.

### Ajouté

- Socle Next.js 16, TypeScript strict, Prisma, MySQL et Tailwind CSS v4.
- Design system M2 avec tokens de couleur, composants de base et responsive
  360 / 768 / 1280.
- Authentification Auth.js v5, inscription, connexion, déconnexion et contrôle
  d'accès par rôle.
- Profils candidat et entreprise avec champs whitelistés.
- Téléversement sécurisé des CV, avatars et logos vers un bucket R2 privé.
- Téléchargement des fichiers par URL signée de 5 minutes et journal d'accès.
- Consultation publique des offres : recherche, filtres, pagination, fiche,
  SEO et sitemap.
- Espace recruteur : création, édition, publication et suspension des offres.
- Candidatures avec cycle de vie, snapshot du CV et suivi recruteur.
- Messagerie par candidature, signalements, blocage et temps réel.
- Notifications transactionnelles, préférences, digest, désabonnement et
  outbox Resend.
- Administration M10 : tableau de bord, utilisateurs, offres, signalements,
  statistiques et journal d'audit.
- Connexion admin en deux étapes avec TOTP, codes de récupération et
  réauthentification de 5 minutes.
- Modération des signalements avec motif obligatoire, contexte limité à
  30 messages et décisions `sans_suite`, `avertissement`, `masquage` ou
  `suspension`.
- Masquage append-only via `MessageModeration`, sans modification de
  `Message`.
- Suspension et réactivation des comptes avec invalidation immédiate des
  sessions par `sessionVersion`.
- Export CSV du journal d'audit, protégé contre l'injection de formules et
  soumis à réauthentification.

### Sécurité

- 404 strict pour les invités et non-admins sur toutes les routes admin.
- `requireAdmin()` vérifie la session en base avant chaque page et action.
- Dernier admin actif protégé structurellement : aucun admin ne peut être
  suspendu depuis l'interface.
- Aucune suppression physique depuis l'interface admin.
- Journal d'audit append-only avec triggers SQL.
- En-têtes de sécurité : `nosniff`, `DENY`, `Referrer-Policy`,
  `Permissions-Policy` et HSTS en production.
- Fichiers privés uniquement accessibles par les routes contrôlées.
- CI GitHub Actions avec migrations, lint, typegen, TypeScript, tests et build.

### Qualité

- 80 fichiers de tests et 1 299 tests réussis.
- `npx tsc --noEmit`, `npm run lint` et `npm run build` verts.
- Recette M10 et passation documentées dans `RECETTE-M10.md`.
- Politique de sécurité dans `SECURITY.md`.

### Limites connues

- La migration et le rollback PHP legacy restent à rejouer sur un poste
  autorisé.
- La CLI d'anonymisation des données personnelles n'est pas livrée.
- Le rate limiting est en mémoire et monoprocessus.
- Lighthouse navigateur ne fournit pas de score de performance ni d'émulation
  mobile.

[1.0.0]: https://github.com/Djibril-dev237/JOB4us/releases/tag/v1.0.0

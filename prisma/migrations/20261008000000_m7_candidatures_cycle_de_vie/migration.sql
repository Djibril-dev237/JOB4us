-- M7 / étape 2 validée — cycle de vie des candidatures : 7 statuts,
-- journal d'audit, index de listes
--
-- Généré via `prisma migrate diff --from-url … --to-schema-datamodel`
-- (migrate dev refuse les environnements non interactifs, comme en M5/M6),
-- puis CORRIGÉ et réordonné à la main — trois écarts au diff brut :
--  1. le diff ne détecte PAS le changement de définition de l'index
--     `candidatures_candidat_id_fkey` (même nom, clé passée de
--     (`candidat_id`) à (`candidat_id`, `created_at`)) : DROP + CREATE
--     explicites ci-dessous ;
--  1bis. MySQL 8 refuse ce DROP tant que l'index supporte la FK homonyme
--     (erreur 1553 rencontrée en exécution) : séquence détachement FK →
--     drop index → index composite → reconnexion FK, avec la définition
--     relevée par `SHOW CREATE TABLE` ;
--  2. le diff propose un seul ALTER sur l'ENUM `statut`, ce qui invalide
--     les lignes encore stockées en 'vue'/'retenue' (mode strict MySQL) :
--     passage intermédiaire par l'UNION des anciennes et nouvelles valeurs,
--     backfill, puis ENUM final à 7 valeurs.
--
-- Ce que change cette migration :
--  1. `statut` ENUM 5 → 7 valeurs : 'vue' → 'consultee', 'retenue' →
--     'preselectionnee' (terminologie de l'étape 2 validée) ; `acceptee`
--     et `retiree` sont NOUVEAUX — `retiree` remplace la suppression
--     physique du legacy (diagnostic étape 1 #11) pour que
--     « l'historique M7 doit survivre » (schema.prisma, Offre.deletedAt) ;
--  2. table `audit_candidatures` : append-only, SANS clé étrangère
--     (même doctrine que `acces_fichiers` — la trace survit aux
--     suppressions de comptes et de lignes) ;
--  3. index de liste candidat composite + index des filtres recruteur.
--
-- Base de dev au moment de l'écriture : 0 candidature (comptage vérifié),
-- le backfill ne touche donc aucune ligne ici ; il est conservé pour un
-- état de production hérité du legacy PHP.

-- DropIndex — l'index en place ne couvre plus le tri de la liste
-- (`ORDER BY created_at DESC` sur les 15 lignes paginées du candidat).
-- MySQL 8 refuse le DROP tant que l'index supporte une clé étrangère
-- (erreur 1553, rencontrée et récupérée pendant l'écriture) : on détache
-- d'abord la FK homonyme, on lève l'index, on le recrée en composite et
-- on remonte la FK. La définition réinjectée reprend le DDL relevé sur la
-- base (`SHOW CREATE TABLE`) : ON DELETE CASCADE ON UPDATE CASCADE.
ALTER TABLE `candidatures` DROP FOREIGN KEY `candidatures_candidat_id_fkey`;
DROP INDEX `candidatures_candidat_id_fkey` ON `candidatures`;
-- Recréé en composite : la colonne de tête `candidat_id` reste présente,
-- donc la FK conserve son index de référence ; `created_at` en deuxième
-- supprime le filesort de la liste paginée du candidat (ORDER BY
-- created_at DESC, 15 par page).
CREATE INDEX `candidatures_candidat_id_fkey` ON `candidatures`(`candidat_id`, `created_at`);
ALTER TABLE `candidatures`
    ADD CONSTRAINT `candidatures_candidat_id_fkey` FOREIGN KEY (`candidat_id`) REFERENCES `candidats` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable — étape 1/3 : UNION anciennes + nouvelles valeurs, afin
-- qu'aucune ligne 'vue'/'retenue' ne soit rejetée en mode strict.
ALTER TABLE `candidatures`
    MODIFY `statut` ENUM('envoyee', 'vue', 'consultee', 'retenue', 'preselectionnee', 'entretien', 'acceptee', 'refusee', 'retiree') NOT NULL DEFAULT 'envoyee';

-- Backfill — étape 2/3 : bascule des libellés legacy sur la terminologie
-- validée en étape 2 (sémantique identique : 'vue' = consultée,
-- 'retenue' = présélectionnée). Les valeurs inchangées ne sont pas
-- touchées ; aucune ligne ne reçoit un statut non dérivé de l'ancien.
UPDATE `candidatures` SET `statut` = 'consultee'    WHERE `statut` = 'vue';
UPDATE `candidatures` SET `statut` = 'preselectionnee' WHERE `statut` = 'retenue';

-- AlterTable — étape 3/3 : ENUM final à 7 valeurs (liste unique de
-- vérité, identique à l'enum Prisma StatutCandidature). Les transitions
-- entre ces valeurs ne sont PAS couvertes par la base (l'ENUM ne prouve
-- qu'une appartenance) : elles sont contrôlées côté serveur dans
-- src/lib/candidatures-labels.ts, testées exhaustivement.
ALTER TABLE `candidatures`
    MODIFY `statut` ENUM('envoyee', 'consultee', 'preselectionnee', 'entretien', 'acceptee', 'refusee', 'retiree') NOT NULL DEFAULT 'envoyee';

-- CreateTable — journal d'audit des transitions (tâche 11) : qui, quelle
-- candidature, quelle action, quel ancien/nouveau statut, quand. Pas de
-- clé étrangère et pas d'updatedAt, exactement comme `acces_fichiers`
-- (le commentaire du modèle en reprend la justification).
CREATE TABLE `audit_candidatures` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `candidature_id` INTEGER NOT NULL,
    `acteur_id` INTEGER NOT NULL,
    `action` VARCHAR(50) NOT NULL,
    `ancien_statut` VARCHAR(30) NULL,
    `nouveau_statut` VARCHAR(30) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_candidatures_candidature_id_idx`(`candidature_id`),
    INDEX `audit_candidatures_acteur_id_idx`(`acteur_id`),
    INDEX `audit_candidatures_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex — requête canonique de la vue recruteur (DAL) :
--   WHERE offre_id = ? [AND statut = ?] ORDER BY created_at DESC
-- Composition :
--  * `offre_id` en tête : déjà la tête de l'unique (offre_id, candidat_id),
--    mais celle-ci ne porte pas `statut` ;
--  * `statut` en deuxième : égalité très sélective sur le filtre de la
--    liste recruteur ('envoyee' domine, puis se restreint) ;
--  * `created_at` en troisième : tri de la liste sans filesort.
CREATE INDEX `candidatures_offre_statut_idx` ON `candidatures`(`offre_id`, `statut`, `created_at`);

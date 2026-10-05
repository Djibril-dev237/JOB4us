-- M6 / étape 2 validée — cycle de vie des offres : statut + suppression logique
--
-- Généré via `prisma migrate diff --from-url … --to-schema-datamodel`
-- (migrate dev refuse les environnements non interactifs, comme en M5),
-- puis réordonné pour insérer le backfill ENTRE l'ajout de `statut` et la
-- suppression de `is_active`, et appliqué par `prisma migrate deploy`.
--
-- Ce que change cette migration :
--  1. `statut` ENUM('brouillon','publiee','cloturee','suspendue') remplace
--     le booléen `is_active` qui fusionnait à tort brouillon et suspension
--     (commentaire offres-public.ts : « distinguer les deux demandera un
--     enum en M6 ») ;
--  2. `deleted_at` : suppression LOGIQUE — `candidatures.offre_id` est en
--     ON DELETE CASCADE (0_init) : un delete physique détruirait
--     l'historique des candidatures M7 (diagnostic M6 #7, gravité élevée) ;
--  3. index de liste reconstruit sur `statut`.
--
-- « expirée » n'est PAS un statut : date_expiration dépassée est dérivée
-- à chaque lecture (aucun cron — étape 2), d'où AUCUNE ligne à basculer.

-- DropIndex (l'index en place référence la colonne `is_active` qui part)
DROP INDEX `offres_visibles_liste_idx` ON `offres`;

-- AlterTable — ajout des colonnes d'état AVANT tout drop (le backfill
-- ci-dessous en a besoin).
ALTER TABLE `offres`
    ADD COLUMN `deleted_at` DATETIME(3) NULL,
    ADD COLUMN `statut` ENUM('brouillon', 'publiee', 'cloturee', 'suspendue') NOT NULL DEFAULT 'brouillon';

-- Backfill : le DEFAULT 'brouillon' a déjà positionné toutes les lignes ;
-- on ne remonte que celles qui étaient publiées. En base de dev,
-- `is_active = false` ne servait QUE de brouillon : la suspension admin
-- n'a jamais existé comme fonctionnalité (diagnostic M6 #8 : aucun
-- processus de modération en Next), aucun cas ambigu à trancher.
-- L'offre #5 (expirée, is_active = true) reste `publiee` + expirée
-- dérivée : exactement le même 404 qu'avant — aucune variation de
-- visibilité après ce backfill (contrôlé sur les 6 offres de fixture).
-- `deleted_at` reste NULL partout : aucune suppression n'existait.
UPDATE `offres` SET `statut` = 'publiee' WHERE `is_active` = TRUE;

-- AlterTable — suppression de l'ancien booléen (source unique de vérité :
-- jamais deux colonnes d'état susceptibles de diverger).
ALTER TABLE `offres` DROP COLUMN `is_active`;

-- CreateIndex — index de la liste publique M5, reconstruit sur `statut`
-- Requête canonique (DAL src/lib/offres-public.ts) :
--   WHERE statut = 'publiee' AND deleted_at IS NULL
--     AND date_expiration >= <jour, Douala>
--   [AND ville LIKE … / type_contrat = … / …]
--   ORDER BY created_at DESC LIMIT 10 (OFFSET pagination)
-- Composition (mêmes raisonnements déjà validés en M5) :
--  * `statut` en tête : égalité très sélective — brouillons, clôturées et
--    suspendues écartés d'emblée (ex-« is_active en tête ») ;
--  * `created_at` en deuxième : le TRI est sur created_at DESC → parcours
--    inversé de l'index, pas de filesort, arrêt dès que le LIMIT couvert ;
--  * `date_expiration` en troisième : filtre en index condition pushdown
--    sans retour en table pour ce champ.
-- `deleted_at` est VOLONTAIREMENT absent de la clé : NULL sur ~toutes
-- les lignes (suppressions logiques rares) → le filtre résiduel ne coûte
-- rien, tandis que l'insérer ne changerait pas le plan (même préfixe
-- d'égalité) et alourdirait l'index. À re-si si les suppressions
-- devenaient majoritaires.
CREATE INDEX `offres_visibles_liste_idx` ON `offres`(`statut`, `created_at`, `date_expiration`);

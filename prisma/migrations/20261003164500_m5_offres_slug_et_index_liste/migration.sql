-- M5 / task 4 — slug d'URL publique + index de la liste publique
--
-- Généré via `prisma migrate diff --from-url … --to-schema-datamodel`
-- (migrate dev refusant les environnements non interactifs), augmenté du
-- backfill des slugs ci-dessous, appliqué par `prisma migrate deploy`.

-- AlterTable
-- slug : URL publique « titre-slug-<id> » (task 5). NULLABLE car la colonne
-- est ajoutée sur une table déjà peuplée : le backfill juste après la
-- remplit pour toutes les lignes existantes ; les prochaines offres (M6)
-- le renseignent à la création (src/lib/slug.ts). Le suffixe <id> rend le
-- slug unique même avec deux offres de même titre, et évite tout UPDATE de
-- masse si un titre est modifié.
ALTER TABLE `offres` ADD COLUMN `slug` VARCHAR(220) NULL;

-- CreateIndex
-- UNIQUE : lecture publique WHERE slug = ? (task 5), et protection des
-- collisions à l'écriture. Les NULL multiples sont autorisés (MySQL/MariaDB).
CREATE UNIQUE INDEX `offres_slug_key` ON `offres`(`slug`);

-- CreateIndex
-- ─── Index de la liste publique ──────────────────────────────────────────
-- Requête canonique (OffrePubliqueController@index legacy + DAL
-- lib/offres-public.ts) :
--   WHERE is_active = TRUE
--     AND date_expiration >= <jour, Douala>
--     [AND ville LIKE … / type_contrat = … / niveau_experience = …]
--   ORDER BY created_at DESC
--   LIMIT 10  (OFFSET pagination)
--
-- Composition et pourquoi dans cet ordre :
--  * is_active en tête : égalité très sélective (brouillons et suspensions
--    écartés d'emblée) ;
--  * created_at en deuxième : le TRI est sur created_at DESC → MySQL
--    parcourt l'index à l'envers : pas de filesort, et l'arrête dès que le
--    LIMIT est couvert ;
--  * date_expiration en troisième : rend le filtre d'expiration réalisable
--    en index condition pushdown (ICP) sans retour en table pour ce champ.
-- Variante (is_active, date_expiration, created_at) REJETÉE : une plage sur
-- le 2ᵉ attribut casse l'ordre du 3ᵉ → filesort systématique.
-- Vérification dev (MariaDB 10.4, table de 6 lignes) : EXPLAIN →
-- key=offres_visibles_liste_idx, « Using where; Using index », AUCUN
-- filesort. Le plan à volume réel reste à re-vérifier (base quasi vide).
--
-- Rejets documentés (tâche « index adaptés aux filtres et à la recherche ») :
--  * q = LIKE '%…%' sur titre + description (LONGTEXT) : non sargable en
--    B-tree. FULLTEXT rejetée pour DIVERGENCE DE SÉMANTIQUE : recherche par
--    mot entier + stop-words + seuil de pertinence, alors que le legacy
--    matche une sous-chaîne n'importe où (« dév » trouve « développeur ») —
--    l'anti-recopie impose de garder la même fonctionnalité ;
--  * ville = LIKE '%…%' : même cause, non sargable ;
--  * categorie_id : déjà couverte par la clé étrangère (offres_categorie_id_fkey) ;
--  * type_contrat (5 valeurs) et niveau_experience (4) : sélectivité trop
--    faible pour un index dédié — MySQL les filtre sur les lignes déjà
--    servies par l'index principal, surcoût d'écriture sans gain mesurable.
CREATE INDEX `offres_visibles_liste_idx` ON `offres`(`is_active`, `created_at`, `date_expiration`);

-- ─── Backfill des slugs existants ────────────────────────────────────────
-- Règle identique à src/lib/slug.ts : minuscules → accents remplacés par
-- leur équivalent ASCII → tout ce qui n'est pas [a-z0-9] devient '-' →
-- bords '-' tranchés (chaîne vide → « offre ») → CONCAT '-', id.
-- Les 27 REPLACE retirent les accents présents dans les titres FR (œ/æ/ÿ
-- inclus) ; ce qui reste d'hors-charset (polonais, roumain…) est écarté par
-- REGEXP_REPLACE — jamais de slug invalide. SGBD de dev : MariaDB 10.4.32
-- (REGEXP_REPLACE + LOWER via la collation utf8mb4) — backfill vérifié sur
-- les 6 offres de fixture ; aucune dépendance au fuseau.
UPDATE `offres`
SET `slug` = CONCAT(
  COALESCE(
    NULLIF(
      TRIM(BOTH '-' FROM REGEXP_REPLACE(
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
          LOWER(`titre`),
          'à','a'),'á','a'),'â','a'),'ä','a'),'ã','a'),'å','a'),
        'è','e'),'é','e'),'ê','e'),'ë','e'),
        'ì','i'),'í','i'),'î','i'),'ï','i'),
        'ò','o'),'ó','o'),'ô','o'),'ö','o'),'õ','o'),
        'ù','u'),'ú','u'),'û','u'),'ü','u'),
        'ç','c'),'œ','oe'),'æ','ae'),'ÿ','y'),
        '[^a-z0-9]+', '-'
      )),
      ''
    ),
    'offre'
  ),
  '-',
  `id`
)
WHERE `slug` IS NULL;

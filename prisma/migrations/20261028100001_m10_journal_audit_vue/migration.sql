-- M10 — vue d'audit en lecture seule et verrouillage append-only.
-- La vue agrège le journal générique M10 et les journaux M7/M8 existants.
-- Aucune donnée n'est dupliquée : la vue est calculée à la lecture.
-- Les triggers refusent toute mise à jour ou suppression des traces.

CREATE OR REPLACE VIEW `vue_journal_audit` AS
SELECT
    CONVERT('generique' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS `source`,
    `id` AS `entree_id`,
    `acteur_id`,
    `action`,
    `cible_type`,
    `cible_id`,
    `motif`,
    `commentaire`,
    `created_at`
FROM `journal_audit`
UNION ALL
SELECT
    CONVERT('candidatures' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS `source`,
    `id` AS `entree_id`,
    `acteur_id`,
    `action`,
    CONVERT('candidature' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS `cible_type`,
    `candidature_id` AS `cible_id`,
    NULL AS `motif`,
    CONCAT('Statut : ', COALESCE(`ancien_statut`, 'inconnu'), ' -> ', COALESCE(`nouveau_statut`, 'inconnu')) COLLATE utf8mb4_unicode_ci AS `commentaire`,
    `created_at`
FROM `audit_candidatures`
UNION ALL
SELECT
    CONVERT('conversations' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS `source`,
    `id` AS `entree_id`,
    `acteur_id`,
    CONVERT('consultation_conversation' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS `action`,
    CONVERT('conversation' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS `cible_type`,
    `conversation_id` AS `cible_id`,
    NULL AS `motif`,
    CONCAT('Signalement : ', COALESCE(CAST(`signalement_id` AS CHAR), 'non rattache')) COLLATE utf8mb4_unicode_ci AS `commentaire`,
    `created_at`
FROM `audit_conversations`
UNION ALL
SELECT
    CONVERT('fichiers' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS `source`,
    `id` AS `entree_id`,
    `acteur_id`,
    CONVERT('consultation_fichier' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS `action`,
    CONVERT('candidat' USING utf8mb4) COLLATE utf8mb4_unicode_ci AS `cible_type`,
    `cible_candidat_id` AS `cible_id`,
    NULL AS `motif`,
    NULL AS `commentaire`,
    `created_at`
FROM `acces_fichiers`;

DROP TRIGGER IF EXISTS `journal_audit_avant_update`;
CREATE TRIGGER `journal_audit_avant_update` BEFORE UPDATE ON `journal_audit`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'journal_audit est append-only';

DROP TRIGGER IF EXISTS `journal_audit_avant_delete`;
CREATE TRIGGER `journal_audit_avant_delete` BEFORE DELETE ON `journal_audit`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'journal_audit est append-only';

DROP TRIGGER IF EXISTS `message_moderation_avant_update`;
CREATE TRIGGER `message_moderation_avant_update` BEFORE UPDATE ON `message_moderation`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'message_moderation est append-only';

DROP TRIGGER IF EXISTS `message_moderation_avant_delete`;
CREATE TRIGGER `message_moderation_avant_delete` BEFORE DELETE ON `message_moderation`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'message_moderation est append-only';

DROP TRIGGER IF EXISTS `audit_candidatures_avant_update`;
CREATE TRIGGER `audit_candidatures_avant_update` BEFORE UPDATE ON `audit_candidatures`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_candidatures est append-only';

DROP TRIGGER IF EXISTS `audit_candidatures_avant_delete`;
CREATE TRIGGER `audit_candidatures_avant_delete` BEFORE DELETE ON `audit_candidatures`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_candidatures est append-only';

DROP TRIGGER IF EXISTS `audit_conversations_avant_update`;
CREATE TRIGGER `audit_conversations_avant_update` BEFORE UPDATE ON `audit_conversations`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_conversations est append-only';

DROP TRIGGER IF EXISTS `audit_conversations_avant_delete`;
CREATE TRIGGER `audit_conversations_avant_delete` BEFORE DELETE ON `audit_conversations`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_conversations est append-only';

DROP TRIGGER IF EXISTS `acces_fichiers_avant_update`;
CREATE TRIGGER `acces_fichiers_avant_update` BEFORE UPDATE ON `acces_fichiers`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'acces_fichiers est append-only';

DROP TRIGGER IF EXISTS `acces_fichiers_avant_delete`;
CREATE TRIGGER `acces_fichiers_avant_delete` BEFORE DELETE ON `acces_fichiers`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'acces_fichiers est append-only';

-- Rollback de 20261028100001_m10_journal_audit_vue.
-- Les triggers sont supprimés en premier, puis la vue agrégée.

DROP TRIGGER IF EXISTS `acces_fichiers_avant_delete`;
DROP TRIGGER IF EXISTS `acces_fichiers_avant_update`;
DROP TRIGGER IF EXISTS `audit_conversations_avant_delete`;
DROP TRIGGER IF EXISTS `audit_conversations_avant_update`;
DROP TRIGGER IF EXISTS `audit_candidatures_avant_delete`;
DROP TRIGGER IF EXISTS `audit_candidatures_avant_update`;
DROP TRIGGER IF EXISTS `message_moderation_avant_delete`;
DROP TRIGGER IF EXISTS `message_moderation_avant_update`;
DROP TRIGGER IF EXISTS `journal_audit_avant_delete`;
DROP TRIGGER IF EXISTS `journal_audit_avant_update`;
DROP VIEW IF EXISTS `vue_journal_audit`;

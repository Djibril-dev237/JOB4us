-- Rollback de 20261028100000_m10_admin_moderation.
-- À exécuter AVANT le rollback de la vue d'audit.
-- Les lignes qui utilisent les nouveaux enums sont supprimées : un rollback
-- ne peut pas conserver une valeur que l'ancien schéma ne sait pas lire.

DELETE FROM `emails_notifications` WHERE `type` = 'moderation';
DELETE FROM `notification_preferences` WHERE `type` = 'moderation';
DELETE FROM `notifications` WHERE `type` = 'moderation';

ALTER TABLE `notifications` MODIFY `type` ENUM('candidatureRecue', 'statutCandidature', 'candidatureRetiree', 'nouveauMessage', 'offreIndisponible', 'signalementRecu', 'offrePubliee', 'entrepriseCertifiee', 'systeme') NOT NULL;

ALTER TABLE `notification_preferences` MODIFY `type` ENUM('candidatureRecue', 'statutCandidature', 'candidatureRetiree', 'nouveauMessage', 'offreIndisponible', 'signalementRecu', 'offrePubliee', 'entrepriseCertifiee', 'systeme') NOT NULL;

ALTER TABLE `emails_notifications` MODIFY `type` ENUM('candidatureRecue', 'statutCandidature', 'candidatureRetiree', 'nouveauMessage', 'offreIndisponible', 'signalementRecu', 'offrePubliee', 'entrepriseCertifiee', 'systeme') NULL;

DROP INDEX `signalements_statut_traite_idx` ON `signalements`;
ALTER TABLE `signalements` DROP COLUMN `motif_decision`, DROP COLUMN `decision`;

ALTER TABLE `admin_invitations` DROP FOREIGN KEY `admin_invitations_user_id_fkey`;
ALTER TABLE `admin_recovery_codes` DROP FOREIGN KEY `admin_recovery_codes_user_id_fkey`;
ALTER TABLE `admin_auth_challenges` DROP FOREIGN KEY `admin_auth_challenges_user_id_fkey`;

DROP TABLE `journal_audit`;
DROP TABLE `message_moderation`;
DROP TABLE `admin_auth_challenges`;
DROP TABLE `admin_recovery_codes`;
DROP TABLE `admin_invitations`;

ALTER TABLE `users`
    DROP COLUMN `totp_secret`,
    DROP COLUMN `totp_last_step`,
    DROP COLUMN `totp_enabled_at`,
    DROP COLUMN `session_version`,
    DROP COLUMN `anonymized_at`;

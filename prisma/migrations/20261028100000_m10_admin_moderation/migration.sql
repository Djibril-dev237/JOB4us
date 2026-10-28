-- M10 — administration et modération.
-- Ajoute les fondations d'authentification admin, la décision de modération,
-- le journal de masquage et le journal d'audit générique. Les comptes admin
-- ne sont jamais créés depuis l'interface : la CLI émet une invitation.

-- AlterTable
ALTER TABLE `emails_notifications` MODIFY `type` ENUM('candidatureRecue', 'statutCandidature', 'candidatureRetiree', 'nouveauMessage', 'offreIndisponible', 'signalementRecu', 'offrePubliee', 'entrepriseCertifiee', 'systeme', 'moderation') NULL;

-- AlterTable
ALTER TABLE `notification_preferences` MODIFY `type` ENUM('candidatureRecue', 'statutCandidature', 'candidatureRetiree', 'nouveauMessage', 'offreIndisponible', 'signalementRecu', 'offrePubliee', 'entrepriseCertifiee', 'systeme', 'moderation') NOT NULL;

-- AlterTable
ALTER TABLE `notifications` MODIFY `type` ENUM('candidatureRecue', 'statutCandidature', 'candidatureRetiree', 'nouveauMessage', 'offreIndisponible', 'signalementRecu', 'offrePubliee', 'entrepriseCertifiee', 'systeme', 'moderation') NOT NULL;

-- AlterTable
ALTER TABLE `signalements` ADD COLUMN `decision` ENUM('sans_suite', 'avertissement', 'masquage', 'suspension') NULL,
    ADD COLUMN `motif_decision` VARCHAR(50) NULL;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `anonymized_at` DATETIME(3) NULL,
    ADD COLUMN `session_version` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `totp_enabled_at` DATETIME(3) NULL,
    ADD COLUMN `totp_last_step` INTEGER NULL,
    ADD COLUMN `totp_secret` VARCHAR(255) NULL;

-- CreateTable
CREATE TABLE `admin_invitations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `token_hash` VARCHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `admin_invitations_token_hash_key`(`token_hash`),
    INDEX `admin_invitations_user_idx`(`user_id`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_recovery_codes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `code_hash` VARCHAR(64) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `admin_recovery_codes_code_hash_key`(`code_hash`),
    INDEX `admin_recovery_codes_user_idx`(`user_id`, `used_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_auth_challenges` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `token_hash` VARCHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `consumed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `admin_auth_challenges_token_hash_key`(`token_hash`),
    INDEX `admin_auth_challenges_user_idx`(`user_id`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_moderation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `message_id` INTEGER NOT NULL,
    `signalement_id` INTEGER NULL,
    `acteur_id` INTEGER NOT NULL,
    `action` ENUM('masquage', 'retablissement') NOT NULL,
    `motif` VARCHAR(50) NOT NULL,
    `note_interne` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `message_moderation_message_idx`(`message_id`, `created_at`, `id`),
    INDEX `message_moderation_signalement_idx`(`signalement_id`),
    INDEX `message_moderation_acteur_idx`(`acteur_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `journal_audit` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `acteur_id` INTEGER NOT NULL,
    `action` VARCHAR(80) NOT NULL,
    `cible_type` VARCHAR(30) NOT NULL,
    `cible_id` INTEGER NULL,
    `motif` VARCHAR(50) NULL,
    `commentaire` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `journal_audit_created_idx`(`created_at`),
    INDEX `journal_audit_acteur_idx`(`acteur_id`, `created_at`),
    INDEX `journal_audit_cible_idx`(`cible_type`, `cible_id`, `created_at`),
    INDEX `journal_audit_action_idx`(`action`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `signalements_statut_traite_idx` ON `signalements`(`statut`, `traite_le`);

-- AddForeignKey
ALTER TABLE `admin_invitations` ADD CONSTRAINT `admin_invitations_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admin_recovery_codes` ADD CONSTRAINT `admin_recovery_codes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admin_auth_challenges` ADD CONSTRAINT `admin_auth_challenges_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

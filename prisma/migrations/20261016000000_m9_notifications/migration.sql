-- AlterTable
ALTER TABLE `notifications` ADD COLUMN `archivee_le` DATETIME(3) NULL,
    ADD COLUMN `cle` VARCHAR(200) NOT NULL,
    ADD COLUMN `compteur` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `dernier_ref_id` INTEGER NULL,
    ADD COLUMN `lue_le` DATETIME(3) NULL,
    MODIFY `type` ENUM('candidatureRecue', 'statutCandidature', 'candidatureRetiree', 'nouveauMessage', 'offreIndisponible', 'signalementRecu', 'offrePubliee', 'entrepriseCertifiee') NOT NULL;

-- CreateTable
CREATE TABLE `notification_preferences` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `type` ENUM('candidatureRecue', 'statutCandidature', 'candidatureRetiree', 'nouveauMessage', 'offreIndisponible', 'signalementRecu', 'offrePubliee', 'entrepriseCertifiee') NOT NULL,
    `email_active` BOOLEAN NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `notification_preferences_user_id_type_key`(`user_id`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_reglages` (
    `user_id` INTEGER NOT NULL,
    `emails_actives` BOOLEAN NOT NULL DEFAULT true,
    `resume_quotidien` BOOLEAN NOT NULL DEFAULT false,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `emails_notifications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `cle` VARCHAR(200) NOT NULL,
    `destinataire_id` INTEGER NOT NULL,
    `notification_id` INTEGER NULL,
    `type` ENUM('candidatureRecue', 'statutCandidature', 'candidatureRetiree', 'nouveauMessage', 'offreIndisponible', 'signalementRecu', 'offrePubliee', 'entrepriseCertifiee') NULL,
    `resume_du` DATETIME(3) NULL,
    `statut` ENUM('enAttente', 'envoye', 'abandonne') NOT NULL DEFAULT 'enAttente',
    `tentatives` INTEGER NOT NULL DEFAULT 0,
    `prochaine_tentative` DATETIME(3) NULL,
    `envoye_le` DATETIME(3) NULL,
    `erreur` VARCHAR(300) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `emails_notifications_cle_key`(`cle`),
    INDEX `emails_drain_idx`(`statut`, `prochaine_tentative`),
    INDEX `emails_plafond_idx`(`destinataire_id`, `created_at`),
    UNIQUE INDEX `emails_resume_uniq`(`destinataire_id`, `resume_du`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `notifications_cle_key` ON `notifications`(`cle`);

-- CreateIndex
CREATE INDEX `notifications_user_lu_idx` ON `notifications`(`user_id`, `is_lu`);

-- CreateIndex
CREATE INDEX `notifications_user_created_idx` ON `notifications`(`user_id`, `created_at`);

-- CreateIndex
CREATE INDEX `notifications_archivage_idx` ON `notifications`(`is_lu`, `lue_le`);

-- CreateIndex
CREATE INDEX `notifications_purge_idx` ON `notifications`(`archivee_le`);

-- AddForeignKey
ALTER TABLE `notification_preferences` ADD CONSTRAINT `notification_preferences_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_reglages` ADD CONSTRAINT `notification_reglages_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `emails_notifications` ADD CONSTRAINT `emails_notifications_destinataire_id_fkey` FOREIGN KEY (`destinataire_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `emails_notifications` ADD CONSTRAINT `emails_notifications_notification_id_fkey` FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


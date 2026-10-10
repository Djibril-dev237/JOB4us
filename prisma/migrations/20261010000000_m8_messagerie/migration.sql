-- DropForeignKey
ALTER TABLE `conversations` DROP FOREIGN KEY `conversations_candidat_id_fkey`;

-- DropForeignKey
ALTER TABLE `conversations` DROP FOREIGN KEY `conversations_recruteur_id_fkey`;

-- DropForeignKey
ALTER TABLE `conversations` DROP FOREIGN KEY `conversations_offre_id_fkey`;

-- DropIndex
DROP INDEX `conversations_candidat_id_fkey` ON `conversations`;

-- DropIndex
DROP INDEX `conversations_offre_id_fkey` ON `conversations`;

-- DropIndex
DROP INDEX `conversations_recruteur_id_fkey` ON `conversations`;

-- DropIndex
DROP INDEX `conversations_candidat_id_recruteur_id_offre_id_key` ON `conversations`;

-- AlterTable
ALTER TABLE `conversations` DROP COLUMN `candidat_id`,
    DROP COLUMN `offre_id`,
    DROP COLUMN `recruteur_id`,
    ADD COLUMN `candidature_id` INTEGER NOT NULL;

-- AlterTable
ALTER TABLE `messages` DROP COLUMN `is_lu`,
    DROP COLUMN `updated_at`;

-- CreateTable
CREATE TABLE `conversations_etat` (
    `conversation_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `masque_le` DATETIME(3) NULL,
    `lu_le` DATETIME(3) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `conv_etat_user_masque_idx`(`user_id`, `masque_le`),
    PRIMARY KEY (`conversation_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `blocages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `bloqueur_id` INTEGER NOT NULL,
    `bloque_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `blocages_bloque_idx`(`bloque_id`),
    UNIQUE INDEX `blocages_bloqueur_id_bloque_id_key`(`bloqueur_id`, `bloque_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `signalements` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `message_id` INTEGER NOT NULL,
    `auteur_id` INTEGER NOT NULL,
    `motif` VARCHAR(300) NOT NULL,
    `statut` ENUM('ouvert', 'traite') NOT NULL DEFAULT 'ouvert',
    `note_interne` TEXT NULL,
    `traite_par_id` INTEGER NULL,
    `traite_le` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `signalements_statut_idx`(`statut`, `created_at`),
    UNIQUE INDEX `signalements_message_id_auteur_id_key`(`message_id`, `auteur_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_conversations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `conversation_id` INTEGER NOT NULL,
    `acteur_id` INTEGER NOT NULL,
    `signalement_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_conversations_conversation_id_idx`(`conversation_id`),
    INDEX `audit_conversations_acteur_id_idx`(`acteur_id`),
    INDEX `audit_conversations_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `conversations_candidature_id_key` ON `conversations`(`candidature_id`);

-- CreateIndex
CREATE INDEX `messages_conv_created_idx` ON `messages`(`conversation_id`, `created_at`);

-- AddForeignKey
ALTER TABLE `conversations` ADD CONSTRAINT `conversations_candidature_id_fkey` FOREIGN KEY (`candidature_id`) REFERENCES `candidatures`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversations_etat` ADD CONSTRAINT `conversations_etat_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversations_etat` ADD CONSTRAINT `conversations_etat_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `blocages` ADD CONSTRAINT `blocages_bloqueur_id_fkey` FOREIGN KEY (`bloqueur_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `blocages` ADD CONSTRAINT `blocages_bloque_id_fkey` FOREIGN KEY (`bloque_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `signalements` ADD CONSTRAINT `signalements_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `signalements` ADD CONSTRAINT `signalements_auteur_id_fkey` FOREIGN KEY (`auteur_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `signalements` ADD CONSTRAINT `signalements_traite_par_id_fkey` FOREIGN KEY (`traite_par_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


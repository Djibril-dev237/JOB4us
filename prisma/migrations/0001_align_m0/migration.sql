-- DropForeignKey
ALTER TABLE `_offressauvegardees` DROP FOREIGN KEY `_OffresSauvegardees_A_fkey`;

-- DropForeignKey
ALTER TABLE `_offressauvegardees` DROP FOREIGN KEY `_OffresSauvegardees_B_fkey`;

-- AlterTable
ALTER TABLE `entreprises` DROP COLUMN `secteur`,
    DROP COLUMN `taille`,
    MODIFY `secteur_activite` VARCHAR(150) NULL,
    MODIFY `taille_entreprise` VARCHAR(20) NULL;

-- DropTable
DROP TABLE `_offressauvegardees`;

-- CreateTable
CREATE TABLE `offres_sauvegardees` (
    `user_id` INTEGER NOT NULL,
    `offre_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `offres_sauvegardees_offre_id_fkey`(`offre_id`),
    PRIMARY KEY (`user_id`, `offre_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `conversations_candidat_id_fkey` ON `conversations`(`candidat_id`);

-- AddForeignKey
ALTER TABLE `offres_sauvegardees` ADD CONSTRAINT `offres_sauvegardees_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `offres_sauvegardees` ADD CONSTRAINT `offres_sauvegardees_offre_id_fkey` FOREIGN KEY (`offre_id`) REFERENCES `offres`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


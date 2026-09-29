-- CreateTable
CREATE TABLE `acces_fichiers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `acteur_id` INTEGER NOT NULL,
    `cible_candidat_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `acces_fichiers_acteur_id_idx`(`acteur_id`),
    INDEX `acces_fichiers_cible_candidat_id_idx`(`cible_candidat_id`),
    INDEX `acces_fichiers_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

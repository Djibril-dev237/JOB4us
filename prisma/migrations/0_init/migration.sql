-- CreateTable
CREATE TABLE `_offressauvegardees` (
    `A` INTEGER NOT NULL,
    `B` INTEGER NOT NULL,

    UNIQUE INDEX `_OffresSauvegardees_AB_unique`(`A` ASC, `B` ASC),
    INDEX `_OffresSauvegardees_B_index`(`B` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `candidat_competences` (
    `candidat_id` INTEGER NOT NULL,
    `competence_id` INTEGER NOT NULL,
    `niveau` ENUM('debutant', 'intermediaire', 'avance') NOT NULL DEFAULT 'intermediaire',

    INDEX `candidat_competences_competence_id_fkey`(`competence_id` ASC),
    PRIMARY KEY (`candidat_id` ASC, `competence_id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `candidats` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `titre_profil` VARCHAR(150) NULL,
    `resume` TEXT NULL,
    `cv_path` VARCHAR(191) NULL,
    `date_naissance` DATE NULL,
    `genre` ENUM('homme', 'femme', 'autre') NULL,
    `disponibilite` ENUM('immediat', '1_mois', '3_mois', 'non_disponible') NOT NULL DEFAULT 'immediat',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `candidats_user_id_key`(`user_id` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `candidatures` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `offre_id` INTEGER NOT NULL,
    `candidat_id` INTEGER NOT NULL,
    `lettre_motivation` TEXT NULL,
    `cv_path` VARCHAR(191) NULL,
    `statut` ENUM('envoyee', 'vue', 'retenue', 'refusee', 'entretien') NOT NULL DEFAULT 'envoyee',
    `note_recruteur` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `candidatures_candidat_id_fkey`(`candidat_id` ASC),
    UNIQUE INDEX `candidatures_offre_id_candidat_id_key`(`offre_id` ASC, `candidat_id` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `categories` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nom` VARCHAR(100) NOT NULL,
    `icone` VARCHAR(50) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `categories_nom_key`(`nom` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `competences` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nom` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `competences_nom_key`(`nom` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `conversations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `candidat_id` INTEGER NOT NULL,
    `recruteur_id` INTEGER NOT NULL,
    `offre_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `conversations_candidat_id_recruteur_id_offre_id_key`(`candidat_id` ASC, `recruteur_id` ASC, `offre_id` ASC),
    INDEX `conversations_offre_id_fkey`(`offre_id` ASC),
    INDEX `conversations_recruteur_id_fkey`(`recruteur_id` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `entreprises` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `nom` VARCHAR(150) NOT NULL,
    `description` TEXT NULL,
    `secteur` VARCHAR(100) NULL,
    `secteur_activite` VARCHAR(191) NULL,
    `taille` VARCHAR(20) NULL,
    `taille_entreprise` VARCHAR(191) NULL,
    `site_web` VARCHAR(191) NULL,
    `email_contact` VARCHAR(191) NULL,
    `telephone` VARCHAR(191) NULL,
    `adresse` VARCHAR(191) NULL,
    `logo` VARCHAR(191) NULL,
    `ville` VARCHAR(100) NULL,
    `pays` VARCHAR(100) NOT NULL DEFAULT 'Cameroun',
    `is_verified` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `entreprises_user_id_key`(`user_id` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `experiences` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `candidat_id` INTEGER NOT NULL,
    `poste` VARCHAR(150) NOT NULL,
    `entreprise` VARCHAR(150) NOT NULL,
    `ville` VARCHAR(100) NULL,
    `date_debut` DATE NOT NULL,
    `date_fin` DATE NULL,
    `description` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `experiences_candidat_id_fkey`(`candidat_id` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `formations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `candidat_id` INTEGER NOT NULL,
    `diplome` VARCHAR(150) NOT NULL,
    `etablissement` VARCHAR(150) NOT NULL,
    `ville` VARCHAR(100) NULL,
    `date_debut` DATE NOT NULL,
    `date_fin` DATE NULL,
    `description` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `formations_candidat_id_fkey`(`candidat_id` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `messages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `conversation_id` INTEGER NOT NULL,
    `sender_id` INTEGER NOT NULL,
    `contenu` TEXT NOT NULL,
    `is_lu` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `messages_conversation_id_fkey`(`conversation_id` ASC),
    INDEX `messages_sender_id_fkey`(`sender_id` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `type` VARCHAR(100) NOT NULL,
    `titre` VARCHAR(200) NOT NULL,
    `contenu` TEXT NULL,
    `is_lu` BOOLEAN NOT NULL DEFAULT false,
    `lien` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `notifications_user_id_fkey`(`user_id` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `offre_competences` (
    `offre_id` INTEGER NOT NULL,
    `competence_id` INTEGER NOT NULL,

    INDEX `offre_competences_competence_id_fkey`(`competence_id` ASC),
    PRIMARY KEY (`offre_id` ASC, `competence_id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `offres` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `entreprise_id` INTEGER NOT NULL,
    `categorie_id` INTEGER NOT NULL,
    `titre` VARCHAR(200) NOT NULL,
    `description` LONGTEXT NOT NULL,
    `type_contrat` ENUM('CDI', 'CDD', 'stage', 'freelance', 'temps_partiel') NOT NULL,
    `niveau_experience` ENUM('sans_experience', 'junior', 'intermediaire', 'senior') NOT NULL,
    `ville` VARCHAR(100) NOT NULL,
    `pays` VARCHAR(100) NOT NULL DEFAULT 'Cameroun',
    `salaire_min` DECIMAL(10, 2) NULL,
    `salaire_max` DECIMAL(10, 2) NULL,
    `salaire_visible` BOOLEAN NOT NULL DEFAULT false,
    `date_expiration` DATE NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `vues` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `offres_categorie_id_fkey`(`categorie_id` ASC),
    INDEX `offres_entreprise_id_fkey`(`entreprise_id` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `email` VARCHAR(150) NULL,
    `password` VARCHAR(255) NULL,
    `role` ENUM('candidat', 'recruteur', 'admin') NOT NULL,
    `avatar` VARCHAR(255) NULL,
    `phone` VARCHAR(20) NULL,
    `ville` VARCHAR(100) NULL,
    `pays` VARCHAR(100) NOT NULL DEFAULT 'Cameroun',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `email_verified_at` DATETIME(3) NULL,
    `remember_token` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email` ASC),
    UNIQUE INDEX `users_phone_key`(`phone` ASC),
    PRIMARY KEY (`id` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `_offressauvegardees` ADD CONSTRAINT `_OffresSauvegardees_A_fkey` FOREIGN KEY (`A`) REFERENCES `offres`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_offressauvegardees` ADD CONSTRAINT `_OffresSauvegardees_B_fkey` FOREIGN KEY (`B`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `candidat_competences` ADD CONSTRAINT `candidat_competences_candidat_id_fkey` FOREIGN KEY (`candidat_id`) REFERENCES `candidats`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `candidat_competences` ADD CONSTRAINT `candidat_competences_competence_id_fkey` FOREIGN KEY (`competence_id`) REFERENCES `competences`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `candidats` ADD CONSTRAINT `candidats_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `candidatures` ADD CONSTRAINT `candidatures_candidat_id_fkey` FOREIGN KEY (`candidat_id`) REFERENCES `candidats`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `candidatures` ADD CONSTRAINT `candidatures_offre_id_fkey` FOREIGN KEY (`offre_id`) REFERENCES `offres`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversations` ADD CONSTRAINT `conversations_candidat_id_fkey` FOREIGN KEY (`candidat_id`) REFERENCES `candidats`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversations` ADD CONSTRAINT `conversations_offre_id_fkey` FOREIGN KEY (`offre_id`) REFERENCES `offres`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversations` ADD CONSTRAINT `conversations_recruteur_id_fkey` FOREIGN KEY (`recruteur_id`) REFERENCES `entreprises`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `entreprises` ADD CONSTRAINT `entreprises_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `experiences` ADD CONSTRAINT `experiences_candidat_id_fkey` FOREIGN KEY (`candidat_id`) REFERENCES `candidats`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `formations` ADD CONSTRAINT `formations_candidat_id_fkey` FOREIGN KEY (`candidat_id`) REFERENCES `candidats`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_sender_id_fkey` FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `offre_competences` ADD CONSTRAINT `offre_competences_competence_id_fkey` FOREIGN KEY (`competence_id`) REFERENCES `competences`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `offre_competences` ADD CONSTRAINT `offre_competences_offre_id_fkey` FOREIGN KEY (`offre_id`) REFERENCES `offres`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `offres` ADD CONSTRAINT `offres_categorie_id_fkey` FOREIGN KEY (`categorie_id`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `offres` ADD CONSTRAINT `offres_entreprise_id_fkey` FOREIGN KEY (`entreprise_id`) REFERENCES `entreprises`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- Arbitrage de la Vague 1 (M9) : ajout du 9e type `systeme` au catalogue,
-- pour la notification legacy « nouvel utilisateur inscrit » vers les admins
-- (parité RegisterController.php / M4). In-app seulement, aucun email.
-- Migration DISTINCTE de 20261016000000_m9_notifications (déjà appliquée) :
-- le fichier d'une migration appliquée n'est jamais modifié (checksum Prisma).

-- AlterTable
ALTER TABLE `notifications` MODIFY `type` ENUM('candidatureRecue', 'statutCandidature', 'candidatureRetiree', 'nouveauMessage', 'offreIndisponible', 'signalementRecu', 'offrePubliee', 'entrepriseCertifiee', 'systeme') NOT NULL;

-- AlterTable
ALTER TABLE `notification_preferences` MODIFY `type` ENUM('candidatureRecue', 'statutCandidature', 'candidatureRetiree', 'nouveauMessage', 'offreIndisponible', 'signalementRecu', 'offrePubliee', 'entrepriseCertifiee', 'systeme') NOT NULL;

-- AlterTable
ALTER TABLE `emails_notifications` MODIFY `type` ENUM('candidatureRecue', 'statutCandidature', 'candidatureRetiree', 'nouveauMessage', 'offreIndisponible', 'signalementRecu', 'offrePubliee', 'entrepriseCertifiee', 'systeme') NULL;

# Politique de sécurité

## Signaler une vulnérabilité

Merci de ne pas ouvrir d'issue publique pour une vulnérabilité de sécurité.

Utilise la fonctionnalité GitHub Security Advisories du dépôt :

```text
https://github.com/Djibril-dev237/JOB4us/security/advisories/new
```

Si cette fonctionnalité n'est pas disponible, contacte le mainteneur via son
profil GitHub en précisant :

- la nature de la vulnérabilité ;
- les étapes de reproduction ;
- l'impact estimé ;
- la version ou le commit concerné.

Aucun secret, mot de passe, jeton ou donnée personnelle ne doit être inclus
dans un rapport public.

## Périmètre

Sont concernés notamment :

- l'authentification, les sessions et la double authentification admin ;
- le contrôle d'accès candidat, recruteur et administrateur ;
- les téléchargements de CV, avatars et logos ;
- la messagerie et les signalements ;
- les données personnelles et le journal d'audit ;
- les actions d'administration et de modération.

## Hors périmètre

- les comptes de démonstration ou de test ;
- les dépendances obsolètes sans preuve d'exploitation ;
- les attaques par déni de service volumétrique ;
- les problèmes liés à une configuration locale non destinée à la production.

## Bonnes pratiques pour les contributeurs

- Ne jamais commiter de fichier `.env`, de clé privée ou de jeton.
- Utiliser `.env.example` pour documenter les variables attendues.
- Vérifier les contrôles d'accès côté serveur, pas seulement dans l'interface.
- Ne pas exposer les CV, avatars ou logos par une URL publique permanente.
- Signaler toute lecture de contenu privé sans motif, autorisation et audit.

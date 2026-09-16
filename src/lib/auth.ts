// Auth helper - à activer après `npm install next-auth bcryptjs`
// Pour l'instant, structure prête pour Auth.js (NextAuth)

import { prisma } from "./prisma";

// Vérifie mot de passe (bcryptjs) - équivalent Hash::check() Laravel
// import bcrypt from "bcryptjs";
// export async function verifyPassword(plain: string, hash: string) {
//   return bcrypt.compare(plain, hash);
// }

// Récupère user + relations (équivalent Auth::user()->load('candidat','entreprise'))
export async function getUserWithRelations(userId: number) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: { candidat: true, entreprise: true },
  });
}

// Vérifie rôle - équivalent middleware IsCandidat / IsRecruteur / IsAdmin
export function hasRole(user: { role: string }, role: "candidat" | "recruteur" | "admin") {
  return user.role === role;
}

// TODO: Installer puis décommenter
// npm install next-auth@4 bcryptjs
// npm install --save-dev @types/bcryptjs
//
// Ensuite créer src/app/api/auth/[...nextauth]/route.ts avec :
// import NextAuth from "next-auth"
// import CredentialsProvider from "next-auth/providers/credentials"
// ...

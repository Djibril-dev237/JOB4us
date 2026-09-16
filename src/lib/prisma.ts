import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Singleton pour éviter trop de connexions en dev (hot reload)
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;

// Exemples d'utilisation (équivalent Eloquent) :
// const offres = await prisma.offre.findMany({ where: { isActive: true }, include: { entreprise: true, categorie: true } })
// const user = await prisma.user.findUnique({ where: { email: "test@test.com" }, include: { candidat: true } })

import NextAuth, { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import AppleProvider from "next-auth/providers/apple";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Mot de passe", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Email et mot de passe requis");
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user) throw new Error("Utilisateur non trouvé");
        if (!user.isActive) throw new Error("Compte désactivé");
        if (!user.password) throw new Error("Ce compte utilise Google/Apple. Connectez-vous avec Google ou Apple.");

        const isValid = await bcrypt.compare(credentials.password, user.password);
        if (!isValid) throw new Error("Mot de passe incorrect");

        return {
          id: user.id.toString(),
          name: user.name,
          email: user.email,
          role: user.role as "candidat" | "recruteur" | "admin",
        };
      },
    }),
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          }),
        ]
      : []),
    ...(process.env.APPLE_ID && process.env.APPLE_SECRET
      ? [
          AppleProvider({
            clientId: process.env.APPLE_ID,
            clientSecret: process.env.APPLE_SECRET,
          }),
        ]
      : []),
  ],
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24h comme Laravel SESSION_LIFETIME 120min -> on met 24h
  },
  callbacks: {
    async signIn({ user, account }) {
      // Pour Google/Apple, crée l'utilisateur s'il n'existe pas
      if (account?.provider === "google" || account?.provider === "apple") {
        if (!user.email) return false;
        const existing = await prisma.user.findUnique({ where: { email: user.email } });
        if (!existing) {
          const newUser = await prisma.user.create({
            data: {
              name: user.name || user.email.split("@")[0],
              email: user.email,
              password: null,
              role: "candidat",
              avatar: user.image,
              emailVerifiedAt: new Date(),
            },
          });
          await prisma.candidat.create({ data: { userId: newUser.id } });
          // On assigne le rôle pour le token
          (user as any).role = "candidat";
          (user as any).id = newUser.id.toString();
        } else {
          (user as any).role = existing.role;
          (user as any).id = existing.id.toString();
        }
      }
      return true;
    },
    async jwt({ token, user, account }) {
      if (user) {
        token.id = (user as any).id || token.id;
        token.role = (user as any).role || token.role;
      }
      // Pour OAuth, récupère le rôle depuis la BDD si pas encore dans le token
      if (!token.role && token.email) {
        const dbUser = await prisma.user.findUnique({ where: { email: token.email as string } });
        if (dbUser) {
          token.id = dbUser.id.toString();
          token.role = dbUser.role as any;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.role = (token.role as "candidat" | "recruteur" | "admin") || "candidat";
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };

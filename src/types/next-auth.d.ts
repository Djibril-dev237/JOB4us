import NextAuth from "next-auth";

declare module "next-auth" {
  interface User {
    id: string;
    role: "candidat" | "recruteur" | "admin";
  }
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: "candidat" | "recruteur" | "admin";
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: "candidat" | "recruteur" | "admin";
  }
}

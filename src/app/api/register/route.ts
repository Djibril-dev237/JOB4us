import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// POST /api/register - équivalent Auth\RegisterController@create
export async function POST(req: Request) {
  try {
    const { name, email, password, role } = await req.json();

    if (!name || !email || !password || !role) {
      return NextResponse.json({ error: "Champs manquants" }, { status: 400 });
    }
    if (!["candidat", "recruteur"].includes(role)) {
      return NextResponse.json({ error: "Rôle invalide" }, { status: 400 });
    }

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      return NextResponse.json({ error: "Email déjà utilisé" }, { status: 409 });
    }

    const hashed = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashed,
        role,
        pays: "Cameroun",
      },
    });

    // Crée le profil lié comme dans Laravel (candidats ou entreprises)
    if (role === "candidat") {
      await prisma.candidat.create({
        data: { userId: user.id },
      });
    } else if (role === "recruteur") {
      await prisma.entreprise.create({
        data: { userId: user.id, nom: name },
      });
    }

    return NextResponse.json({ id: user.id, role: user.role }, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/offres - équivalent Offre::active()->with(['entreprise','categorie'])->get()
export async function GET() {
  try {
    const offres = await prisma.offre.findMany({
      where: { isActive: true },
      include: {
        entreprise: true,
        categorie: true,
        competences: { include: { competence: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return NextResponse.json(offres);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

// POST /api/offres - équivalent OffreController@store
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const offre = await prisma.offre.create({
      data: {
        titre: body.titre,
        description: body.description,
        typeContrat: body.typeContrat, // CDI, CDD...
        niveauExperience: body.niveauExperience,
        ville: body.ville,
        pays: body.pays || "Cameroun",
        salaireMin: body.salaireMin,
        salaireMax: body.salaireMax,
        dateExpiration: new Date(body.dateExpiration),
        entrepriseId: body.entrepriseId,
        categorieId: body.categorieId,
      },
    });
    return NextResponse.json(offre, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Données invalides" }, { status: 400 });
  }
}

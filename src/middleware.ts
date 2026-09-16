// Middleware Next.js - équivalent des middlewares Laravel IsCandidat / IsRecruteur / IsAdmin
// Pour l'instant exemple sans next-auth, à activer après install

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  // Exemple: protège /candidat, /recruteur, /admin
  // Quand Auth.js sera installé, vérifier le token ici
  // const token = await getToken({ req: request })
  // if (!token) return NextResponse.redirect(new URL("/login", request.url))

  return NextResponse.next();
}

export const config = {
  matcher: ["/candidat/:path*", "/recruteur/:path*", "/admin/:path*"],
};

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// Équivalent Laravel: middleware IsCandidat, IsRecruteur, IsAdmin
export async function middleware(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  const path = request.nextUrl.pathname;

  // Pas connecté -> login
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const role = token.role as string;

  if (path.startsWith("/candidat") && role !== "candidat" && role !== "admin") {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (path.startsWith("/recruteur") && role !== "recruteur" && role !== "admin") {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (path.startsWith("/admin") && role !== "admin") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/candidat/:path*", "/recruteur/:path*", "/admin/:path*"],
};

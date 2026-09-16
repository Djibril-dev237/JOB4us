import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";

export default async function AdminDashboard() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "admin") redirect("/");

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-bold">Dashboard Admin</h1>
      <p className="mt-2 text-zinc-600">Admin: {session.user.email}</p>
      <div className="mt-6 rounded-xl border p-5 bg-white dark:bg-zinc-900">
        Gestion utilisateurs / offres / entreprises (à venir) - équivalent Admin\UserController, OffreAdminController
      </div>
    </div>
  );
}

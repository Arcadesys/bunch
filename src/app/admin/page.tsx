import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AdminView } from "./admin-view";
import { requireAdminId } from "@/server/admin-access";
import { SystemError } from "@/server/system-error";

export default async function AdminPage() {
  const request = new Request("http://localhost/admin", {
    headers: await headers(),
  });

  try {
    await requireAdminId(request);
  } catch (error) {
    if (error instanceof SystemError && error.code === "FORBIDDEN") notFound();
    if (error instanceof SystemError && error.code === "UNAUTHORIZED") {
      redirect("/auth/login?returnTo=%2Fadmin");
    }
    throw error;
  }

  return <AdminView />;
}

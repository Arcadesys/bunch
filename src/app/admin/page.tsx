import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AdminView } from "./admin-view";
import { requireAdminId } from "@/server/admin-access";
import { SystemError } from "@/server/system-error";
import { getMcpUsageService } from "@/server/mcp-usage-service";

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

  const usage = getMcpUsageService();
  const [stats7, stats30] = await Promise.all([usage.summary(7), usage.summary(30)]);
  return <AdminView stats7={stats7} stats30={stats30} />;
}

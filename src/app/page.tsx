import { getAuth0Client, isAuth0Configured } from "@/lib/auth0";
import { BunchLanding } from "./bunch-landing";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SystemPage() {
  const session = isAuth0Configured() ? await getAuth0Client().getSession() : null;
  if (session?.user.sub) redirect("/home");
  return <BunchLanding />;
}

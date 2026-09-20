import { getAuth0Client, isAuth0Configured } from "@/lib/auth0";
import { LandingPage } from "./landing-page";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SystemPage() {
  const session = isAuth0Configured() ? await getAuth0Client().getSession() : null;
  if (session?.user.sub) redirect("/home");
  return <LandingPage />;
}

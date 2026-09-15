import { CatchUpCommandCenter } from "./catch-up-command-center";
import { getAuth0Client, isAuth0Configured } from "@/lib/auth0";
import { LandingPage } from "./landing-page";

export const dynamic = "force-dynamic";

export default async function SystemPage() {
  const session = isAuth0Configured() ? await getAuth0Client().getSession() : null;
  return session?.user.sub ? <CatchUpCommandCenter /> : <LandingPage />;
}

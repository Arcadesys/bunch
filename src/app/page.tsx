import { CatchUpCommandCenter } from "./catch-up-command-center";
import { BunchLanding } from "./bunch-landing";
import { getAuth0Client, isAuth0Configured } from "@/lib/auth0";

export const dynamic = "force-dynamic";

export default async function SystemPage() {
  const session = isAuth0Configured() ? await getAuth0Client().getSession() : null;
  if (session?.user.sub || process.env.SYSTEM_DEMO_MODE === "true") {
    return <CatchUpCommandCenter />;
  }
  return <BunchLanding />;
}

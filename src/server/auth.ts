import { getPilotService, type PilotIdentity } from "./pilot-service";
import { getAuth0Client, isAuth0Configured } from "@/lib/auth0";

export function ownerIdFromAuth0Subject(subject: string) {
  const normalized = subject.trim();
  if (!normalized) throw new Error("A valid Auth0 subject is required.");
  return `auth0:${normalized}`;
}

export async function requireOwnerId(request?: Request): Promise<string> {
  if (isAuth0Configured()) {
    const session = await getAuth0Client().getSession();
    if (session?.user.sub) {
      const ownerId = ownerIdFromAuth0Subject(session.user.sub);
      await getPilotService().assertAccess(ownerId, request?.url.includes("/images") ? "image" : "web");
      return ownerId;
    }
  }

  // Local-only walkthrough mode. It is rejected unless deliberately enabled.
  if (process.env.SYSTEM_DEMO_MODE === "true" && request?.headers.get("x-system-demo") === "local") {
    return "demo:local-user";
  }
  throw new Error("Sign in with Google to access private System records.");
}


// Identity-only access is reserved for joining and account recovery/export/deletion.
export async function requirePilotIdentity(): Promise<PilotIdentity> {
  const session = await getAuth0Client().getSession();
  if (!session?.user.sub) throw new Error("Sign in with Google to manage your DIDdy account.");
  return { ownerId: ownerIdFromAuth0Subject(session.user.sub), email: typeof session.user.email === "string" ? session.user.email : "", emailVerified: session.user.email_verified === true };
}

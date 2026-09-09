import { getPilotService, type PilotIdentity } from "./pilot-service";
import { getAuth0Client, isAuth0Configured } from "@/lib/auth0";

export function ownerIdFromAuth0Subject(subject: string) {
  const normalized = subject.trim();
  if (!normalized) throw new Error("A valid Auth0 subject is required.");
  return `auth0:${normalized}`;
}

function e2ePilotIdentity(request?: Request): PilotIdentity | null {
  if (process.env.SYSTEM_E2E_TEST_MODE !== "true" || process.env.NODE_ENV === "production") return null;
  const subject = request?.headers.get("x-system-e2e-subject")?.trim();
  return subject && /^[A-Za-z0-9|:_-]{1,160}$/.test(subject)
    ? { ownerId: ownerIdFromAuth0Subject(subject), email: "fixture@example.test", emailVerified: true }
    : null;
}

// Three accepted identity paths, in precedence order: the end-to-end test seam (which
// cannot run in a production build), a real Auth0 session, and finally the local
// walkthrough header. Every path returns an owner ID derived from an immutable
// subject, never from anything the caller supplied as data.
export async function requireOwnerId(request?: Request): Promise<string> {
  const e2e = e2ePilotIdentity(request);
  if (e2e) {
    await getPilotService().assertAccess(e2e.ownerId, request?.url.includes("/images") ? "image" : "web");
    return e2e.ownerId;
  }
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
export async function requirePilotIdentity(request?: Request): Promise<PilotIdentity> {
  // Local end-to-end test seam. It cannot run in a production build and requires
  // both the explicit test-server flag and a per-request synthetic subject.
  const e2e = e2ePilotIdentity(request);
  if (e2e) return e2e;
  const session = await getAuth0Client().getSession();
  if (!session?.user.sub) throw new Error("Sign in with Google to manage your Bunch account.");
  return { ownerId: ownerIdFromAuth0Subject(session.user.sub), email: typeof session.user.email === "string" ? session.user.email : "", emailVerified: session.user.email_verified === true };
}

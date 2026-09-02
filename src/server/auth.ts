import { getAuth0Client, isAuth0Configured } from "@/lib/auth0";

export function ownerIdFromAuth0Subject(subject: string) {
  const normalized = subject.trim();
  if (!normalized) throw new Error("A valid Auth0 subject is required.");
  return `auth0:${normalized}`;
}

export async function requireOwnerId(request?: Request): Promise<string> {
  if (isAuth0Configured()) {
    const session = await getAuth0Client().getSession();
    if (session?.user.sub) return ownerIdFromAuth0Subject(session.user.sub);
  }

  // Local-only walkthrough mode. It is rejected unless deliberately enabled.
  if (process.env.SYSTEM_DEMO_MODE === "true" && request?.headers.get("x-system-demo") === "local") {
    return "demo:local-user";
  }
  throw new Error("Sign in with Google to access private System records.");
}

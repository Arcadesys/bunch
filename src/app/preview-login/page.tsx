import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { PREVIEW_EMAIL, PREVIEW_SESSION_COOKIE, previewLoginEnabled, safeReturnTo, verifyPreviewSession } from "@/server/preview-login";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Preview test account — Bunch", robots: { index: false, follow: false } };

export default async function PreviewLoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!previewLoginEnabled()) notFound();
  const params = await searchParams;
  const returnTo = safeReturnTo(params.returnTo);
  const signedIn = verifyPreviewSession((await cookies()).get(PREVIEW_SESSION_COOKIE)?.value) !== null;
  return <main className="shell preview-login">
    <p className="preview-login-banner" role="note"><strong>Preview deployment.</strong> This sign-in exists only on preview builds. Production uses Google sign-in.</p>
    <h1>Preview test account</h1>
    <p>This is one shared, separate test account. It can&apos;t see anyone&apos;s real profiles, notes or photos, and it starts empty.</p>
    {params.error && <p className="notice" role="alert">That password didn&apos;t match. Check the preview password and try again.</p>}
    {params.signedOut && <p className="notice" role="status">Signed out of the test account.</p>}
    {signedIn ? <>
      <p className="notice" role="status">You&apos;re signed in as the test account.</p>
      <div className="actions">
        <a className="button" href={returnTo}>Continue</a>
        <form method="post" action="/api/preview-login"><input type="hidden" name="action" value="signout" /><button className="button button-secondary" type="submit">Sign out</button></form>
      </div>
    </> : <form method="post" action="/api/preview-login" className="preview-login-form">
      <input type="hidden" name="returnTo" value={returnTo} />
      <label htmlFor="preview-password">Preview password</label>
      <input id="preview-password" name="password" type="password" autoComplete="current-password" required minLength={32} />
      <button className="button" type="submit">Sign in to the test account</button>
    </form>}
    <details><summary>Stuck on &ldquo;access unavailable&rdquo;?</summary>
      <p>If the pilot gate is on, the test account needs an invitation like any friend: run <code>npm run pilot:admin invite {PREVIEW_EMAIL}</code> against this preview&apos;s database, then open the invitation link here while signed in.</p>
    </details>
  </main>;
}

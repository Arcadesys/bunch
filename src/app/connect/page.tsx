import Link from "next/link";
export default function ConnectPage() {
  return (
    <main className="pilot-page">
      <nav aria-label="Connection navigation">
        <Link href="/home">Bunch</Link>
        <a href="/account">Account & privacy</a>
        <a href="/join">Accept invitation</a>
      </nav>
      <h1>Connect your private Bunch account</h1>
      <p>
        Accept your invitation first, then use the same Google sign-in in each
        client. Each friend system has its own account.
      </p>
      <h2>Codex plugin</h2>
      <p>
        Install the versioned Bunch package provided by the operator using your
        Codex plugin installation controls. Review the remote MCP address and
        complete your own OAuth sign-in. The package contains no shared login or
        private records.
      </p>
      <h2>ChatGPT</h2>
      <p>
        If your account supports custom apps, open its app/developer settings
        and add the operator-provided Bunch MCP address. Complete your own
        sign-in. Workspace administrators may need to enable custom apps.
      </p>
      <p>
        Installing another person’s plugin does not grant access to their
        account. If custom apps are unavailable, use this website.
      </p>
      <h2>Check the connection</h2>
      <ol>
        <li>Ask “Show my alter profiles.” Only your profiles should appear.</li>
        <li>
          Ask “Who is recorded as hosting or fronting?” An empty account should
          say nothing is recorded.
        </li>
        <li>
          Close and reopen the client, then repeat the read. A failed refresh
          should ask you to reconnect.
        </li>
      </ol>
      <h2>Conversation catch-up</h2>
      <p>
        Bunch supplies recorded dates and elapsed time. Your ChatGPT or Codex
        session can summarize only messages it can actually access. It must tell
        you when history is unavailable. Summaries are not saved in Bunch.
      </p>
    </main>
  );
}

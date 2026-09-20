export function AdminView() {
  return (
    <main className="shell">
      <nav aria-label="Admin navigation">
        <a href="/home">Bunch home</a>
      </nav>

      <p className="eyebrow">Private operator area</p>
      <h1>Admin</h1>
      <p className="intro">
        These controls are available only to the active Bunch operator.
      </p>

      <section className="panel" aria-labelledby="account-controls-heading">
        <h2 id="account-controls-heading">Account controls</h2>
        <p>Manage invitations and daily image allowances from the account page.</p>
        <div className="actions">
          <a className="button" href="/account#tenant-invitations-heading">
            Manage invitations
          </a>
          <a className="button button-secondary" href="/account">
            Manage image allowances
          </a>
        </div>
      </section>
    </main>
  );
}

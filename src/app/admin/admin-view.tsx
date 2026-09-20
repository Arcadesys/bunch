import type { UsageStats } from "@/server/mcp-usage-service";

const money = (value: number) => value.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 3 });
const empty = (days: number): UsageStats => ({ windowDays: days, totalInvocations: 0, totalErrors: 0, byTool: [], byDay: [], byOwner: [], aiSpend: { totalUsd: 0, meaningfulActions: 0, costPerActionUsd: 0, activeUserDays: 0, costPerActiveUserDayUsd: 0, chargedFailures: 0, estimatedRows: 0, economyActions: 0, byAction: [], byModelQuality: [], byAccount: [], byDay: [] } });

export function AdminView({ stats7 = empty(7), stats30 = empty(30) }: { stats7?: UsageStats; stats30?: UsageStats }) {
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
      <section className="panel admin-spend" aria-labelledby="ai-spend-heading">
        <h2 id="ai-spend-heading">AI image spend</h2>
        <p>Provider-confirmed costs are used when available. Estimated rows retain the conservative dispatch reservation.</p>
        <div className="admin-spend-grid">
          {[stats7, stats30].map(stats => <article key={stats.windowDays} aria-label={`${stats.windowDays}-day AI spend`}>
            <h3>Last {stats.windowDays} days</h3>
            <dl>
              <div><dt>Total spend</dt><dd>{money(stats.aiSpend.totalUsd)}</dd></div>
              <div><dt>Cost per paid action</dt><dd>{money(stats.aiSpend.costPerActionUsd)}</dd></div>
              <div><dt>Cost per active user-day</dt><dd>{money(stats.aiSpend.costPerActiveUserDayUsd)}</dd></div>
              <div><dt>Paid image actions</dt><dd>{stats.aiSpend.meaningfulActions}</dd></div>
              <div><dt>Charged failures</dt><dd>{stats.aiSpend.chargedFailures}</dd></div>
              <div><dt>Estimated-cost rows</dt><dd>{stats.aiSpend.estimatedRows}</dd></div>
            </dl>
          </article>)}
        </div>
        <div className="admin-spend-table" tabIndex={0} role="region" aria-label="Thirty-day spend by model and quality">
          <table><caption>Thirty-day spend by model and quality</caption><thead><tr><th scope="col">Model</th><th scope="col">Quality</th><th scope="col">Actions</th><th scope="col">Cost</th></tr></thead><tbody>
            {stats30.aiSpend.byModelQuality.length ? stats30.aiSpend.byModelQuality.map(row => <tr key={`${row.model}:${row.quality}`}><th scope="row">{row.model}</th><td>{row.quality}</td><td>{row.actions}</td><td>{money(row.costUsd)}</td></tr>) : <tr><td colSpan={4}>No paid image actions in this window.</td></tr>}
          </tbody></table>
        </div>
        <p><strong>Economy actions:</strong> {stats30.aiSpend.economyActions}. <strong>Target:</strong> no more than $0.13 per active user-day after full rollout.</p>
      </section>
    </main>
  );
}

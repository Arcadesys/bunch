# Tenant invitations

One-use invitation links let an operator bring another isolated account onto an
instance without sharing credentials or records.

## Flow

An authenticated operator opens invitations from **Account & privacy**, then
creates, copies, lists, and revokes one-use links. A recipient signs in, enters
a display name, accepts the privacy notice, and redeems the link once into an
account isolated from the operator's.

Opening invitations requires recording current capacity and recovery evidence
for the systems the instance will hold. This is a deliberate speed bump, not a
technical constraint.

## Token design

The link token is 32 random bytes encoded as 43 URL-safe characters.

Two properties matter:

- Postgres stores only a SHA-256 hash of the token, never the token itself. A
  database read cannot reconstruct a working link.
- The token travels in the URL **fragment**, so it is never sent to the server
  as part of the request. Opening a link therefore neither transmits nor
  redeems it. Redemption is an explicit, separate action.

The token is held in session storage only long enough to survive the return
trip through the identity provider.

## Operator promotion

The first operator is pinned by migration `0012_tenant_invitations.sql`, which
records the immutable owner ID of the account that already owns durable records.
This is a migration-time ownership check — not an email match, and not a runtime
"whoever signs in first" rule. A later or unrelated account cannot promote
itself through this path.

## Guarantees under test

`src/server/pilot.integration.test.ts` covers single use, expiry, revocation,
retry, concurrency, cross-account isolation, and non-owner denial. Run it
against a disposable database with `npm run eval:pilot`.

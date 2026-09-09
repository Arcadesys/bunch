# Bunch

Bunch is a private online companion for the pieces of life you want to return to with context. Use its web companion and MCP connection to keep what matters available when you need it.

## What you can do

Keep private profiles, notes, tasks, preferences, decisions, important conversations, and images together. Make a catch-up review for a chosen time period when you come back.

Hosting and fronting are separate, explicit records. “Relevant to” can connect a note or task to more than one person; it never guesses who is responsible, present, hosting, or fronting.

Catch-up is based on a time interval and source coverage. If a source was unavailable, Bunch says that plainly instead of treating it as proof that nothing happened.

## Bunch and Working Monkeys

- **Bunch** is the connected online companion, used through its web experience and MCP connection.
- **Working Monkeys** is a separate local-only Mac companion. It can deliberately cache selected Bunch reference profiles for offline use, but never sends its local work back to Bunch.

## Getting started

Open your configured Bunch instance and sign in. Then connect its MCP endpoint in a client you trust. The web companion and MCP tools use the same authenticated account, so your private records remain in one place.

Private images are stored privately and served only through owner-authorized routes. A scoped reference credential can share selected profiles and approved images with Working Monkeys; it cannot read or write Bunch work records.

## For maintainers

Local setup, MCP tool details, database configuration, Auth0 settings, and release checks are in [Maintainer setup](docs/maintainer-setup.md). Bunch’s connected deployment and Working Monkeys’ local runtime are maintained separately.

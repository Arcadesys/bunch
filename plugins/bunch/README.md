# Bunch plugin

Private accounts for invited members. This package includes portable Agent Plugins manifests, compatibility manifests for existing Codex clients, a remote MCP server configuration, and the System Companion skill. It contains no credentials, personal records, or local hooks.

1. Obtain an invitation directly from the operator and accept it at https://system.thearcades.me/join. Use your own verified Google account.
2. Add the extracted plugin directory using your Codex version's supported local-plugin installation controls. If managed by a workspace, an administrator may need to import it. 
3. Review the HTTPS MCP address and authorize your own account through OAuth. Never paste the operator's token or environment files.
4. Ask to list your profiles and read your recorded hosting/fronting. Close and reopen Codex, then repeat the read.

ChatGPT uses a separate custom-app installation. Eligible accounts can add `https://system.thearcades.me/mcp` through developer/custom-app settings and complete their own OAuth authorization. Bunch exposes a non-sensitive account profile so ChatGPT can distinguish separately authorized accounts without receiving an Auth0 subject. Availability depends on account and workspace policy. If unavailable, use the web companion.

When connecting Bunch on ChatGPT web, the installed skill offers this optional cleanup checklist:

- [ ] Check both **Installed** and **Personal** for `Bunch` and endpoint-confirmed legacy `System Companion` or `DIDdy` connections.
- [ ] Review the exact stale installed connections found and choose whether to uninstall them. Nothing is removed automatically.
- [ ] Confirm no stale connection remains before installing the current Bunch custom app.
- [ ] Test the fictional Demo read separately from an authenticated owner-scoped read.

A **Created by me** record that only offers **Install plugin** is not an installed connection. Removing an installed app may disconnect its saved OAuth session and always requires explicit confirmation.

Hosting and fronting remain separate. No switch is inferred from identity, silence, tone, or a catch-up request. Conversation summaries require actual host history access; installation alone does not provide that access. Generated summaries are saved privately for 30 days from creation, including their dates and coverage gaps; raw transcripts are not saved. You can retrieve or delete saved summaries through Bunch.

Other systems cannot access your data. The hosting operator has technical administrator access. This is not end-to-end encryption. See `/account` for export, deletion, and recovery information.

Invitations are closed unless the operator has opened them. Installing this package does not by itself grant membership.

## Demo system

The same hosted `/mcp` endpoint supports a read-only default walkthrough without sign-in. Ask for `get_demo_system` to fetch Fenton, Benny, Dot, fictional history, and shared tasks from Bunch. Nothing is stored locally or written to a real system. To use your own records, call `connect_private_system`, complete OAuth, and refresh the tool list. Invalid credentials remain errors; they never select demo data.

[Install and explore the Demo system](../../docs/demo-install.md)

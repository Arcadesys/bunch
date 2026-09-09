# Bunch plugin

Private accounts for invited members. This package includes a remote MCP server configuration and the System Companion skill; it contains no credentials, personal records, or local hooks.

1. Obtain an invitation directly from the operator and accept it at https://system.thearcades.me/join. Use your own verified Google account.
2. Add the extracted plugin directory using your Codex version's supported local-plugin installation controls. If managed by a workspace, an administrator may need to import it. 
3. Review the HTTPS MCP address and authorize your own account through OAuth. Never paste the operator's token or environment files.
4. Ask to list your profiles and read your recorded hosting/fronting. Close and reopen Codex, then repeat the read.

ChatGPT uses a separate custom-app installation. Eligible accounts can add `https://system.thearcades.me/mcp` through developer/custom-app settings and complete their own OAuth authorization. Availability depends on account and workspace policy. If unavailable, use the web companion.

Hosting and fronting remain separate. No switch is inferred from identity, silence, tone, or a catch-up request. Conversation summaries require actual host history access; installation alone does not provide that access. Generated summaries are saved privately for 30 days from creation, including their dates and coverage gaps; raw transcripts are not saved. You can retrieve or delete saved summaries through Bunch.

Other systems cannot access your data. The hosting operator has technical administrator access. This is not end-to-end encryption. See `/account` for export, deletion, and recovery information.

Invitations are closed unless the operator has opened them. Installing this package does not by itself grant membership.

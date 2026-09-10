# Try the Bunch Demo system

The Demo system is a fictional, read-only sample you can explore in Codex. Meet Fenton, Benny, and Dot; browse shared tasks, notes, hosting/fronting history, and a catch-up. The plugin retrieves those records from Bunch. You do not need a Bunch account, local database, or shared login.

## Install the plugin

With the Codex CLI installed, add this repository's marketplace:

```sh
codex plugin marketplace add Arcadesys/bunch --ref main
```

Restart the desktop app, open **Plugins**, select the **Bunch** marketplace, and install **Bunch**. The repository's plugin directory is `plugins/bunch`. Authentication is deferred until private access is requested.

On CLI versions that provide `codex plugin add`, you can install the same plugin with:

```sh
codex plugin add bunch@bunch
```

Start a new task so the installed tools and skill are loaded. Ask:

> Show the Demo system. Then show Benny's open tasks and the reminder Fenton left him.

The response should say **Demo system**, show Fenton, Benny, and Dot, and include **Write a thank-you note for the gift we received.** Benny handles writing; Fenton left the reminder. The gift was received by the system, not given by Benny.

You can also ask who is hosting, explore each person's history, or read Benny's sample catch-up. This sample has eight read tools and no saved edits. Its dates describe a fixed fictional snapshot.

[Plugin source](../plugins/bunch) · [Sample details and available tools](hosted-demo-system.md)

The repository marketplace setup follows [OpenAI's plugin packaging documentation](https://developers.openai.com/plugins/build/plugins). The CLI `plugin add` command is also exposed by the current Codex CLI's help; availability can differ by client version.

## Connect just the hosted tools

If you prefer a direct MCP connection, add this configuration to your Codex MCP settings:

```toml
[mcp_servers.bunch_demo]
url = "https://system.thearcades.me/mcp"
```

Start a new task and ask for `get_demo_system`. No token is needed for demo reads. See [OpenAI's MCP setup documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) for where to configure your client.

## Use your own private system

Ask to connect your private system. Bunch's `connect_private_system` tool requests OAuth sign-in; then refresh the connection/tool list. Your account must meet Bunch's existing invitation/access requirements. Authenticated private tools return your own records. The fictional demo remains available only when explicitly requested.

If authentication fails, Bunch reports the failure. It does not silently replace your private records with sample data. The website's `/install` page installs the web app; it is not this plugin installer.

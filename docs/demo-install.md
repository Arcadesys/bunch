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

### ChatGPT web installation checklist

1. Search both **Installed** and **Personal** for an exact `Bunch` entry and for legacy `System Companion` or `DIDdy` entries whose MCP endpoint identifies this Bunch service. Remove only confirmed matches and only after the user approves disconnecting their saved OAuth session.
2. Create one app named **Bunch** with the canonical hosted `/mcp` URL, **Server URL**, and **Mixed** authentication. Use the existing barrel-of-monkeys icon and the description: `Private Bunch companion for profiles, notes, tasks, presence, media, and a fictional demo system.`
3. Run **Scan Tools**, complete OAuth when prompted, and wait for the authenticated scan to finish before choosing **Create**.
4. Verify installation, fictional Demo access, OAuth, and a read-only `get_account_profile` call as separate gates. Do not use a write or private-media mutation as an installation test.

ChatGPT currently documents custom MCP apps as web-only. A Pro account may verify read/fetch access, but full MCP actions such as `generate_scene` require a supported Business, Enterprise, or Edu plan. On phones, install Bunch from `/install` and use its authenticated `/images` page for private reference-backed generation.

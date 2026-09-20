"""Validate and package only portable plugin files, never application data or secrets."""
import json
import pathlib
import tarfile
import tempfile

root = pathlib.Path(__file__).resolve().parents[1]
plugin = root / 'plugins/bunch'
manifest = json.loads((plugin / 'plugin.json').read_text())
compat_manifest = json.loads((plugin / '.codex-plugin/plugin.json').read_text())
mcp = json.loads((plugin / 'mcp.json').read_text())
compat_mcp = json.loads((plugin / '.mcp.json').read_text())
files = [
    'plugin.json',
    'mcp.json',
    '.codex-plugin/plugin.json',
    '.mcp.json',
    'skills/system-companion/SKILL.md',
    'skills/system-companion/agents/openai.yaml',
    'README.md',
    'assets/bunch-barrel-monkeys.png',
]

def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)

require(manifest.get('$schema') == 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', 'Portable plugin schema is missing or unsupported')
require(mcp.get('$schema') == 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', 'Portable MCP schema is missing or unsupported')
require(manifest.get('name') == compat_manifest.get('name') == 'bunch', 'Plugin names do not match')
require(manifest.get('version') == compat_manifest.get('version'), 'Plugin versions do not match')
portable_server = mcp.get('mcpServers', {}).get('bunch', {})
compat_server = compat_mcp.get('mcpServers', {}).get('bunch', {})
require(portable_server.get('type') == 'streamable-http', 'Portable MCP server must use streamable-http')
require(compat_server.get('type') == 'http', 'Compatibility MCP server must use http')
require(portable_server.get('url') == compat_server.get('url') == 'https://system.thearcades.me/mcp', 'Hosted MCP URLs do not match')
require((plugin / files[4]).read_bytes() == (root / 'skills/system-companion/SKILL.md').read_bytes(), 'Plugin skill is stale')
require((plugin / files[5]).read_bytes() == (root / 'skills/system-companion/agents/openai.yaml').read_bytes(), 'Plugin OpenAI agent config is stale')
for name in files:
    source = plugin / name
    require(source.is_file() and not source.is_symlink(), f'Unsafe or missing plugin file: {name}')
    require(source.resolve().is_relative_to(plugin.resolve()), f'Plugin file escapes package root: {name}')
output = pathlib.Path(tempfile.mkdtemp(prefix='bunch-plugin-')) / f'bunch-{manifest["version"]}.tar.gz'
with tarfile.open(output, 'w:gz') as archive:
    for name in files:
        archive.add(plugin / name, arcname=f'bunch/{name}')
print(output)

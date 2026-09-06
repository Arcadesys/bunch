"""Package only portable plugin files, never the application checkout or secrets."""
import json, pathlib, tarfile, tempfile
root = pathlib.Path(__file__).resolve().parents[1]
plugin = root / 'plugins/diddy'
manifest = json.loads((plugin / '.codex-plugin/plugin.json').read_text())
files = ['.codex-plugin/plugin.json', '.mcp.json', 'skills/system-companion/SKILL.md', 'README.md', 'assets/bunch-barrel-monkeys.png']
assert (plugin / files[2]).read_bytes() == (root / 'skills/system-companion/SKILL.md').read_bytes(), 'Plugin skill is stale'
output = pathlib.Path(tempfile.mkdtemp(prefix='diddy-plugin-')) / f'diddy-{manifest["version"]}.tar.gz'
with tarfile.open(output, 'w:gz') as archive:
    for name in files:
        archive.add(plugin / name, arcname=f'diddy/{name}')
print(output)

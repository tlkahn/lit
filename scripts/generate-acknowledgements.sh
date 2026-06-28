#!/usr/bin/env bash
set -euo pipefail

# Generate src/data/acknowledgements.json from Rust + JS deps + bundled fonts.
# No external tools required — uses cargo metadata and reads node_modules.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$REPO_ROOT/src/data/acknowledgements.json"

mkdir -p "$(dirname "$OUT")"

python3 -c "
import json, subprocess, os, sys

repo = sys.argv[1]

# ── Rust dependencies ──────────────────────────────────────────────
meta = json.loads(subprocess.check_output(
    ['cargo', 'metadata', '--format-version', '1'],
    cwd=os.path.join(repo, 'src-tauri'),
    stderr=subprocess.DEVNULL,
))

workspace_ids = set(meta.get('workspace_members', []))
workspace_names = set()
for wid in workspace_ids:
    # IDs look like 'path+file:///...#name@version' or 'name version (source)'
    if '#' in wid:
        tail = wid.split('#')[-1]
        workspace_names.add(tail.split('@')[0])
    else:
        workspace_names.add(wid.split(' ')[0])

rust = []
for pkg in sorted(meta['packages'], key=lambda p: p['name'].lower()):
    if pkg['name'] in workspace_names:
        continue
    # Also skip local path-only deps that aren't published
    if pkg.get('source') is None:
        continue
    rust.append({
        'name': pkg['name'],
        'version': pkg['version'],
        'license': pkg.get('license') or 'Unknown',
        'repository': pkg.get('repository') or '',
    })

# ── JavaScript dependencies ───────────────────────────────────────
nm = os.path.join(repo, 'node_modules')
js = []
if os.path.isdir(nm):
    for entry in sorted(os.listdir(nm)):
        pkg_json = os.path.join(nm, entry, 'package.json')
        if entry.startswith('.') or entry.startswith('_'):
            continue
        # Handle scoped packages (@org/pkg)
        if entry.startswith('@'):
            scope_dir = os.path.join(nm, entry)
            if not os.path.isdir(scope_dir):
                continue
            for sub in sorted(os.listdir(scope_dir)):
                pkg_json = os.path.join(scope_dir, sub, 'package.json')
                if os.path.isfile(pkg_json):
                    try:
                        with open(pkg_json) as f:
                            p = json.load(f)
                        js.append({
                            'name': p.get('name', f'{entry}/{sub}'),
                            'version': p.get('version', ''),
                            'license': p.get('license', 'Unknown') if isinstance(p.get('license'), str) else (p.get('license', {}).get('type', 'Unknown') if isinstance(p.get('license'), dict) else 'Unknown'),
                            'repository': (p.get('repository', {}).get('url', '') if isinstance(p.get('repository'), dict) else (p.get('repository') or '')).replace('git+', '').replace('git://', 'https://').rstrip('.git'),
                        })
                    except (json.JSONDecodeError, OSError):
                        pass
            continue
        if os.path.isfile(pkg_json):
            try:
                with open(pkg_json) as f:
                    p = json.load(f)
                js.append({
                    'name': p.get('name', entry),
                    'version': p.get('version', ''),
                    'license': p.get('license', 'Unknown') if isinstance(p.get('license'), str) else (p.get('license', {}).get('type', 'Unknown') if isinstance(p.get('license'), dict) else 'Unknown'),
                    'repository': (p.get('repository', {}).get('url', '') if isinstance(p.get('repository'), dict) else (p.get('repository') or '')).replace('git+', '').replace('git://', 'https://').rstrip('.git'),
                })
            except (json.JSONDecodeError, OSError):
                pass

# ── Bundled fonts ─────────────────────────────────────────────────
fonts = [
    {
        'name': 'Junicode',
        'license': 'OFL-1.1',
        'url': 'https://github.com/psb1558/Junicode-font',
    },
    {
        'name': 'Source Sans 3',
        'license': 'OFL-1.1',
        'url': 'https://github.com/adobe-fonts/source-sans',
    },
]

result = {'rust': rust, 'js': js, 'fonts': fonts}
with open(sys.argv[2], 'w') as f:
    json.dump(result, f, indent=2, ensure_ascii=False)
    f.write('\n')

print(f'Written {len(rust)} Rust + {len(js)} JS + {len(fonts)} font entries to {sys.argv[2]}')
" "$REPO_ROOT" "$OUT"

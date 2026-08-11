#!/usr/bin/env bash
set -euo pipefail

# Generate src/data/acknowledgements.json from Rust + JS deps + bundled fonts.
# No external tools required — uses cargo metadata and reads node_modules.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$REPO_ROOT/src/data/acknowledgements.json"

mkdir -p "$(dirname "$OUT")"

python3 -c "
import json, subprocess, os, sys, re
from collections import deque

repo = sys.argv[1]

def normalize_repo(raw):
    if not raw or raw.startswith('http'):
        return raw
    # ssh://git@github.com/owner/name or git@github.com:owner/name
    if raw.startswith('ssh://'):
        raw = raw[len('ssh://'):]
    m = re.match(r'git@([^:/]+)[:/](.*)', raw)
    if m:
        return f'https://{m.group(1)}/{m.group(2)}'
    # github:owner/name, gitlab:owner/name, bitbucket:owner/name, gist:id
    for prefix, host in [('github:', 'github.com'), ('gitlab:', 'gitlab.com'), ('bitbucket:', 'bitbucket.org'), ('gist:', 'gist.github.com')]:
        if raw.startswith(prefix):
            return f'https://{host}/{raw[len(prefix):]}'
    # bare owner/name (npm convention: defaults to GitHub)
    if re.match(r'^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$', raw):
        return f'https://github.com/{raw}'
    return raw

def parse_pkg(p, fallback_name):
    if isinstance(p.get('license'), str):
        lic = p.get('license', 'Unknown')
    elif isinstance(p.get('license'), dict):
        lic = p.get('license', {}).get('type', 'Unknown')
    else:
        lic = 'Unknown'
    raw_repo = p.get('repository', '')
    if isinstance(raw_repo, dict):
        raw_repo = raw_repo.get('url', '')
    raw_repo = (raw_repo or '').replace('git+', '').replace('git://', 'https://').removesuffix('.git')
    return {
        'name': p.get('name', fallback_name),
        'version': p.get('version', ''),
        'license': lic,
        'repository': normalize_repo(raw_repo),
    }

# ── Rust dependencies (normal-dep closure only) ──────────────────
# Get host triple so we can prune platform-specific crates
host_triple = None
for line in subprocess.check_output(['rustc', '-vV']).decode().splitlines():
    if line.startswith('host:'):
        host_triple = line.split(':', 1)[1].strip()
        break

meta_cmd = ['cargo', 'metadata', '--format-version', '1']
if host_triple:
    meta_cmd += ['--filter-platform', host_triple]
meta = json.loads(subprocess.check_output(
    meta_cmd,
    cwd=os.path.join(repo, 'src-tauri'),
    stderr=subprocess.DEVNULL,
))

workspace_ids = set(meta.get('workspace_members', []))
pkg_map = {p['id']: p for p in meta['packages']}
node_map = {n['id']: n for n in meta['resolve']['nodes']}

# BFS from workspace members, following only normal (kind=None) edges
visited = set()
queue = deque(workspace_ids)
while queue:
    nid = queue.popleft()
    if nid in visited:
        continue
    visited.add(nid)
    node = node_map.get(nid)
    if not node:
        continue
    for dep in node['deps']:
        has_normal = any(dk.get('kind') is None for dk in dep.get('dep_kinds', []))
        if has_normal and dep['pkg'] not in visited:
            queue.append(dep['pkg'])

rust = []
for pid in sorted(visited):
    if pid in workspace_ids:
        continue
    pkg = pkg_map.get(pid)
    if not pkg:
        continue
    # Skip local path-only deps that aren't published
    if pkg.get('source') is None:
        continue
    rust.append({
        'name': pkg['name'],
        'version': pkg['version'],
        'license': pkg.get('license') or 'Unknown',
        'repository': pkg.get('repository') or '',
    })

# ── JavaScript dependencies (runtime closure only) ───────────────
nm = os.path.join(repo, 'node_modules')
js = []
if os.path.isdir(nm):
    # Read root package.json to get runtime dependencies
    with open(os.path.join(repo, 'package.json')) as f:
        root_pkg = json.load(f)
    runtime_seeds = set(root_pkg.get('dependencies', {}).keys())

    # BFS: walk dependencies + optionalDependencies of each reached package
    js_visited = set()
    js_queue = deque(runtime_seeds)
    while js_queue:
        pkg_name = js_queue.popleft()
        if pkg_name in js_visited:
            continue
        js_visited.add(pkg_name)
        pkg_json = os.path.join(nm, pkg_name, 'package.json')
        if not os.path.isfile(pkg_json):
            continue
        try:
            with open(pkg_json) as f:
                p = json.load(f)
            for dep_key in ('dependencies', 'optionalDependencies'):
                for dep_name in p.get(dep_key, {}):
                    if dep_name not in js_visited:
                        js_queue.append(dep_name)
        except (json.JSONDecodeError, OSError):
            pass

    # Emit only reached packages, using the existing parse_pkg
    for pkg_name in sorted(js_visited):
        pkg_json = os.path.join(nm, pkg_name, 'package.json')
        if not os.path.isfile(pkg_json):
            continue
        try:
            with open(pkg_json) as f:
                p = json.load(f)
            js.append(parse_pkg(p, pkg_name))
        except (json.JSONDecodeError, OSError):
            pass

# ── Bundled fonts ─────────────────────────────────────────────────
fonts = [
    {
        'name': 'IBM Plex Sans',
        'license': 'OFL-1.1',
        'url': 'https://github.com/IBM/plex',
    },
    {
        'name': 'IBM Plex Serif',
        'license': 'OFL-1.1',
        'url': 'https://github.com/IBM/plex',
    },
    {
        'name': 'IBM Plex Mono',
        'license': 'OFL-1.1',
        'url': 'https://github.com/IBM/plex',
    },
]

result = {'rust': rust, 'js': js, 'fonts': fonts}
with open(sys.argv[2], 'w') as f:
    json.dump(result, f, indent=2, ensure_ascii=False)
    f.write('\n')

print(f'Written {len(rust)} Rust + {len(js)} JS + {len(fonts)} font entries to {sys.argv[2]}')
" "$REPO_ROOT" "$OUT"

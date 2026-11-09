"""Compare authored source against the preserved ZIP extraction manifest."""
import hashlib
import json
import os
from pathlib import Path

root = Path(__file__).resolve().parent.parent
original = json.loads((root.parent / 'source-provenance.json').read_text(encoding='utf-8'))
before = {row['path']: row['sha256'] for row in original['files']}
skip_dirs = {'node_modules', '.next', '.git', '__pycache__', '.local', '.temp'}
skip_files = {'docs/erp/qa/source-changes.json', 'next-env.d.ts'}
after = {}
for directory, dirs, files in os.walk(root):
    dirs[:] = [name for name in dirs if name not in skip_dirs]
    for name in files:
        path = Path(directory) / name
        rel = path.relative_to(root).as_posix()
        if rel in skip_files or rel.startswith('qa/results/') or name.endswith(('.log', '.tsbuildinfo')):
            continue
        if name.startswith('.env') and not name.endswith('.example'):
            continue
        if rel.startswith('qa/local-stack/supabase/.'):
            continue
        after[rel] = hashlib.sha256(path.read_bytes()).hexdigest()
report = {
    'source_archive': original['archive'], 'source_archive_sha256': original['sha256'],
    'archive_still_matches': hashlib.sha256(Path(original['archive']).read_bytes()).hexdigest() == original['sha256'],
    'modified': sorted(name for name in after if name in before and after[name] != before[name]),
    'added': sorted(name for name in after if name not in before),
    'removed': sorted(name for name in before if name not in after),
    'excluded': 'dependencies, build output, env secrets, logs and local QA runtime state',
}
target = root / 'docs/erp/qa/source-changes.json'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps({key: len(report[key]) for key in ['modified', 'added', 'removed']}))
print('Original ZIP unchanged:', report['archive_still_matches'])

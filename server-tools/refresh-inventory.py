#!/usr/bin/python3 -I
"""Refresh a bounded, read-only inventory for the sandboxed Codex agent."""
import datetime
import json
import os
import pathlib
import subprocess
import tempfile

output = pathlib.Path.home() / '.local/share/codex-watch-vps/projects/services-docker.json'
result = subprocess.run(['/usr/bin/sudo', '-n', '/usr/local/sbin/codex-watch-services', 'list'],
                        check=True, capture_output=True, text=True, timeout=20,
                        env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C'})
items = json.loads(result.stdout)
if not isinstance(items, list):
    raise SystemExit('Invalid inventory')
system_result = subprocess.run(['/usr/bin/systemctl', 'list-units', '--type=service', '--all',
                                '--no-legend', '--no-pager', '--plain'], check=True,
                               capture_output=True, text=True, timeout=20,
                               env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C'})
system_services = []
for line in system_result.stdout.splitlines():
    parts = line.split(maxsplit=4)
    if len(parts) >= 4:
        system_services.append(dict(zip(('unit', 'load', 'active', 'sub', 'description'), parts)))
data = {'updatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'containers': items, 'systemServices': system_services}
fd, name = tempfile.mkstemp(prefix='.docker-inventory-', dir=output.parent)
try:
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
        f.write('\n')
    os.replace(name, output)
finally:
    if os.path.exists(name):
        os.unlink(name)

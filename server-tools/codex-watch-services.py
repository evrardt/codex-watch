#!/usr/bin/python3 -I
"""Restricted Docker and systemd operations for Codex Watch's server.

Run as root only via a sudoers rule for this exact, root-owned executable.
Never accept arbitrary flags, templates, commands, or container output.
Install write operations only when the calling agent is sandboxed and every
escape is approved by a trusted user. This helper does not itself verify approval.
"""
import json
import re
import subprocess
import sys

DOCKER = '/usr/bin/docker'
IDENTIFIER = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$')
UNIT = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,127}\.service$')
CRITICAL_UNITS = frozenset(('ssh.service', 'sshd.service', 'docker.service', 'containerd.service',
                            'tailscaled.service', 'dbus.service', 'apparmor.service', 'networking.service',
                            'NetworkManager.service', 'nftables.service', 'ufw.service', 'firewalld.service'))


def docker_inventory():
    result = subprocess.run([DOCKER, 'ps', '--all', '--no-trunc', '--format', '{{json .}}'],
                            check=True, capture_output=True, text=True, timeout=15,
                            env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C'})
    entries = []
    for line in result.stdout.splitlines():
        item = json.loads(line)
        entries.append({key: item.get(key, '') for key in ('ID', 'Names', 'Image', 'State', 'Status', 'Ports')})
    return entries


def run(args):
    if args == ['list']:
        return docker_inventory()
    if len(args) == 2 and args[0] == 'status' and IDENTIFIER.fullmatch(args[1]):
        entries = [item for item in docker_inventory()
                   if item['Names'] == args[1] or item['ID'] == args[1]]
        if len(entries) != 1:
            raise ValueError('Conteneur introuvable')
        return entries[0]
    if len(args) == 3 and args[0] == 'container' and args[1] in ('start', 'stop', 'restart') and IDENTIFIER.fullmatch(args[2]):
        entries = [item for item in docker_inventory() if item['Names'] == args[2] or item['ID'] == args[2]]
        if len(entries) != 1 or not re.fullmatch(r'[0-9a-f]{64}', entries[0]['ID']):
            raise ValueError('Conteneur introuvable')
        subprocess.run([DOCKER, args[1], '--', entries[0]['ID']], check=True, capture_output=True, text=True,
                       timeout=90, env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C'})
        return {'operation': args[1], 'container': entries[0]['Names'], 'result': 'ok'}
    if len(args) == 3 and args[0] == 'service' and args[1] in ('start', 'stop', 'restart') and UNIT.fullmatch(args[2]):
        result = subprocess.run(['/usr/bin/systemctl', 'show', '--property=Id', '--property=LoadState', '--', args[2]],
                                check=True, capture_output=True, text=True, timeout=15,
                                env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C'})
        properties = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
        unit = properties.get('Id', '')
        if (properties.get('LoadState') != 'loaded' or not UNIT.fullmatch(unit)
                or unit in CRITICAL_UNITS or args[2] in CRITICAL_UNITS or unit.startswith(('systemd-', 'user@'))):
            raise ValueError('Service introuvable ou protégé')
        subprocess.run(['/usr/bin/systemctl', args[1], '--', unit], check=True, capture_output=True, text=True,
                       timeout=90, env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C'})
        return {'operation': args[1], 'service': unit, 'result': 'ok'}
    raise ValueError('Usage : list | status NOM | container start|stop|restart NOM | service start|stop|restart NOM.service')


def main():
    try:
        print(json.dumps(run(sys.argv[1:]), ensure_ascii=False))
    except (ValueError, subprocess.SubprocessError, OSError, json.JSONDecodeError) as exc:
        print('Erreur : ' + (str(exc) if isinstance(exc, ValueError) else 'Inventaire indisponible'), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())

import importlib.util
import json
import pathlib
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('services', pathlib.Path(__file__).with_name('codex-watch-services.py'))
services = importlib.util.module_from_spec(spec)
spec.loader.exec_module(services)


class InventoryTest(unittest.TestCase):
    def test_inventory_exposes_only_selected_fields(self):
        row = {'ID': 'a' * 64, 'Names': 'web', 'Image': 'example', 'State': 'running',
               'Status': 'Up', 'Ports': '443/tcp', 'Command': 'private value', 'Labels': 'secret'}
        with patch.object(services.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, json.dumps(row), '')) as mock:
            self.assertEqual(services.run(['list']), [{k: row[k] for k in ('ID', 'Names', 'Image', 'State', 'Status', 'Ports')}])
            self.assertEqual(mock.call_args.args[0][:3], ['/usr/bin/docker', 'ps', '--all'])
            self.assertEqual(mock.call_args.kwargs['timeout'], 15)

    def test_status_exact_match_only(self):
        row = {'ID': 'a' * 64, 'Names': 'web'}
        with patch.object(services, 'docker_inventory', return_value=[row]):
            self.assertEqual(services.run(['status', 'web']), row)
            self.assertEqual(services.run(['status', 'a' * 64]), row)
            for name in ('we', 'a' * 12, '--help', '../web', 'web;id'):
                with self.assertRaises(ValueError):
                    services.run(['status', name])

    def test_rejects_mutations_and_extra_arguments(self):
        with patch.object(services, 'docker_inventory') as inventory:
            for args in ([], ['restart', 'web'], ['list', '--help'], ['status', 'web', 'extra'],
                         ['container', 'exec', 'web'], ['container', 'restart', '--help'],
                         ['container', 'restart', 'web;id']):
                with self.assertRaises(ValueError):
                    services.run(args)
            inventory.assert_not_called()

    def test_container_operation_uses_exact_immutable_id(self):
        item = {'ID': 'a' * 64, 'Names': 'web'}
        with patch.object(services, 'docker_inventory', return_value=[item]), patch.object(services.subprocess, 'run') as mock:
            self.assertEqual(services.run(['container', 'restart', 'web'])['result'], 'ok')
            self.assertEqual(mock.call_args.args[0], ['/usr/bin/docker', 'restart', '--', 'a' * 64])
            with self.assertRaises(ValueError):
                services.run(['container', 'stop', 'we'])
            self.assertEqual(mock.call_count, 1)

    def test_service_operation_rejects_critical_alias_and_uses_canonical_name(self):
        show = subprocess.CompletedProcess([], 0, 'Id=ssh.service\nLoadState=loaded\n', '')
        with patch.object(services.subprocess, 'run', return_value=show) as mock:
            with self.assertRaises(ValueError):
                services.run(['service', 'restart', 'alias.service'])
            self.assertEqual(mock.call_count, 1)
        show.stdout = 'Id=example.service\nLoadState=loaded\n'
        with patch.object(services.subprocess, 'run', return_value=show) as mock:
            self.assertEqual(services.run(['service', 'restart', 'alias.service'])['service'], 'example.service')
            self.assertEqual(mock.call_args.args[0], ['/usr/bin/systemctl', 'restart', '--', 'example.service'])


if __name__ == '__main__':
    unittest.main()

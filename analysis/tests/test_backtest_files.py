import json
from pathlib import Path
import tempfile
import unittest

from test_identities import game
from test_baseline import PROTOCOL
from backtest import run_backtest
from identities import audit_identity_files
from ingest import digest


class BacktestFilesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.games, self.audit = self.root / 'games.jsonl', self.root / 'source.json'
        self.identity = self.root / 'identity/audit.json'
        self.protocol, self.output = self.root / 'protocol.json', self.root / 'output'
        rows = [game('warmup', '2024-01-01T00:00:00Z'), game('development', '2025-02-01T00:00:00Z'),
                game('evaluation', '2026-02-01T00:00:00Z'), game('holdout', '2026-09-09T00:00:00Z')]
        self.games.write_text(''.join(json.dumps(row)+'\n' for row in rows))
        self.audit.write_text(json.dumps({'corpus_version': 'chaincc-corpus-v1',
                                         'canonical_sha256': digest(self.games.read_bytes()),
                                         'canonical_games': 4, 'cutoff_utc': '2026-10-21T00:00:00Z',
                                         'source_timezone_assumption': 'UTC', 'timezone_verified': False}))
        audit_identity_files(self.games, self.audit, '2026-10-21T00:00:00Z', self.identity.parent)
        self.protocol.write_text(json.dumps({**PROTOCOL, 'bootstrap_replicates': 20}))

    def run_backtest(self):
        return run_backtest(self.games, self.audit, self.identity, self.protocol, self.output)

    def test_full_pipeline_is_byte_reproducible_and_non_promotable(self):
        report = self.run_backtest()
        files = {path.name: path.read_bytes() for path in self.output.iterdir()}
        self.assertEqual(report, self.run_backtest())
        self.assertEqual(files, {path.name: path.read_bytes() for path in self.output.iterdir()})
        self.assertFalse(report['public_promotion_allowed'])
        self.assertEqual(report['runs']['1']['periods']['holdout_2026']['games'], 1)
        for days, run in report['runs'].items():
            self.assertEqual(run['prediction_sha256'], digest(files[f'predictions-delay-{days}.jsonl']))

    def test_corrupt_corpus_fails_before_writing(self):
        self.games.write_text(self.games.read_text()+'\n')
        with self.assertRaises(ValueError):
            self.run_backtest()
        self.assertFalse(self.output.exists())

    def test_output_cannot_overwrite_a_source_audit(self):
        target = self.root / 'metrics.json'
        target.write_bytes(self.audit.read_bytes())
        before = target.read_bytes()
        with self.assertRaisesRegex(ValueError, 'overwrite an input'):
            run_backtest(self.games, target, self.identity, self.protocol, self.root)
        self.assertEqual(before, target.read_bytes())


if __name__ == '__main__':
    unittest.main()

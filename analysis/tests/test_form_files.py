import copy
import json
from pathlib import Path
import tempfile
import unittest

from test_baseline import PROTOCOL, game
from test_residuals import FORM
from baseline import replay
from form_backtest import run_form_backtest
from ingest import digest


class FormFilesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.base_path, self.config = self.root/'baseline.json', self.root/'protocol.json'
        self.predictions = self.root/'predictions'
        self.predictions.mkdir()
        games = [game('warmup', '2024-02-01T00:00:00Z'), game('dev1', '2025-01-10T00:00:00Z'),
                 game('dev2', '2025-01-12T00:00:00Z'), game('eval1', '2026-02-01T00:00:00Z'),
                 game('eval2', '2026-02-03T00:00:00Z'), game('end', '2026-09-10T00:00:00Z')]
        baseline = {'backtest_version': 'internal-elo-backtest-v1', 'protocol': PROTOCOL,
                    'protocol_sha256': digest(json.dumps(PROTOCOL).encode()),
                    'source_canonical_sha256': 'f'*64, 'runs': {}}
        for days in PROTOCOL['availability_delay_days']:
            rows, _ = replay(games, PROTOCOL, days)
            data = ''.join(json.dumps(row)+'\n' for row in rows).encode()
            (self.predictions/f'predictions-delay-{days}.jsonl').write_bytes(data)
            baseline['runs'][str(days)] = {'prediction_sha256': digest(data)}
        self.base_path.write_text(json.dumps(baseline))
        config = copy.deepcopy(FORM)
        config.update({'baseline_metrics_sha256': digest(self.base_path.read_bytes()),
                       'baseline_protocol_sha256': baseline['protocol_sha256'], 'bootstrap_replicates': 20})
        self.config.write_text(json.dumps(config))
        self.output = self.root/'out'

    def run_experiment(self):
        return run_form_backtest(self.base_path, self.predictions, self.config, self.output)

    def test_nonzero_candidate_roundtrip_is_byte_reproducible(self):
        result = self.run_experiment()
        self.assertGreater(result['selected_on_development_only']['coefficient'], 0)
        self.assertFalse(result['public_promotion_allowed'])
        files = {path.name:path.read_bytes() for path in self.output.iterdir()}
        self.assertEqual(result, self.run_experiment())
        self.assertEqual(files, {path.name:path.read_bytes() for path in self.output.iterdir()})
        for delay, run in result['runs'].items():
            self.assertEqual(run['prediction_sha256'], digest(files[f'predictions-delay-{delay}.jsonl']))
        self.assertEqual(result['runs']['1']['periods']['holdout_2026']['games'], 1)

    def test_corrupted_predictions_fail_before_output(self):
        (self.predictions/'predictions-delay-1.jsonl').write_text('{}\n')
        with self.assertRaisesRegex(ValueError, 'prediction hash'):
            self.run_experiment()
        self.assertFalse(self.output.exists())

    def test_changed_baseline_report_fails_before_output(self):
        self.base_path.write_text(self.base_path.read_text()+'\n')
        with self.assertRaisesRegex(ValueError, 'frozen residual-form protocol'):
            self.run_experiment()
        self.assertFalse(self.output.exists())

    def test_output_cannot_replace_baseline_prediction_files(self):
        source = self.predictions/'predictions-delay-1.jsonl'
        before = source.read_bytes()
        with self.assertRaisesRegex(ValueError, 'overwrite a frozen input'):
            run_form_backtest(self.base_path, self.predictions, self.config, self.predictions)
        self.assertEqual(before, source.read_bytes())


if __name__ == '__main__':
    unittest.main()

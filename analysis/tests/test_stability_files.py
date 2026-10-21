import copy
import json
from pathlib import Path
import tempfile
import unittest

from test_baseline import PROTOCOL, game
from test_lineups import CONFIG, A, B
from baseline import replay
from ingest import digest
from stability_backtest import run_backtest


class StabilityFilesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.base, self.source, self.config = self.root/'base.json', self.root/'games.jsonl', self.root/'config.json'
        self.predictions, self.output = self.root/'predictions', self.root/'out'
        self.predictions.mkdir()
        games = [game('warmup','2024-02-01T00:00:00Z'),game('dev1','2025-01-10T00:00:00Z'),
                 game('dev2','2025-01-12T00:00:00Z'),game('dev3','2025-01-14T00:00:00Z'),
                 game('evaluation','2026-02-01T00:00:00Z'),game('final','2026-09-10T00:00:00Z')]
        for item in games:
            item['roster_a'] = {'players':[{'source_name':name} for name in A]}
            names = ('x1','x2','x3','x4','x5') if item['game_id'] in ['dev2','dev3'] else B
            item['roster_b'] = {'players':[{'source_name':name} for name in names]}
        self.source.write_text(''.join(json.dumps(item)+'\n' for item in games))
        base = {'backtest_version':'internal-elo-backtest-v1','protocol':PROTOCOL,
                'protocol_sha256':digest(json.dumps(PROTOCOL).encode()),
                'source_canonical_sha256':digest(self.source.read_bytes()),'runs':{}}
        for delay in PROTOCOL['availability_delay_days']:
            rows,_ = replay(games,PROTOCOL,delay)
            data = ''.join(json.dumps(row)+'\n' for row in rows).encode()
            (self.predictions/f'predictions-delay-{delay}.jsonl').write_bytes(data)
            base['runs'][str(delay)] = {'prediction_sha256':digest(data)}
        self.base.write_text(json.dumps(base))
        config = copy.deepcopy(CONFIG)
        config.update({'baseline_metrics_sha256':digest(self.base.read_bytes()),
                       'baseline_protocol_sha256':base['protocol_sha256'],
                       'source_canonical_sha256':base['source_canonical_sha256'],'bootstrap_replicates':20})
        self.config.write_text(json.dumps(config))

    def run_experiment(self):
        return run_backtest(self.base,self.predictions,self.source,self.config,self.output)

    def test_nonzero_experiment_is_reproducible_and_does_not_export_target_players(self):
        report = self.run_experiment()
        self.assertGreater(report['selected_on_development_only']['coefficient'],0)
        self.assertFalse(report['public_promotion_allowed'])
        files = {path.name:path.read_bytes() for path in self.output.iterdir()}
        self.assertEqual(report,self.run_experiment())
        self.assertEqual(files,{path.name:path.read_bytes() for path in self.output.iterdir()})
        for row in map(json.loads,files['predictions-delay-1.jsonl'].decode().splitlines()):
            self.assertNotIn('roster_a',row)
            self.assertNotIn('observed_lineup_a',row)

    def test_changed_source_corpus_is_rejected_before_output(self):
        self.source.write_text(self.source.read_text()+'\n')
        with self.assertRaisesRegex(ValueError,'frozen protocol'):
            self.run_experiment()
        self.assertFalse(self.output.exists())

    def test_tampered_predictions_are_rejected_before_output(self):
        (self.predictions/'predictions-delay-1.jsonl').write_text('{}\n')
        with self.assertRaisesRegex(ValueError,'prediction hash'):
            self.run_experiment()
        self.assertFalse(self.output.exists())

    def test_output_cannot_replace_baseline_predictions(self):
        source = self.predictions/'predictions-delay-1.jsonl'
        before = source.read_bytes()
        with self.assertRaisesRegex(ValueError,'overwrite a frozen input'):
            run_backtest(self.base,self.predictions,self.source,self.config,self.predictions)
        self.assertEqual(before,source.read_bytes())


if __name__ == '__main__':
    unittest.main()

import copy
import json
from pathlib import Path
import tempfile
import unittest

from test_baseline import PROTOCOL, game
from test_identities import game as canonical_game
from baseline import replay
from backtest import run_backtest
from elo_tuning import run_tuning, select_k, validate_tuning
from identities import audit_identity_files
from ingest import digest

TUNING = json.loads((Path(__file__).resolve().parents[1]/'config/internal-elo-tuning-v1.json').read_text())


class TuningTests(unittest.TestCase):
    def test_scale_and_location_changes_do_not_identify_a_separate_divisor(self):
        games = [game('first','2024-01-01T00:00:00Z'),game('second','2024-01-03T00:00:00Z'),
                 game('third','2024-01-05T00:00:00Z',0)]
        first = replay(games,PROTOCOL,1)[0]
        transformed = replay(games,{**PROTOCOL,'divisor':800,'k_factor':64,'initial_rating':0},1)[0]
        for a,b in zip(first,transformed):
            self.assertAlmostEqual(a['p_win_a'],b['p_win_a'],places=14)
            self.assertAlmostEqual(a['log_loss'],b['log_loss'],places=14)

    def test_ties_keep_existing_reference_k(self):
        games = [game('dev','2025-01-10T00:00:00Z')]
        selected,candidates = select_k(games,PROTOCOL,TUNING)
        self.assertEqual(selected['k_factor'],32)
        self.assertEqual(len(candidates),4)
        self.assertTrue(all(candidate['development']['log_loss']==candidates[0]['development']['log_loss'] for candidate in candidates))

    def test_selection_excludes_all_2026_outcomes(self):
        games = [game('warmup','2024-01-01T00:00:00Z'),game('dev1','2025-01-10T00:00:00Z'),
                 game('dev2','2025-01-12T00:00:00Z'),game('future','2026-02-01T00:00:00Z')]
        before = select_k(games,PROTOCOL,TUNING)
        games[-1]['win_a'] = 0
        games[-1]['team_a_id'] = 'future-team'
        self.assertEqual(before,select_k(games,PROTOCOL,TUNING))

    def test_selection_uses_only_primary_delay_and_fixed_scale(self):
        for changes in [{'selection_delay_days':3},{'fixed_divisor':200},{'fixed_initial_rating':0}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate_tuning({**TUNING,**changes},PROTOCOL)

    def test_invalid_grids_and_promotable_protocol_are_rejected(self):
        for changes in [{'k_candidates':[0,32]},{'k_candidates':[16,16,32]},
                        {'k_candidates':[8,16]},{'k_candidates':[32,float('nan')]},{'promotion_allowed':True}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate_tuning({**TUNING,**changes},PROTOCOL)

    def test_no_development_returns_error_not_a_fabricated_optimum(self):
        with self.assertRaises(ValueError):
            select_k([game('warmup','2024-01-01T00:00:00Z')],PROTOCOL,TUNING)

    def test_search_does_not_mutate_inputs(self):
        games = [game('dev','2025-01-10T00:00:00Z')]
        original = copy.deepcopy((games,PROTOCOL,TUNING))
        select_k(games,PROTOCOL,TUNING)
        self.assertEqual((games,PROTOCOL,TUNING),original)


class TuningFilesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.games,self.corpus,self.identity = self.root/'games.jsonl',self.root/'corpus.json',self.root/'identity/audit.json'
        self.base_protocol,self.config = self.root/'base-protocol.json',self.root/'tuning.json'
        self.predictions,self.output = self.root/'baseline',self.root/'selected'
        rows = [canonical_game('warmup','2024-01-01T00:00:00Z'),canonical_game('dev1','2025-01-10T00:00:00Z'),
                canonical_game('dev2','2025-01-12T00:00:00Z'),canonical_game('eval','2026-02-01T00:00:00Z'),
                canonical_game('final','2026-09-10T00:00:00Z')]
        self.games.write_text(''.join(json.dumps(row)+'\n' for row in rows))
        self.corpus.write_text(json.dumps({'corpus_version':'chaincc-corpus-v1','canonical_sha256':digest(self.games.read_bytes()),
                                          'canonical_games':len(rows),'cutoff_utc':'2026-10-21T00:00:00Z',
                                          'source_timezone_assumption':'UTC','timezone_verified':False}))
        audit_identity_files(self.games,self.corpus,'2026-10-21T00:00:00Z',self.identity.parent)
        self.base_protocol.write_text(json.dumps({**PROTOCOL,'bootstrap_replicates':20}))
        base = run_backtest(self.games,self.corpus,self.identity,self.base_protocol,self.predictions)
        self.base = self.predictions/'metrics.json'
        tuning = {**TUNING,'baseline_metrics_sha256':digest(self.base.read_bytes()),
                  'baseline_protocol_sha256':base['protocol_sha256'],
                  'source_canonical_sha256':base['source_canonical_sha256'],'bootstrap_replicates':20}
        self.config.write_text(json.dumps(tuning))

    def run_experiment(self):
        return run_tuning(self.games,self.corpus,self.identity,self.base,self.predictions,self.config,self.output)

    def test_selected_k_pipeline_is_reproducible_and_non_promotable(self):
        report = self.run_experiment()
        self.assertFalse(report['public_promotion_allowed'])
        self.assertEqual(report['selected_replay_protocol']['k_factor'],report['selected_on_development_only']['k_factor'])
        files = {path.name:path.read_bytes() for path in self.output.iterdir()}
        self.assertEqual(report,self.run_experiment())
        self.assertEqual(files,{path.name:path.read_bytes() for path in self.output.iterdir()})
        for delay,run in report['runs'].items():
            self.assertEqual(run['prediction_sha256'],digest(files[f'predictions-delay-{delay}.jsonl']))
            self.assertEqual(run['periods']['holdout_2026']['games'],1)

    def test_reference_only_grid_preserves_original_prediction_hashes(self):
        config = json.loads(self.config.read_text())
        config['k_candidates'] = [32]
        self.config.write_text(json.dumps(config))
        report = self.run_experiment()
        base = json.loads(self.base.read_text())
        for delay,run in report['runs'].items():
            self.assertEqual(run['prediction_sha256'],base['runs'][delay]['prediction_sha256'])
            self.assertEqual(run['periods']['evaluation_2026']['paired_vs_k32_reference']['log_loss_advantage'],0)

    def test_corrupt_prediction_fails_before_output(self):
        (self.predictions/'predictions-delay-1.jsonl').write_text('{}\n')
        with self.assertRaisesRegex(ValueError,'prediction hash'):
            self.run_experiment()
        self.assertFalse(self.output.exists())

    def test_changed_corpus_fails_before_output(self):
        self.games.write_text(self.games.read_text()+'\n')
        with self.assertRaises(ValueError):
            self.run_experiment()
        self.assertFalse(self.output.exists())

    def test_output_cannot_replace_frozen_predictions(self):
        source = self.predictions/'predictions-delay-1.jsonl'
        before = source.read_bytes()
        with self.assertRaisesRegex(ValueError,'overwrite a frozen input'):
            run_tuning(self.games,self.corpus,self.identity,self.base,self.predictions,self.config,self.predictions)
        self.assertEqual(before,source.read_bytes())


if __name__ == '__main__':
    unittest.main()

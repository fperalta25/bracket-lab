import copy
import json
import math
from pathlib import Path
import tempfile
import unittest

from baseline import replay
from confidence_backtest import run, scale, select, validate
from ingest import digest
from test_baseline import PROTOCOL, game

CONFIG = json.loads((Path(__file__).resolve().parents[1]/'config/elo-confidence-v1.json').read_text())


class ConfidenceTests(unittest.TestCase):
    def setUp(self):
        self.rows = replay([game('a','2024-01-01T00:00:00Z'), game('b','2025-01-10T00:00:00Z'),
                            game('c','2025-01-12T00:00:00Z'), game('d','2026-02-01T00:00:00Z')], PROTOCOL, 1)[0]

    def test_identity_is_exact_and_inputs_unchanged(self):
        before = copy.deepcopy(self.rows)
        self.assertEqual(scale(self.rows,1,400),self.rows)
        scale(self.rows,.75,400)
        self.assertEqual(before,self.rows)

    def test_swap_symmetry_and_equal_rating_neutrality(self):
        row = {**self.rows[0], 'rating_a_before':1600, 'rating_b_before':1400}
        swapped = {**row,'rating_a_before':1400,'rating_b_before':1600}
        for slope in CONFIG['slope_candidates']:
            a,b = scale([row,swapped],slope,400)
            self.assertAlmostEqual(a['p_win_a']+b['p_win_a'],1)
            self.assertEqual(scale([self.rows[0]],slope,400)[0]['p_win_a'],.5)

    def test_saturated_probabilities_keep_finite_log_loss(self):
        row = {**self.rows[0],'rating_a_before':1e6,'rating_b_before':0,'win_a':0}
        result = scale([row],1.5,400)[0]
        self.assertEqual(result['p_win_a'],1)
        self.assertTrue(math.isfinite(result['log_loss']))
        self.assertGreater(result['log_loss'],1000)

    def test_scaling_does_not_use_outcomes_or_modify_rating_feedback(self):
        other = [{**r,'win_a':1-r['win_a']} for r in self.rows]
        a,b = scale(self.rows,.75,400),scale(other,.75,400)
        for original,left,right in zip(self.rows,a,b):
            self.assertEqual(left['p_win_a'],right['p_win_a'])
            self.assertEqual(left['rating_a_before'],original['rating_a_before'])
            self.assertEqual(left['assumed_available_at_utc'],original['assumed_available_at_utc'])

    def test_selection_excludes_future_labels(self):
        before = select(self.rows,CONFIG,400)
        self.rows[-1]['win_a'] = 1-self.rows[-1]['win_a']
        self.rows[-1]['rating_a_before'] = 99999
        self.assertEqual(before,select(self.rows,CONFIG,400))

    def test_tie_retains_identity_and_empty_development_rejected(self):
        neutral = [{**self.rows[0],'period':'development_2025','scored':True}]
        self.assertEqual(select(neutral,CONFIG,400)[0]['slope'],1)
        with self.assertRaises(ValueError):
            select([],CONFIG,400)

    def test_invalid_protocols_and_slopes_rejected(self):
        for change in [{'promotion_allowed':True},{'slope_candidates':[.5]},
                       {'slope_candidates':[1,1]},{'slope_candidates':[1,0]},
                       {'slope_candidates':[1,float('nan')]},{'selection_period':'evaluation_2026'},
                       {'selection_delay_days':3}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate({**CONFIG,**change},PROTOCOL)
        for value in [0,-1,True,float('inf')]:
            with self.assertRaises(ValueError):
                scale(self.rows,value,400)


class ConfidenceFilesTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.base,self.config,self.output = self.root/'base.json',self.root/'protocol.json',self.root/'output'
        protocol = {**PROTOCOL,'bootstrap_replicates':5}
        runs = {}
        for delay in protocol['availability_delay_days']:
            rows = replay([game('dev','2025-01-10T00:00:00Z'),game('eval','2026-02-01T00:00:00Z'),
                           game('final','2026-09-10T00:00:00Z')],protocol,delay)[0]
            raw = ''.join(json.dumps(row,sort_keys=True,ensure_ascii=False)+'\n' for row in rows).encode()
            (self.root/f'predictions-delay-{delay}.jsonl').write_bytes(raw)
            runs[str(delay)] = {'prediction_sha256':digest(raw)}
        base = {'backtest_version':'internal-elo-backtest-v1','protocol':protocol,'protocol_sha256':'protocol',
                'source_canonical_sha256':'corpus','runs':runs}
        self.base.write_text(json.dumps(base))
        self.config.write_text(json.dumps({**CONFIG,'baseline_metrics_sha256':digest(self.base.read_bytes()),
                                          'baseline_protocol_sha256':'protocol','source_canonical_sha256':'corpus',
                                          'bootstrap_replicates':5}))

    def run_comparison(self):
        return run(self.base,self.root,self.config,self.output)

    def test_pipeline_is_repeatable_and_identity_preserves_frozen_hashes(self):
        report = self.run_comparison()
        self.assertFalse(report['public_promotion_allowed'])
        self.assertEqual(report['selected_on_development_only']['slope'],1)
        frozen = {p.name:p.read_bytes() for p in self.output.iterdir()}
        self.assertEqual(report,self.run_comparison())
        self.assertEqual(frozen,{p.name:p.read_bytes() for p in self.output.iterdir()})
        for delay in report['runs']:
            self.assertEqual((self.root/f'predictions-delay-{delay}.jsonl').read_bytes(),
                             frozen[f'predictions-delay-{delay}.jsonl'])

    def test_selected_nonidentity_applies_once_to_all_sensitivities(self):
        original = json.loads((self.root/'predictions-delay-1.jsonl').read_text().splitlines()[0])
        rows = []
        for i in range(12):
            y = int(i < 9)
            rows.append({**original,'game_id':str(i),'rating_a_before':400*math.log10(4),
                         'rating_b_before':0,'p_win_a':.8,'win_a':y,
                         'log_loss':-math.log(.8 if y else .2),'brier':(.8-y)**2})
        raw = ''.join(json.dumps(row,sort_keys=True,ensure_ascii=False)+'\n' for row in rows).encode()
        (self.root/'predictions-delay-1.jsonl').write_bytes(raw)
        base = json.loads(self.base.read_text())
        base['runs']['1']['prediction_sha256'] = digest(raw)
        self.base.write_text(json.dumps(base))
        config = json.loads(self.config.read_text())
        config['baseline_metrics_sha256'] = digest(self.base.read_bytes())
        self.config.write_text(json.dumps(config))
        report = self.run_comparison()
        self.assertEqual(report['selected_on_development_only']['slope'],.75)
        for delay in report['runs']:
            before = [json.loads(line) for line in (self.root/f'predictions-delay-{delay}.jsonl').read_text().splitlines()]
            after = [json.loads(line) for line in (self.output/f'predictions-delay-{delay}.jsonl').read_text().splitlines()]
            self.assertEqual(after,scale(before,.75,400))

    def test_tampered_inputs_fail_before_output(self):
        (self.root/'predictions-delay-1.jsonl').write_text('{}\n')
        with self.assertRaisesRegex(ValueError,'hash mismatch'):
            self.run_comparison()
        self.assertFalse(self.output.exists())

    def test_frozen_report_hash_and_overwrite_protection(self):
        original = self.base.read_bytes()
        with self.assertRaisesRegex(ValueError,'overwrite'):
            run(self.base,self.root,self.config,self.root)
        self.assertEqual(original,self.base.read_bytes())
        self.base.write_bytes(original+b'\n')
        with self.assertRaisesRegex(ValueError,'baseline mismatch'):
            self.run_comparison()

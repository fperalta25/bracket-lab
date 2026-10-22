import copy
import json
from pathlib import Path
import unittest

from baseline import replay
from calibrated_form import run, select_observed_variant
from confidence_backtest import scale
from export_form import export
from ingest import digest
from observed_form import last_observed_features, forms_at_cutoff
from test_baseline import PROTOCOL, game
import test_export_elo as export_fixture
from elo_tuning import run_tuning

ROOT=Path(__file__).resolve().parents[1]
CONFIG=json.loads((ROOT/'config/last-observed-form-v1.json').read_text())


class ObservedFormTests(unittest.TestCase):
    def rows(self):
        return replay([game('a','2024-01-01T00:00:00Z'),game('b','2025-01-10T00:00:00Z'),
                       game('c','2025-01-12T00:00:00Z'),game('future','2026-02-01T00:00:00Z')],PROTOCOL,1)[0]

    def test_strict_availability_and_stale_history_remain_distinct_from_missing(self):
        rows=self.rows()
        early=forms_at_cutoff(rows,['a','unknown'],'2024-01-02T00:00:00Z',5,3)
        self.assertIsNone(early['a']['value'])
        later=forms_at_cutoff(rows,['a','b','unknown'],'2024-12-01T00:00:00Z',5,3)
        self.assertAlmostEqual(later['a']['value'],.125)
        self.assertAlmostEqual(later['b']['value'],-.125)
        self.assertGreater(later['a']['age_days'],300)
        self.assertIsNone(later['unknown']['value'])

    def test_grouping_gives_each_source_day_equal_weight_and_limits_number_of_days(self):
        row=self.rows()[0]
        rows=[{**row,'game_id':str(i),'event_start_utc':f'2024-01-01T0{i}:00:00Z',
               'assumed_available_at_utc':f'2024-01-02T0{i}:00:00Z','win_a':1,'p_win_a':.5} for i in range(3)]
        rows.append({**row,'game_id':'loss','event_start_utc':'2024-01-03T00:00:00Z',
                     'assumed_available_at_utc':'2024-01-04T00:00:00Z','win_a':0,'p_win_a':.5})
        form=forms_at_cutoff(rows,['a'],'2024-01-05T00:00:00Z',2,3)['a']
        self.assertEqual(form['value'],0);self.assertEqual(form['games'],4);self.assertEqual(form['days'],2)
        self.assertAlmostEqual(forms_at_cutoff(rows,['a'],'2024-01-05T00:00:00Z',1,3)['a']['value'],-.125)

    def test_snapshot_equals_rolling_feature_at_the_same_cutoff_and_future_labels_do_not_enter(self):
        rows=self.rows();features=last_observed_features(rows,3,3)
        cutoff=rows[-1]['event_start_utc']
        snapshot=forms_at_cutoff(rows,['a'],cutoff,3,3)['a']
        self.assertEqual(snapshot,features[-1]['form_a'])
        rows[-1]['win_a']=1-rows[-1]['win_a']
        self.assertEqual(snapshot,forms_at_cutoff(rows,['a'],cutoff,3,3)['a'])

    def test_selection_never_uses_2026_and_ties_keep_base(self):
        rows=scale(self.rows(),.75,400);before=select_observed_variant(rows,CONFIG,400/.75)
        rows[-1]['win_a']=1-rows[-1]['win_a'];rows[-1]['p_win_a']=.99
        self.assertEqual(before,select_observed_variant(rows,CONFIG,400/.75))
        neutral=[{**rows[0],'period':'development_2025','scored':True}]
        self.assertEqual(select_observed_variant(neutral,CONFIG,400/.75)[0]['coefficient'],0)

    def test_input_order_duplicates_and_invalid_sizes(self):
        rows=self.rows();before=copy.deepcopy(rows)
        self.assertEqual(last_observed_features(rows,3,3),last_observed_features(list(reversed(rows)),3,3))
        self.assertEqual(rows,before)
        with self.assertRaises(ValueError):last_observed_features(rows+[rows[0]],3,3)
        for size in [0,-1,1.5]:
            with self.assertRaises(ValueError):last_observed_features(rows,size,3)


class LearnedFormFilesTests(unittest.TestCase):
    def setUp(self):
        # Reuse the existing real pipeline fixture, including audits and learned M0 export.
        export_fixture.ExportTests.setUp(self)
        config = self.root/'internal-elo-tuning-v1.json'
        tuning = json.loads(config.read_text()); tuning['k_candidates'] = [32]; config.write_text(json.dumps(tuning))
        run_tuning(self.games,self.corpus,self.identity,self.base,self.base.parent,config,self.tuning.parent)
        export_fixture.ExportTests.run_export(self)
        self.base_artifact=self.output
        self.form_output=self.root/'form-run'
        self.form_protocol=self.root/'form-protocol.json'
        base=json.loads(self.base.read_text())
        self.form_protocol.write_text(json.dumps({**CONFIG,'baseline_metrics_sha256':digest(self.base.read_bytes()),
            'baseline_protocol_sha256':base['protocol_sha256'],'confidence_metrics_sha256':digest(self.confidence.read_bytes()),
            'bootstrap_replicates':5}))

    def run_form(self):return run(self.base,self.confidence,self.base.parent,self.form_protocol,self.form_output)

    def export_form(self):
        return export(self.base_artifact,self.form_output/'metrics.json',self.games,self.corpus,self.identity,self.base,self.root/'form-artifact.json')

    def test_report_and_artifact_are_reproducible_and_preserve_m0(self):
        report=self.run_form();data=(self.form_output/'metrics.json').read_bytes()
        self.assertEqual(report,self.run_form());self.assertEqual(data,(self.form_output/'metrics.json').read_bytes())
        self.assertGreater(report['selected_on_development_only']['coefficient'],0)
        original=self.base_artifact.read_bytes();first=self.export_form();self.assertEqual(first,self.export_form())
        self.assertEqual(original,self.base_artifact.read_bytes())
        p=json.loads(first['payloadJson']);base=json.loads(json.loads(original)['payloadJson'])
        self.assertFalse(p['recommended']);self.assertEqual(first['sha256'],digest(first['payloadJson'].encode()))
        self.assertEqual(p['teams'][0]['rating'],base['teams'][0]['rating'])
        self.assertNotEqual(p['teams'][0]['formRatingAdjustment'],0)
        self.assertEqual(p['teams'][1]['formRatingAdjustment'],0);self.assertIsNone(p['teams'][1]['form']['value'])
        self.assertEqual(p['targetTournamentExcluded']['games'],1)

    def test_reference_integrity_and_primary_delay_are_required(self):
        p=json.loads(self.form_protocol.read_text());p['selection_delay_days']=3;self.form_protocol.write_text(json.dumps(p))
        with self.assertRaises(ValueError):self.run_form()
        self.assertFalse(self.form_output.exists())

    def test_snapshot_rejects_mismatched_report_or_overwriting_the_base(self):
        self.run_form();before=self.base_artifact.read_bytes()
        with self.assertRaisesRegex(ValueError,'overwrite'):
            export(self.base_artifact,self.form_output/'metrics.json',self.games,self.corpus,self.identity,self.base,self.base_artifact)
        self.assertEqual(before,self.base_artifact.read_bytes())
        p=json.loads((self.form_output/'metrics.json').read_text());p['fixed_log_odds_slope']=999
        (self.form_output/'metrics.json').write_text(json.dumps(p))
        with self.assertRaisesRegex(ValueError,'match'):self.export_form()

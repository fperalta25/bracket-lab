import copy
import json
import math
from pathlib import Path
import unittest

from test_baseline import PROTOCOL, game
from baseline import replay
from form_backtest import paired_vs_baseline, select_variant, validate_form_protocol
from residuals import apply_form, residual_features

FORM = json.loads((Path(__file__).resolve().parents[1]/'config/residual-form-v1.json').read_text())


def rows():
    return replay([game('first', '2024-01-01T00:00:00Z'), game('same-day', '2024-01-01T01:00:00Z'),
                   game('next', '2024-01-03T00:00:00Z')], PROTOCOL, 1)[0]


class ResidualTests(unittest.TestCase):
    def test_residuals_are_delayed_and_day_averaged_with_shrinkage(self):
        features = residual_features(rows(), 14, 3)
        self.assertEqual(features[0]['form_a'], {'status': 'missing', 'value': None, 'days': 0, 'games': 0})
        self.assertEqual(features[1]['form_a']['status'], 'missing')
        self.assertEqual(features[2]['form_a'], {'status': 'estimated', 'value': .125, 'days': 1, 'games': 2})
        self.assertEqual(features[2]['form_b']['value'], -.125)

    def test_exact_availability_is_excluded(self):
        data = replay([game('first', '2024-01-01T00:00:00Z'), game('boundary', '2024-01-02T00:00:00Z')], PROTOCOL, 1)[0]
        self.assertEqual(residual_features(data, 14, 3)[1]['form_a']['status'], 'missing')

    def test_window_lower_bound_is_inclusive_and_old_form_expires(self):
        data = replay([game('first', '2024-01-01T00:00:00Z'), game('boundary', '2024-01-15T00:00:00Z'),
                       game('expired', '2024-01-15T00:00:01Z')], PROTOCOL, 1)[0]
        features = residual_features(data, 14, 3)
        self.assertEqual(features[1]['form_a']['days'], 1)
        self.assertEqual(features[2]['form_a']['status'], 'missing')

    def test_future_and_target_outcomes_do_not_change_features(self):
        data = rows()
        before = residual_features(data, 30, 3)
        changed = copy.deepcopy(data)
        changed[-1]['win_a'] = 0
        after = residual_features(changed, 30, 3)
        for first, second in zip(before, after):
            self.assertEqual(first['form_a'], second['form_a'])
            self.assertEqual(first['form_b'], second['form_b'])
        first_prediction = apply_form(before, 1, 400)
        next_prediction = apply_form(after, 1, 400)
        self.assertEqual([row['p_win_a'] for row in first_prediction], [row['p_win_a'] for row in next_prediction])

    def test_zero_effect_preserves_baseline_bits_and_does_not_mutate_inputs(self):
        data = rows()
        before = copy.deepcopy(data)
        result = apply_form(residual_features(data, 14, 3), 0, 400)
        for base, candidate in zip(data, result):
            for key in ['p_win_a', 'log_loss', 'brier', 'rating_a_before', 'rating_b_before']:
                self.assertEqual(base[key], candidate[key])
        self.assertEqual(data, before)

    def test_positive_innovation_adjusts_probability_and_is_antisymmetric(self):
        features = residual_features(rows(), 14, 3)
        result = apply_form(features, 1, 400)[-1]
        self.assertGreater(result['p_win_a'], features[-1]['p_win_a'])
        swapped = copy.deepcopy(features[-1])
        for a, b in [('team_a_id','team_b_id'), ('rating_a_before','rating_b_before'), ('form_a','form_b')]:
            swapped[a], swapped[b] = swapped[b], swapped[a]
        swapped['win_a'] = 1-swapped['win_a']
        swapped['p_win_a'] = 1-swapped['p_win_a']
        reverse = apply_form([swapped], 1, 400)[0]
        self.assertAlmostEqual(result['p_win_a']+reverse['p_win_a'], 1)
        self.assertAlmostEqual(result['log_loss'], reverse['log_loss'])

    def test_observed_zero_is_distinct_from_missing(self):
        data = rows()
        data[1]['win_a'] = 0
        feature = residual_features(data, 30, 3)[-1]['form_a']
        self.assertEqual(feature['status'], 'estimated')
        self.assertEqual(feature['value'], 0)

    def test_cached_reference_not_contextual_prediction_defines_innovation(self):
        data = rows()
        first = residual_features(data, 30, 3)
        # Each coefficient consumes the same fixed baseline feature rows.
        one = apply_form(first, .5, 400)
        two = apply_form(first, 2, 400)
        self.assertEqual(one[-1]['form_a'], two[-1]['form_a'])
        self.assertNotEqual(one[-1]['p_win_a'], two[-1]['p_win_a'])

    def test_postgame_stats_and_input_order_have_no_feature_effect(self):
        data = rows()
        expected = residual_features(data, 30, 3)
        data.reverse()
        data[0]['goldat15'] = 9999999
        result = residual_features(data, 30, 3)
        self.assertEqual([row['form_a'] for row in result], [row['form_a'] for row in expected])

    def test_duplicate_invalid_or_mismatched_reference_is_rejected(self):
        data = rows()
        with self.assertRaises(ValueError):
            residual_features(data+[data[0]], 30, 3)
        with self.assertRaises(ValueError):
            residual_features(data, 0, 3)
        with self.assertRaises(ValueError):
            residual_features(data, 30, 0)
        features = residual_features(data, 30, 3)
        features[-1]['p_win_a'] = .1
        with self.assertRaisesRegex(ValueError, 'rating scale'):
            apply_form(features, 1, 400)
        with self.assertRaises(ValueError):
            apply_form(features, float('nan'), 400)

    def test_selection_does_not_depend_on_any_2026_outcome(self):
        data = replay([game('warmup', '2024-12-10T00:00:00Z'), game('dev1', '2025-01-10T00:00:00Z'),
                       game('dev2', '2025-01-12T00:00:00Z'), game('eval', '2026-02-01T00:00:00Z')], PROTOCOL, 1)[0]
        chosen = select_variant(data, FORM, 400)
        data[-1]['win_a'] = 0
        data[-1]['log_loss'] = 99999
        data[-1]['p_win_a'] = .999
        self.assertEqual(chosen, select_variant(data, FORM, 400))
        self.assertEqual(len(chosen[1]), 10)

    def test_no_signal_selects_zero_effect_baseline_on_tie(self):
        data = replay([game('dev', '2025-01-10T00:00:00Z')], PROTOCOL, 1)[0]
        chosen, _ = select_variant(data, FORM, 400)
        self.assertEqual(chosen['id'], 'baseline')
        with self.assertRaises(ValueError):
            select_variant([], FORM, 400)

    def test_paired_bootstrap_compares_to_elo_not_coin_flip(self):
        data = replay([game('a', '2025-01-10T00:00:00Z'), game('b', '2025-01-12T00:00:00Z', league_id='MSI')], PROTOCOL, 1)[0]
        zero = paired_vs_baseline(data, data, FORM)
        self.assertEqual(zero['log_loss_advantage_95'], [0, 0])
        worse = copy.deepcopy(data)
        for row in worse:
            row['log_loss'] += .1
            row['brier'] += .01
        report = paired_vs_baseline(worse, data, FORM)
        self.assertAlmostEqual(report['log_loss_advantage'], -.1)
        self.assertAlmostEqual(report['log_loss_advantage_95'][1], -.1)
        self.assertEqual(report, paired_vs_baseline(worse, data, FORM))

    def test_mismatched_pairs_and_promotable_protocol_are_rejected(self):
        data = rows()
        changed = copy.deepcopy(data)
        changed[-1]['win_a'] = 0
        with self.assertRaises(ValueError):
            paired_vs_baseline(changed, data, FORM)
        with self.assertRaises(ValueError):
            validate_form_protocol({**FORM, 'promotion_allowed': True})


if __name__ == '__main__':
    unittest.main()

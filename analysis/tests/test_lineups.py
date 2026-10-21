import copy
import json
from pathlib import Path
import unittest

from test_baseline import PROTOCOL, game
from baseline import replay
from lineups import apply_stability, lineup_features
from stability_backtest import match_lineups, select_variant

CONFIG = json.loads((Path(__file__).resolve().parents[1]/'config/lineup-stability-v1.json').read_text())
A = ('a1','a2','a3','a4','a5')
B = ('b1','b2','b3','b4','b5')
B_CHANGED = ('b1','b2','b3','b4','b6')


def sample():
    rows = replay([game('first','2024-01-01T00:00:00Z'), game('last','2024-01-03T00:00:00Z'),
                   game('target','2024-01-05T00:00:00Z')], PROTOCOL, 1)[0]
    lineups = {'first':{'a':A,'b':B}, 'last':{'a':A,'b':B_CHANGED}, 'target':{'a':A,'b':B}}
    return rows, lineups


class LineupTests(unittest.TestCase):
    def test_uses_latest_known_lineup_against_earlier_days(self):
        rows, lineups = sample()
        features = lineup_features(rows,lineups,30)
        self.assertEqual(features[0]['lineup_stability_a']['status'],'missing')
        self.assertEqual(features[1]['lineup_stability_a']['reason'],'no_earlier_comparison_day')
        self.assertEqual(features[2]['lineup_stability_a']['value'],.625)
        self.assertAlmostEqual(features[2]['lineup_stability_b']['value'],.575)
        self.assertEqual(features[2]['lineup_stability_a']['reference_game_id'],'last')

    def test_target_or_future_roster_does_not_change_earlier_features(self):
        rows, lineups = sample()
        before = lineup_features(rows,lineups,30)
        lineups['target'] = {'a':('x1','x2','x3','x4','x5'),'b':None}
        after = lineup_features(rows,lineups,30)
        self.assertEqual(before,after)
        self.assertNotIn('observed_lineup_a',after[-1])

    def test_target_outcome_does_not_change_stability_or_prediction(self):
        rows,lineups = sample()
        before = apply_stability(lineup_features(rows,lineups,30),1,400)
        rows[-1]['win_a'] = 0
        after = apply_stability(lineup_features(rows,lineups,30),1,400)
        self.assertEqual([row['p_win_a'] for row in before],[row['p_win_a'] for row in after])

    def test_exact_availability_boundary_excludes_lineup(self):
        rows,lineups = sample()
        rows[-1]['event_start_utc'] = '2024-01-04T00:00:00Z'
        rows[-1]['assumed_available_at_utc'] = '2024-01-05T00:00:00Z'
        self.assertEqual(lineup_features(rows,lineups,30)[-1]['lineup_stability_a']['status'],'missing')

    def test_reference_day_is_not_used_as_comparison(self):
        rows,lineups = sample()
        rows[1]['event_start_utc'] = '2024-01-01T01:00:00Z'
        rows[1]['assumed_available_at_utc'] = '2024-01-02T01:00:00Z'
        self.assertEqual(lineup_features(rows,lineups,30)[-1]['lineup_stability_a']['reason'],'no_earlier_comparison_day')

    def test_missing_latest_lineup_does_not_resurrect_older_one(self):
        rows,lineups = sample()
        lineups['last']['b'] = None
        features = lineup_features(rows,lineups,30)
        self.assertEqual(features[-1]['lineup_stability_b']['reason'],'latest_lineup_missing')
        predicted = apply_stability(features,1,400)[-1]
        for key in ['p_win_a','log_loss','brier']:
            self.assertEqual(predicted[key],rows[-1][key])

    def test_zero_effect_preserves_baseline_bits_without_mutation(self):
        rows,lineups = sample()
        original = copy.deepcopy(rows)
        result = apply_stability(lineup_features(rows,lineups,30),0,400)
        for base,candidate in zip(rows,result):
            for key in ['p_win_a','log_loss','brier']:
                self.assertEqual(base[key],candidate[key])
        self.assertEqual(rows,original)

    def test_signed_effect_is_antisymmetric(self):
        rows,lineups = sample()
        feature = lineup_features(rows,lineups,30)[-1]
        positive = apply_stability([feature],1,400)[0]
        negative = apply_stability([feature],-1,400)[0]
        self.assertGreater(positive['p_win_a'],feature['p_win_a'])
        self.assertLess(negative['p_win_a'],feature['p_win_a'])
        swapped = copy.deepcopy(feature)
        for a,b in [('rating_a_before','rating_b_before'),('lineup_stability_a','lineup_stability_b')]:
            swapped[a],swapped[b] = swapped[b],swapped[a]
        swapped['p_win_a'] = 1-swapped['p_win_a']
        swapped['win_a'] = 1-swapped['win_a']
        reverse = apply_stability([swapped],1,400)[0]
        self.assertAlmostEqual(positive['p_win_a']+reverse['p_win_a'],1)
        self.assertAlmostEqual(positive['log_loss'],reverse['log_loss'])

    def test_names_are_compared_only_within_the_same_source_team(self):
        rows,lineups = sample()
        lineups['first']['b'] = A
        lineups['last']['b'] = A
        features = lineup_features(rows,lineups,30)
        self.assertEqual(features[-1]['lineup_stability_a']['games'],1)
        self.assertEqual(features[-1]['lineup_stability_b']['games'],1)

    def test_order_and_future_statistics_do_not_change_features(self):
        rows,lineups = sample()
        expected = lineup_features(rows,lineups,30)
        rows.reverse()
        rows[0]['goldat15'] = 99999
        actual = lineup_features(rows,lineups,30)
        self.assertEqual([row['lineup_stability_a'] for row in expected],[row['lineup_stability_a'] for row in actual])

    def test_duplicate_and_incomplete_lineups_fail(self):
        rows,lineups = sample()
        with self.assertRaises(ValueError):
            lineup_features(rows+[rows[0]],lineups,30)
        lineups['first']['a'] = ('a1',)*5
        with self.assertRaises(ValueError):
            lineup_features(rows,lineups,30)

    def test_selection_excludes_all_2026_roster_and_outcome_information(self):
        rows,lineups = sample()
        for row in rows:
            row['period'] = 'development_2025'
        future = copy.deepcopy(rows[-1])
        future.update({'game_id':'future','event_start_utc':'2026-02-01T00:00:00Z',
                       'assumed_available_at_utc':'2026-02-02T00:00:00Z','period':'evaluation_2026'})
        rows.append(future)
        lineups['future'] = {'a':A,'b':B}
        expected = select_variant(rows,lineups,CONFIG,400)
        future['win_a'] = 0
        future['log_loss'] = 9999
        lineups['future'] = {'a':None,'b':None}
        self.assertEqual(expected,select_variant(rows,lineups,CONFIG,400))
        self.assertEqual(len(expected[1]),9)

    def test_multiple_games_on_comparison_day_have_one_day_weight(self):
        rows,lineups = sample()
        duplicate = copy.deepcopy(rows[0])
        duplicate.update({'game_id':'same-day','event_start_utc':'2024-01-01T01:00:00Z',
                          'assumed_available_at_utc':'2024-01-02T01:00:00Z'})
        lineups['same-day'] = copy.deepcopy(lineups['first'])
        feature = lineup_features(rows+[duplicate],lineups,30)[-1]['lineup_stability_a']
        self.assertEqual((feature['days'],feature['games'],feature['value']),(1,2,.625))

    def test_window_bound_inclusive_then_expires(self):
        rows,lineups = sample()
        rows[-1].update({'event_start_utc':'2024-01-31T00:00:00Z','assumed_available_at_utc':'2024-02-01T00:00:00Z'})
        self.assertEqual(lineup_features(rows,lineups,30)[-1]['lineup_stability_a']['status'],'estimated')
        rows[-1].update({'event_start_utc':'2024-01-31T00:00:01Z','assumed_available_at_utc':'2024-02-01T00:00:01Z'})
        self.assertEqual(lineup_features(rows,lineups,30)[-1]['lineup_stability_a']['status'],'missing')

    def test_late_older_observation_does_not_replace_latest_game(self):
        rows,lineups = sample()
        rows[0]['assumed_available_at_utc'] = '2024-01-04T12:00:00Z'
        feature = lineup_features(rows,lineups,30)[-1]['lineup_stability_a']
        self.assertEqual(feature['reference_game_id'],'last')
        self.assertEqual(feature['value'],.625)

    def test_ambiguous_latest_lineups_are_missing_not_arbitrarily_selected(self):
        rows,lineups = sample()
        other = copy.deepcopy(rows[1])
        other['game_id'] = 'conflict'
        lineups['conflict'] = {'a':('x1','x2','x3','x4','x5'),'b':B_CHANGED}
        feature = lineup_features(rows+[other],lineups,30)[-1]['lineup_stability_a']
        self.assertEqual(feature['reason'],'ambiguous_latest_lineup')

    def test_no_signal_tie_keeps_baseline_and_join_mismatch_fails(self):
        rows,lineups = sample()
        for row in rows:
            row['period'] = 'development_2025'
        lineups = {row['game_id']:{'a':A,'b':B} for row in rows}
        self.assertEqual(select_variant(rows,lineups,CONFIG,400)[0]['id'],'baseline')
        with self.assertRaises(ValueError):
            match_lineups(rows,{})


if __name__ == '__main__':
    unittest.main()

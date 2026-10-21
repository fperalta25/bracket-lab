import copy
import json
import math
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from baseline import log_probabilities, replay, validate_protocol
from backtest import evaluate, metrics, paired_cluster_advantage

PROTOCOL = json.loads((Path(__file__).resolve().parents[1] / 'config/internal-elo-v1.json').read_text())


def game(game_id, at, win_a=1, **changes):
    return {'game_id': game_id, 'event_start_utc': at, 'team_a_id': 'a', 'team_b_id': 'b',
            'win_a': win_a, 'league_id': 'LCK', 'split': 'Spring', **changes}


class BaselineTests(unittest.TestCase):
    def test_elo_probability_and_symmetry(self):
        self.assertEqual(math.exp(log_probabilities(1500, 1500)[0]), .5)
        self.assertAlmostEqual(math.exp(log_probabilities(1900, 1500)[0]), 10/11)
        for gap in [-10000, -400, 0, 400, 10000]:
            a, b = log_probabilities(1500+gap, 1500)
            reverse = log_probabilities(1500, 1500+gap)
            self.assertEqual(a, reverse[1])
            self.assertAlmostEqual(math.exp(a)+math.exp(b), 1)
        self.assertGreater(math.exp(log_probabilities(1600, 1500)[0]), .5)

    def test_stable_extreme_log_loss_and_invalid_values(self):
        self.assertTrue(all(math.isfinite(value) for value in log_probabilities(100000, -100000)))
        for args in [(float('nan'), 0), (0, float('inf')), (0, 0, 0), (1e308, -1e308)]:
            with self.assertRaises(ValueError):
                log_probabilities(*args)

    def test_zero_sum_updates_and_delayed_learning(self):
        rows, _ = replay([game('first', '2024-01-01T00:00:00Z'), game('second', '2024-01-03T00:00:00Z')], PROTOCOL, 1)
        self.assertEqual(rows[0]['p_win_a'], .5)
        self.assertEqual(rows[1]['rating_a_before'], 1516)
        self.assertEqual(rows[1]['rating_b_before'], 1484)
        self.assertEqual(rows[1]['rating_a_before']+rows[1]['rating_b_before'], 3000)
        self.assertFalse(rows[1]['cold_start'])

    def test_delayed_updates_use_saved_pregame_probabilities(self):
        games = [game('first', '2024-01-01T00:00:00Z'), game('second', '2024-01-01T01:00:00Z'),
                 game('next', '2024-01-03T00:00:00Z')]
        rows, _ = replay(games, PROTOCOL, 1)
        self.assertEqual(rows[0]['p_win_a'], .5)
        self.assertEqual(rows[1]['p_win_a'], .5)
        self.assertEqual(rows[2]['rating_a_before'], 1532)
        self.assertEqual(rows[2]['rating_b_before'], 1468)

    def test_availability_equal_to_start_is_not_used(self):
        games = [game('first', '2024-01-01T00:00:00Z'), game('exact', '2024-01-02T00:00:00Z'),
                 game('later', '2024-01-02T00:00:01Z')]
        rows, _ = replay(games, PROTOCOL, 1)
        self.assertEqual(rows[1]['p_win_a'], .5)
        self.assertGreater(rows[2]['p_win_a'], .5)

    def test_target_outcome_and_future_games_do_not_change_earlier_predictions(self):
        games = [game('first', '2024-01-01T00:00:00Z'), game('future', '2024-01-03T00:00:00Z')]
        original = replay(games, PROTOCOL, 1)[0]
        changed = copy.deepcopy(games)
        changed[1]['win_a'] = 0
        after = replay(changed, PROTOCOL, 1)[0]
        self.assertEqual(original[0], after[0])
        self.assertEqual(original[1]['p_win_a'], after[1]['p_win_a'])
        changed[0]['win_a'] = 0
        self.assertEqual(replay(changed, PROTOCOL, 1)[0][0]['p_win_a'], .5)

    def test_delay_sensitivity_is_not_a_parameter_search(self):
        games = [game('first', '2024-01-01T00:00:00Z'), game('second', '2024-01-03T00:00:00Z')]
        self.assertGreater(replay(games, PROTOCOL, 1)[0][1]['p_win_a'], .5)
        self.assertEqual(replay(games, PROTOCOL, 7)[0][1]['p_win_a'], .5)
        with self.assertRaises(ValueError):
            replay(games, PROTOCOL, 2)

    def test_embargo_games_neither_score_nor_update(self):
        games = [game('gap', '2025-01-02T00:00:00Z'), game('scored', '2025-01-08T00:00:00Z')]
        rows, counts = replay(games, PROTOCOL, 1)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['period'], 'development_2025')
        self.assertEqual(rows[0]['p_win_a'], .5)
        self.assertEqual(counts['embargo_or_outside_period_games'], 1)

    def test_first_holdout_prediction_has_no_holdout_result(self):
        rows, _ = replay([game('gap', '2026-09-04T00:00:00Z'), game('test', '2026-09-08T00:00:00Z')], PROTOCOL, 1)
        self.assertEqual(rows[0]['period'], 'holdout_2026')
        self.assertEqual(rows[0]['p_win_a'], .5)

    def test_duplicate_and_invalid_protocol_are_rejected(self):
        first = game('g', '2024-01-01T00:00:00Z')
        with self.assertRaises(ValueError):
            replay([first, first], PROTOCOL, 1)
        protocol = copy.deepcopy(PROTOCOL)
        protocol['promotion_allowed'] = True
        with self.assertRaises(ValueError):
            validate_protocol(protocol)
        protocol = copy.deepcopy(PROTOCOL)
        protocol['periods'][1]['start'] = '2024-01-02T00:00:00Z'
        with self.assertRaises(ValueError):
            validate_protocol(protocol)

    def test_input_order_and_postgame_stats_do_not_change_replay(self):
        games = [game('b', '2024-01-03T00:00:00Z'), game('a', '2024-01-01T00:00:00Z')]
        first = replay(games, PROTOCOL, 1)
        games.reverse()
        games[0]['goldat15'] = 999999
        games[0]['roster_a'] = {'future': 'irrelevant'}
        self.assertEqual(first, replay(games, PROTOCOL, 1))

    def test_metrics_coin_flip_and_empty_data(self):
        rows, _ = replay([game('g', '2025-01-08T00:00:00Z')], PROTOCOL, 1)
        report = metrics(rows)
        self.assertEqual(report['brier'], .25)
        self.assertEqual(report['log_loss'], math.log(2))
        self.assertEqual(report['accuracy'], .5)
        self.assertEqual(report['unique_teams'], 2)
        self.assertIsNone(report['verified_series'])
        self.assertIsNone(metrics([])['log_loss'])
        self.assertEqual(sum(bucket['games'] for bucket in report['calibration']), 1)

    def test_cluster_bootstrap_is_paired_reproducible_and_rejects_single_cluster_claim(self):
        rows, _ = replay([game('a', '2025-01-08T00:00:00Z'), game('b', '2025-01-10T00:00:00Z', league_id='MSI')], PROTOCOL, 1)
        one = paired_cluster_advantage(rows[:1], PROTOCOL)
        self.assertIsNone(one['log_loss_advantage_95'])
        result = paired_cluster_advantage(rows, PROTOCOL)
        self.assertEqual(result, paired_cluster_advantage(rows, PROTOCOL))
        self.assertEqual(result['clusters'], 2)
        report = evaluate(rows, PROTOCOL)['development_2025']
        self.assertEqual(report['international_by_source_label']['games'], 1)


if __name__ == '__main__':
    unittest.main()

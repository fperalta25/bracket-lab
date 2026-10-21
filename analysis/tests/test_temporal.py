from dataclasses import FrozenInstanceError, replace
import unittest

from temporal import Evidence, HistoricalResult, PreGameQuery, RosterSnapshot, TemporalHistory

PROOF = Evidence('synthetic-test-source', 'a' * 64)
QUERY = PreGameQuery('target', 'a', 'b', '2025-02-01T12:00:00Z', '2025-02-01T11:00:00Z')


def result(game_id='past', **changes):
    return replace(HistoricalResult(game_id, 'a', 'b', '2025-01-20T12:00:00Z',
                                    '2025-01-20T13:00:00Z', 1, PROOF, PROOF), **changes)


def roster(snapshot_id='old', **changes):
    return replace(RosterSnapshot(snapshot_id, 'a', ('p1', 'p2', 'p3', 'p4', 'p5'),
                                  '2025-01-01T00:00:00Z', '2024-12-30T00:00:00Z', PROOF), **changes)


class TemporalTests(unittest.TestCase):
    def test_only_completed_and_available_games_are_observed(self):
        games = [result(), result('unpublished', available_at_utc='2025-02-02T00:00:00Z'),
                 result('unknown', available_at_utc=None), result('unsupported', time_evidence=None)]
        view = TemporalHistory(games).results_before('a', QUERY)
        self.assertEqual(view.status, 'observed')
        self.assertEqual([game.game_id for game in view.games], ['past'])

    def test_future_outcome_and_future_roster_do_not_change_earlier_views(self):
        future = result('future', event_start_utc='2025-02-02T12:00:00Z', available_at_utc='2025-02-02T13:00:00Z')
        future_roster = roster('new', player_ids=('p6', 'p7', 'p8', 'p9', 'p10'),
                               effective_from_utc='2025-02-02T00:00:00Z')
        first = TemporalHistory([result(), future], [roster(), future_roster])
        changed = TemporalHistory([result(), replace(future, win_a=0)], [roster(), replace(future_roster, player_ids=('x1', 'x2', 'x3', 'x4', 'x5'))])
        self.assertEqual(first.results_before('a', QUERY), changed.results_before('a', QUERY))
        self.assertEqual(first.roster_before('a', QUERY), changed.roster_before('a', QUERY))

    def test_target_result_is_never_history_even_if_input_id_is_mislabeled(self):
        view = TemporalHistory([result('target'), result()]).results_before('a', QUERY)
        self.assertEqual([game.game_id for game in view.games], ['past'])

    def test_availability_cutoff_is_strict_and_window_start_inclusive(self):
        lower = result('boundary', event_start_utc='2025-01-02T11:00:00Z', available_at_utc='2025-01-02T12:00:00Z')
        unavailable = result('exact-cutoff', available_at_utc=QUERY.as_of_utc)
        too_old = result('outside', event_start_utc='2025-01-02T10:59:59Z', available_at_utc='2025-01-02T12:00:00Z')
        view = TemporalHistory([lower, unavailable, too_old]).results_before('a', QUERY)
        self.assertEqual([game.game_id for game in view.games], ['boundary'])

    def test_missing_data_does_not_become_zero_or_imputed_history(self):
        view = TemporalHistory([result(result_evidence=None)]).results_before('a', QUERY)
        self.assertEqual(view.status, 'missing')
        self.assertEqual(view.games, ())
        self.assertIsNone(TemporalHistory().roster_before('a', QUERY))

    def test_quarantined_game_is_excluded(self):
        view = TemporalHistory([result()], quarantined_game_ids=['past']).results_before('a', QUERY)
        self.assertEqual(view.status, 'missing')

    def test_roster_announcement_after_query_does_not_backfill_effective_date(self):
        late = roster('late', player_ids=('x1', 'x2', 'x3', 'x4', 'x5'),
                      available_at_utc='2025-02-02T00:00:00Z', effective_from_utc='2025-01-20T00:00:00Z')
        self.assertEqual(TemporalHistory(rosters=[roster(), late]).roster_before('a', QUERY), roster())

    def test_announced_future_roster_is_not_yet_effective(self):
        future = roster('future', effective_from_utc='2025-02-02T00:00:00Z')
        self.assertIsNone(TemporalHistory(rosters=[future]).roster_before('a', QUERY))

    def test_roster_available_at_exact_cutoff_is_excluded(self):
        exact = roster(available_at_utc=QUERY.as_of_utc)
        self.assertIsNone(TemporalHistory(rosters=[exact]).roster_before('a', QUERY))

    def test_expired_latest_snapshot_does_not_resurrect_old_roster(self):
        expired = roster('expired', effective_from_utc='2025-01-20T00:00:00Z',
                         effective_until_utc='2025-02-01T00:00:00Z')
        self.assertIsNone(TemporalHistory(rosters=[roster(), expired]).roster_before('a', QUERY))

    def test_conflicting_known_rosters_fail_instead_of_choosing_input_order(self):
        other = roster('other', player_ids=('x1', 'x2', 'x3', 'x4', 'x5'))
        with self.assertRaisesRegex(ValueError, 'Conflicting'):
            TemporalHistory(rosters=[roster(), other]).roster_before('a', QUERY)

    def test_mutable_player_list_is_copied_and_snapshots_are_frozen(self):
        players = ['p5', 'p4', 'p3', 'p2', 'p1']
        snapshot = roster(player_ids=players)
        players[0] = 'changed'
        self.assertEqual(snapshot.player_ids, ('p1', 'p2', 'p3', 'p4', 'p5'))
        with self.assertRaises(FrozenInstanceError):
            snapshot.team_id = 'other'

    def test_game_order_is_deterministic_and_team_can_be_on_either_side(self):
        later = result('later', event_start_utc='2025-01-21T00:00:00Z', available_at_utc='2025-01-21T01:00:00Z')
        history = TemporalHistory([later, result()])
        self.assertEqual(history.results_before('a', QUERY), history.results_before('b', QUERY))
        self.assertEqual([game.game_id for game in history.results_before('a', QUERY).games], ['past', 'later'])

    def test_query_must_precede_target_and_use_explicit_timezone(self):
        with self.assertRaises(ValueError):
            replace(QUERY, as_of_utc=QUERY.game_start_utc)
        with self.assertRaises(ValueError):
            replace(QUERY, as_of_utc='2025-01-01')
        self.assertEqual(replace(QUERY, as_of_utc='2025-02-01T12:00:00+01:00'), QUERY)

    def test_result_and_roster_validation(self):
        for changes in [dict(win_a=True), dict(win_a=2), dict(team_b_id='a'),
                        dict(available_at_utc='2025-01-20T12:00:00Z'), dict(result_evidence='unreviewed')]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                result(**changes)
        with self.assertRaises(ValueError):
            roster(player_ids=('p1', 'p1', 'p2', 'p3', 'p4'))
        with self.assertRaises(ValueError):
            Evidence('missing hash', 'not-a-hash')

    def test_invalid_team_window_or_duplicate_id_fails(self):
        with self.assertRaises(ValueError):
            TemporalHistory([result(), result()])
        with self.assertRaises(ValueError):
            TemporalHistory(rosters=[roster(), roster()])
        for days in [0, -1, True]:
            with self.assertRaises(ValueError):
                TemporalHistory().results_before('a', QUERY, window_days=days)
        with self.assertRaises(ValueError):
            TemporalHistory().results_before('not-a-participant', QUERY)


if __name__ == '__main__':
    unittest.main()

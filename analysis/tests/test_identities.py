import copy
import json
from pathlib import Path
import tempfile
import unittest

from test_ingest import CUTOFF, fixture, packed
from identities import audit_identity_files, identity_audit
from ingest import audit, digest


def game(game_id='g1', at='2025-01-01T12:00:00+00:00'):
    teams, players = fixture()
    record = audit(packed(teams), packed(players), CUTOFF, 'UTC')[0][0]
    record['game_id'] = game_id
    record['event_start_utc'] = at
    return record


class IdentityTests(unittest.TestCase):
    def test_observed_names_do_not_merge_source_ids(self):
        first = game()
        first['team_a_name'] = first['team_b_name'] = 'Same label'
        ledger, report = identity_audit([first], CUTOFF)
        self.assertEqual(len(ledger), 2)
        self.assertEqual(report['names_with_multiple_team_ids'], {'Same label': ['a', 'b']})
        self.assertFalse(report['training_ready'])

    def test_same_source_id_records_both_names_without_inferred_rename(self):
        first, later = game(), game('g2', '2025-02-01T12:00:00Z')
        later['team_a_name'] = 'Renamed?'
        ledger, report = identity_audit([first, later], CUTOFF)
        self.assertEqual(len(ledger), 2)
        self.assertEqual(len(report['team_ids_with_multiple_names']['a']), 2)
        self.assertNotIn('valid_from', ledger[0])
        self.assertNotIn('effective_at_utc', ledger[0]['observed_names'][0])

    def test_cutoff_precedes_alias_and_roster_grouping(self):
        first, future = game(), game('g2', '2026-10-21T00:00:00Z')
        before = identity_audit([first], CUTOFF)
        future['team_a_name'] = 'Future name'
        future['roster_a'] = None
        self.assertEqual(before, identity_audit([future, first], CUTOFF))

    def test_future_player_change_does_not_rewrite_earlier_lineup(self):
        first, later = game(), game('g2', '2025-02-01T12:00:00Z')
        later['roster_a'] = copy.deepcopy(later['roster_a'])
        later['roster_a']['players'][0]['source_name'] = 'Substitute'
        later['roster_a']['observation_id'] = digest(json.dumps(
            ['a', later['roster_a']['players']], sort_keys=True).encode())
        ledger, _ = identity_audit([first, later], CUTOFF)
        self.assertEqual(len(ledger[0]['observed_lineups']), 2)
        early, _ = identity_audit([first, later], '2025-02-01T00:00:00Z')
        self.assertEqual(early, identity_audit([first], '2025-02-01T00:00:00Z')[0])

    def test_input_order_does_not_change_first_last_observations(self):
        first, later = game(), game('g2', '2025-02-01T12:00:00Z')
        self.assertEqual(identity_audit([first, later], CUTOFF), identity_audit([later, first], CUTOFF))
        ledger, _ = identity_audit([later, first], CUTOFF)
        self.assertEqual(ledger[0]['first_game_id'], 'g1')
        self.assertEqual(ledger[0]['last_game_id'], 'g2')

    def test_duplicate_game_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            identity_audit([game(), game()], CUTOFF)

    def test_forged_lineup_hash_is_rejected(self):
        first = game()
        first['roster_a']['players'][0]['source_name'] = 'Other'
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            identity_audit([first], CUTOFF)

    def test_missing_lineup_is_not_an_empty_roster(self):
        first = game()
        first['roster_a'] = None
        ledger, report = identity_audit([first], CUTOFF)
        self.assertEqual(ledger[0]['observed_lineups'], [])
        self.assertEqual(report['missing_lineup_observations'], 1)

    def test_concurrent_team_observations_are_diagnostic_not_arbitrarily_selected(self):
        ledger, report = identity_audit([game(), game('g2')], CUTOFF)
        self.assertEqual(ledger, [])
        self.assertEqual(report['identity_eligible_games'], 0)
        self.assertEqual(report['identity_quarantined_game_ids'], ['g1', 'g2'])
        self.assertEqual(len(report['simultaneous_team_observations']), 2)
        self.assertEqual(report['simultaneous_team_observations'][0]['game_ids'], ['g1', 'g2'])

    def test_isolation_does_not_remove_an_earlier_unambiguous_observation(self):
        earlier = game('past', '2024-01-01T00:00:00Z')
        ledger, report = identity_audit([earlier, game(), game('g2')], CUTOFF)
        self.assertEqual(report['identity_eligible_games'], 1)
        self.assertEqual(ledger[0]['observed_games'], 1)
        self.assertEqual(ledger[0]['first_game_id'], 'past')

    def test_result_availability_does_not_follow_from_game_start(self):
        first = game()
        _, report = identity_audit([first], CUTOFF)
        self.assertEqual(report['temporal_blockers']['missing_result_availability'], 1)
        first['available_at_utc'] = CUTOFF
        _, report = identity_audit([first], CUTOFF)
        self.assertEqual(report['temporal_blockers']['result_not_available_before_cutoff'], 1)
        first['available_at_utc'] = '2024-12-31T23:00:00Z'
        with self.assertRaisesRegex(ValueError, 'must follow'):
            identity_audit([first], CUTOFF)
        first['available_at_utc'] = first['event_start_utc']
        with self.assertRaisesRegex(ValueError, 'must follow'):
            identity_audit([first], CUTOFF)

    def test_file_integrity_and_cutoff_validation_precede_outputs(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            games, source, output = root / 'games.jsonl', root / 'audit.json', root / 'out'
            games.write_text(json.dumps(game()) + '\n')
            metadata = {'corpus_version': 'chaincc-corpus-v1', 'canonical_sha256': digest(games.read_bytes()),
                        'canonical_games': 1, 'cutoff_utc': CUTOFF,
                        'source_timezone_assumption': 'UTC', 'timezone_verified': False}
            source.write_text(json.dumps(metadata))
            with self.assertRaisesRegex(ValueError, 'exceed'):
                audit_identity_files(games, source, '2027-01-01T00:00:00Z', output)
            self.assertFalse(output.exists())
            report = audit_identity_files(games, source, CUTOFF, output)
            before = {path.name: path.read_bytes() for path in output.iterdir()}
            self.assertEqual(report, audit_identity_files(games, source, CUTOFF, output))
            self.assertEqual(before, {path.name: path.read_bytes() for path in output.iterdir()})
            games.write_text(games.read_text() + '\n')
            with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                audit_identity_files(games, source, CUTOFF, root / 'new')
            self.assertFalse((root / 'new').exists())


if __name__ == '__main__':
    unittest.main()

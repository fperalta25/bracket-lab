import copy
import csv
import gzip
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from ingest import acquire, audit, digest, read_csv

CUTOFF = '2026-10-21T00:00:00Z'


def packed(rows):
    stream = io.StringIO(newline='')
    writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)
    return gzip.compress(stream.getvalue().encode(), mtime=0)


def fixture():
    teams, players = [], []
    for side, team, other, won in [('Blue', 'b', 'a', 'TRUE'), ('Red', 'a', 'b', 'FALSE')]:
        row = dict(game_id='game1', date='2025-01-01 12:00:00', league='LCK', split='Spring',
                   patch='15.1', side=side, team_name=team, team_id=team,
                   opponent_team_name=other, result=won, game_number='2', bo_format='', kills='12')
        teams.append(row)
        for role in ['top', 'jng', 'mid', 'bot', 'sup']:
            players.append({**row, 'position': role, 'playername': team + role})
    return teams, players


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.teams, self.players = fixture()

    def run_audit(self, cutoff=CUTOFF, zone='UTC'):
        return audit(packed(self.teams), packed(self.players), cutoff, zone)

    def test_one_canonical_game_and_side_join(self):
        games, quarantine, report = self.run_audit()
        self.assertEqual(len(games), 1)
        self.assertEqual(quarantine, [])
        self.assertEqual((games[0]['team_a_id'], games[0]['win_a']), ('a', 0))
        self.assertEqual(games[0]['blue_side_team_id'], 'b')
        self.assertEqual(report['games_with_complete_observed_lineups'], 1)
        self.assertEqual(len(games[0]['roster_a']['players']), 5)

    def test_no_invented_series_or_identity(self):
        game = self.run_audit()[0][0]
        for key in ['series_id', 'game_number', 'best_of', 'score_a_before', 'available_at_utc']:
            self.assertIsNone(game[key])
        self.assertEqual(game['source_game_number'], '2')
        self.assertEqual(game['roster_a']['identity_status'], 'source_names_only')

    def test_strict_cutoff(self):
        games, _, report = self.run_audit('2025-01-01T12:00:00Z')
        self.assertEqual(games, [])
        self.assertEqual(report['excluded_games'], {'at_or_after_cutoff': 1})

    def test_explicit_timezone_is_recorded_not_verified(self):
        games, _, report = self.run_audit(zone='Asia/Seoul')
        self.assertEqual(games[0]['event_start_utc'], '2025-01-01T03:00:00+00:00')
        self.assertFalse(report['timezone_verified'])
        self.assertFalse(report['training_ready'])
        with self.assertRaises(ValueError):
            self.run_audit('2026-10-21')

    def test_missing_id_is_quarantined(self):
        self.teams[0]['team_id'] = ''
        self.assertEqual(self.run_audit()[2]['excluded_games'], {'missing_team_id': 1})

    def test_duplicate_team_rows_are_not_silently_deduplicated(self):
        self.teams.append(copy.deepcopy(self.teams[0]))
        self.assertEqual(self.run_audit()[2]['excluded_games'], {'invalid_team_pair': 1})

    def test_invalid_winners(self):
        self.teams[1]['result'] = 'TRUE'
        self.assertEqual(self.run_audit()[2]['excluded_games'], {'invalid_result': 1})

    def test_conflicting_team_context(self):
        self.teams[1]['patch'] = 'future'
        self.assertEqual(self.run_audit()[2]['excluded_games'], {'inconsistent_context': 1})

    def test_invalid_date(self):
        for row in self.teams:
            row['date'] = 'invalid'
        self.assertEqual(self.run_audit()[2]['excluded_games'], {'invalid_date': 1})

    def test_duplicate_or_missing_players_isolate_lineup(self):
        self.players[-1] = copy.deepcopy(self.players[-2])
        games, _, report = self.run_audit()
        self.assertEqual(len(games), 1)
        self.assertIsNone(games[0]['roster_a'])
        self.assertIsNone(games[0]['roster_b'])
        self.assertEqual(report['lineup_issues'], {'player_roles': 1})

    def test_player_side_context_must_match(self):
        self.players[0]['team_name'] = 'wrong'
        self.assertEqual(self.run_audit()[2]['lineup_issues'], {'player_context_mismatch': 1})

    def test_orphan_players_are_reported(self):
        self.players.append({**self.players[0], 'game_id': 'orphan'})
        self.assertEqual(self.run_audit()[2]['orphan_player_games'], 1)

    def test_future_game_does_not_change_earlier_record(self):
        earlier = self.run_audit()[0][0]
        for row in copy.deepcopy(self.teams):
            self.teams.append({**row, 'game_id': 'future', 'date': '2027-01-01 00:00:00'})
        again = self.run_audit()[0][0]
        # Raw-source hashes intentionally change; historical observations do not.
        earlier.pop('source_provenance')
        again.pop('source_provenance')
        self.assertEqual(earlier, again)

    def test_postgame_stats_not_in_canonical_schema(self):
        game = self.run_audit()[0][0]
        self.assertNotIn('kills', game)
        self.assertNotIn('bo_format', game)

    def test_audit_repeat_is_identical(self):
        self.assertEqual(self.run_audit(), self.run_audit())

    def test_schema_and_malformed_rows_fail_closed(self):
        with self.assertRaises(ValueError):
            audit(packed([{'wrong': 'schema'}]), packed(self.players), CUTOFF, 'UTC')
        with self.assertRaises(ValueError):
            read_csv(gzip.compress(b'game_id,date\ngame1\n'))

    def test_download_records_exact_bytes_and_retrieval_time(self):
        data = packed(self.teams)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with patch('ingest.urllib.request.urlopen') as opened:
                opened.return_value.__enter__.return_value.read.return_value = data
                path = acquire(root, 2025, 'teams', CUTOFF)
            entry = json.loads((root / 'sources.lock.json').read_text())['sources'][0]
            self.assertEqual(entry['sha256'], digest(data))
            self.assertEqual(entry['row_count'], 2)
            self.assertIsNotNone(entry['retrieved_at_utc'])
            self.assertIsNone(entry['imported_at_utc'])
            self.assertEqual(path.read_bytes(), data)

    def test_failed_download_does_not_create_lock(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with patch('ingest.urllib.request.urlopen', side_effect=TimeoutError):
                with self.assertRaises(TimeoutError):
                    acquire(root, 2025, 'teams', CUTOFF)
            self.assertFalse((root / 'sources.lock.json').exists())

    def test_same_side_and_same_id_are_rejected(self):
        self.teams[1]['side'] = 'Blue'
        self.assertEqual(self.run_audit()[2]['excluded_games'], {'invalid_team_pair': 1})
        self.teams[1]['side'] = 'Red'
        self.teams[1]['team_id'] = self.teams[0]['team_id']
        self.assertEqual(self.run_audit()[2]['excluded_games'], {'same_team_id': 1})

    def test_import_hash_and_idempotent_lock(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / 'input.gz'
            data = packed(self.teams)
            source.write_bytes(data)
            path = acquire(root, 2025, 'teams', CUTOFF, source)
            before = (root / 'sources.lock.json').read_bytes()
            acquire(root, 2025, 'teams', CUTOFF, source)
            self.assertEqual(before, (root / 'sources.lock.json').read_bytes())
            entry = json.loads(before)['sources'][0]
            self.assertEqual(entry['sha256'], digest(data))
            self.assertEqual(path.read_bytes(), data)
            self.assertEqual(entry['acquisition'], 'local_import')


if __name__ == '__main__':
    unittest.main()

import copy
import json
from pathlib import Path
import tempfile
import unittest

from test_ingest import CUTOFF, fixture, packed
from corpus import audit_corpus, locked_sources, save_corpus
from ingest import acquire


class CorpusTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.add_season(2024)
        self.add_season(2026)

    def add_season(self, season, date=None, game_id=None, player_suffix=""):
        teams, players = fixture()
        for kind, rows in [('teams', teams), ('players', players)]:
            for row in rows:
                row['year'] = str(season)
                row['date'] = date or f'{season}-01-01 12:00:00'
                row['game_id'] = game_id or f'game-{season}'
                if kind == 'players':
                    row['playername'] += player_suffix
            path = self.root / f'{kind}-{season}.gz'
            path.write_bytes(packed(rows))
            acquire(self.root, season, kind, CUTOFF, path)

    def read_lock(self):
        return json.loads((self.root / 'sources.lock.json').read_text())

    def write_lock(self, lock):
        (self.root / 'sources.lock.json').write_text(json.dumps(lock))

    def run_audit(self, seasons=None):
        return audit_corpus(self.root, seasons or [2024, 2026], CUTOFF, 'UTC')

    def test_temporal_merge_preserves_one_game_each(self):
        games, quarantine, report = self.run_audit()
        self.assertEqual([game['game_id'] for game in games], ['game-2024', 'game-2026'])
        self.assertEqual(quarantine, [])
        self.assertEqual(report['canonical_games'], 2)
        self.assertEqual(report['coverage_by_month'], {'2024-01': 1, '2026-01': 1})
        self.assertFalse(report['training_ready'])
        self.assertEqual(report['verified_series'], 0)

    def test_selection_and_save_are_byte_stable(self):
        before = self.run_audit()
        after = self.run_audit([2026, 2024])
        self.assertEqual(before, after)
        output = self.root / 'output'
        save_corpus(output, *before)
        files = {path.name: path.read_bytes() for path in output.iterdir()}
        save_corpus(output, *after)
        self.assertEqual(files, {path.name: path.read_bytes() for path in output.iterdir()})

    def test_rejects_duplicate_season_selection(self):
        with self.assertRaisesRegex(ValueError, 'distinct'):
            self.run_audit([2024, 2024])

    def test_missing_or_ambiguous_pair_fails(self):
        lock = self.read_lock()
        source = lock['sources'].pop()
        self.write_lock(lock)
        with self.assertRaisesRegex(ValueError, 'exactly one'):
            self.run_audit()
        lock['sources'].extend([source, copy.deepcopy(source)])
        self.write_lock(lock)
        with self.assertRaisesRegex(ValueError, 'exactly one'):
            self.run_audit()

    def test_different_cutoff_does_not_silently_reuse_lock(self):
        with self.assertRaisesRegex(ValueError, 'exactly one'):
            locked_sources(self.root, [2024], '2026-10-20T00:00:00Z')

    def test_tampered_raw_bytes_are_rejected(self):
        source = self.read_lock()['sources'][0]
        (self.root / source['path']).write_bytes(b'corrupted')
        with self.assertRaisesRegex(ValueError, 'hash/size'):
            self.run_audit()

    def test_tampered_schema_or_row_count_is_rejected(self):
        lock = self.read_lock()
        lock['sources'][0]['row_count'] += 1
        self.write_lock(lock)
        with self.assertRaisesRegex(ValueError, 'schema/count'):
            self.run_audit()

    def test_wrong_season_is_rejected(self):
        lock = self.read_lock()
        for source in lock['sources']:
            if source['season'] == 2024:
                source['season'] = 2023
        self.write_lock(lock)
        with self.assertRaisesRegex(ValueError, 'season mismatch'):
            self.run_audit([2023])

    def test_duplicate_game_across_seasons_is_rejected(self):
        # Start with a fresh lock so updated sources are not ambiguous.
        (self.root / 'sources.lock.json').unlink()
        self.add_season(2024, game_id='reused')
        self.add_season(2026, game_id='reused')
        with self.assertRaisesRegex(ValueError, 'overlap'):
            self.run_audit()

    def test_cutoff_exclusion_has_league_and_season(self):
        (self.root / 'sources.lock.json').unlink()
        self.add_season(2024)
        self.add_season(2026, date='2026-10-21 00:00:00')
        games, quarantine, report = self.run_audit()
        self.assertEqual(len(games), 1)
        self.assertEqual(quarantine, [{'season': 2026, 'game_id': 'game-2026', 'reason': 'at_or_after_cutoff'}])
        self.assertEqual(report['seasons']['2026']['excluded_games_by_league'], {'LCK': {'at_or_after_cutoff': 1}})

    def test_unselected_sources_do_not_change_corpus_identity(self):
        before = self.run_audit()
        self.add_season(2025)
        self.assertEqual(before, self.run_audit())

    def test_source_path_must_stay_inside_root(self):
        lock = self.read_lock()
        lock['sources'][0]['path'] = '../outside.gz'
        self.write_lock(lock)
        with self.assertRaisesRegex(ValueError, 'inside'):
            self.run_audit()

    def test_future_roster_does_not_change_past_observation(self):
        before = self.run_audit()[0][0]
        (self.root / 'sources.lock.json').unlink()
        self.add_season(2024)
        self.add_season(2026, player_suffix='-changed')
        after = self.run_audit()[0][0]
        self.assertEqual(before, after)


if __name__ == '__main__':
    unittest.main()

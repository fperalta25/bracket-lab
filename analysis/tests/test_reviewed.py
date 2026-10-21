import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from test_identities import game
from identities import audit_identity_files
from ingest import digest
from reviewed import import_reviewed, load_imported_history, save_import
from temporal import PreGameQuery


class ReviewedImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.games, self.corpus = self.root / 'games.jsonl', self.root / 'corpus.json'
        self.identity = self.root / 'identity' / 'audit.json'
        self.games.write_text(json.dumps(game()) + '\n')
        self.corpus.write_text(json.dumps({
            'corpus_version': 'chaincc-corpus-v1', 'canonical_sha256': digest(self.games.read_bytes()),
            'canonical_games': 1, 'cutoff_utc': '2026-10-21T00:00:00Z',
            'source_timezone_assumption': 'UTC', 'timezone_verified': False,
        }))
        audit_identity_files(self.games, self.corpus, '2026-10-21T00:00:00Z', self.identity.parent)
        self.bundle_path = self.root / 'bundle.json'
        evidence = self.root / 'source.txt'
        evidence.write_text('Synthetic test evidence only; no historical claim.\n')
        self.bundle = {
            'schema_version': 1, 'source_canonical_sha256': digest(self.games.read_bytes()),
            'source_corpus_audit_sha256': digest(self.corpus.read_bytes()),
            'source_identity_audit_sha256': digest(self.identity.read_bytes()),
            'sources': [{'id': 'test', 'path': 'source.txt', 'reference': 'synthetic:test-only',
                         'sha256': digest(evidence.read_bytes()), 'retrieved_at_utc': '2025-01-02T00:00:00Z',
                         'reviewed_at_utc': '2025-01-02T01:00:00Z', 'review_note': 'Synthetic fixture',
                         'license': 'Synthetic fixture, no third-party dataset'}],
            'results': [{'game_id': 'g1', 'team_a_id': 'a', 'team_b_id': 'b', 'win_a': 0,
                         'event_start_utc': '2025-01-01T12:00:00Z', 'available_at_utc': '2025-01-01T13:00:00Z',
                         'time_source_id': 'test', 'result_source_id': 'test'}],
            'rosters': [{'snapshot_id': 'lineup', 'team_id': 'a', 'player_ids': ['p1', 'p2', 'p3', 'p4', 'p5'],
                         'effective_from_utc': '2024-12-01T00:00:00Z', 'available_at_utc': '2024-11-30T00:00:00Z',
                         'source_id': 'test'}],
        }

    def run_import(self):
        self.bundle_path.write_text(json.dumps(self.bundle))
        return import_reviewed(self.bundle_path, self.games, self.corpus, self.identity)

    def test_import_roundtrip_reaches_temporal_history_without_changing_corpus(self):
        before = self.games.read_bytes()
        dataset, report = self.run_import()
        output = self.root / 'imported'
        report = save_import(output, dataset, report)
        history = load_imported_history(output / 'dataset.json', output / 'audit.json')
        query = PreGameQuery('target', 'a', 'b', '2025-01-03T12:00:00Z', '2025-01-03T11:00:00Z')
        self.assertEqual(history.results_before('a', query).games[0].game_id, 'g1')
        self.assertEqual(history.roster_before('a', query).player_ids, ('p1', 'p2', 'p3', 'p4', 'p5'))
        self.assertFalse(report['training_ready'])
        self.assertEqual(before, self.games.read_bytes())

    def test_idempotent_outputs(self):
        output = self.root / 'out'
        first = save_import(output, *self.run_import())
        files = {path.name: path.read_bytes() for path in output.iterdir()}
        self.assertEqual(first, save_import(output, *self.run_import()))
        self.assertEqual(files, {path.name: path.read_bytes() for path in output.iterdir()})

    def test_tampered_source_bytes_fail(self):
        (self.root / 'source.txt').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'source hash'):
            self.run_import()

    def test_bundle_must_reference_exact_frozen_inputs(self):
        self.bundle['source_identity_audit_sha256'] = 'a' * 64
        with self.assertRaisesRegex(ValueError, 'different frozen inputs'):
            self.run_import()

    def test_unknown_source_fails(self):
        self.bundle['results'][0]['result_source_id'] = 'unknown'
        with self.assertRaisesRegex(ValueError, 'Unknown reviewed source'):
            self.run_import()

    def test_duplicate_source_fails(self):
        self.bundle['sources'].append(copy.deepcopy(self.bundle['sources'][0]))
        with self.assertRaisesRegex(ValueError, 'duplicate evidence source'):
            self.run_import()

    def test_unknown_game_fails(self):
        self.bundle['results'][0]['game_id'] = 'not-in-corpus'
        with self.assertRaisesRegex(ValueError, 'Unknown or quarantined'):
            self.run_import()

    def test_quarantined_game_cannot_be_promoted_by_annotation(self):
        identity = json.loads(self.identity.read_text())
        identity['identity_quarantined_game_ids'] = ['g1']
        self.identity.write_text(json.dumps(identity))
        self.bundle['source_identity_audit_sha256'] = digest(self.identity.read_bytes())
        with self.assertRaisesRegex(ValueError, 'Unknown or quarantined'):
            self.run_import()

    def test_result_or_team_override_is_rejected(self):
        for key, value in [('team_a_id', 'other'), ('win_a', 1)]:
            with self.subTest(key=key):
                original = self.bundle['results'][0][key]
                self.bundle['results'][0][key] = value
                with self.assertRaisesRegex(ValueError, 'conflict'):
                    self.run_import()
                self.bundle['results'][0][key] = original

    def test_duplicate_results_fail(self):
        self.bundle['results'].append(copy.deepcopy(self.bundle['results'][0]))
        with self.assertRaisesRegex(ValueError, 'Duplicate historical'):
            self.run_import()

    def test_duplicate_roster_snapshot_fails(self):
        self.bundle['rosters'].append(copy.deepcopy(self.bundle['rosters'][0]))
        with self.assertRaisesRegex(ValueError, 'Duplicate roster'):
            self.run_import()

    def test_availability_cannot_exceed_capture(self):
        self.bundle['results'][0]['available_at_utc'] = '2025-01-03T00:00:00Z'
        with self.assertRaisesRegex(ValueError, 'later than evidence retrieval'):
            self.run_import()

    def test_review_cannot_precede_capture(self):
        self.bundle['sources'][0]['reviewed_at_utc'] = '2024-01-01T00:00:00Z'
        with self.assertRaisesRegex(ValueError, 'Review cannot precede'):
            self.run_import()

    def test_availability_requires_timezone_and_cannot_be_null(self):
        for value in [None, '2025-01-01']:
            self.bundle['results'][0]['available_at_utc'] = value
            with self.assertRaises(ValueError):
                self.run_import()

    def test_postgame_stats_are_not_accepted_as_temporal_fields(self):
        self.bundle['results'][0]['goldat15'] = 5000
        with self.assertRaisesRegex(ValueError, 'unsupported evidence fields'):
            self.run_import()

    def test_start_correction_is_explicit_and_preserves_original(self):
        before = self.games.read_bytes()
        self.bundle['results'][0]['event_start_utc'] = '2025-01-01T11:00:00Z'
        _, report = self.run_import()
        self.assertEqual(report['reviewed_start_corrections'][0]['game_id'], 'g1')
        self.assertEqual(before, self.games.read_bytes())

    def test_roster_requires_known_team_and_distinct_player_ids(self):
        self.bundle['rosters'][0]['team_id'] = 'unknown'
        with self.assertRaisesRegex(ValueError, 'Unknown roster team'):
            self.run_import()
        self.bundle['rosters'][0]['team_id'] = 'a'
        self.bundle['rosters'][0]['player_ids'] = ['p1'] * 5
        with self.assertRaisesRegex(ValueError, 'distinct stable'):
            self.run_import()

    def test_source_path_cannot_escape_bundle_directory(self):
        self.bundle['sources'][0]['path'] = '../outside.txt'
        with self.assertRaisesRegex(ValueError, 'inside bundle directory'):
            self.run_import()

    def test_review_and_license_must_be_explicit(self):
        for key in ['review_note', 'license']:
            self.bundle['sources'][0][key] = ''
            with self.assertRaises(ValueError):
                self.run_import()
            self.bundle['sources'][0][key] = 'test-only'

    def test_empty_bundle_preserves_missing_data(self):
        self.bundle['sources'], self.bundle['results'], self.bundle['rosters'] = [], [], []
        dataset, report = self.run_import()
        self.assertEqual(dataset['results'], [])
        self.assertEqual(report['games_without_reviewed_results'], 1)
        self.assertFalse(report['training_ready'])

    def test_cutoff_cannot_be_bypassed_with_later_evidence(self):
        self.bundle['sources'][0]['retrieved_at_utc'] = '2026-10-22T00:00:00Z'
        self.bundle['sources'][0]['reviewed_at_utc'] = '2026-10-22T01:00:00Z'
        self.bundle['results'][0]['available_at_utc'] = '2026-10-21T00:00:00Z'
        with self.assertRaisesRegex(ValueError, 'precede corpus cutoff'):
            self.run_import()

    def test_conflicting_rosters_are_rejected_before_output(self):
        other = copy.deepcopy(self.bundle['rosters'][0])
        other['snapshot_id'] = 'conflict'
        other['player_ids'] = ['x1', 'x2', 'x3', 'x4', 'x5']
        self.bundle['rosters'].append(other)
        with self.assertRaisesRegex(ValueError, 'Conflicting reviewed roster'):
            self.run_import()

    def test_tampered_serialized_dataset_fails_on_load(self):
        output = self.root / 'out'
        save_import(output, *self.run_import())
        (output / 'dataset.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'version/hash'):
            load_imported_history(output / 'dataset.json', output / 'audit.json')

    def test_cli_output_cannot_overwrite_source_audit(self):
        self.bundle_path.write_text(json.dumps(self.bundle))
        before = self.identity.read_bytes()
        process = subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / 'src/reviewed.py'),
                                  '--bundle', str(self.bundle_path), '--games', str(self.games),
                                  '--corpus-audit', str(self.corpus), '--identity-audit', str(self.identity),
                                  '--output', str(self.identity.parent)], capture_output=True, text=True)
        self.assertEqual(process.returncode, 1)
        self.assertEqual(before, self.identity.read_bytes())
        self.assertFalse((self.identity.parent / 'dataset.json').exists())

    def test_cli_rejects_invalid_bundle_without_outputs(self):
        self.bundle['sources'][0]['sha256'] = 'b' * 64
        self.bundle_path.write_text(json.dumps(self.bundle))
        output = self.root / 'out'
        process = subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / 'src/reviewed.py'),
                                  '--bundle', str(self.bundle_path), '--games', str(self.games),
                                  '--corpus-audit', str(self.corpus), '--identity-audit', str(self.identity),
                                  '--output', str(output)], capture_output=True, text=True)
        self.assertEqual(process.returncode, 1)
        self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()

import json
from pathlib import Path
import tempfile
import unittest

from test_identities import game
from identities import audit_identity_files
from ingest import digest
from temporal_audit import readiness_report


class TemporalAuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.games = self.root / 'games.jsonl'
        self.corpus = self.root / 'corpus.json'
        self.identity = self.root / 'identities' / 'audit.json'
        self.games.write_text(json.dumps(game()) + '\n')
        self.corpus.write_text(json.dumps({
            'corpus_version': 'chaincc-corpus-v1', 'canonical_sha256': digest(self.games.read_bytes()),
            'canonical_games': 1, 'cutoff_utc': '2026-10-21T00:00:00Z',
            'source_timezone_assumption': 'UTC', 'timezone_verified': False,
        }))
        audit_identity_files(self.games, self.corpus, '2026-10-21T00:00:00Z', self.identity.parent)

    def run_audit(self):
        return readiness_report(self.games, self.corpus, self.identity)

    def test_unknown_availability_and_source_names_do_not_create_features(self):
        report = self.run_audit()
        self.assertEqual(report['candidate_games'], 1)
        self.assertEqual(report['historical_results_with_reviewed_temporal_evidence'], 0)
        self.assertEqual(report['missing_evidence_by_game']['stable_player_ids'], 1)
        self.assertFalse(report['training_ready'])
        for block in report['feature_blocks'].values():
            self.assertEqual(block, {'status': 'missing', 'value': None})
        self.assertEqual(report, self.run_audit())

    def test_modified_corpus_is_rejected(self):
        self.games.write_text(self.games.read_text() + '\n')
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            self.run_audit()

    def test_identity_quarantine_must_reference_input_games(self):
        identity = json.loads(self.identity.read_text())
        identity['identity_quarantined_game_ids'] = ['unknown']
        self.identity.write_text(json.dumps(identity))
        with self.assertRaisesRegex(ValueError, 'unknown game IDs'):
            self.run_audit()

    def test_matching_audit_provenance_is_required(self):
        corpus = json.loads(self.corpus.read_text())
        corpus['timezone_verified'] = True
        self.corpus.write_text(json.dumps(corpus))
        with self.assertRaisesRegex(ValueError, 'different corpus audit'):
            self.run_audit()


if __name__ == '__main__':
    unittest.main()

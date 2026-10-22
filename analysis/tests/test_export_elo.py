import json
from pathlib import Path
import tempfile
import unittest

from baseline import replay
from backtest import run_backtest
from confidence_backtest import run as run_confidence
from elo_tuning import run_tuning
from export_elo import closing_ratings, export
from identities import audit_identity_files
from ingest import digest
from test_baseline import PROTOCOL, game
from test_identities import game as canonical_game

ROOT=Path(__file__).resolve().parents[1]


class ClosingTests(unittest.TestCase):
    def test_snapshot_uses_saved_innovations_strictly_before_cutoff(self):
        rows,_=replay([game('a','2024-01-01T00:00:00Z'),game('b','2024-01-03T00:00:00Z')],PROTOCOL,1)
        before=closing_ratings(rows,PROTOCOL,'2024-01-02T00:00:00Z')
        self.assertEqual(before[0],{})
        ratings,counts,last=closing_ratings(rows,PROTOCOL,'2024-01-03T00:00:00Z')
        self.assertAlmostEqual(ratings['a'],1516)
        self.assertAlmostEqual(ratings['a']+ratings['b'],3000)
        self.assertEqual(counts['a'],1)
        self.assertEqual(last['a'],rows[0]['event_start_utc'])
        rows[-1]['win_a']=1-rows[-1]['win_a']
        self.assertEqual((ratings,counts,last),closing_ratings(rows,PROTOCOL,'2024-01-03T00:00:00Z'))


class ExportTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);self.root=Path(temp.name)
        self.games,self.corpus,self.identity=self.root/'games.jsonl',self.root/'corpus.json',self.root/'identity/audit.json'
        self.base,self.confidence,self.tuning,self.mapping=[self.root/name for name in ['baseline/metrics.json','confidence/metrics.json','tuning/metrics.json','mapping.json']]
        rows=[canonical_game('warm','2024-01-01T00:00:00Z'),canonical_game('dev1','2025-01-10T00:00:00Z'),
              canonical_game('dev2','2025-01-12T00:00:00Z'),canonical_game('eval','2026-02-01T00:00:00Z'),
              canonical_game('final','2026-09-10T00:00:00Z'),canonical_game('target','2026-09-12T00:00:00Z')]
        rows[-1]['league_id']='WLDs'
        self.games.write_text(''.join(json.dumps(row)+'\n' for row in rows))
        self.corpus.write_text(json.dumps({'corpus_version':'chaincc-corpus-v1','canonical_sha256':digest(self.games.read_bytes()),
            'canonical_games':len(rows),'cutoff_utc':'2026-10-21T00:00:00Z','source_timezone_assumption':'UTC','timezone_verified':False}))
        audit_identity_files(self.games,self.corpus,'2026-10-21T00:00:00Z',self.identity.parent)
        config=self.root/'baseline.json';config.write_text(json.dumps({**PROTOCOL,'bootstrap_replicates':5}))
        base=run_backtest(self.games,self.corpus,self.identity,config,self.base.parent)
        for name, runner in [('elo-confidence-v1.json','confidence'),('internal-elo-tuning-v1.json','tuning')]:
            original=json.loads((ROOT/'config'/name).read_text())
            data={**original,'baseline_metrics_sha256':digest(self.base.read_bytes()),'baseline_protocol_sha256':base['protocol_sha256'],
                  'source_canonical_sha256':base['source_canonical_sha256'],'bootstrap_replicates':5}
            config=self.root/name;config.write_text(json.dumps(data))
            if runner=='confidence':run_confidence(self.base,self.base.parent,config,self.confidence.parent)
            else:run_tuning(self.games,self.corpus,self.identity,self.base,self.base.parent,config,self.tuning.parent)
        self.mapping.write_text(json.dumps({'version':1,'teams':[
            {'team_id':'mapped','acronym':'A','source_team_id':rows[0]['team_a_id'],'source_name':rows[0]['team_a_name']},
            {'team_id':'unknown','acronym':'U','source_team_id':None,'source_name':None}]}))
        self.output=self.root/'artifact.json'

    def run_export(self,cutoff='2026-10-21T00:00:00Z'):
        return export(self.games,self.corpus,self.identity,self.base,self.confidence,self.tuning,self.mapping,cutoff,self.output)

    def test_reproducible_hashed_snapshot_excludes_target_and_marks_unlinked_prior(self):
        first=self.run_export();raw=self.output.read_bytes();self.assertEqual(first,self.run_export());self.assertEqual(raw,self.output.read_bytes())
        self.assertEqual(first['sha256'],digest(first['payloadJson'].encode()))
        p=json.loads(first['payloadJson']);self.assertFalse(p['recommended']);self.assertEqual(p['status'],'trained_experimental')
        mapped,unknown=p['teams'];self.assertEqual(mapped['games'],5)
        self.assertEqual(p['targetTournamentExcluded']['games'],1)
        self.assertEqual(unknown['games'],0);self.assertEqual(unknown['rating'],1500);self.assertIsNone(unknown['sourceTeamId'])
        self.assertEqual(p['source']['exporterSha256'],digest((ROOT/'src/export_elo.py').read_bytes()))

    def test_duplicate_or_ambiguous_mapping_rejected(self):
        data=json.loads(self.mapping.read_text());data['teams'].append(data['teams'][0]);self.mapping.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError,'Duplicate'):self.run_export()
        self.assertFalse(self.output.exists())

    def test_invented_source_name_rejected(self):
        data=json.loads(self.mapping.read_text());data['teams'][0]['source_name']='invented';self.mapping.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError,'ambiguous'):self.run_export()

    def test_tampered_corpus_report_and_invalid_cutoff_fail(self):
        with self.assertRaisesRegex(ValueError,'cutoff'):self.run_export('2026-10-22T00:00:00Z')
        self.games.write_text(self.games.read_text()+'\n')
        with self.assertRaises(ValueError):self.run_export()
        self.assertFalse(self.output.exists())

    def test_unknown_version_and_protected_output_rejected(self):
        self.output=self.base;before=self.base.read_bytes()
        with self.assertRaisesRegex(ValueError,'overwrite'):self.run_export()
        self.assertEqual(before,self.base.read_bytes())
        c=json.loads(self.confidence.read_text());c['backtest_version']='unknown';self.confidence.write_text(json.dumps(c))
        with self.assertRaises(ValueError):self.run_export()

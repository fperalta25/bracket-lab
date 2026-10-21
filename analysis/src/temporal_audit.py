"""Measure missing pre-game evidence in the current, frozen canonical corpus."""
import argparse
from collections import Counter
import json
from pathlib import Path

from ingest import digest, utc, write_json
from temporal import HistoricalResult


def readiness_report(games_path, corpus_audit_path, identity_audit_path):
    data = games_path.read_bytes()
    corpus_bytes, identity_bytes = corpus_audit_path.read_bytes(), identity_audit_path.read_bytes()
    corpus, identity = json.loads(corpus_bytes), json.loads(identity_bytes)
    if corpus.get('corpus_version') != 'chaincc-corpus-v1' or identity.get('identity_audit_version') != 'chaincc-identities-v1':
        raise ValueError('Unsupported input audit version')
    if digest(data) != corpus['canonical_sha256'] or digest(data) != identity['source_canonical_sha256']:
        raise ValueError('Canonical corpus hash mismatch')
    if digest(corpus_bytes) != identity['source_audit_sha256']:
        raise ValueError('Identity audit references a different corpus audit')
    if utc(corpus['cutoff_utc']) != utc(identity['as_of_utc']):
        raise ValueError('Require matching corpus and identity cutoffs')
    games = [json.loads(line) for line in data.decode('utf-8').splitlines()]
    ids = [game['game_id'] for game in games]
    if len(games) != corpus['canonical_games'] or len(ids) != len(set(ids)):
        raise ValueError('Canonical corpus count or ID mismatch')
    quarantined = set(identity['identity_quarantined_game_ids'])
    if not quarantined.issubset(ids):
        raise ValueError('Identity quarantine contains unknown game IDs')
    candidates = [game for game in games if game['game_id'] not in quarantined]
    missing = Counter()
    for game in candidates:
        # The current canonical format contains no reviewed timestamp/result evidence
        # or pre-game player-ID snapshots. Never turn source names into player IDs.
        result = HistoricalResult(game['game_id'], game['team_a_id'], game['team_b_id'],
                                  game['event_start_utc'], game['available_at_utc'], game['win_a'])
        if result.available_at_utc is None:
            missing['result_available_at_utc'] += 1
        missing['reviewed_time_and_result_evidence'] += 1
        missing['pre_game_roster_snapshot'] += 1
        if any(game[f'roster_{side}'] is None or game[f'roster_{side}']['identity_status'] != 'stable_player_ids'
               for side in ['a', 'b']):
            missing['stable_player_ids'] += 1
    return {
        'temporal_audit_version': 'pregame-contract-v1', 'mode': 'coverage_only',
        'source_canonical_sha256': digest(data), 'source_corpus_audit_sha256': digest(corpus_bytes),
        'source_identity_audit_sha256': digest(identity_bytes),
        'as_of_utc': corpus['cutoff_utc'], 'canonical_games': len(games),
        'quarantined_games': len(quarantined), 'candidate_games': len(candidates),
        'missing_evidence_by_game': dict(sorted(missing.items())),
        'historical_results_with_reviewed_temporal_evidence': 0,
        'pre_game_roster_snapshots': 0, 'training_ready': False,
        'feature_blocks': {
            'recent_form': {'status': 'missing', 'value': None},
            'roster_continuity': {'status': 'missing', 'value': None},
            'historical_gpr': {'status': 'missing', 'value': None},
        },
        'limitations': ['Coverage audit only; no features, baseline probabilities or coefficients are fitted.',
                        'Current canonical schema has no reviewed temporal evidence or pre-game roster snapshots.',
                        'Evidence references require review; a source hash does not establish historical availability.',
                        'No use of current GPR for past matches; missing blocks remain missing.'],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--games', type=Path, required=True)
    parser.add_argument('--corpus-audit', type=Path, required=True)
    parser.add_argument('--identity-audit', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        report = readiness_report(args.games, args.corpus_audit, args.identity_audit)
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, f'Temporal coverage audit failed: {error}\n')
    write_json(args.output, report)
    print(json.dumps({key: report[key] for key in ['candidate_games', 'training_ready', 'missing_evidence_by_game']}))


if __name__ == '__main__':
    main()

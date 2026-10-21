"""Import reviewed offline evidence into the temporal contract without mutating raw data."""
import argparse
from dataclasses import asdict
import json
from pathlib import Path

from ingest import digest, utc, write_json
from temporal import Evidence, HistoricalResult, RosterSnapshot, TemporalHistory
from temporal_audit import readiness_report


def fields(value, required, optional=()):
    if not isinstance(value, dict) or not set(required) <= value.keys() or value.keys() - set(required) - set(optional):
        raise ValueError('Missing or unsupported evidence fields')


def reviewed_sources(bundle, directory):
    sources = {}
    for source in bundle['sources']:
        fields(source, ['id', 'path', 'reference', 'sha256', 'retrieved_at_utc',
                        'reviewed_at_utc', 'review_note', 'license'])
        if not source['id'] or source['id'] in sources:
            raise ValueError('Missing or duplicate evidence source ID')
        path = (directory / source['path']).resolve()
        if not path.is_relative_to(directory.resolve()):
            raise ValueError('Evidence files must stay inside bundle directory')
        evidence = Evidence(source['reference'], source['sha256'])
        if digest(path.read_bytes()) != evidence.sha256:
            raise ValueError('Evidence source hash mismatch')
        if not source['review_note'].strip() or not source['license'].strip():
            raise ValueError('Require explicit review and license information')
        if utc(source['reviewed_at_utc']) < utc(source['retrieved_at_utc']):
            raise ValueError('Review cannot precede retrieval of reviewed bytes')
        sources[source['id']] = (source, evidence)
    return sources


def import_reviewed(bundle_path, games_path, corpus_audit_path, identity_audit_path):
    coverage = readiness_report(games_path, corpus_audit_path, identity_audit_path)
    bundle_data = bundle_path.read_bytes()
    bundle = json.loads(bundle_data)
    fields(bundle, ['schema_version', 'source_canonical_sha256', 'source_corpus_audit_sha256',
                    'source_identity_audit_sha256', 'sources', 'results', 'rosters'])
    if type(bundle['schema_version']) is not int or bundle['schema_version'] != 1:
        raise ValueError('Unsupported reviewed evidence schema')
    for key in ['source_canonical_sha256', 'source_corpus_audit_sha256', 'source_identity_audit_sha256']:
        if bundle[key] != coverage[key]:
            raise ValueError('Evidence bundle references different frozen inputs')
    if any(not isinstance(bundle[key], list) for key in ['sources', 'results', 'rosters']):
        raise ValueError('Evidence collections must be arrays')
    sources = reviewed_sources(bundle, bundle_path.parent)
    games_data = games_path.read_bytes()
    if digest(games_data) != coverage['source_canonical_sha256']:
        raise ValueError('Canonical corpus changed during evidence import')
    games = {game['game_id']: game for game in map(json.loads, games_data.decode('utf-8').splitlines())}
    identity = json.loads(identity_audit_path.read_text())
    quarantined = set(identity['identity_quarantined_game_ids'])
    teams = {game[key] for game in games.values() for key in ['team_a_id', 'team_b_id']}
    cutoff = utc(coverage['as_of_utc'])
    results, rosters, changed_starts = [], [], []

    def source(source_id, available=None):
        if source_id not in sources:
            raise ValueError('Unknown reviewed source ID')
        metadata, evidence = sources[source_id]
        if available is not None and utc(available) > utc(metadata['retrieved_at_utc']):
            raise ValueError('Claimed availability is later than evidence retrieval')
        return evidence

    for item in bundle['results']:
        fields(item, ['game_id', 'team_a_id', 'team_b_id', 'event_start_utc', 'available_at_utc',
                      'win_a', 'time_source_id', 'result_source_id'])
        game_id = item['game_id']
        if game_id not in games or game_id in quarantined:
            raise ValueError('Unknown or quarantined game ID')
        original = games[game_id]
        if any(item[key] != original[key] for key in ['team_a_id', 'team_b_id', 'win_a']):
            raise ValueError('Evidence teams/result conflict with canonical game')
        if item['available_at_utc'] is None:
            raise ValueError('Reviewed result requires explicit availability')
        result = HistoricalResult(
            game_id, item['team_a_id'], item['team_b_id'], item['event_start_utc'], item['available_at_utc'],
            item['win_a'], source(item['time_source_id']), source(item['result_source_id'], item['available_at_utc']))
        if utc(result.event_start_utc) >= cutoff or utc(result.available_at_utc) >= cutoff:
            raise ValueError('Reviewed game/availability must precede corpus cutoff')
        if utc(result.event_start_utc) != utc(original['event_start_utc']):
            changed_starts.append({'game_id': game_id, 'source_start_utc': original['event_start_utc'],
                                   'reviewed_start_utc': result.event_start_utc})
        results.append(result)
    for item in bundle['rosters']:
        fields(item, ['snapshot_id', 'team_id', 'player_ids', 'effective_from_utc', 'available_at_utc', 'source_id'],
               ['effective_until_utc'])
        if item['team_id'] not in teams:
            raise ValueError('Unknown roster team ID')
        if not isinstance(item['player_ids'], list):
            raise ValueError('Player IDs must be an array')
        if utc(item['available_at_utc']) >= cutoff:
            raise ValueError('Roster availability must precede corpus cutoff')
        rosters.append(RosterSnapshot(
            item['snapshot_id'], item['team_id'], item['player_ids'], item['effective_from_utc'],
            item['available_at_utc'], source(item['source_id'], item['available_at_utc']),
            item.get('effective_until_utc')))
    known_rosters = {}
    for roster in rosters:
        key = (roster.team_id, roster.effective_from_utc, roster.available_at_utc)
        value = (roster.player_ids, roster.effective_until_utc)
        if key in known_rosters and known_rosters[key] != value:
            raise ValueError('Conflicting reviewed roster snapshots')
        known_rosters[key] = value
    # Validate all identities before any output, including duplicate IDs.
    TemporalHistory(results, rosters)
    results.sort(key=lambda result: (result.event_start_utc, result.game_id))
    rosters.sort(key=lambda roster: (roster.team_id, roster.effective_from_utc, roster.available_at_utc, roster.snapshot_id))
    dataset = {'schema_version': 'reviewed-temporal-v1',
               'results': [asdict(result) for result in results], 'rosters': [asdict(roster) for roster in rosters]}
    report = {
        'import_version': 'reviewed-temporal-v1', 'bundle_sha256': digest(bundle_data),
        **{key: coverage[key] for key in ['source_canonical_sha256', 'source_corpus_audit_sha256',
                                         'source_identity_audit_sha256', 'as_of_utc', 'candidate_games']},
        'imported_results': len(results), 'imported_roster_snapshots': len(rosters),
        'games_without_reviewed_results': coverage['candidate_games'] - len(results),
        'reviewed_start_corrections': sorted(changed_starts, key=lambda item: item['game_id']),
        'sources': [sources[key][0] for key in sorted(sources)],
        'training_ready': False,
        'limitations': ['Source reviews are explicit declarations, not automatically established historical truth.',
                        'Import does not establish complete corpus coverage, verified series, calibration or model validation.',
                        'Roster player IDs must be reviewed stable identities, never inferred from display names.',
                        'Original corpus and audits remain unchanged.'],
    }
    return dataset, report


def save_import(output, dataset, report):
    data = (json.dumps(dataset, sort_keys=True, ensure_ascii=False, indent=2) + '\n').encode()
    output.mkdir(parents=True, exist_ok=True)
    (output / 'dataset.json').write_bytes(data)
    report = {**report, 'dataset_sha256': digest(data)}
    write_json(output / 'audit.json', report)
    return report


def load_imported_history(dataset_path, audit_path):
    data = dataset_path.read_bytes()
    report = json.loads(audit_path.read_text())
    if report.get('import_version') != 'reviewed-temporal-v1' or digest(data) != report['dataset_sha256']:
        raise ValueError('Reviewed dataset version/hash mismatch')
    dataset = json.loads(data)
    if dataset.get('schema_version') != 'reviewed-temporal-v1':
        raise ValueError('Unsupported reviewed dataset schema')
    results = [HistoricalResult(**{**row, 'time_evidence': Evidence(**row['time_evidence']),
                                  'result_evidence': Evidence(**row['result_evidence'])}) for row in dataset['results']]
    rosters = [RosterSnapshot(**{**row, 'evidence': Evidence(**row['evidence'])}) for row in dataset['rosters']]
    if len(results) != report['imported_results'] or len(rosters) != report['imported_roster_snapshots']:
        raise ValueError('Reviewed dataset count mismatch')
    return TemporalHistory(results, rosters)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--games', type=Path, required=True)
    parser.add_argument('--corpus-audit', type=Path, required=True)
    parser.add_argument('--identity-audit', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        dataset, report = import_reviewed(args.bundle, args.games, args.corpus_audit, args.identity_audit)
    except (ValueError, OSError, KeyError, TypeError) as error:
        parser.exit(1, f'Reviewed evidence import failed: {error}\n')
    protected = {path.resolve() for path in [args.bundle, args.games, args.corpus_audit, args.identity_audit]}
    protected.update((args.bundle.parent / item['path']).resolve() for item in report['sources'])
    targets = {(args.output / name).resolve() for name in ['dataset.json', 'audit.json']}
    if protected & targets:
        parser.exit(1, 'Reviewed evidence output would overwrite a source or audit. Choose a separate output directory.\n')
    report = save_import(args.output, dataset, report)
    print(json.dumps({key: report[key] for key in ['imported_results', 'imported_roster_snapshots', 'training_ready']}))


if __name__ == '__main__':
    main()

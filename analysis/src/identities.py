"""Dated identity observations from a hash-verified canonical corpus, never alias inference."""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path

from ingest import ROLES, digest, utc, write_json


def observation_span(observations):
    first, last = observations[0], observations[-1]
    return {'first_seen_utc': first['at'], 'last_seen_utc': last['at'],
            'first_game_id': first['game_id'], 'last_game_id': last['game_id'],
            'observed_games': len(observations)}


def identity_audit(games, as_of):
    cutoff = utc(as_of)
    # The cutoff precedes grouping, so later aliases and players never backfill earlier ledgers.
    games = sorted((game for game in games if utc(game['event_start_utc']) < cutoff),
                   key=lambda game: (utc(game['event_start_utc']), game['game_id']))
    seen = set()
    teams = defaultdict(list)
    at_team = defaultdict(list)
    for game in games:
        for side in ['a', 'b']:
            at_team[(game[f'team_{side}_id'], utc(game['event_start_utc']).isoformat())].append(game['game_id'])
    simultaneous = [{'team_id': team_id, 'at_utc': at, 'game_ids': sorted(ids)}
                    for (team_id, at), ids in sorted(at_team.items()) if len(ids) > 1]
    quarantined = {game_id for group in simultaneous for game_id in group['game_ids']}
    names = defaultdict(set)
    blockers = Counter()
    for game in games:
        if not game['game_id'] or game['game_id'] in seen:
            raise ValueError('Missing or duplicate canonical game ID')
        seen.add(game['game_id'])
        if not game['team_a_id'] or not game['team_b_id'] or game['team_a_id'] == game['team_b_id']:
            raise ValueError('Require two distinct source team IDs')
        if game['available_at_utc'] is None:
            blockers['missing_result_availability'] += 1
        elif utc(game['available_at_utc']) < utc(game['event_start_utc']):
            raise ValueError('Result availability precedes game start')
        elif utc(game['available_at_utc']) >= cutoff:
            blockers['result_not_available_before_cutoff'] += 1
        if game['series_id'] is None:
            blockers['missing_series_linkage'] += 1
        if game['game_id'] in quarantined:
            continue
        for side in ['a', 'b']:
            team_id, name = game[f'team_{side}_id'], game[f'team_{side}_name']
            if not name:
                raise ValueError('Missing observed team name')
            names[name].add(team_id)
            roster = game[f'roster_{side}']
            if roster is not None:
                players = roster['players']
                if (len(players) != 5 or {player['role'] for player in players} != ROLES
                        or len({player['source_name'] for player in players if player['source_name']}) != 5):
                    raise ValueError('Invalid observed lineup')
                if roster['identity_status'] != 'source_names_only':
                    raise ValueError('Unsupported player identity status')
                expected = digest(json.dumps([team_id, sorted(players, key=lambda player: player['role'])],
                                            sort_keys=True).encode())
                if roster['observation_id'] != expected:
                    raise ValueError('Lineup observation hash mismatch')
            teams[team_id].append({'game_id': game['game_id'], 'at': utc(game['event_start_utc']).isoformat(),
                                   'name': name, 'roster': roster})
    ledger, aliases_conflicts = [], {}
    lineup_count = 0
    missing_lineup_observations = 0
    for team_id, observations in sorted(teams.items()):
        by_name, by_lineup = defaultdict(list), defaultdict(list)
        for observation in observations:
            by_name[observation['name']].append(observation)
            if observation['roster'] is None:
                missing_lineup_observations += 1
            else:
                by_lineup[observation['roster']['observation_id']].append(observation)
        aliases = [{'source_name': name, **observation_span(items)} for name, items in sorted(by_name.items())]
        lineups = [{'observation_id': key, 'players': items[0]['roster']['players'],
                    **observation_span(items)} for key, items in sorted(by_lineup.items())]
        if len(aliases) > 1:
            aliases_conflicts[team_id] = aliases
        lineup_count += len(lineups)
        ledger.append({'source_team_id': team_id, 'observed_names': aliases, 'observed_lineups': lineups,
                       'identity_status': 'source_id_only', **observation_span(observations)})
    report = {
        'identity_audit_version': 'chaincc-identities-v1', 'as_of_utc': cutoff.isoformat(),
        'cutoff_rule': 'event_start_utc < as_of_utc', 'mode': 'retrospective_observations',
        'training_ready': False, 'canonical_games': len(games), 'source_team_ids': len(ledger),
        'identity_eligible_games': len(games) - len(quarantined),
        'identity_quarantined_game_ids': sorted(quarantined),
        'observed_team_lineups': lineup_count, 'missing_lineup_observations': missing_lineup_observations,
        'team_ids_with_multiple_names': aliases_conflicts,
        'names_with_multiple_team_ids': {name: sorted(ids) for name, ids in sorted(names.items()) if len(ids) > 1},
        'simultaneous_team_observations': simultaneous,
        'temporal_blockers': dict(sorted(blockers.items())),
        'limitations': ['First/last seen delimit observations, not effective alias or roster validity.',
                        'Source player names do not establish stable player identities.',
                        'No organization merges, renamed teams or series are inferred.',
                        'Postgame lineups are not assumed known before game start.',
                        'Source timezone remains unverified; source result availability may be missing.'],
    }
    return ledger, report


def audit_identity_files(games_path, audit_path, as_of, output):
    data = games_path.read_bytes()
    source_report = json.loads(audit_path.read_text())
    if digest(data) != source_report['canonical_sha256']:
        raise ValueError('Canonical corpus hash mismatch')
    if source_report.get('corpus_version') != 'chaincc-corpus-v1':
        raise ValueError('Unsupported canonical corpus version')
    if utc(as_of) > utc(source_report['cutoff_utc']):
        raise ValueError('Identity cutoff cannot exceed source corpus cutoff')
    games = [json.loads(line) for line in data.decode('utf-8').splitlines()]
    if len(games) != source_report['canonical_games']:
        raise ValueError('Canonical corpus count mismatch')
    ledger, report = identity_audit(games, as_of)
    report.update({'source_canonical_sha256': digest(data),
                   'source_audit_sha256': digest(audit_path.read_bytes()),
                   'source_timezone_assumption': source_report['source_timezone_assumption'],
                   'timezone_verified': source_report['timezone_verified']})
    ledger_data = (json.dumps(ledger, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode()
    report['identity_ledger_sha256'] = digest(ledger_data)
    output.mkdir(parents=True, exist_ok=True)
    (output / 'identities.json').write_bytes(ledger_data)
    write_json(output / 'audit.json', report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--games', type=Path, required=True)
    parser.add_argument('--audit', type=Path, required=True)
    parser.add_argument('--as-of', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        report = audit_identity_files(args.games, args.audit, args.as_of, args.output)
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, f'Identity audit failed: {error}\n')
    print(json.dumps({key: report[key] for key in ['canonical_games', 'source_team_ids', 'observed_team_lineups']}))


if __name__ == '__main__':
    main()

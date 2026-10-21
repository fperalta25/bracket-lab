"""Offline ChainCC acquisition and audit. Python standard library only."""
import argparse
from collections import Counter, defaultdict
import csv
from datetime import datetime, timezone
import gzip
import hashlib
import io
import json
from pathlib import Path
import urllib.request
from urllib.error import URLError
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
SOURCE = 'https://chaincc.lol/free/data/'
LICENSE = 'https://creativecommons.org/licenses/by/4.0/'
VERSION = 'chaincc-audit-v1'
ROLES = {'top', 'jng', 'mid', 'bot', 'sup'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + '\n')


def utc(value):
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('Cutoff must include a timezone')
    return parsed.astimezone(timezone.utc)


def acquire(root, season, kind, as_of, local=None):
    utc(as_of)
    url = f'https://chaincc.lol/data/chaincc-{kind}-{season}.csv.gz'
    if local:
        data = Path(local).read_bytes()
    else:
        with urllib.request.urlopen(url, timeout=60) as response:
            data = response.read()
    # Validate gzip and CSV before recording provenance.
    columns, rows = read_csv(data)
    sha = digest(data)
    relative = Path('data/raw/chaincc') / str(season) / f'{kind}-{sha}.csv.gz'
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and digest(target.read_bytes()) != sha:
        raise ValueError('Stored raw file does not match its content hash')
    if not target.exists():
        target.write_bytes(data)
    lock_path = root / 'sources.lock.json'
    lock = json.loads(lock_path.read_text()) if lock_path.exists() else {'schema_version': 1, 'sources': []}
    entry = {
        'provider': 'ChainCC', 'season': season, 'kind': kind, 'url': url,
        'source_page': SOURCE, 'license': 'CC-BY-4.0', 'license_url': LICENSE,
        'license_basis': 'Provider declaration at source_page; upstream rights not independently audited',
        'attribution': 'ChainCC. League of Legends esports match dataset.',
        'sha256': sha, 'bytes': len(data), 'path': str(relative),
        'retrieved_at_utc': None if local else datetime.now(timezone.utc).isoformat(),
        'imported_at_utc': datetime.now(timezone.utc).isoformat() if local else None,
        'row_count': len(rows),
        'acquisition': 'local_import' if local else 'download',
        'as_of_utc': utc(as_of).isoformat(), 'use_rule': 'event_start_utc < as_of_utc',
        'columns': columns,
    }
    # Repeat acquisition of identical bytes/config retains original provenance.
    identity = ('sha256', 'kind', 'season', 'as_of_utc')
    if not any(all(old[key] == entry[key] for key in identity) for old in lock['sources']):
        lock['sources'].append(entry)
    write_json(lock_path, lock)
    return target


def read_csv(data):
    with gzip.open(io.BytesIO(data), 'rt', encoding='utf-8-sig', newline='') as stream:
        reader = csv.DictReader(stream)
        columns = reader.fieldnames
        if not columns or len(set(columns)) != len(columns):
            raise ValueError('Missing or duplicate CSV headers')
        rows = list(reader)
        if any(None in row or any(value is None for value in row.values()) for row in rows):
            raise ValueError('Malformed CSV row')
        return columns, rows


def audit(teams_data, players_data, cutoff, source_timezone):
    cutoff = utc(cutoff)
    zone = ZoneInfo(source_timezone)
    tcols, teams = read_csv(teams_data)
    pcols, players = read_csv(players_data)
    required = {'game_id', 'date', 'league', 'split', 'patch', 'side',
                'team_name', 'opponent_team_name', 'result'}
    for columns, extra in [(tcols, {'team_id', 'game_number'}), (pcols, {'position', 'playername'})]:
        if not required.union(extra).issubset(columns):
            raise ValueError('Unsupported source schema: missing required columns')
    by_game, by_player = defaultdict(list), defaultdict(list)
    for row in teams:
        by_game[row['game_id']].append(row)
    for row in players:
        by_player[row['game_id']].append(row)
    excluded, roster_issues = Counter(), Counter()
    games, quarantine = [], []
    league_counts = Counter()
    aliases = defaultdict(set)
    missing = {kind: {column: sum(not row[column] for row in rows) for column in columns}
               for kind, columns, rows in [('teams', tcols, teams), ('players', pcols, players)]}

    def reject(game_id, reason):
        excluded[reason] += 1
        quarantine.append({'game_id': game_id, 'reason': reason})

    for game_id, sides in sorted(by_game.items()):
        if not game_id:
            reject(game_id, 'missing_game_id')
            continue
        if len(sides) != 2 or {row['side'] for row in sides} != {'Blue', 'Red'}:
            reject(game_id, 'invalid_team_pair')
            continue
        if any(not row['team_id'] for row in sides):
            reject(game_id, 'missing_team_id')
            continue
        if sides[0]['team_id'] == sides[1]['team_id']:
            reject(game_id, 'same_team_id')
            continue
        if any(sides[0][key] != sides[1][key] for key in ['date', 'league', 'split', 'patch', 'game_number']):
            reject(game_id, 'inconsistent_context')
            continue
        if any(row.get('opponent_team_name') != sides[1-index]['team_name'] for index, row in enumerate(sides)):
            reject(game_id, 'opponent_mismatch')
            continue
        if sorted(row['result'] for row in sides) != ['FALSE', 'TRUE']:
            reject(game_id, 'invalid_result')
            continue
        try:
            source_date = datetime.fromisoformat(sides[0]['date'])
            at = (source_date.replace(tzinfo=zone) if source_date.tzinfo is None else source_date).astimezone(timezone.utc)
        except ValueError:
            reject(game_id, 'invalid_date')
            continue
        if at >= cutoff:
            reject(game_id, 'at_or_after_cutoff')
            continue
        a, b = sorted(sides, key=lambda row: row['team_id'])
        observed = by_player.get(game_id, [])
        roster_by_side = {}
        roster_reason = None
        if len(observed) != 10:
            roster_reason = 'player_count'
        elif len({row['playername'] for row in observed}) != 10:
            roster_reason = 'duplicate_player_names'
        elif {row['side'] for row in observed} != {'Blue', 'Red'}:
            roster_reason = 'player_sides'
        else:
            for team in sides:
                lineup = [row for row in observed if row['side'] == team['side']]
                if len(lineup) != 5 or {row['position'] for row in lineup} != ROLES:
                    roster_reason = 'player_roles'
                    break
                if len({row['playername'] for row in lineup if row['playername']}) != 5:
                    roster_reason = 'player_names'
                    break
                if any(any(row[key] != team[key] for key in required - {'game_id'}) for row in lineup):
                    roster_reason = 'player_context_mismatch'
                    break
                roster_by_side[team['side']] = sorted(
                    [{'role': row['position'], 'source_name': row['playername']} for row in lineup],
                    key=lambda row: row['role'])
        if roster_reason:
            roster_issues[roster_reason] += 1
            roster_by_side = {}
        for row in sides:
            aliases[row['team_id']].add(row['team_name'])
        league_counts[a['league']] += 1
        # Source player names are observations, never asserted to be stable identities.
        def roster(team):
            lineup = roster_by_side.get(team['side'])
            if lineup is None:
                return None
            return {'observation_id': digest(json.dumps([team['team_id'], lineup], sort_keys=True).encode()),
                    'players': lineup, 'identity_status': 'source_names_only'}
        games.append({
            'game_id': game_id, 'event_start_utc': at.isoformat(),
            'source_date': a['date'], 'league_id': a['league'], 'split': a['split'],
            'event_id': None, 'event_stage': None, 'patch_id': a['patch'] or None,
            'team_a_id': a['team_id'], 'team_b_id': b['team_id'],
            'team_a_name': a['team_name'], 'team_b_name': b['team_name'],
            'blue_side_team_id': next(row['team_id'] for row in sides if row['side'] == 'Blue'),
            'win_a': int(a['result'] == 'TRUE'),
            'roster_a': roster(a), 'roster_b': roster(b),
            'series_id': None, 'game_number': None, 'source_game_number': a['game_number'],
            'best_of': None, 'score_a_before': None, 'score_b_before': None,
            'is_international': None, 'available_at_utc': None,
            'series_status': 'unverified_linkage',
        })
    games.sort(key=lambda game: (game['event_start_utc'], game['game_id']))
    for game_id in sorted(by_player.keys() - by_game.keys()):
        quarantine.append({'game_id': game_id, 'reason': 'orphan_player_game'})
    source_hashes = {'teams': digest(teams_data), 'players': digest(players_data)}
    for game in games:
        game['source_provenance'] = source_hashes
    report = {
        'audit_version': VERSION, 'source_sha256': source_hashes,
        'cutoff_utc': cutoff.isoformat(), 'cutoff_rule': 'event_start_utc < cutoff_utc',
        'source_timezone_assumption': source_timezone, 'timezone_verified': False,
        'training_ready': False,
        'limitations': ['Source dates have no timezone; explicit timezone is an assumption.',
                        'No verified series IDs/best-of; all games excluded from momentum corpus.',
                        'Player names are not stable IDs; rosters are observed lineups only.',
                        'Availability times, historical GPR, regions and alias validity are unverified.'],
        'schema': {'teams': tcols, 'players': pcols}, 'missing_cells': missing,
        'input_rows': {'teams': len(teams), 'players': len(players)},
        'team_game_groups': len(by_game), 'canonical_games': len(games),
        'excluded_games': dict(sorted(excluded.items())),
        'games_with_complete_observed_lineups': sum(game['roster_a'] is not None for game in games),
        'lineup_issues': dict(sorted(roster_issues.items())),
        'orphan_player_games': len(by_player.keys() - by_game.keys()),
        'verified_series': 0, 'momentum_eligible_games': 0,
        'coverage_by_league': dict(sorted(league_counts.items())),
        'observed_team_names': {key: sorted(value) for key, value in sorted(aliases.items())},
        'date_range_utc': [games[0]['event_start_utc'], games[-1]['event_start_utc']] if games else None,
    }
    return games, quarantine, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ['download', 'import']:
        command = commands.add_parser(name)
        command.add_argument('--season', type=int, required=True)
        command.add_argument('--kind', choices=['teams', 'players'], required=True)
        command.add_argument('--as-of', required=True)
        if name == 'import':
            command.add_argument('--file', type=Path, required=True)
    command = commands.add_parser('audit')
    command.add_argument('--teams', type=Path, required=True)
    command.add_argument('--players', type=Path, required=True)
    command.add_argument('--as-of', required=True)
    command.add_argument('--source-timezone', required=True)
    command.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.command in {'download', 'import'}:
        try:
            print(acquire(args.root, args.season, args.kind, args.as_of, getattr(args, 'file', None)))
        except (URLError, TimeoutError) as error:
            parser.exit(1, f'Download failed: {error}. Use import --file with a locally downloaded CSV.gz.\n')
        return
    games, quarantine, report = audit(args.teams.read_bytes(), args.players.read_bytes(), args.as_of, args.source_timezone)
    args.output.mkdir(parents=True, exist_ok=True)
    curated = ''.join(json.dumps(game, sort_keys=True, ensure_ascii=False) + '\n' for game in games)
    (args.output / 'games.jsonl').write_text(curated)
    report['canonical_sha256'] = digest(curated.encode())
    write_json(args.output / 'quarantine.json', quarantine)
    write_json(args.output / 'audit.json', report)
    print(json.dumps({key: report[key] for key in ['canonical_games', 'excluded_games', 'canonical_sha256']}))


if __name__ == '__main__':
    main()

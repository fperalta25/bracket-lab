"""Audit explicitly locked seasons as one reproducible offline corpus."""
import argparse
from collections import Counter
import json
from pathlib import Path

from ingest import ROOT, VERSION, audit, digest, read_csv, utc, write_json


def locked_sources(root, seasons, cutoff):
    """Require one immutable team/player pair per season and the exact cutoff."""
    if not seasons or len(seasons) != len(set(seasons)):
        raise ValueError('Select distinct seasons')
    lock = json.loads((root / 'sources.lock.json').read_text())
    if lock.get('schema_version') != 1:
        raise ValueError('Unsupported source lock version')
    selected = []
    for season in sorted(seasons):
        pair = {}
        for kind in ['teams', 'players']:
            candidates = [source for source in lock['sources']
                          if source['provider'] == 'ChainCC' and source['season'] == season
                          and source['kind'] == kind and utc(source['as_of_utc']) == utc(cutoff)]
            if len(candidates) != 1:
                raise ValueError(f'Require exactly one locked {kind} file for {season} and cutoff')
            source = candidates[0]
            path = (root / source['path']).resolve()
            if not path.is_relative_to(root.resolve()):
                raise ValueError('Raw source path must stay inside the repository')
            data = path.read_bytes()
            if digest(data) != source['sha256'] or len(data) != source['bytes']:
                raise ValueError(f'Source hash/size mismatch: {season} {kind}')
            columns, rows = read_csv(data)
            if columns != source['columns'] or len(rows) != source['row_count']:
                raise ValueError(f'Source schema/count mismatch: {season} {kind}')
            # A mislabeled season must not silently contaminate the merged corpus.
            if 'year' not in columns or any(row['year'] != str(season) for row in rows):
                raise ValueError(f'Source season mismatch: {season} {kind}')
            pair[kind] = (source, data)
        selected.append((season, pair))
    return selected


def audit_corpus(root, seasons, cutoff, source_timezone):
    selected = locked_sources(root, seasons, cutoff)
    games, quarantine, reports, manifest = [], [], {}, []
    seen_games = set()
    for season, pair in selected:
        teams, players = pair['teams'][1], pair['players'][1]
        _, rows = read_csv(teams)
        ids = {row['game_id'] for row in rows if row['game_id']}
        if ids & seen_games:
            raise ValueError('Game IDs overlap across seasons; resolve source linkage before merging')
        seen_games.update(ids)
        season_games, season_quarantine, report = audit(teams, players, cutoff, source_timezone)
        reports[str(season)] = report
        games.extend(season_games)
        quarantine.extend({'season': season, **item} for item in season_quarantine)
        manifest.extend(pair[kind][0] for kind in ['teams', 'players'])
    games.sort(key=lambda game: (game['event_start_utc'], game['game_id']))
    # Temporal diagnostics describe observations; they are not train/test partitions.
    months, leagues, exclusions = Counter(), Counter(), Counter()
    for game in games:
        months[game['event_start_utc'][:7]] += 1
        leagues[game['league_id']] += 1
    for report in reports.values():
        exclusions.update(report['excluded_games'])
    summary = {
        'corpus_version': 'chaincc-corpus-v1', 'audit_version': VERSION,
        'cutoff_utc': utc(cutoff).isoformat(), 'cutoff_rule': 'event_start_utc < cutoff_utc',
        'source_timezone_assumption': source_timezone,
        'timezone_verified': False, 'training_ready': False,
        'selected_sources_sha256': digest(json.dumps(manifest, sort_keys=True).encode()),
        'sources': [{'season': source['season'], 'kind': source['kind'],
                     'sha256': source['sha256'], 'row_count': source['row_count']}
                    for source in manifest],
        'seasons': {season: {key: report[key] for key in [
            'input_rows', 'team_game_groups', 'canonical_games', 'excluded_games',
            'excluded_games_by_league', 'games_with_complete_observed_lineups',
            'lineup_issues', 'date_range_utc', 'source_sha256', 'missing_cells']}
            for season, report in reports.items()},
        'canonical_games': len(games), 'excluded_games': dict(sorted(exclusions.items())),
        'coverage_by_month': dict(sorted(months.items())),
        'coverage_by_league': dict(sorted(leagues.items())),
        'unique_team_ids': len({game[key] for game in games for key in ['team_a_id', 'team_b_id']}),
        'games_with_complete_observed_lineups': sum(game['roster_a'] is not None for game in games),
        'verified_series': 0, 'momentum_eligible_games': 0,
        'limitations': reports[str(min(seasons))]['limitations'],
    }
    return games, quarantine, summary


def save_corpus(output, games, quarantine, report):
    output.mkdir(parents=True, exist_ok=True)
    data = ''.join(json.dumps(game, sort_keys=True, ensure_ascii=False) + '\n' for game in games).encode()
    (output / 'games.jsonl').write_bytes(data)
    report = {**report, 'canonical_sha256': digest(data)}
    write_json(output / 'quarantine.json', quarantine)
    write_json(output / 'audit.json', report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--seasons', type=int, nargs='+', required=True)
    parser.add_argument('--as-of', required=True)
    parser.add_argument('--source-timezone', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        games, quarantine, report = audit_corpus(args.root, args.seasons, args.as_of, args.source_timezone)
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, f'Corpus audit failed: {error}\n')
    report = save_corpus(args.output, games, quarantine, report)
    print(json.dumps({key: report[key] for key in ['canonical_games', 'excluded_games', 'canonical_sha256']}))


if __name__ == '__main__':
    main()

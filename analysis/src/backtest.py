"""Reproducible research backtest; never exports a public trained model."""
import argparse
from collections import defaultdict
import json
import math
from pathlib import Path
import random
import sys

from baseline import replay, validate_protocol
from ingest import digest, utc, write_json
from temporal_audit import readiness_report


def metrics(rows):
    if not rows:
        return {'games': 0, 'log_loss': None, 'brier': None, 'accuracy': None,
                'cold_start_games': 0, 'unique_teams': 0, 'unique_matchups': 0, 'verified_series': None,
                'calibration': [], 'favorite_buckets': []}
    bins, favorites = defaultdict(list), defaultdict(list)
    for row in rows:
        p = row['p_win_a']
        bins[min(int(p * 10), 9)].append(row)
        favorites[min(int(max(p, 1 - p) * 10), 9)].append(row)
    def accuracy(row):
        p, y = row['p_win_a'], row['win_a']
        return 0.5 if p == 0.5 else float((p > 0.5) == bool(y))
    n = len(rows)
    return {
        'games': n, 'log_loss': math.fsum(row['log_loss'] for row in rows) / n,
        'brier': math.fsum(row['brier'] for row in rows) / n,
        'accuracy': math.fsum(accuracy(row) for row in rows) / n,
        'cold_start_games': sum(row['cold_start'] for row in rows),
        'unique_teams': len({row[key] for row in rows for key in ['team_a_id', 'team_b_id']}),
        'unique_matchups': len({tuple(sorted([row['team_a_id'], row['team_b_id']])) for row in rows}),
        'verified_series': None,
        'calibration': [{'lower': key / 10, 'upper': (key + 1) / 10, 'games': len(items),
                         'mean_p_win_a': math.fsum(row['p_win_a'] for row in items) / len(items),
                         'observed_win_a': sum(row['win_a'] for row in items) / len(items)}
                        for key, items in sorted(bins.items())],
        'favorite_buckets': [{'lower': key / 10, 'upper': (key + 1) / 10, 'games': len(items),
                              'mean_favorite_probability': math.fsum(max(row['p_win_a'], 1-row['p_win_a']) for row in items) / len(items),
                              'favorite_win_rate': math.fsum(accuracy(row) for row in items) / len(items)}
                             for key, items in sorted(favorites.items())],
    }


def percentile(values, q):
    values = sorted(values)
    position = (len(values) - 1) * q
    lower = int(position)
    upper = min(lower + 1, len(values) - 1)
    return values[lower] + (values[upper] - values[lower]) * (position - lower)


def paired_cluster_advantage(rows, protocol):
    groups = defaultdict(list)
    for row in rows:
        groups[tuple(row[key] for key in protocol['cluster_fields'])].append(row)
    totals = [(len(items), math.fsum(math.log(2) - row['log_loss'] for row in items),
               math.fsum(0.25 - row['brier'] for row in items)) for _, items in sorted(groups.items())]
    report = {'cluster_proxy': protocol['cluster_fields'], 'clusters': len(totals),
              'replicates': protocol['bootstrap_replicates'], 'log_loss_advantage_95': None,
              'brier_advantage_95': None}
    if len(totals) < 2:
        return report
    rng = random.Random(protocol['bootstrap_seed'])
    losses, briers = [], []
    for _ in range(protocol['bootstrap_replicates']):
        sample = [totals[rng.randrange(len(totals))] for _ in totals]
        n = sum(item[0] for item in sample)
        losses.append(math.fsum(item[1] for item in sample) / n)
        briers.append(math.fsum(item[2] for item in sample) / n)
    report['log_loss_advantage_95'] = [percentile(losses, .025), percentile(losses, .975)]
    report['brier_advantage_95'] = [percentile(briers, .025), percentile(briers, .975)]
    return report


def evaluate(rows, protocol):
    scored = [row for row in rows if row['scored']]
    international = set(protocol['international_league_labels'])
    periods = {}
    for period in protocol['periods']:
        if not period['score']:
            continue
        selected = [row for row in scored if row['period'] == period['id']]
        international_rows = [row for row in selected if row['league_id'] in international]
        periods[period['id']] = {
            **metrics(selected), 'paired_vs_coin_flip': paired_cluster_advantage(selected, protocol),
            'international_by_source_label': {**metrics(international_rows),
                                              'paired_vs_coin_flip': paired_cluster_advantage(international_rows, protocol)},
            'by_league': {league: {key: value for key, value in metrics([row for row in selected if row['league_id'] == league]).items()
                                   if key not in ['calibration', 'favorite_buckets']}
                          for league in sorted({row['league_id'] for row in selected})},
        }
    return periods


def run_backtest(games_path, corpus_audit, identity_audit, protocol_path, output):
    coverage = readiness_report(games_path, corpus_audit, identity_audit)
    protocol_bytes = protocol_path.read_bytes()
    protocol = json.loads(protocol_bytes)
    validate_protocol(protocol)
    if utc(protocol['periods'][-1]['end']) > utc(coverage['as_of_utc']):
        raise ValueError('Evaluation cannot exceed source cutoff')
    if protocol['bootstrap_replicates'] < 1:
        raise ValueError('Require positive bootstrap replicates')
    data = games_path.read_bytes()
    if digest(data) != coverage['source_canonical_sha256']:
        raise ValueError('Corpus changed during backtest')
    identity_data = identity_audit.read_bytes()
    if digest(identity_data) != coverage['source_identity_audit_sha256']:
        raise ValueError('Identity audit changed during backtest')
    quarantine = set(json.loads(identity_data)['identity_quarantined_game_ids'])
    games = [game for game in map(json.loads, data.decode().splitlines()) if game['game_id'] not in quarantine]
    runs = {}
    predictions = {}
    for days in protocol['availability_delay_days']:
        rows, counts = replay(games, protocol, days)
        text = ''.join(json.dumps(row, sort_keys=True, ensure_ascii=False) + '\n' for row in rows)
        predictions[f'predictions-delay-{days}.jsonl'] = text.encode()
        runs[str(days)] = {'assumed_availability_delay_days': days, **counts,
                          'prediction_sha256': digest(text.encode()), 'periods': evaluate(rows, protocol)}
    report = {
        'backtest_version': 'internal-elo-backtest-v1', 'model_id': 'internal_elo_baseline',
        'status': 'exploratory_not_calibrated', 'public_promotion_allowed': False,
        'python_version': sys.version.split()[0], 'protocol': protocol, 'protocol_sha256': digest(protocol_bytes),
        'implementation_sha256': {name: digest((Path(__file__).parent / name).read_bytes())
                                  for name in ['baseline.py', 'backtest.py', 'temporal_audit.py', 'ingest.py']},
        **{key: coverage[key] for key in ['source_canonical_sha256', 'source_corpus_audit_sha256',
                                         'source_identity_audit_sha256', 'candidate_games', 'quarantined_games']},
        'reference_coin_flip': {'p_win_a': .5, 'log_loss': math.log(2), 'brier': .25, 'expected_accuracy': .5},
        'assumptions': [
            'Retrospective research uses source dates interpreted as UTC; timezone is not independently verified.',
            'Availability is assumed start plus the prespecified delay, not historical publication evidence.',
            'Elo K/divisor/initial rating are prespecified provisional values, not fitted or calibrated.',
            'Replay updates online after assumed availability, including during scored periods; hyperparameters remain fixed.',
            'Games outside periods are omitted from both scoring and rating updates; boundaries contain seven-day gaps.',
            'Clusters league/year/split approximate event dependence; verified series/event IDs are unavailable.',
            'International labels are a declared source-label subset, not verified region/stage metadata.',
            'Provider team IDs persist across time; player turnover and organization continuity are not modeled.',
        ],
        'limitations': ['No comparison to contemporaneous historical GPR is possible from this corpus.',
                        'Unverified series can cross temporal splits; no sequence effects or verified series bootstrap.',
                        'Performance is conditional on corpus coverage and availability assumptions; no claim of public predictive validation.'],
        'runs': runs,
    }
    protected = {path.resolve() for path in [games_path, corpus_audit, identity_audit, protocol_path]}
    targets = {output / 'metrics.json', *(output / name for name in predictions)}
    if protected & {path.resolve() for path in targets}:
        raise ValueError('Backtest output would overwrite an input')
    output.mkdir(parents=True, exist_ok=True)
    for name, value in predictions.items():
        (output / name).write_bytes(value)
    write_json(output / 'metrics.json', report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--games', type=Path, required=True)
    parser.add_argument('--corpus-audit', type=Path, required=True)
    parser.add_argument('--identity-audit', type=Path, required=True)
    parser.add_argument('--protocol', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        report = run_backtest(args.games, args.corpus_audit, args.identity_audit, args.protocol, args.output)
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, f'Elo backtest failed: {error}\n')
    primary = report['runs'][str(report['protocol']['primary_delay_days'])]
    print(json.dumps({key: {metric: value[metric] for metric in ['games', 'log_loss', 'brier']}
                      for key, value in primary['periods'].items()}, indent=2))


if __name__ == '__main__':
    main()

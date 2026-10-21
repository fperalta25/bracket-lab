"""Prespecified residual-form ablation selected solely on 2025 development data."""
import argparse
from collections import defaultdict
import json
import math
from pathlib import Path
import random
import sys

from backtest import evaluate, metrics, percentile
from ingest import digest, utc, write_json
from residuals import apply_form, residual_features


def validate_form_protocol(protocol):
    if (protocol.get('protocol_version') != 'residual-form-research-v1'
            or protocol.get('promotion_allowed') is not False
            or protocol.get('include_zero_effect_baseline') is not True
            or protocol.get('aggregation') != 'mean_residual_per_team_source_day'
            or protocol.get('selection_metric') != 'log_loss'):
        raise ValueError('Require a research-only form protocol with baseline candidate')
    for key in ['windows_days', 'coefficients']:
        values = protocol[key]
        if not values or len(set(values)) != len(values) or any(not math.isfinite(value) or value <= 0 for value in values):
            raise ValueError('Require distinct positive candidate parameters')
    if any(type(value) is not int for value in protocol['windows_days']):
        raise ValueError('Windows must be whole days')
    if not math.isfinite(protocol['shrinkage_days']) or protocol['shrinkage_days'] <= 0:
        raise ValueError('Require positive day shrinkage')
    if not math.isfinite(protocol['tie_tolerance']) or protocol['tie_tolerance'] < 0:
        raise ValueError('Require finite nonnegative tie tolerance')
    if type(protocol['bootstrap_replicates']) is not int or protocol['bootstrap_replicates'] < 1:
        raise ValueError('Require positive bootstrap replicates')


def select_variant(rows, protocol, divisor):
    validate_form_protocol(protocol)
    development = [row for row in rows if row['period'] == protocol['selection_period']]
    if not development:
        raise ValueError('No development games for parameter selection')
    last = max(utc(row['event_start_utc']) for row in development)
    # Later evaluation labels never enter candidate fitting or selection.
    prefix = [row for row in rows if utc(row['event_start_utc']) <= last]
    candidates = [{'id': 'baseline', 'window_days': None, 'coefficient': 0.0,
                   'development': metrics(development)}]
    for days in protocol['windows_days']:
        features = residual_features(prefix, days, protocol['shrinkage_days'])
        for coefficient in protocol['coefficients']:
            predicted = apply_form(features, coefficient, divisor)
            candidates.append({'id': f'form-{days}d-beta-{coefficient:g}', 'window_days': days,
                               'coefficient': coefficient, 'development': metrics([
                                   row for row in predicted if row['period'] == protocol['selection_period']])})
    selected = candidates[0]
    for candidate in candidates[1:]:
        if candidate['development']['log_loss'] < selected['development']['log_loss'] - protocol['tie_tolerance']:
            selected = candidate
    return selected, candidates


def paired_vs_baseline(candidate, baseline, protocol):
    if len(candidate) != len(baseline):
        raise ValueError('Paired comparison requires identical games')
    base = {row['game_id']: row for row in baseline}
    if len(base) != len(baseline) or len({row['game_id'] for row in candidate}) != len(candidate):
        raise ValueError('Duplicate games in paired comparison')
    groups = defaultdict(list)
    for row in candidate:
        other = base.get(row['game_id'])
        keys = ['win_a', 'team_a_id', 'team_b_id', 'event_start_utc', 'period', 'league_id', 'year', 'split']
        if other is None or any(row[key] != other[key] for key in keys):
            raise ValueError('Paired comparison mismatch')
        groups[tuple(row[key] for key in protocol['cluster_fields'])].append(
            (other['log_loss']-row['log_loss'], other['brier']-row['brier']))
    totals = [(len(items), math.fsum(item[0] for item in items), math.fsum(item[1] for item in items))
              for _, items in sorted(groups.items())]
    n = len(candidate)
    report = {'games': n, 'clusters': len(totals), 'cluster_proxy': protocol['cluster_fields'],
              'log_loss_advantage': math.fsum(item[1] for item in totals) / n if n else None,
              'brier_advantage': math.fsum(item[2] for item in totals) / n if n else None,
              'log_loss_advantage_95': None, 'brier_advantage_95': None,
              'replicates': protocol['bootstrap_replicates']}
    if len(totals) < 2:
        return report
    rng = random.Random(protocol['bootstrap_seed'])
    losses, briers = [], []
    for _ in range(protocol['bootstrap_replicates']):
        sample = [totals[rng.randrange(len(totals))] for _ in totals]
        count = sum(item[0] for item in sample)
        losses.append(math.fsum(item[1] for item in sample)/count)
        briers.append(math.fsum(item[2] for item in sample)/count)
    report['log_loss_advantage_95'] = [percentile(losses, .025), percentile(losses, .975)]
    report['brier_advantage_95'] = [percentile(briers, .025), percentile(briers, .975)]
    return report


def run_form_backtest(baseline_report_path, predictions_dir, protocol_path, output):
    baseline_bytes, protocol_bytes = baseline_report_path.read_bytes(), protocol_path.read_bytes()
    baseline_report, protocol = json.loads(baseline_bytes), json.loads(protocol_bytes)
    validate_form_protocol(protocol)
    if (digest(baseline_bytes) != protocol['baseline_metrics_sha256']
            or baseline_report['protocol_sha256'] != protocol['baseline_protocol_sha256']
            or baseline_report.get('backtest_version') != 'internal-elo-backtest-v1'):
        raise ValueError('Baseline does not match frozen residual-form protocol')
    base_protocol = baseline_report['protocol']
    if protocol['selection_delay_days'] != base_protocol['primary_delay_days']:
        raise ValueError('Selection delay must match prespecified primary baseline delay')
    rows_by_delay, files = {}, {}
    for delay, run in baseline_report['runs'].items():
        path = predictions_dir / f'predictions-delay-{delay}.jsonl'
        data = path.read_bytes()
        if digest(data) != run['prediction_sha256']:
            raise ValueError('Baseline prediction hash mismatch')
        files[delay] = path
        rows_by_delay[delay] = [json.loads(line) for line in data.decode().splitlines()]
    selected, candidates = select_variant(rows_by_delay[str(protocol['selection_delay_days'])], protocol, base_protocol['divisor'])
    runs, predictions = {}, {}
    for delay, baseline_rows in rows_by_delay.items():
        if selected['coefficient'] == 0:
            predicted = baseline_rows
        else:
            features = residual_features(baseline_rows, selected['window_days'], protocol['shrinkage_days'])
            predicted = apply_form(features, selected['coefficient'], base_protocol['divisor'])
        periods = evaluate(predicted, base_protocol)
        for name, period in periods.items():
            chosen = [row for row in predicted if row['scored'] and row['period'] == name]
            base = [row for row in baseline_rows if row['scored'] and row['period'] == name]
            period['paired_vs_internal_elo'] = paired_vs_baseline(chosen, base, protocol)
            labels = set(base_protocol['international_league_labels'])
            period['international_by_source_label']['paired_vs_internal_elo'] = paired_vs_baseline(
                [row for row in chosen if row['league_id'] in labels],
                [row for row in base if row['league_id'] in labels], protocol)
            period['baseline_metrics'] = {key: value for key, value in metrics(base).items()
                                          if key not in ['calibration', 'favorite_buckets']}
            period['estimated_form_games'] = sum(row.get('form_a', {}).get('status') == 'estimated'
                                                and row.get('form_b', {}).get('status') == 'estimated' for row in chosen)
        data = ''.join(json.dumps(row, sort_keys=True, ensure_ascii=False)+'\n' for row in predicted).encode()
        predictions[f'predictions-delay-{delay}.jsonl'] = data
        runs[delay] = {'prediction_sha256': digest(data), 'periods': periods}
    report = {
        'backtest_version': 'residual-form-backtest-v1', 'status': 'exploratory_not_calibrated',
        'public_promotion_allowed': False, 'python_version': sys.version.split()[0],
        'protocol': protocol, 'protocol_sha256': digest(protocol_bytes),
        'baseline_metrics_sha256': digest(baseline_bytes),
        'source_canonical_sha256': baseline_report['source_canonical_sha256'],
        'implementation_sha256': {name: digest((Path(__file__).parent/name).read_bytes())
                                  for name in ['residuals.py', 'form_backtest.py', 'baseline.py', 'backtest.py']},
        'selected_on_development_only': selected, 'development_candidates': candidates, 'runs': runs,
        'limitations': [
            'Form uses delayed baseline innovations y-p_pre_game; Elo ratings remain unchanged.',
            'Team-day averaging approximates within-series dependence; series IDs and roster identities are unverified.',
            'Missing form falls back to zero adjustment, not an observed zero-form measurement.',
            '2026 results are diagnostic comparisons; the baseline final period was already inspected.',
            'Only 2025 and the primary delay select parameters; no reselection on 2026 or alternate delays.',
            'Availability/timezone assumptions and incomplete coverage of the frozen baseline still apply.',
            'Cluster proxy intervals do not establish verified series-level independence or public model validation.',
        ],
    }
    protected = {path.resolve() for path in [baseline_report_path, protocol_path, *files.values()]}
    targets = {output/'metrics.json', *(output/name for name in predictions)}
    if protected & {path.resolve() for path in targets}:
        raise ValueError('Form output would overwrite a frozen input')
    output.mkdir(parents=True, exist_ok=True)
    for name, data in predictions.items():
        (output/name).write_bytes(data)
    write_json(output/'metrics.json', report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-report', type=Path, required=True)
    parser.add_argument('--predictions-dir', type=Path, required=True)
    parser.add_argument('--protocol', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        report = run_form_backtest(args.baseline_report, args.predictions_dir, args.protocol, args.output)
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, f'Residual form backtest failed: {error}\n')
    print(json.dumps({'selected': report['selected_on_development_only']['id'],
                      'primary_periods': {key: value['paired_vs_internal_elo']
                          for key, value in report['runs'][str(report['protocol']['selection_delay_days'])]['periods'].items()}}, indent=2))


if __name__ == '__main__':
    main()

"""Development-only selection of an estimated lineup-stability modifier to internal Elo."""
import argparse
import json
import math
from pathlib import Path
import sys

from backtest import evaluate, metrics
from form_backtest import paired_vs_baseline
from ingest import digest, utc, write_json
from lineups import apply_stability, lineup_features


def validate_protocol(protocol):
    if (protocol.get('protocol_version') != 'lineup-stability-research-v1'
            or protocol.get('promotion_allowed') is not False
            or protocol.get('include_zero_effect_baseline') is not True
            or protocol.get('require_both_teams_observed') is not True
            or protocol.get('identity_mode') != 'exact_source_names_within_same_source_team'
            or protocol.get('aggregation') != 'team_day_mean_overlap_with_latest_available_lineup_excluding_its_day'
            or protocol.get('selection_metric') != 'log_loss' or protocol.get('prior_stability') != .5):
        raise ValueError('Unsupported or promotable lineup-stability protocol')
    for key in ['windows_days', 'coefficients']:
        values = protocol[key]
        if not values or len(set(values)) != len(values) or any(not math.isfinite(value) or value == 0 for value in values):
            raise ValueError('Require distinct finite nonzero candidates')
    if any(type(value) is not int or value <= 0 for value in protocol['windows_days']):
        raise ValueError('Require positive whole-day windows')
    if not math.isfinite(protocol['shrinkage_days']) or protocol['shrinkage_days'] <= 0:
        raise ValueError('Require positive shrinkage')
    if not math.isfinite(protocol['tie_tolerance']) or protocol['tie_tolerance'] < 0:
        raise ValueError('Require nonnegative tie tolerance')
    if type(protocol['bootstrap_replicates']) is not int or protocol['bootstrap_replicates'] < 1:
        raise ValueError('Require positive bootstrap count')


def select_variant(rows, lineups, protocol, divisor):
    validate_protocol(protocol)
    development = [row for row in rows if row['period'] == protocol['selection_period']]
    if not development:
        raise ValueError('No development lineup games')
    last = max(utc(row['event_start_utc']) for row in development)
    prefix = [row for row in rows if utc(row['event_start_utc']) <= last]
    candidates = [{'id': 'baseline', 'window_days': None, 'coefficient': 0.0, 'development': metrics(development)}]
    for days in protocol['windows_days']:
        features = lineup_features(prefix, lineups, days, protocol['shrinkage_days'], protocol['prior_stability'])
        for coefficient in protocol['coefficients']:
            predicted = apply_stability(features, coefficient, divisor)
            candidates.append({'id': f'stability-{days}d-beta-{coefficient:g}', 'window_days': days,
                               'coefficient': coefficient, 'development': metrics([
                                   row for row in predicted if row['period'] == protocol['selection_period']])})
    selected = candidates[0]
    for candidate in candidates[1:]:
        if candidate['development']['log_loss'] < selected['development']['log_loss']-protocol['tie_tolerance']:
            selected = candidate
    return selected, candidates


def match_lineups(rows, games):
    matched = {}
    for row in rows:
        original = games.get(row['game_id'])
        if original is None or any(row[key] != original[key] for key in ['team_a_id', 'team_b_id', 'win_a']):
            raise ValueError('Lineup corpus does not match frozen baseline games')
        if utc(row['event_start_utc']) != utc(original['event_start_utc']):
            raise ValueError('Lineup/baseline date mismatch')
        matched[row['game_id']] = {
            side: None if original[f'roster_{side}'] is None else tuple(
                player['source_name'] for player in original[f'roster_{side}']['players'])
            for side in ['a', 'b']}
    return matched


def run_backtest(baseline_path, predictions_dir, games_path, protocol_path, output):
    base_data, config_data, game_data = baseline_path.read_bytes(), protocol_path.read_bytes(), games_path.read_bytes()
    baseline, protocol = json.loads(base_data), json.loads(config_data)
    validate_protocol(protocol)
    if (digest(base_data) != protocol['baseline_metrics_sha256']
            or baseline['protocol_sha256'] != protocol['baseline_protocol_sha256']
            or baseline.get('backtest_version') != 'internal-elo-backtest-v1'
            or digest(game_data) != protocol['source_canonical_sha256']
            or digest(game_data) != baseline['source_canonical_sha256']):
        raise ValueError('Stability inputs do not match frozen protocol')
    games_list = [json.loads(line) for line in game_data.decode().splitlines()]
    games = {game['game_id']: game for game in games_list}
    if len(games) != len(games_list):
        raise ValueError('Duplicate canonical game IDs')
    base_protocol = baseline['protocol']
    if protocol['selection_delay_days'] != base_protocol['primary_delay_days']:
        raise ValueError('Selection must use primary baseline delay')
    rows_by_delay, inputs = {}, []
    for delay, run in baseline['runs'].items():
        path = predictions_dir/f'predictions-delay-{delay}.jsonl'
        data = path.read_bytes()
        if digest(data) != run['prediction_sha256']:
            raise ValueError('Stability baseline prediction hash mismatch')
        inputs.append(path)
        rows_by_delay[delay] = [json.loads(line) for line in data.decode().splitlines()]
    all_lineups = {delay: match_lineups(rows, games) for delay, rows in rows_by_delay.items()}
    selected, candidates = select_variant(rows_by_delay[str(protocol['selection_delay_days'])],
                                         all_lineups[str(protocol['selection_delay_days'])], protocol, base_protocol['divisor'])
    predictions, runs = {}, {}
    for delay, rows in rows_by_delay.items():
        if selected['coefficient'] == 0:
            predicted = rows
        else:
            features = lineup_features(rows, all_lineups[delay], selected['window_days'],
                                       protocol['shrinkage_days'], protocol['prior_stability'])
            predicted = apply_stability(features, selected['coefficient'], base_protocol['divisor'])
        periods = evaluate(predicted, base_protocol)
        for name, period in periods.items():
            chosen = [row for row in predicted if row['scored'] and row['period'] == name]
            base = [row for row in rows if row['scored'] and row['period'] == name]
            period['paired_vs_internal_elo'] = paired_vs_baseline(chosen, base, protocol)
            labels = set(base_protocol['international_league_labels'])
            period['international_by_source_label']['paired_vs_internal_elo'] = paired_vs_baseline(
                [row for row in chosen if row['league_id'] in labels], [row for row in base if row['league_id'] in labels], protocol)
            period['baseline_metrics'] = {key: value for key, value in metrics(base).items()
                                          if key not in ['calibration', 'favorite_buckets']}
            period['both_teams_estimated_stability_games'] = sum(
                row.get('lineup_stability_a', {}).get('status') == row.get('lineup_stability_b', {}).get('status') == 'estimated'
                for row in chosen)
        data = ''.join(json.dumps(row, sort_keys=True, ensure_ascii=False)+'\n' for row in predicted).encode()
        predictions[f'predictions-delay-{delay}.jsonl'] = data
        runs[delay] = {'prediction_sha256': digest(data), 'periods': periods}
    report = {
        'backtest_version': 'lineup-stability-backtest-v1', 'status': 'exploratory_not_calibrated',
        'public_promotion_allowed': False, 'python_version': sys.version.split()[0],
        'protocol': protocol, 'protocol_sha256': digest(config_data),
        'baseline_metrics_sha256': digest(base_data), 'source_canonical_sha256': digest(game_data),
        'implementation_sha256': {name: digest((Path(__file__).parent/name).read_bytes())
                                  for name in ['lineups.py', 'stability_backtest.py', 'form_backtest.py', 'backtest.py', 'baseline.py']},
        'selected_on_development_only': selected, 'development_candidates': candidates, 'runs': runs,
        'limitations': ['The target game lineup is not a pre-game feature; only earlier assumed-available observations are used.',
                        'Source names are a within-team identity proxy, not verified player IDs or a confirmed current roster.',
                        'Latest source day is excluded from comparison; day weighting approximates series dependence.',
                        'Missing either team yields no modifier; it is not observed zero stability.',
                        '2026 comparisons are diagnostic and have been inspected previously; no new blind test.',
                        'Availability, timezone, team-ID continuity and cluster-proxy limitations of internal Elo still apply.',
                        'No residual form modifier, historical GPR, subjective bonuses or public model promotion.'],
    }
    protected = {path.resolve() for path in [baseline_path, games_path, protocol_path, *inputs]}
    if protected & {(output/name).resolve() for name in ['metrics.json', *predictions]}:
        raise ValueError('Stability output would overwrite a frozen input')
    output.mkdir(parents=True, exist_ok=True)
    for name, data in predictions.items():
        (output/name).write_bytes(data)
    write_json(output/'metrics.json', report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-report', type=Path, required=True)
    parser.add_argument('--predictions-dir', type=Path, required=True)
    parser.add_argument('--games', type=Path, required=True)
    parser.add_argument('--protocol', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        report = run_backtest(args.baseline_report, args.predictions_dir, args.games, args.protocol, args.output)
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, f'Lineup stability backtest failed: {error}\n')
    print(json.dumps({'selected': report['selected_on_development_only']['id'],
                      'primary_periods': {key: value['paired_vs_internal_elo'] for key, value in
                          report['runs'][str(report['protocol']['selection_delay_days'])]['periods'].items()}}, indent=2))


if __name__ == '__main__':
    main()

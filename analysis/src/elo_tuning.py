"""Prespecified internal Elo K selection on development only; no GPR calibration."""
import argparse
import json
import math
from pathlib import Path
import sys

from baseline import replay
from backtest import evaluate, metrics
from form_backtest import paired_vs_baseline
from ingest import digest, utc, write_json
from temporal_audit import readiness_report


def validate_tuning(protocol, baseline_protocol):
    if (protocol.get('protocol_version') != 'internal-elo-tuning-v1'
            or protocol.get('promotion_allowed') is not False
            or protocol.get('selection_metric') != 'log_loss'
            or protocol.get('tie_preference') != 'keep_reference_k'):
        raise ValueError('Unsupported or promotable Elo tuning protocol')
    candidates = protocol['k_candidates']
    if (not candidates or len(set(candidates)) != len(candidates)
            or any(type(k) not in (int, float) or not math.isfinite(k) or k <= 0 for k in candidates)
            or protocol['reference_k'] not in candidates
            or protocol['reference_k'] != baseline_protocol['k_factor']):
        raise ValueError('Require distinct positive K candidates including frozen reference')
    if (protocol['fixed_divisor'] != baseline_protocol['divisor']
            or protocol['fixed_initial_rating'] != baseline_protocol['initial_rating']
            or protocol['selection_delay_days'] != baseline_protocol['primary_delay_days']):
        raise ValueError('Do not tune rating units or primary delay')
    if not math.isfinite(protocol['tie_tolerance']) or protocol['tie_tolerance'] < 0:
        raise ValueError('Require nonnegative tie tolerance')
    if type(protocol['bootstrap_replicates']) is not int or protocol['bootstrap_replicates'] <= 0:
        raise ValueError('Require positive bootstrap count')
    period = next((period for period in baseline_protocol['periods'] if period['id'] == protocol['selection_period']), None)
    if period is None or not period['score']:
        raise ValueError('Require a scored development period')


def select_k(games, baseline_protocol, tuning):
    validate_tuning(tuning, baseline_protocol)
    period = next(period for period in baseline_protocol['periods'] if period['id'] == tuning['selection_period'])
    # No 2026 game enters replays used to choose K, even as a future label.
    prefix = [game for game in games if utc(game['event_start_utc']) < utc(period['end'])]
    candidates = []
    for k in tuning['k_candidates']:
        protocol = {**baseline_protocol, 'k_factor': k}
        rows, _ = replay(prefix, protocol, tuning['selection_delay_days'])
        selected = [row for row in rows if row['period'] == tuning['selection_period'] and row['scored']]
        if not selected:
            raise ValueError('No development games for K selection')
        candidates.append({'k_factor': k, 'development': metrics(selected)})
    best = next(candidate for candidate in candidates if candidate['k_factor'] == tuning['reference_k'])
    for candidate in candidates:
        if candidate['development']['log_loss'] < best['development']['log_loss']-tuning['tie_tolerance']:
            best = candidate
    return best, candidates


def run_tuning(games_path, corpus_audit, identity_audit, baseline_path, predictions_dir, tuning_path, output):
    coverage = readiness_report(games_path, corpus_audit, identity_audit)
    base_data, tuning_data = baseline_path.read_bytes(), tuning_path.read_bytes()
    baseline, tuning = json.loads(base_data), json.loads(tuning_data)
    if (baseline.get('backtest_version') != 'internal-elo-backtest-v1'
            or digest(base_data) != tuning['baseline_metrics_sha256']
            or baseline['protocol_sha256'] != tuning['baseline_protocol_sha256']):
        raise ValueError('Elo reference does not match frozen tuning protocol')
    for key in ['source_canonical_sha256', 'source_corpus_audit_sha256', 'source_identity_audit_sha256']:
        if coverage[key] != baseline[key]:
            raise ValueError('Elo tuning source/audit mismatch')
    if coverage['source_canonical_sha256'] != tuning['source_canonical_sha256']:
        raise ValueError('Elo tuning corpus mismatch')
    base_protocol = baseline['protocol']
    validate_tuning(tuning, base_protocol)
    data, identity_data = games_path.read_bytes(), identity_audit.read_bytes()
    if digest(data) != coverage['source_canonical_sha256'] or digest(identity_data) != coverage['source_identity_audit_sha256']:
        raise ValueError('Elo tuning inputs changed during validation')
    excluded = set(json.loads(identity_data)['identity_quarantined_game_ids'])
    games = [game for game in map(json.loads, data.decode().splitlines()) if game['game_id'] not in excluded]
    baseline_rows, files = {}, []
    for delay, run in baseline['runs'].items():
        path = predictions_dir/f'predictions-delay-{delay}.jsonl'
        raw = path.read_bytes()
        if digest(raw) != run['prediction_sha256']:
            raise ValueError('Elo reference prediction hash mismatch')
        files.append(path)
        baseline_rows[delay] = [json.loads(line) for line in raw.decode().splitlines()]
    if set(baseline_rows) != {str(delay) for delay in base_protocol['availability_delay_days']}:
        raise ValueError('Require every prespecified availability sensitivity')
    selected, candidates = select_k(games, base_protocol, tuning)
    selected_protocol = {**base_protocol, 'k_factor': selected['k_factor']}
    predictions, runs = {}, {}
    for delay, reference in baseline_rows.items():
        predicted, counts = replay(games, selected_protocol, int(delay))
        periods = evaluate(predicted, selected_protocol)
        for name, period in periods.items():
            chosen = [row for row in predicted if row['scored'] and row['period'] == name]
            original = [row for row in reference if row['scored'] and row['period'] == name]
            period['paired_vs_k32_reference'] = paired_vs_baseline(chosen, original, tuning)
            labels = set(base_protocol['international_league_labels'])
            period['international_by_source_label']['paired_vs_k32_reference'] = paired_vs_baseline(
                [row for row in chosen if row['league_id'] in labels],
                [row for row in original if row['league_id'] in labels], tuning)
            period['reference_metrics'] = {key: value for key, value in metrics(original).items()
                                          if key not in ['calibration', 'favorite_buckets']}
        raw = ''.join(json.dumps(row, sort_keys=True, ensure_ascii=False)+'\n' for row in predicted).encode()
        if selected['k_factor'] == tuning['reference_k'] and digest(raw) != baseline['runs'][delay]['prediction_sha256']:
            raise ValueError('Reference K replay failed exact compatibility')
        predictions[f'predictions-delay-{delay}.jsonl'] = raw
        runs[delay] = {**counts, 'prediction_sha256': digest(raw), 'periods': periods}
    report = {
        'backtest_version': 'internal-elo-tuning-v1', 'model_id': 'internal_elo_baseline',
        'status': 'development_selected_not_publicly_validated', 'public_promotion_allowed': False,
        'python_version': sys.version.split()[0], 'tuning_protocol': tuning, 'tuning_protocol_sha256': digest(tuning_data),
        'baseline_metrics_sha256': digest(base_data), 'selected_replay_protocol': selected_protocol,
        **{key: coverage[key] for key in ['source_canonical_sha256', 'source_corpus_audit_sha256',
                                         'source_identity_audit_sha256', 'candidate_games', 'quarantined_games']},
        'implementation_sha256': {name: digest((Path(__file__).parent/name).read_bytes())
                                  for name in ['elo_tuning.py', 'baseline.py', 'backtest.py', 'form_backtest.py', 'temporal_audit.py', 'ingest.py']},
        'selected_on_development_only': selected, 'development_candidates': candidates, 'runs': runs,
        'limitations': ['K is selected with 2025 primary-delay log loss only; it is not a calibrated GPR divisor.',
                        'Initial rating and divisor fix arbitrary internal Elo units; only relative K/divisor affects learning.',
                        '2026 comparisons are diagnostic after previous inspection, not a new blind test.',
                        'Delayed feedback, timezone, team-ID continuity, coverage and cluster-proxy assumptions remain.',
                        'No residual form, lineup stability, roster identity inference or other contextual modifier.',
                        'No export of a public trained artifact or modification of existing simulator presets.'],
    }
    protected = {path.resolve() for path in [games_path, corpus_audit, identity_audit, baseline_path, tuning_path, *files]}
    if protected & {(output/name).resolve() for name in ['metrics.json', *predictions]}:
        raise ValueError('Elo tuning output would overwrite a frozen input')
    output.mkdir(parents=True, exist_ok=True)
    for name, raw in predictions.items():
        (output/name).write_bytes(raw)
    write_json(output/'metrics.json', report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--games', type=Path, required=True)
    parser.add_argument('--corpus-audit', type=Path, required=True)
    parser.add_argument('--identity-audit', type=Path, required=True)
    parser.add_argument('--baseline-report', type=Path, required=True)
    parser.add_argument('--predictions-dir', type=Path, required=True)
    parser.add_argument('--protocol', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        report = run_tuning(args.games, args.corpus_audit, args.identity_audit, args.baseline_report,
                            args.predictions_dir, args.protocol, args.output)
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, f'Elo parameter evaluation failed: {error}\n')
    print(json.dumps({'selected_k': report['selected_on_development_only']['k_factor'],
                      'primary_periods': {name: value['paired_vs_k32_reference'] for name, value in
                         report['runs'][str(report['tuning_protocol']['selection_delay_days'])]['periods'].items()}}, indent=2))


if __name__ == '__main__':
    main()

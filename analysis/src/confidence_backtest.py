"""Global log-odds scaling of frozen internal Elo; no feedback or GPR change."""
import argparse
import json
import math
from pathlib import Path
import sys

from baseline import log_probabilities
from backtest import evaluate, metrics
from form_backtest import paired_vs_baseline
from ingest import digest, write_json


def validate(protocol, base):
    if (protocol.get('protocol_version') != 'elo-confidence-v1'
            or protocol.get('promotion_allowed') is not False
            or protocol.get('selection_metric') != 'log_loss'
            or protocol.get('tie_preference') != 'keep_unit_slope'
            or protocol.get('selection_period') != 'development_2025'
            or protocol['selection_delay_days'] != base['primary_delay_days']):
        raise ValueError('Require frozen development-only, non-promotable confidence protocol')
    slopes = protocol['slope_candidates']
    if (not slopes or 1 not in slopes or len(slopes) != len(set(slopes))
            or any(type(s) not in (int, float) or not math.isfinite(s) or s <= 0 for s in slopes)):
        raise ValueError('Require positive distinct slopes including identity')
    if (not math.isfinite(protocol['tie_tolerance']) or protocol['tie_tolerance'] < 0
            or type(protocol['bootstrap_replicates']) is not int or protocol['bootstrap_replicates'] < 1):
        raise ValueError('Invalid tolerance or bootstrap count')


def scale(rows, slope, divisor):
    if type(slope) not in (int, float) or not math.isfinite(slope) or slope <= 0:
        raise ValueError('Require positive finite slope')
    if slope == 1:
        return [dict(row) for row in rows]  # Exact reference parity, including saturation.
    result = []
    for row in rows:
        # Recover unsaturated log odds from pre-game ratings, never from outcomes.
        a, b = log_probabilities(row['rating_a_before'], row['rating_b_before'], divisor / slope)
        p, y = math.exp(a), row['win_a']
        result.append({**row, 'p_win_a': p, 'log_loss': -(a if y else b), 'brier': (p-y)**2})
    return result


def select(rows, protocol, divisor):
    development = [row for row in rows if row['scored'] and row['period'] == protocol['selection_period']]
    if not development:
        raise ValueError('No development games')
    candidates = [{'slope': s, 'development': metrics(scale(development, s, divisor))}
                  for s in protocol['slope_candidates']]
    best = next(c for c in candidates if c['slope'] == 1)
    for candidate in candidates:
        if candidate['development']['log_loss'] < best['development']['log_loss']-protocol['tie_tolerance']:
            best = candidate
    return best, candidates


def run(baseline_path, predictions_dir, protocol_path, output):
    raw_base, raw_protocol = baseline_path.read_bytes(), protocol_path.read_bytes()
    base, protocol = json.loads(raw_base), json.loads(raw_protocol)
    if (base.get('backtest_version') != 'internal-elo-backtest-v1'
            or digest(raw_base) != protocol['baseline_metrics_sha256']
            or base['protocol_sha256'] != protocol['baseline_protocol_sha256']
            or base['source_canonical_sha256'] != protocol['source_canonical_sha256']):
        raise ValueError('Frozen baseline mismatch')
    validate(protocol, base['protocol'])
    rows, sources = {}, []
    if set(base['runs']) != {str(d) for d in base['protocol']['availability_delay_days']}:
        raise ValueError('Missing availability sensitivity')
    for delay, reference in base['runs'].items():
        path = predictions_dir/f'predictions-delay-{delay}.jsonl'
        raw = path.read_bytes()
        if digest(raw) != reference['prediction_sha256']:
            raise ValueError('Frozen prediction hash mismatch')
        rows[delay] = [json.loads(line) for line in raw.decode().splitlines()]
        sources.append(path)
    chosen, candidates = select(rows[str(protocol['selection_delay_days'])], protocol, base['protocol']['divisor'])
    runs, predictions = {}, {}
    for delay, reference in rows.items():
        predicted = scale(reference, chosen['slope'], base['protocol']['divisor'])
        periods = evaluate(predicted, base['protocol'])
        for name, period in periods.items():
            candidate = [r for r in predicted if r['scored'] and r['period'] == name]
            original = [r for r in reference if r['scored'] and r['period'] == name]
            period['paired_vs_internal_elo'] = paired_vs_baseline(candidate, original, protocol)
            labels = set(base['protocol']['international_league_labels'])
            period['international_by_source_label']['paired_vs_internal_elo'] = paired_vs_baseline(
                [r for r in candidate if r['league_id'] in labels],
                [r for r in original if r['league_id'] in labels], protocol)
        raw = ''.join(json.dumps(row, sort_keys=True, ensure_ascii=False)+'\n' for row in predicted).encode()
        if chosen['slope'] == 1 and digest(raw) != base['runs'][delay]['prediction_sha256']:
            raise ValueError('Identity scaling lost exact compatibility')
        predictions[f'predictions-delay-{delay}.jsonl'] = raw
        runs[delay] = {'prediction_sha256': digest(raw), 'periods': periods}
    report = {
        'backtest_version': 'elo-confidence-v1', 'status': 'exploratory_not_publicly_validated',
        'public_promotion_allowed': False, 'python_version': sys.version.split()[0],
        'protocol': protocol, 'protocol_sha256': digest(raw_protocol),
        'baseline_metrics_sha256': digest(raw_base), 'source_canonical_sha256': base['source_canonical_sha256'],
        'implementation_sha256': {name: digest((Path(__file__).parent/name).read_bytes())
                                  for name in ['confidence_backtest.py', 'baseline.py', 'backtest.py', 'form_backtest.py']},
        'selected_on_development_only': chosen, 'development_candidates': candidates, 'runs': runs,
        'limitations': [
            'Output log-odds slope only; frozen K32 rating updates and delayed feedback remain unchanged.',
            'No intercept: swapping teams complements probabilities; equal ratings remain 50%.',
            'Only 2025 primary-delay data selects slope; 2026 was previously inspected and is diagnostic.',
            'Estimated availability (1/3/7 days), assumed UTC and unverified team continuity remain.',
            'League/year/split bootstrap clusters are proxies, not verified series.',
            'Internal Elo is not Riot GPR; no transfer to GPR divisor or public trained artifact.',
        ],
    }
    protected = {p.resolve() for p in [baseline_path, protocol_path, *sources]}
    if protected & {(output/name).resolve() for name in ['metrics.json', *predictions]}:
        raise ValueError('Output would overwrite frozen input')
    output.mkdir(parents=True, exist_ok=True)
    for name, raw in predictions.items():
        (output/name).write_bytes(raw)
    write_json(output/'metrics.json', report)
    return report



def web_summary(report_path, baseline_path):
    """Small aggregate-only view of the primary run; independent of public presets."""
    raw, baseline_raw = report_path.read_bytes(), baseline_path.read_bytes()
    report, baseline = json.loads(raw), json.loads(baseline_raw)
    if (report['backtest_version'] != 'elo-confidence-v1'
            or report['public_promotion_allowed'] is not False
            or digest(baseline_raw) != report['baseline_metrics_sha256']):
        raise ValueError('Summary requires matching non-promotable research reports')
    delay = str(report['protocol']['selection_delay_days'])
    rows = []
    for period, values in report['runs'][delay]['periods'].items():
        reference = baseline['runs'][delay]['periods'][period]
        for scope in ['global', 'international']:
            candidate, original = values, reference
            if scope == 'international':
                candidate = values['international_by_source_label']
                original = reference['international_by_source_label']
            rows.append({'period': period, 'scope': scope, 'games': candidate['games'],
                         'reference_log_loss': original['log_loss'], 'adjusted_log_loss': candidate['log_loss'],
                         'reference_brier': original['brier'], 'adjusted_brier': candidate['brier'],
                         'log_loss_advantage_95': candidate['paired_vs_internal_elo']['log_loss_advantage_95']})
    return {'report_sha256': digest(raw), 'baseline_sha256': digest(baseline_raw),
            'promotion_allowed': False, 'slope': report['selected_on_development_only']['slope'],
            'delay_days': int(delay), 'rows': rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['baseline-report', 'predictions-dir', 'protocol', 'output']:
        parser.add_argument('--'+name, type=Path, required=True)
    args = parser.parse_args()
    try:
        report = run(args.baseline_report, args.predictions_dir, args.protocol, args.output)
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, f'Confidence comparison failed: {error}\n')
    print(json.dumps({'slope': report['selected_on_development_only']['slope'],
                      'primary': {name: p['paired_vs_internal_elo'] for name, p in
                                  report['runs'][str(report['protocol']['selection_delay_days'])]['periods'].items()}}, indent=2))


if __name__ == '__main__':
    main()

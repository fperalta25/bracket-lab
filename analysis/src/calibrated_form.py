"""Residual-form ablation around the frozen learned Elo confidence reference."""
import argparse
import json
from pathlib import Path

from backtest import evaluate, metrics
from confidence_backtest import scale
from form_backtest import select_variant, paired_vs_baseline, validate_form_protocol
from ingest import digest, write_json, utc
from observed_form import last_observed_features
from residuals import apply_form, residual_features



def select_observed_variant(rows, protocol, divisor):
    development = [r for r in rows if r['scored'] and r['period'] == protocol['selection_period']]
    if not development: raise ValueError('No development observations')
    last = max(utc(r['event_start_utc']) for r in development)
    prefix = [r for r in rows if utc(r['event_start_utc']) <= last]
    candidates = [{'id': 'baseline', 'source_days': None, 'coefficient': 0.0, 'development': metrics(development)}]
    for days in protocol['source_day_counts']:
        features = last_observed_features(prefix, days, protocol['shrinkage_days'])
        for coefficient in protocol['coefficients']:
            predicted = apply_form(features, coefficient, divisor)
            candidates.append({'id': f'source-days-{days}-beta-{coefficient:g}', 'source_days': days, 'coefficient': coefficient,
                'development': metrics([r for r in predicted if r['period'] == protocol['selection_period']])})
    selected = candidates[0]
    for candidate in candidates[1:]:
        if candidate['development']['log_loss'] < selected['development']['log_loss']-protocol['tie_tolerance']: selected = candidate
    return selected, candidates


def run(baseline_path, confidence_path, predictions_dir, protocol_path, output):
    base_raw, confidence_raw, protocol_raw = [p.read_bytes() for p in [baseline_path, confidence_path, protocol_path]]
    base, confidence, protocol = map(json.loads, [base_raw, confidence_raw, protocol_raw])
    observed = protocol.get('form_mode') == 'last_observed_source_days'
    validate_form_protocol({**protocol, 'windows_days': protocol['source_day_counts']} if observed else protocol)
    if (protocol.get('experiment_id') != ('last-observed-form-v1' if observed else 'calibrated-residual-form-v1')
            or digest(base_raw) != protocol['baseline_metrics_sha256']
            or digest(confidence_raw) != protocol['confidence_metrics_sha256']
            or base['protocol_sha256'] != protocol['baseline_protocol_sha256']
            or confidence['baseline_metrics_sha256'] != digest(base_raw)
            or confidence['backtest_version'] != 'elo-confidence-v1'
            or protocol['selection_period'] != 'development_2025'
            or protocol['selection_delay_days'] != base['protocol']['primary_delay_days']
            or protocol.get('residual_reference') != 'fixed_confidence_scaled_elo_output'):
        raise ValueError('Require matching frozen learned reference and development-only form protocol')
    slope = confidence['selected_on_development_only']['slope']
    divisor = base['protocol']['divisor'] / slope
    references, sources = {}, []
    for delay, reference in base['runs'].items():
        path = predictions_dir/f'predictions-delay-{delay}.jsonl'
        raw = path.read_bytes()
        if digest(raw) != reference['prediction_sha256']:
            raise ValueError('Frozen baseline prediction hash mismatch')
        references[delay] = scale([json.loads(line) for line in raw.decode().splitlines()], slope, base['protocol']['divisor'])
        sources.append(path)
    if set(references) != {str(d) for d in base['protocol']['availability_delay_days']}:
        raise ValueError('Missing availability sensitivity')
    selected, candidates = select_observed_variant(references[str(protocol['selection_delay_days'])], protocol, divisor) if observed else select_variant(references[str(protocol['selection_delay_days'])], protocol, divisor)
    runs, files = {}, {}
    for delay, reference in references.items():
        predicted = reference if selected['coefficient'] == 0 else apply_form(
            last_observed_features(reference, selected['source_days'], protocol['shrinkage_days']) if observed else residual_features(reference, selected['window_days'], protocol['shrinkage_days']), selected['coefficient'], divisor)
        periods = evaluate(predicted, base['protocol'])
        for name, period in periods.items():
            chosen = [r for r in predicted if r['scored'] and r['period'] == name]
            original = [r for r in reference if r['scored'] and r['period'] == name]
            period['paired_vs_learned_elo'] = paired_vs_baseline(chosen, original, protocol)
            period['reference_metrics'] = {k: v for k, v in metrics(original).items() if k not in ['calibration', 'favorite_buckets']}
            labels = set(base['protocol']['international_league_labels'])
            period['international_by_source_label']['paired_vs_learned_elo'] = paired_vs_baseline(
                [r for r in chosen if r['league_id'] in labels], [r for r in original if r['league_id'] in labels], protocol)
        raw = ''.join(json.dumps(row, sort_keys=True, ensure_ascii=False)+'\n' for row in predicted).encode()
        files[f'predictions-delay-{delay}.jsonl'] = raw
        runs[delay] = {'prediction_sha256': digest(raw), 'periods': periods}
    report = {'backtest_version': protocol['experiment_id'], 'status': 'trained_experimental', 'recommended': False,
              'protocol': protocol, 'protocol_sha256': digest(protocol_raw), 'baseline_metrics_sha256': digest(base_raw),
              'confidence_metrics_sha256': digest(confidence_raw), 'fixed_log_odds_slope': slope,
              'source_canonical_sha256': base['source_canonical_sha256'],
              'implementation_sha256': {name: digest((Path(__file__).parent/name).read_bytes()) for name in
                  ['calibrated_form.py', 'observed_form.py', 'confidence_backtest.py', 'residuals.py', 'form_backtest.py', 'backtest.py']},
              'selected_on_development_only': selected, 'development_candidates': candidates, 'runs': runs,
              'limitations': ['K32 replay updates are unchanged; innovations use confidence-scaled y-p.',
                             'Selection on 2025 only; inspected 2026 diagnostics are not a new blind test.',
                             'UTC and delayed availability are assumptions; team-day groups are not verified series.',
                             'No manual v2 modifiers, current GPR substitution or robust superiority claim.']}
    protected = {p.resolve() for p in [baseline_path, confidence_path, protocol_path, *sources]}
    if protected & {(output/name).resolve() for name in ['metrics.json', *files]}:
        raise ValueError('Cannot overwrite frozen input')
    output.mkdir(parents=True, exist_ok=True)
    for name, raw in files.items(): (output/name).write_bytes(raw)
    write_json(output/'metrics.json', report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['baseline-report', 'confidence-report', 'predictions-dir', 'protocol', 'output']:
        parser.add_argument('--'+name, type=Path, required=True)
    a = parser.parse_args()
    try: report = run(a.baseline_report, a.confidence_report, a.predictions_dir, a.protocol, a.output)
    except (ValueError, KeyError, OSError) as error: parser.exit(1, f'Learned form failed: {error}\n')
    print(json.dumps({'selected': report['selected_on_development_only']['id'], 'periods': {
        name: value['paired_vs_learned_elo'] for name, value in report['runs']['1']['periods'].items()}}, indent=2))


if __name__ == '__main__': main()

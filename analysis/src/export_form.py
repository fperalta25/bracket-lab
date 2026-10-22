"""Freeze an optional learned form variant, retaining the original M0 artifact."""
import argparse
from copy import deepcopy
import json
import math
from pathlib import Path

from baseline import replay
from confidence_backtest import scale
from export_elo import closing_ratings
from ingest import digest, write_json
from observed_form import forms_at_cutoff
from temporal_audit import readiness_report


def export(base_artifact_path, form_report_path, games_path, corpus_audit, identity_audit, baseline_report_path, output):
    raw_base, raw_form = base_artifact_path.read_bytes(), form_report_path.read_bytes()
    envelope, report = json.loads(raw_base), json.loads(raw_form)
    if digest(envelope['payloadJson'].encode()) != envelope['sha256']:
        raise ValueError('Base artifact hash mismatch')
    payload = deepcopy(json.loads(envelope['payloadJson']))
    if payload['status'] != 'trained_experimental' or payload['recommended'] is not False or 'formCoefficient' in payload['parameters']:
        raise ValueError('Require unmodified experimental M0 base')
    if (report['backtest_version'] != 'last-observed-form-v1' or report['recommended'] is not False
            or report['source_canonical_sha256'] != payload['source']['canonicalSha256']
            or report['confidence_metrics_sha256'] != payload['source']['confidenceReportSha256']
            or report['baseline_metrics_sha256'] != payload['source']['baselineReportSha256']
            or report['fixed_log_odds_slope'] != payload['parameters']['logOddsSlope']):
        raise ValueError('Form report does not match learned base')
    coverage = readiness_report(games_path, corpus_audit, identity_audit)
    if coverage['source_canonical_sha256'] != payload['source']['canonicalSha256'] or coverage['source_identity_audit_sha256'] != payload['source']['identityAuditSha256']:
        raise ValueError('Form snapshot source mismatch')
    baseline_raw = baseline_report_path.read_bytes()
    if digest(baseline_raw) != payload['source']['baselineReportSha256']:
        raise ValueError('Baseline report mismatch')
    baseline = json.loads(baseline_raw)
    excluded = set(json.loads(identity_audit.read_bytes())['identity_quarantined_game_ids'])
    raw_games = games_path.read_bytes()
    if digest(raw_games) != coverage['source_canonical_sha256']: raise ValueError('Corpus changed during form export')
    games = [json.loads(line) for line in raw_games.decode().splitlines()]
    games = [g for g in games if g['game_id'] not in excluded and not (g['league_id']=='WLDs' and g['event_start_utc'][:4]=='2026')]
    if payload['parameters']['k'] != baseline['protocol']['k_factor'] or payload['parameters']['divisor'] != baseline['protocol']['divisor']:
        raise ValueError('Form training and base replay use different Elo parameters')
    protocol = {**baseline['protocol'], 'k_factor': payload['parameters']['k']}
    rows, _ = replay(games, protocol, payload['parameters']['availabilityAssumedDays'])
    ratings, counts, last = closing_ratings(rows, protocol, payload['cutoffUtc'])
    for team in payload['teams']:
        source = team['sourceTeamId']
        if (team['rating'] != ratings.get(source, protocol['initial_rating']) or team['games'] != counts.get(source, 0)
                or team['lastGameUtc'] != last.get(source)):
            raise ValueError('Base snapshot does not match reconstructed replay')
    rows = scale(rows, payload['parameters']['logOddsSlope'], payload['parameters']['divisor'])
    selected = report['selected_on_development_only']
    if selected['coefficient'] <= 0 or selected['source_days'] is None:
        raise ValueError('No nonzero form variant selected on development')
    shrinkage = report['protocol']['shrinkage_days']
    forms = forms_at_cutoff(rows, [t['sourceTeamId'] for t in payload['teams']], payload['cutoffUtc'], selected['source_days'], shrinkage)
    factor = payload['parameters']['divisor']/(payload['parameters']['logOddsSlope']*math.log(10))
    for team in payload['teams']:
        form = forms[team['sourceTeamId']]
        team['form'] = form
        team['formRatingAdjustment'] = selected['coefficient']*(form['value'] or 0)*factor
    payload['modelId'] = payload['modelId'].removesuffix('-v1')+'-last-observed-form-v1'
    payload['parameters'].update(formSourceDays=selected['source_days'], formCoefficient=selected['coefficient'], formShrinkageDays=shrinkage)
    payload['source'].update(baseArtifactSha256=digest(raw_base), formReportSha256=digest(raw_form), formExporterSha256=digest(Path(__file__).read_bytes()))
    payload['evaluation'] = {name: {'games': p['games'], 'logLoss': p['log_loss'], 'brier': p['brier'],
        'referenceLogLoss': p['reference_metrics']['log_loss'], 'referenceBrier': p['reference_metrics']['brier'],
        'advantage95': p['paired_vs_learned_elo']['log_loss_advantage_95']} for name, p in report['runs']['1']['periods'].items()}
    payload['limitations'][0] = 'Exploratory M1: internal Elo plus learned residual history; not Riot GPR or manual v2 context.'
    payload['limitations'].append('Form uses last available source days, possibly old; frozen covariate, not latent live form. Mixed inspected 2026 diagnostics; no recommendation.')
    serialized = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(',', ':'))
    result = {'schemaVersion': 1, 'sha256': digest(serialized.encode()), 'payloadJson': serialized}
    protected = {p.resolve() for p in [base_artifact_path, form_report_path, games_path, corpus_audit, identity_audit, baseline_report_path]}
    if output.resolve() in protected: raise ValueError('Cannot overwrite immutable input')
    output.parent.mkdir(parents=True, exist_ok=True)
    write_json(output, result)
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['base-artifact','form-report','games','corpus-audit','identity-audit','baseline-report','output']:
        parser.add_argument('--'+name,type=Path,required=True)
    a=parser.parse_args()
    try: result=export(a.base_artifact,a.form_report,a.games,a.corpus_audit,a.identity_audit,a.baseline_report,a.output)
    except (ValueError,KeyError,OSError) as error: parser.exit(1,f'Form export failed: {error}\n')
    print(json.dumps({'sha256':result['sha256']}))


if __name__=='__main__':main()

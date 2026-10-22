"""Export a frozen, opt-in learned M0 Elo model; not a validated contextual v3."""
import argparse
from collections import Counter
import heapq
import json
from pathlib import Path

from baseline import replay
from ingest import digest, utc, write_json
from temporal_audit import readiness_report


def closing_ratings(rows, protocol, cutoff):
    """Replay the saved pre-game innovations; only strictly available feedback enters the snapshot."""
    end = utc(cutoff)
    ratings, counts, last = {}, Counter(), {}
    pending = []
    for row in rows:
        if utc(row['event_start_utc']) >= end:
            continue
        heapq.heappush(pending,(utc(row['assumed_available_at_utc']),row['game_id'],row))
    while pending and pending[0][0] < end:
        _, _, row = heapq.heappop(pending)
        delta = protocol['k_factor']*(row['win_a']-row['p_win_a'])
        for side, change in [('a',delta),('b',-delta)]:
            team = row[f'team_{side}_id']
            ratings[team] = ratings.get(team,protocol['initial_rating'])+change
            counts[team] += 1
            last[team] = max(last.get(team,''),row['event_start_utc'])
    return ratings, counts, last


def export(games_path, corpus_audit, identity_audit, baseline_path, confidence_path, tuning_path, mapping_path, cutoff, output):
    coverage = readiness_report(games_path,corpus_audit,identity_audit)
    baseline_raw, confidence_raw, tuning_raw, mapping_raw = [p.read_bytes() for p in [baseline_path,confidence_path,tuning_path,mapping_path]]
    baseline, confidence, tuning, mapping = map(json.loads,[baseline_raw,confidence_raw,tuning_raw,mapping_raw])
    if (confidence['baseline_metrics_sha256'] != digest(baseline_raw)
            or tuning['baseline_metrics_sha256'] != digest(baseline_raw)
            or coverage['source_canonical_sha256'] != baseline['source_canonical_sha256']
            or coverage['source_identity_audit_sha256'] != baseline['source_identity_audit_sha256']
            or coverage['source_corpus_audit_sha256'] != baseline['source_corpus_audit_sha256']
            or confidence['backtest_version'] != 'elo-confidence-v1'
            or tuning['backtest_version'] != 'internal-elo-tuning-v1'
            or confidence['public_promotion_allowed'] is not False
            or tuning['public_promotion_allowed'] is not False):
        raise ValueError('Require matching frozen exploratory reports and corpus')
    if utc(cutoff) > utc(json.loads(corpus_audit.read_bytes())['cutoff_utc']):
        raise ValueError('Snapshot cannot exceed audited data cutoff')
    excluded = set(json.loads(identity_audit.read_bytes())['identity_quarantined_game_ids'])
    raw_games = games_path.read_bytes()
    if digest(raw_games) != coverage['source_canonical_sha256']: raise ValueError('Corpus changed during export')
    games = [json.loads(line) for line in raw_games.decode().splitlines()]
    target = [g for g in games if g['league_id']=='WLDs' and utc(g['event_start_utc']).year==2026 and utc(g['event_start_utc'])<utc(cutoff)]
    target_ids = {g['game_id'] for g in target}
    selected = [g for g in games if g['game_id'] not in excluded and g['game_id'] not in target_ids and utc(g['event_start_utc'])<utc(cutoff)]
    protocol = {**baseline['protocol'],'k_factor':tuning['selected_on_development_only']['k_factor']}
    delay = protocol['primary_delay_days']
    rows, _ = replay(selected,protocol,delay)
    ratings, counts, last = closing_ratings(rows,protocol,cutoff)
    teams, seen, source_ids = [], set(), set()
    for link in mapping['teams']:
        team, source = link['team_id'],link['source_team_id']
        if team in seen or (source is not None and source in source_ids):
            raise ValueError('Duplicate model team mapping')
        seen.add(team)
        if source is not None:
            source_ids.add(source)
            names={g[f'team_{s}_name'] for g in selected for s in ['a','b'] if g[f'team_{s}_id']==source}
            if names != {link['source_name']} or source not in counts:
                raise ValueError('Missing or ambiguous mapped source identity')
        elif link['source_name'] is not None:
            raise ValueError('Unlinked team must not claim source evidence')
        teams.append({'teamId':team,'acronym':link['acronym'],'sourceTeamId':source,'sourceName':link['source_name'],
                      'rating':ratings.get(source,protocol['initial_rating']), 'games':counts.get(source,0),
                      'lastGameUtc':last.get(source), 'status':'learned' if source is not None else 'prior_only'})
    if not teams:
        raise ValueError('Empty mapping')
    payload = {
        'schemaVersion':1,'modelId':f'internal-elo-trained-{cutoff[:10]}-v1','status':'trained_experimental','recommended':False,
        'cutoffUtc':cutoff,'parameterSelectionEndUtc':'2026-01-01T00:00:00Z',
        'parameters':{'initialRating':protocol['initial_rating'],'k':protocol['k_factor'],'divisor':protocol['divisor'],
                      'logOddsSlope':confidence['selected_on_development_only']['slope'],'availabilityAssumedDays':delay},
        'source':{'canonicalSha256':coverage['source_canonical_sha256'],'identityAuditSha256':coverage['source_identity_audit_sha256'],
                  'exporterSha256':digest(Path(__file__).read_bytes()),'baselineImplementationSha256':digest((Path(__file__).parent/'baseline.py').read_bytes()),
                  'baselineReportSha256':digest(baseline_raw),'confidenceReportSha256':digest(confidence_raw),
                  'tuningReportSha256':digest(tuning_raw),'mappingSha256':digest(mapping_raw),
                  'url':'https://chaincc.lol/free/data','license':'CC-BY-4.0 (declared by source)'},
        'targetTournamentExcluded':{'league':'WLDs','year':2026,'games':len(target)},
        'teams':sorted(teams,key=lambda t:t['teamId']),
        'evaluation':confidence['runs'][str(delay)]['periods'],
        'limitations':['Exploratory M0: internal Elo, not Riot GPR or trained contextual coefficients.',
                       '2026 diagnostics previously inspected; no robust superiority claim or recommended status.',
                       'Result availability estimated; timezone assumed UTC; source IDs do not verify player continuity.',
                       'Unknown identity uses the initial prior with zero linked games; no inferred alias.',
                       'Target Worlds 2026 excluded from snapshot fitting; report metrics describe historical replay, not this tournament.',
                       'No manual v2 bonuses, online tournament rating updates, latent context or region correction.'],
    }
    # Only compact aggregate period metrics, not per-league/calibration tables, belong in the runtime artifact.
    payload['evaluation'] = {name:{'games':p['games'],'logLoss':p['log_loss'],'brier':p['brier'],
                                  'advantage95':p['paired_vs_internal_elo']['log_loss_advantage_95']}
                             for name,p in payload['evaluation'].items()}
    serialized=json.dumps(payload,sort_keys=True,ensure_ascii=False,separators=(',',':'))
    envelope={'schemaVersion':1,'sha256':digest(serialized.encode()),'payloadJson':serialized}
    protected={p.resolve() for p in [games_path,corpus_audit,identity_audit,baseline_path,confidence_path,tuning_path,mapping_path]}
    if output.resolve() in protected:raise ValueError('Cannot overwrite frozen input')
    output.parent.mkdir(parents=True,exist_ok=True)
    write_json(output,envelope)
    return envelope


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['games','corpus-audit','identity-audit','baseline-report','confidence-report','tuning-report','mapping','output']:
        parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--cutoff',required=True)
    a=parser.parse_args()
    try:
        result=export(a.games,a.corpus_audit,a.identity_audit,a.baseline_report,a.confidence_report,a.tuning_report,a.mapping,a.cutoff,a.output)
    except (ValueError,KeyError,OSError) as error:parser.exit(1,f'Artifact export failed: {error}\n')
    print(json.dumps({'sha256':result['sha256'],'teams':len(json.loads(result['payloadJson'])['teams'])}))


if __name__=='__main__':main()

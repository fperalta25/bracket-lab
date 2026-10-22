"""Residual history over last available source days, preserving the age of observations."""
from collections import defaultdict
import heapq
import math

from ingest import utc


def summarize(history, at, source_days, shrinkage_days):
    days = sorted(history)[-source_days:]
    if not days:
        return {'status': 'missing', 'value': None, 'days': 0, 'games': 0, 'last_game_utc': None, 'age_days': None}
    items = [item for day in days for item in history[day]]
    last = max(item[0] for item in items)
    return {'status': 'estimated', 'value': math.fsum(
        math.fsum(item[1] for item in history[day])/len(history[day]) for day in days)/(len(days)+shrinkage_days),
        'days': len(days), 'games': len(items), 'last_game_utc': last.isoformat(), 'age_days': (at-last).total_seconds()/86400}


def validate(source_days, shrinkage_days):
    if type(source_days) is not int or source_days < 1 or not math.isfinite(shrinkage_days) or shrinkage_days <= 0:
        raise ValueError('Require positive source-day count and shrinkage')


def last_observed_features(rows, source_days, shrinkage_days):
    validate(source_days, shrinkage_days)
    history, pending, seen, result = defaultdict(lambda: defaultdict(list)), [], set(), []
    for row in sorted(rows, key=lambda r: (utc(r['event_start_utc']), r['game_id'])):
        at = utc(row['event_start_utc'])
        if row['game_id'] in seen: raise ValueError('Duplicate residual observation')
        seen.add(row['game_id'])
        while pending and pending[0][0] < at:
            _, _, start, a, b, residual = heapq.heappop(pending)
            for team, value in [(a, residual), (b, -residual)]:
                history[team][start.date()].append((start, value))
                for day in sorted(history[team])[:-source_days]: del history[team][day]
        result.append({**row, 'form_a': summarize(history[row['team_a_id']], at, source_days, shrinkage_days),
                       'form_b': summarize(history[row['team_b_id']], at, source_days, shrinkage_days)})
        available = utc(row['assumed_available_at_utc'])
        if available <= at or not math.isfinite(row['p_win_a']) or not 0 <= row['p_win_a'] <= 1 or type(row['win_a']) is not int or row['win_a'] not in (0, 1):
            raise ValueError('Invalid residual observation')
        heapq.heappush(pending, (available, row['game_id'], at, row['team_a_id'], row['team_b_id'], row['win_a']-row['p_win_a']))
    return result


def forms_at_cutoff(rows, team_ids, cutoff, source_days, shrinkage_days):
    validate(source_days, shrinkage_days)
    at = utc(cutoff)
    history, seen = defaultdict(lambda: defaultdict(list)), set()
    for row in sorted(rows, key=lambda r: (utc(r['event_start_utc']), r['game_id'])):
        start = utc(row['event_start_utc'])
        if start >= at or utc(row['assumed_available_at_utc']) >= at: continue
        if row['game_id'] in seen: raise ValueError('Duplicate residual observation')
        seen.add(row['game_id'])
        residual = row['win_a']-row['p_win_a']
        for team, value in [(row['team_a_id'], residual), (row['team_b_id'], -residual)]:
            history[team][start.date()].append((start, value))
    return {team: summarize(history[team], at, source_days, shrinkage_days) for team in team_ids}

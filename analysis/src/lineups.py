"""Retrospective lineup stability from past source-name observations only."""
from collections import defaultdict, deque
from datetime import timedelta
import heapq
import math

from baseline import log_probabilities
from ingest import utc


def lineup_features(rows, lineups, window_days, shrinkage_days=3, prior_stability=.5):
    if type(window_days) is not int or window_days <= 0:
        raise ValueError('Require positive whole-day lookback')
    if not math.isfinite(shrinkage_days) or shrinkage_days <= 0 or prior_stability != .5:
        raise ValueError('Require positive shrinkage and fixed neutral prior')
    history, pending, seen, output = defaultdict(deque), [], set(), []
    for row in sorted(rows, key=lambda item: (utc(item['event_start_utc']), item['game_id'])):
        at, available = utc(row['event_start_utc']), utc(row['assumed_available_at_utc'])
        game_id, a, b = row['game_id'], row['team_a_id'], row['team_b_id']
        if not game_id or game_id in seen or game_id not in lineups or not a or not b or a == b or available <= at:
            raise ValueError('Invalid or duplicate lineup observation')
        seen.add(game_id)
        observed = lineups[game_id]
        for side in ['a', 'b']:
            players = observed[side]
            if players is not None and (len(players) != 5 or len(set(players)) != 5
                                         or not all(isinstance(name, str) and name.strip() for name in players)):
                raise ValueError('Require five distinct source names or missing lineup')
        while pending and pending[0][0] < at:
            _, old_id, start, old_a, old_b, players_a, players_b = heapq.heappop(pending)
            history[old_a].append((start, old_id, players_a))
            history[old_b].append((start, old_id, players_b))
        lower = at-timedelta(days=window_days)

        def stability(team_id):
            items = deque(item for item in history[team_id] if item[0] >= lower)
            history[team_id] = items
            missing = {'status': 'missing', 'value': None, 'days': 0, 'games': 0, 'reference_game_id': None}
            if not items:
                return {**missing, 'reason': 'no_available_history'}
            latest_at = max(item[0] for item in items)
            latest = [item for item in items if item[0] == latest_at]
            distinct = {None if item[2] is None else tuple(sorted(item[2])) for item in latest}
            if len(distinct) > 1:
                return {**missing, 'reason': 'ambiguous_latest_lineup'}
            reference = min(latest, key=lambda item: item[1])
            if reference[2] is None:
                return {**missing, 'reason': 'latest_lineup_missing'}
            reference_players = set(reference[2])
            days = defaultdict(list)
            for start, _, players in items:
                if players is not None and start.date() < latest_at.date():
                    days[start.date().isoformat()].append(len(reference_players.intersection(players))/5)
            if not days:
                return {**missing, 'reference_game_id': reference[1], 'reason': 'no_earlier_comparison_day'}
            total = math.fsum(math.fsum(values)/len(values) for _, values in sorted(days.items()))
            return {'status': 'estimated', 'value': (total+prior_stability*shrinkage_days)/(len(days)+shrinkage_days),
                    'days': len(days), 'games': sum(len(values) for values in days.values()),
                    'reference_game_id': reference[1], 'reason': None}

        output.append({**row, 'lineup_stability_a': stability(a), 'lineup_stability_b': stability(b)})
        # The target's lineup is queued only after emitting its pre-game features.
        heapq.heappush(pending, (available, game_id, at, a, b,
                                None if observed['a'] is None else tuple(observed['a']),
                                None if observed['b'] is None else tuple(observed['b'])))
    return output


def apply_stability(features, coefficient, divisor):
    if not math.isfinite(coefficient):
        raise ValueError('Require finite stability coefficient')
    output = []
    for row in features:
        a, b = row['lineup_stability_a'], row['lineup_stability_b']
        contribution = coefficient*(a['value']-b['value']) if a['status'] == b['status'] == 'estimated' else 0
        if contribution == 0:
            output.append({**row, 'lineup_log_odds': 0.0})
            continue
        log_a, log_b = log_probabilities(row['rating_a_before'], row['rating_b_before'], divisor)
        if not math.isclose(math.exp(log_a), row['p_win_a'], rel_tol=0, abs_tol=1e-14):
            raise ValueError('Stability baseline probability/rating mismatch')
        x = log_a-log_b+contribution
        if not math.isfinite(x):
            raise ValueError('Nonfinite lineup adjustment')
        log_a = -(max(-x, 0)+math.log1p(math.exp(-abs(x))))
        log_b = -(max(x, 0)+math.log1p(math.exp(-abs(x))))
        p = math.exp(log_a)
        output.append({**row, 'p_win_a': p, 'log_loss': -(log_a if row['win_a'] else log_b),
                       'brier': (p-row['win_a'])**2, 'lineup_log_odds': contribution})
    return output

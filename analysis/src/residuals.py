"""Causal residual form from cached pre-game baseline predictions, research mode only."""
from collections import defaultdict, deque
from datetime import timedelta
import heapq
import math

from baseline import log_probabilities
from ingest import utc


def residual_features(rows, window_days, shrinkage_days):
    if type(window_days) is not int or window_days <= 0:
        raise ValueError('Require a positive whole-day window')
    if not math.isfinite(shrinkage_days) or shrinkage_days <= 0:
        raise ValueError('Require positive shrinkage')
    rows = sorted(rows, key=lambda row: (utc(row['event_start_utc']), row['game_id']))
    pending, seen, history, output = [], set(), defaultdict(deque), []
    for row in rows:
        at, available = utc(row['event_start_utc']), utc(row['assumed_available_at_utc'])
        if row['game_id'] in seen or not row['game_id']:
            raise ValueError('Missing or duplicate baseline game ID')
        seen.add(row['game_id'])
        a, b = row['team_a_id'], row['team_b_id']
        p, y = row['p_win_a'], row['win_a']
        if a == b or not a or not b or type(y) is not int or y not in (0, 1):
            raise ValueError('Invalid baseline matchup')
        if not math.isfinite(p) or not 0 <= p <= 1 or available <= at:
            raise ValueError('Invalid baseline probability/availability')
        while pending and pending[0][0] < at:
            _, _, start, old_a, old_b, residual = heapq.heappop(pending)
            history[old_a].append((start, residual))
            history[old_b].append((start, -residual))
        lower = at - timedelta(days=window_days)

        def team_form(team_id):
            items = history[team_id]
            # Availability need not be ordered by game start: filter all observations.
            retained = deque((start, value) for start, value in items if start >= lower)
            history[team_id] = retained
            days = defaultdict(list)
            for start, value in retained:
                days[start.date().isoformat()].append(value)
            if not days:
                return {'status': 'missing', 'value': None, 'days': 0, 'games': 0}
            value = math.fsum(math.fsum(values) / len(values) for _, values in sorted(days.items()))
            return {'status': 'estimated', 'value': value / (len(days) + shrinkage_days),
                    'days': len(days), 'games': len(retained)}

        output.append({**row, 'form_a': team_form(a), 'form_b': team_form(b)})
        # The innovation always comes from the unmodified baseline, never the candidate.
        heapq.heappush(pending, (available, row['game_id'], at, a, b, y - p))
    return output


def apply_form(features, coefficient, divisor):
    if not math.isfinite(coefficient) or coefficient < 0:
        raise ValueError('Require finite nonnegative form coefficient')
    output = []
    for row in features:
        difference = (row['form_a']['value'] or 0) - (row['form_b']['value'] or 0)
        contribution = coefficient * difference
        if coefficient == 0 or contribution == 0:
            output.append({**row, 'form_log_odds': 0.0})
            continue  # Preserve the cached baseline exactly when there is no effect.
        log_a, log_b = log_probabilities(row['rating_a_before'], row['rating_b_before'], divisor)
        if not math.isclose(math.exp(log_a), row['p_win_a'], rel_tol=0, abs_tol=1e-14):
            raise ValueError('Cached baseline probability does not match rating scale')
        x = log_a - log_b + contribution
        if not math.isfinite(x):
            raise ValueError('Nonfinite contextual log odds')
        log_a = -(max(-x, 0) + math.log1p(math.exp(-abs(x))))
        log_b = -(max(x, 0) + math.log1p(math.exp(-abs(x))))
        p = math.exp(log_a)
        output.append({**row, 'p_win_a': p, 'log_loss': -(log_a if row['win_a'] else log_b),
                       'brier': (p-row['win_a']) ** 2, 'form_log_odds': contribution})
    return output

"""Exploratory internal Elo replay with explicitly assumed delayed feedback."""
from collections import defaultdict
import heapq
import math

from ingest import utc


def log_probabilities(rating_a, rating_b, divisor=400):
    if not all(math.isfinite(value) for value in (rating_a, rating_b, divisor)) or divisor <= 0:
        raise ValueError('Require finite ratings and positive divisor')
    x = math.log(10) * (rating_a - rating_b) / divisor
    if not math.isfinite(x):
        raise ValueError('Rating gap exceeds numeric range')
    def softplus(value):
        return max(value, 0) + math.log1p(math.exp(-abs(value)))
    return -softplus(-x), -softplus(x)


def validate_protocol(protocol):
    if protocol.get('model_id') != 'internal_elo_baseline' or protocol.get('promotion_allowed') is not False:
        raise ValueError('Require an explicitly non-promotable internal Elo protocol')
    for key in ['initial_rating', 'k_factor', 'divisor']:
        if not math.isfinite(protocol[key]) or (key != 'initial_rating' and protocol[key] <= 0):
            raise ValueError('Invalid Elo parameter')
    delays = protocol['availability_delay_days']
    if not delays or len(delays) != len(set(delays)) or any(type(day) is not int or day <= 0 for day in delays):
        raise ValueError('Require distinct positive whole-day availability assumptions')
    if protocol['primary_delay_days'] not in delays:
        raise ValueError('Primary delay must be fixed in the protocol')
    previous_end = None
    ids = set()
    for period in protocol['periods']:
        start, end = utc(period['start']), utc(period['end'])
        if period['id'] in ids or start >= end or (previous_end is not None and start < previous_end):
            raise ValueError('Require distinct, ordered, non-overlapping periods')
        if type(period['score']) is not bool:
            raise ValueError('Period score must be boolean')
        ids.add(period['id'])
        previous_end = end
    if not ids:
        raise ValueError('Require evaluation periods')


def replay(games, protocol, delay_days):
    """Predict at start, then update using the saved prediction when feedback becomes available."""
    validate_protocol(protocol)
    if delay_days not in protocol['availability_delay_days']:
        raise ValueError('Delay is not prespecified')
    from datetime import timedelta
    periods = [(utc(period['start']), utc(period['end']), period) for period in protocol['periods']]
    games = sorted(games, key=lambda game: (utc(game['event_start_utc']), game['game_id']))
    seen, ratings, resolved = set(), {}, defaultdict(int)
    pending, rows = [], []
    omitted = 0
    for game in games:
        if not game['game_id'] or game['game_id'] in seen:
            raise ValueError('Missing or duplicate game ID')
        seen.add(game['game_id'])
        a, b, y = game['team_a_id'], game['team_b_id'], game['win_a']
        if not a or not b or a == b or type(y) is not int or y not in (0, 1):
            raise ValueError('Invalid canonical matchup/outcome')
        at = utc(game['event_start_utc'])
        # Strictly earlier availability; no result from the target or a concurrent game.
        while pending and pending[0][0] < at:
            _, _, old_a, old_b, delta = heapq.heappop(pending)
            ratings[old_a] = ratings.get(old_a, protocol['initial_rating']) + delta
            ratings[old_b] = ratings.get(old_b, protocol['initial_rating']) - delta
            resolved[old_a] += 1
            resolved[old_b] += 1
        period = next((period for start, end, period in periods if start <= at < end), None)
        if period is None:
            omitted += 1
            continue  # Embargo games do not update ratings and are not scored.
        ra, rb = ratings.get(a, protocol['initial_rating']), ratings.get(b, protocol['initial_rating'])
        log_a, log_b = log_probabilities(ra, rb, protocol['divisor'])
        p = math.exp(log_a)
        rows.append({
            'game_id': game['game_id'], 'event_start_utc': at.isoformat(),
            'assumed_available_at_utc': (at + timedelta(days=delay_days)).isoformat(),
            'period': period['id'], 'scored': period['score'],
            'team_a_id': a, 'team_b_id': b, 'rating_a_before': ra, 'rating_b_before': rb,
            'p_win_a': p, 'win_a': y, 'log_loss': -(log_a if y else log_b), 'brier': (p - y) ** 2,
            'cold_start': resolved[a] == 0 or resolved[b] == 0,
            'league_id': game['league_id'], 'split': game['split'], 'year': at.year,
        })
        # Delayed feedback uses p_pre_game, never a recomputed probability from later ratings.
        heapq.heappush(pending, (at + timedelta(days=delay_days), game['game_id'], a, b,
                                protocol['k_factor'] * (y - p)))
    return rows, {'embargo_or_outside_period_games': omitted}

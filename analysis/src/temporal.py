"""Offline pre-game history contracts. No fitted parameters or predictions."""
from dataclasses import dataclass
from datetime import timedelta
import re

from ingest import utc


def instant(value):
    return utc(value).isoformat()


@dataclass(frozen=True)
class Evidence:
    """Reference to reviewed source bytes; a hash alone does not prove publication time."""
    reference: str
    sha256: str

    def __post_init__(self):
        if not self.reference.strip() or not re.fullmatch(r'[a-f0-9]{64}', self.sha256):
            raise ValueError('Evidence requires a source reference and SHA-256')


@dataclass(frozen=True)
class HistoricalResult:
    game_id: str
    team_a_id: str
    team_b_id: str
    event_start_utc: str
    available_at_utc: str | None
    win_a: int
    time_evidence: Evidence | None = None
    result_evidence: Evidence | None = None
    series_id: str | None = None

    def __post_init__(self):
        if not self.game_id or not self.team_a_id or not self.team_b_id or self.team_a_id == self.team_b_id:
            raise ValueError('Require a game and two distinct source team IDs')
        if type(self.win_a) is not int or self.win_a not in (0, 1):
            raise ValueError('Result must be binary')
        if any(value is not None and not isinstance(value, Evidence)
               for value in (self.time_evidence, self.result_evidence)):
            raise ValueError('Result provenance must use Evidence references')
        object.__setattr__(self, 'event_start_utc', instant(self.event_start_utc))
        if self.available_at_utc is not None:
            object.__setattr__(self, 'available_at_utc', instant(self.available_at_utc))
            if utc(self.available_at_utc) <= utc(self.event_start_utc):
                raise ValueError('Result availability must follow game start')


@dataclass(frozen=True)
class RosterSnapshot:
    snapshot_id: str
    team_id: str
    player_ids: tuple[str, ...]
    effective_from_utc: str
    available_at_utc: str
    evidence: Evidence
    effective_until_utc: str | None = None

    def __post_init__(self):
        players = tuple(self.player_ids)
        if not self.snapshot_id or not self.team_id or len(players) != 5 or len(set(players)) != 5 or not all(isinstance(player, str) and player.strip() for player in players):
            raise ValueError('Roster requires five distinct stable player IDs')
        if not isinstance(self.evidence, Evidence):
            raise ValueError('Roster requires reviewed source evidence')
        object.__setattr__(self, 'player_ids', tuple(sorted(players)))
        for field in ['effective_from_utc', 'available_at_utc', 'effective_until_utc']:
            if getattr(self, field) is not None:
                object.__setattr__(self, field, instant(getattr(self, field)))
        if self.effective_until_utc is not None and utc(self.effective_until_utc) <= utc(self.effective_from_utc):
            raise ValueError('Roster validity must be a non-empty interval')


@dataclass(frozen=True)
class PreGameQuery:
    game_id: str
    team_a_id: str
    team_b_id: str
    game_start_utc: str
    as_of_utc: str

    def __post_init__(self):
        if not self.game_id or not self.team_a_id or not self.team_b_id or self.team_a_id == self.team_b_id:
            raise ValueError('Require a target game and two distinct source team IDs')
        object.__setattr__(self, 'game_start_utc', instant(self.game_start_utc))
        object.__setattr__(self, 'as_of_utc', instant(self.as_of_utc))
        if utc(self.as_of_utc) >= utc(self.game_start_utc):
            raise ValueError('Feature cutoff must precede target game start')


@dataclass(frozen=True)
class HistoryView:
    games: tuple[HistoricalResult, ...]

    @property
    def status(self):
        return 'observed' if self.games else 'missing'


class TemporalHistory:
    def __init__(self, results=(), rosters=(), quarantined_game_ids=()):
        self._results = {}
        self._rosters = {}
        seen_results, seen_rosters = set(), set()
        quarantined = frozenset(quarantined_game_ids)
        for result in results:
            if result.game_id in seen_results:
                raise ValueError('Duplicate historical game ID')
            seen_results.add(result.game_id)
            if result.game_id in quarantined:
                continue
            for team_id in [result.team_a_id, result.team_b_id]:
                self._results.setdefault(team_id, []).append(result)
        for roster in rosters:
            if roster.snapshot_id in seen_rosters:
                raise ValueError('Duplicate roster snapshot ID')
            seen_rosters.add(roster.snapshot_id)
            self._rosters.setdefault(roster.team_id, []).append(roster)
        for team_id, items in self._results.items():
            self._results[team_id] = tuple(sorted(items, key=lambda item: (item.event_start_utc, item.game_id)))
        for team_id, items in self._rosters.items():
            self._rosters[team_id] = tuple(items)

    @staticmethod
    def _check_team(team_id, query):
        if team_id not in (query.team_a_id, query.team_b_id):
            raise ValueError('Team is not part of target game')

    def results_before(self, team_id, query, *, window_days=30):
        self._check_team(team_id, query)
        if type(window_days) is not int or window_days <= 0:
            raise ValueError('Lookback days must be a positive integer')
        at = utc(query.as_of_utc)
        lower = at - timedelta(days=window_days)
        games = tuple(result for result in self._results.get(team_id, ())
                      if result.game_id != query.game_id
                      and lower <= utc(result.event_start_utc) < at
                      and result.available_at_utc is not None and utc(result.available_at_utc) < at
                      and isinstance(result.time_evidence, Evidence)
                      and isinstance(result.result_evidence, Evidence))
        return HistoryView(games)

    def roster_before(self, team_id, query):
        self._check_team(team_id, query)
        at = utc(query.as_of_utc)
        known = [roster for roster in self._rosters.get(team_id, ())
                 if utc(roster.available_at_utc) < at and utc(roster.effective_from_utc) <= at]
        if not known:
            return None
        newest = max((roster.effective_from_utc, roster.available_at_utc) for roster in known)
        latest = [roster for roster in known if (roster.effective_from_utc, roster.available_at_utc) == newest]
        if len({(roster.player_ids, roster.effective_until_utc) for roster in latest}) != 1:
            raise ValueError('Conflicting roster snapshots at the same effective/availability time')
        roster = min(latest, key=lambda item: item.snapshot_id)
        # An expired latest snapshot must not resurrect an older roster.
        if roster.effective_until_utc is not None and utc(roster.effective_until_utc) <= at:
            return None
        return roster

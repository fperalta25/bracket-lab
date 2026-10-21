import { createKeyedRandom, createPairingSampler, firstRoundSampler, validateConstraints, SimulationError,
    SWISS_MATCH_COUNTS, type Fixture, type GprSimulationRequest, type Pair, type Team } from '../simulator';
import { applySwissMatch, createSwissState, isActive, recordOf, swissBestOf } from '../simulator/state';

function customFixtures(request: GprSimulationRequest): readonly Fixture[] {
    if (request.scenario.mode !== 'custom') throw new SimulationError('invalid_request');
    validateConstraints(request.snapshot, request.scenario.fixtures);
    return request.scenario.fixtures;
}

export function swissRoundState(request: GprSimulationRequest, round: number) {
    if (!Number.isInteger(round) || round < 1 || round > 5) throw new SimulationError('invalid_request', { field: 'round' });
    const fixtures = customFixtures(request);
    const states = createSwissState(request.snapshot.teams);
    for (const fixture of fixtures.filter((f) => f.stage === 'swiss' && f.round < round && f.status === 'completed')
        .sort((a, b) => a.round - b.round || a.slot - b.slot)) {
        if (fixture.status === 'completed') applySwissMatch(states, { ...fixture, winner: fixture.score.a > fixture.score.b ? fixture.teamA : fixture.teamB });
    }
    const participants = request.snapshot.teams.filter((team) => {
        const state = states.get(team.id)!;
        return isActive(state) && state.wins + state.losses === round - 1;
    });
    return { states, participants, ready: participants.length === SWISS_MATCH_COUNTS[round - 1]! * 2,
        expected: SWISS_MATCH_COUNTS[round - 1]! * 2 };
}

/** Fill the remaining draw using the same complete-matching sampler as the tournament engine. */
export function completeSwissDraw(request: GprSimulationRequest, round: number, drawIndex: number): readonly Fixture[] {
    const fixtures = customFixtures(request);
    const info = swissRoundState(request, round);
    if (!info.ready) throw new SimulationError('invalid_constraints', { round, reason: 'undetermined_participants' });
    const locks = fixtures.filter((f) => f.stage === 'swiss' && f.round === round);
    const random = createKeyedRandom(request.seed, drawIndex, 'pairing', 'scenario-editor', round);
    let pairs: Pair[] = [];
    if (round === 1) pairs = firstRoundSampler(request.snapshot.teams, request.snapshot.rules, locks.map((f) => [f.teamA, f.teamB])).sample(random);
    else {
        const groups = new Map<string, Team[]>();
        for (const team of info.participants) {
            const record = recordOf(info.states.get(team.id)!);
            if (!groups.has(record)) groups.set(record, []);
            groups.get(record)!.push(team);
        }
        for (const [, teams] of [...groups].sort(([a], [b]) => a < b ? -1 : 1)) {
            const ids = teams.map((team) => team.id);
            pairs.push(...createPairingSampler(ids, () => true, (a, b) => info.states.get(a)!.opponents.has(b),
                locks.filter((f) => ids.includes(f.teamA)).map((f) => [f.teamA, f.teamB])).sample(random));
        }
    }
    const usedIds = new Set(fixtures.map((f) => f.id));
    const assigned = new Map(locks.map((f) => [f.slot, f]));
    const lockedTeams = new Set(locks.flatMap((f) => [f.teamA, f.teamB]));
    for (const [teamA, teamB] of pairs) {
        if (lockedTeams.has(teamA)) continue;
        let slot = 1; while (assigned.has(slot)) slot++;
        let id = `scenario:swiss:${round}:${slot}`; while (usedIds.has(id)) id += ':';
        usedIds.add(id);
        assigned.set(slot, { id, stage: 'swiss', round, slot, teamA, teamB,
            bestOf: swissBestOf(info.states.get(teamA)!), status: 'scheduled' });
    }
    const result = [...fixtures.filter((f) => f.stage !== 'swiss' || f.round !== round), ...assigned.values()];
    validateConstraints(request.snapshot, result);
    return result;
}

export function updateSwissScore(request: GprSimulationRequest, round: number, slot: number,
    score: Readonly<{ a: number; b: number }> | null | 'random'): readonly Fixture[] {
    const fixtures = customFixtures(request);
    const atSlot = (f: Fixture) => f.stage === 'swiss' && f.round === round && f.slot === slot;
    const original = fixtures.find(atSlot) ?? request.snapshot.fixtures.find(atSlot);
    if (!original) throw new SimulationError('invalid_fixture', { round, slot });
    const result = fixtures.filter((f) => !atSlot(f));
    if (score !== 'random') {
        const { id, stage, round, slot, teamA, teamB, bestOf } = original;
        const base = { id, stage, round, slot, teamA, teamB, bestOf };
        result.push(score === null ? { ...base, status: 'scheduled' } : { ...base, status: 'completed', score: { ...score } });
    }
    validateConstraints(request.snapshot, result);
    return result;
}

/** Swap opponents atomically, keeping completed scores intact. Unpaired opponents are also valid. */
export function swapSwissOpponent(request: GprSimulationRequest, round: number, slot: number, opponent: string): readonly Fixture[] {
    const fixtures = customFixtures(request);
    const current = fixtures.find((f) => f.stage === 'swiss' && f.round === round && f.slot === slot);
    if (!current || current.status !== 'scheduled' || (current.games?.length ?? 0) > 0 || opponent === current.teamA) throw new SimulationError('invalid_fixture', { round, slot });
    if (opponent === current.teamB) return fixtures;
    const other = fixtures.find((f) => f.stage === 'swiss' && f.round === round && (f.teamA === opponent || f.teamB === opponent));
    if (other?.status === 'completed' || (other?.games?.length ?? 0) > 0) throw new SimulationError('invalid_constraints', { round, reason: 'locked_result' });
    const result = fixtures.map((f): Fixture => {
        if (f === current) return { ...f, teamB: opponent };
        if (f === other) return { ...f, teamA: f.teamA === opponent ? current.teamB : f.teamA,
            teamB: f.teamB === opponent ? current.teamB : f.teamB };
        return f;
    });
    validateConstraints(request.snapshot, result);
    return result;
}

export function clearSwissRound(request: GprSimulationRequest, round: number): readonly Fixture[] {
    const result = customFixtures(request).filter((f) => f.stage !== 'swiss' || f.round !== round);
    validateConstraints(request.snapshot, result);
    return result;
}

import { createKeyedRandom, createPairingSampler, fixtureWinner, validateConstraints, SimulationError,
    type Fixture, type GprSimulationRequest } from '../simulator';
import { applySwissMatch, createSwissState, recordOf, swissBestOf } from '../simulator/state';
import { completeSwissDraw, swissRoundState } from './scenario-rounds';

export const SWISS_BOARD_VERSION = 'record-group-auto-draw-v1';
export const BOARD_GROUPS = [
    [{ record: '0-0', expected: 16 }],
    [{ record: '1-0', expected: 8 }, { record: '0-1', expected: 8 }],
    [{ record: '2-0', expected: 4 }, { record: '1-1', expected: 8 }, { record: '0-2', expected: 4 }],
    [{ record: '2-1', expected: 6 }, { record: '1-2', expected: 6 }],
    [{ record: '2-2', expected: 6 }],
] as const;

function fixturesOf(request: GprSimulationRequest): readonly Fixture[] {
    if (request.scenario.mode !== 'custom') throw new SimulationError('invalid_request');
    validateConstraints(request.snapshot, request.scenario.fixtures);
    return request.scenario.fixtures;
}

/** Draw each record group as soon as its entire membership is known, preserving existing locks. */
export function advanceSwissBoard(request: GprSimulationRequest, drawIndex: number) {
    let fixtures = fixturesOf(request);
    let nextDrawIndex = drawIndex;
    for (let round = 1; round <= 5; round++) {
        const info = swissRoundState({ ...request, scenario: { mode: 'custom', fixtures } }, round);
        for (const group of BOARD_GROUPS[round - 1]!) {
            const ids = info.participants.filter((team) => recordOf(info.states.get(team.id)!) === group.record).map((team) => team.id);
            if (ids.length !== group.expected) continue;
            const locks = fixtures.filter((f) => f.stage === 'swiss' && f.round === round && ids.includes(f.teamA));
            if (locks.length === group.expected / 2) continue;
            if (round === 1) {
                fixtures = completeSwissDraw({ ...request, scenario: { mode: 'custom', fixtures } }, 1, nextDrawIndex++);
                continue;
            }
            const sampler = createPairingSampler(ids, () => true, (a, b) => info.states.get(a)!.opponents.has(b), locks.map((f) => [f.teamA, f.teamB]));
            const pairs = sampler.sample(createKeyedRandom(request.seed, nextDrawIndex++, 'pairing', SWISS_BOARD_VERSION, round, group.record));
            const usedSlots = new Set(fixtures.filter((f) => f.stage === 'swiss' && f.round === round).map((f) => f.slot));
            const usedIds = new Set(fixtures.map((f) => f.id));
            const lockedTeams = new Set(locks.flatMap((f) => [f.teamA, f.teamB]));
            const additions: Fixture[] = [];
            for (const [teamA, teamB] of pairs) {
                if (lockedTeams.has(teamA)) continue;
                let slot = 1; while (usedSlots.has(slot)) slot++;
                usedSlots.add(slot);
                let id = `board:swiss:${round}:${slot}`; while (usedIds.has(id)) id += ':';
                usedIds.add(id);
                additions.push({ id, stage: 'swiss', round, slot, teamA, teamB, bestOf: swissBestOf(info.states.get(teamA)!), status: 'scheduled' });
            }
            fixtures = [...fixtures, ...additions];
        }
    }
    validateConstraints(request.snapshot, fixtures);
    return { fixtures, nextDrawIndex };
}

/** A changed earlier choice resets later draws/results atomically; the UI keeps an undo snapshot. */
export function chooseSwissWinner(request: GprSimulationRequest, fixtureId: string, winner: string, drawIndex: number) {
    const fixtures = fixturesOf(request);
    const fixture = fixtures.find((f) => f.id === fixtureId);
    if (!fixture || fixture.stage !== 'swiss' || (winner !== fixture.teamA && winner !== fixture.teamB)) throw new SimulationError('invalid_fixture');
    const { id, stage, round, slot, teamA, teamB, bestOf } = fixture;
    const base = { id, stage, round, slot, teamA, teamB, bestOf,
        ...(fixture.status !== 'completed' && fixture.games ? { games: fixture.games } : {}) };
    const replacement: Fixture = fixtureWinner(fixture) === winner ? { ...base, status: 'scheduled' } : { ...base, status: 'decided', winner };
    const changingKnownWinner = fixtureWinner(fixture) !== undefined;
    const removedResults = changingKnownWinner ? fixtures.filter((f) => (f.stage !== 'swiss' || f.round > round) && f.status !== 'scheduled').length : 0;
    const retained = fixtures.filter((f) => !changingKnownWinner || (f.stage === 'swiss' && f.round <= round)).map((f) => f.id === id ? replacement : f);
    const advanced = advanceSwissBoard({ ...request, scenario: { mode: 'custom', fixtures: retained } }, drawIndex);
    return { ...advanced, removedResults };
}

export function swissBoardView(request: GprSimulationRequest) {
    const fixtures = fixturesOf(request);
    const columns = BOARD_GROUPS.map((groups, i) => {
        const info = swissRoundState(request, i + 1);
        return { round: i + 1, groups: groups.map((group) => {
            const arrivals = info.participants.filter((team) => recordOf(info.states.get(team.id)!) === group.record);
            const matches = fixtures.filter((f) => f.stage === 'swiss' && f.round === i + 1 && recordOf(info.states.get(f.teamA)!) === group.record)
                .sort((a, b) => a.slot - b.slot).map((f) => ({ ...f, selectedWinner: fixtureWinner(f) }));
            return { ...group, arrivals, matches, drawn: matches.length === group.expected / 2,
                rematches: matches.filter((f) => info.states.get(f.teamA)!.opponents.has(f.teamB)).length };
        }) };
    });
    const states = createSwissState(request.snapshot.teams);
    for (const fixture of [...fixtures].filter((f) => f.stage === 'swiss').sort((a, b) => a.round - b.round || a.slot - b.slot)) {
        const winner = fixtureWinner(fixture); if (winner) applySwissMatch(states, { ...fixture, winner });
    }
    const terminal = (wins: boolean) => request.snapshot.teams.filter((team) => (wins ? states.get(team.id)!.wins : states.get(team.id)!.losses) === 3)
        .map((team) => ({ ...team, record: recordOf(states.get(team.id)!) }));
    return { columns, qualified: terminal(true), eliminated: terminal(false) };
}

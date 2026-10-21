import { createKeyedRandom, fixtureWinner, knockoutSampler, KNOCKOUT_ROUNDS, SimulationError, validateConstraints,
    type Fixture, type GprSimulationRequest, type SwissRecord } from '../simulator';
import { applySwissMatch, createSwissState, recordOf } from '../simulator/state';

export const KNOCKOUT_BOARD_VERSION = 'slot-aware-auto-draw-v1';
export const KNOCKOUT_STAGES = ['quarterfinal', 'semifinal', 'final'] as const;
type KnockoutStage = typeof KNOCKOUT_STAGES[number];
const counts = { quarterfinal: 4, semifinal: 2, final: 1 } as const;

function fixturesOf(request: GprSimulationRequest) {
    if (request.scenario.mode !== 'custom') throw new SimulationError('invalid_request');
    validateConstraints(request.snapshot, request.scenario.fixtures);
    return request.scenario.fixtures;
}

function qualifiedRecords(request: GprSimulationRequest, fixtures: readonly Fixture[]) {
    const states = createSwissState(request.snapshot.teams);
    for (const fixture of fixtures.filter((f) => f.stage === 'swiss').sort((a, b) => a.round - b.round || a.slot - b.slot)) {
        const winner = fixtureWinner(fixture); if (winner) applySwissMatch(states, { ...fixture, winner });
    }
    return Object.fromEntries([...states].filter(([, state]) => state.wins === 3)
        .map(([id, state]) => [id, recordOf(state) as SwissRecord]));
}

/** Draw quarters once; subsequent stages follow their parent slots, without another draw. */
export function advanceKnockoutBoard(request: GprSimulationRequest, drawIndex: number) {
    let fixtures = fixturesOf(request);
    let nextDrawIndex = drawIndex;
    const records = qualifiedRecords(request, fixtures);
    const add = (stage: KnockoutStage, slot: number, teamA: string, teamB: string) => {
        let id = `board:${stage}:${slot}`; while (fixtures.some((f) => f.id === id)) id += ':';
        fixtures = [...fixtures, { id, stage, round: KNOCKOUT_ROUNDS[stage], slot, teamA, teamB,
            bestOf: request.snapshot.rules.knockoutBestOf, status: 'scheduled' }];
    };
    const quarters = fixtures.filter((f) => f.stage === 'quarterfinal');
    if (Object.keys(records).length === 8 && quarters.length < 4) {
        const pairs = knockoutSampler(records, quarters).sample(createKeyedRandom(request.seed, nextDrawIndex++, 'pairing', KNOCKOUT_BOARD_VERSION));
        pairs.forEach(([a, b], index) => { if (!quarters.some((f) => f.slot === index + 1)) add('quarterfinal', index + 1, a, b); });
    }
    for (const stage of ['semifinal', 'final'] as const) {
        const previous = stage === 'semifinal' ? 'quarterfinal' : 'semifinal';
        for (let slot = 1; slot <= counts[stage]; slot++) {
            if (fixtures.some((f) => f.stage === stage && f.slot === slot)) continue;
            const parents = [slot * 2 - 1, slot * 2].map((s) => fixtures.find((f) => f.stage === previous && f.slot === s));
            const [a, b] = parents.map((f) => f && fixtureWinner(f));
            if (a && b) add(stage, slot, a, b);
        }
    }
    validateConstraints(request.snapshot, fixtures);
    return { fixtures, nextDrawIndex };
}

/** Only descendants of a changed result are removed; the other bracket half is preserved. */
export function chooseKnockoutWinner(request: GprSimulationRequest, fixtureId: string, winner: string, drawIndex: number) {
    const fixtures = fixturesOf(request);
    const fixture = fixtures.find((f) => f.id === fixtureId);
    if (!fixture || fixture.stage === 'swiss' || (winner !== fixture.teamA && winner !== fixture.teamB)) throw new SimulationError('invalid_fixture');
    const { id, stage, round, slot, teamA, teamB, bestOf } = fixture;
    const base = { id, stage, round, slot, teamA, teamB, bestOf,
        ...(fixture.status !== 'completed' && fixture.games ? { games: fixture.games } : {}) };
    const replacement: Fixture = fixtureWinner(fixture) === winner ? { ...base, status: 'scheduled' } : { ...base, status: 'decided', winner };
    const descendants = new Set<string>();
    if (fixtureWinner(fixture)) {
        let childSlot = slot;
        for (const childStage of KNOCKOUT_STAGES.slice(KNOCKOUT_STAGES.indexOf(stage) + 1)) {
            childSlot = Math.ceil(childSlot / 2);
            const child = fixtures.find((f) => f.stage === childStage && f.slot === childSlot);
            if (child) descendants.add(child.id);
        }
    }
    const removedResults = fixtures.filter((f) => descendants.has(f.id) && fixtureWinner(f)).length;
    const retained = fixtures.filter((f) => !descendants.has(f.id)).map((f) => f.id === id ? replacement : f);
    return { ...advanceKnockoutBoard({ ...request, scenario: { mode: 'custom', fixtures: retained } }, drawIndex), removedResults };
}

export function knockoutBoardView(request: GprSimulationRequest) {
    const fixtures = fixturesOf(request);
    const columns = KNOCKOUT_STAGES.map((stage, index) => ({ stage, round: index + 1,
        slots: Array.from({ length: counts[stage] }, (_, i) => {
            const slot = i + 1;
            const fixture = fixtures.find((f) => f.stage === stage && f.slot === slot);
            const previous = KNOCKOUT_STAGES[index - 1];
            const parentWinner = (s: number) => {
                const parent = fixtures.find((f) => f.stage === previous && f.slot === s);
                return parent && fixtureWinner(parent);
            };
            return { slot, fixture, teamA: fixture?.teamA ?? parentWinner(slot * 2 - 1),
                teamB: fixture?.teamB ?? parentWinner(slot * 2), selectedWinner: fixture && fixtureWinner(fixture) };
        }) }));
    const final = fixtures.find((f) => f.stage === 'final');
    return { columns, ready: Object.keys(qualifiedRecords(request, fixtures)).length === 8,
        drawn: fixtures.filter((f) => f.stage === 'quarterfinal').length === 4, champion: final && fixtureWinner(final) };
}

/** A new quarterfinal draw keeps the entire Swiss phase and replaces its knockout descendants. */
export function redrawKnockoutQuarters(request: GprSimulationRequest, drawIndex: number) {
    const fixtures = fixturesOf(request);
    if (Object.keys(qualifiedRecords(request, fixtures)).length !== 8) throw new SimulationError('invalid_constraints');
    const swiss = fixtures.filter((f) => f.stage === 'swiss');
    return { ...advanceKnockoutBoard({ ...request, scenario: { mode: 'custom', fixtures: swiss } }, drawIndex),
        removedResults: fixtures.filter((f) => f.stage !== 'swiss' && fixtureWinner(f)).length };
}

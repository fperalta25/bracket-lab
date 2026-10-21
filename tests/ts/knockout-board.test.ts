import { describe, expect, it } from 'vitest';
import { gprSeedRequest } from '../../scripts/seed-snapshot';
import { fixtureWinner, runSimulations, validateConstraints, type Fixture, type GprSimulationRequest } from '../../resources/ts/simulator';
import { chooseSwissWinner, swissBoardView } from '../../resources/ts/public/swiss-board';
import { advanceKnockoutBoard, chooseKnockoutWinner, knockoutBoardView, redrawKnockoutQuarters } from '../../resources/ts/public/knockout-board';
import { parseScenarioFile } from '../../resources/ts/public/scenarios';

function withFixtures(request: GprSimulationRequest, fixtures: readonly Fixture[]): GprSimulationRequest {
    return { ...request, scenario: { mode: 'custom', fixtures } };
}
function fixturesOf(request: GprSimulationRequest) { return request.scenario.mode === 'custom' ? request.scenario.fixtures : []; }
function completedSwiss() {
    let request = gprSeedRequest(20, 42);
    request = withFixtures(request, request.snapshot.fixtures);
    let index = 0;
    while (true) {
        const match = swissBoardView(request).columns.flatMap((c) => c.groups.flatMap((g) => g.matches)).find((m) => !fixtureWinner(m));
        if (!match) return { request, index };
        const next = chooseSwissWinner(request, match.id, match.teamA, index);
        request = withFixtures(request, next.fixtures); index = next.nextDrawIndex;
    }
}
function pick(request: GprSimulationRequest, stage: Fixture['stage'], slot: number, index: number, opposite = false) {
    const f = fixturesOf(request).find((f) => f.stage === stage && f.slot === slot)!;
    const next = chooseKnockoutWinner(request, f.id, opposite ? f.teamB : f.teamA, index);
    return { request: withFixtures(request, next.fixtures), index: next.nextDrawIndex, removedResults: next.removedResults };
}
function completedTournament() {
    let { request, index } = completedSwiss();
    const drawn = advanceKnockoutBoard(request, index); request = withFixtures(request, drawn.fixtures); index = drawn.nextDrawIndex;
    for (const [stage, count] of [['quarterfinal', 4], ['semifinal', 2], ['final', 1]] as const) {
        for (let slot = 1; slot <= count; slot++) ({ request, index } = pick(request, stage, slot, index));
    }
    return { request, index };
}

describe('clickable knockout board', () => {
    it('waits for all qualifiers, then draws legal, reproducible quarters exactly once', () => {
        const initial = gprSeedRequest(1, 42);
        const pending = withFixtures(initial, initial.snapshot.fixtures);
        expect(advanceKnockoutBoard(pending, 0)).toEqual({ fixtures: initial.snapshot.fixtures, nextDrawIndex: 0 });
        expect(knockoutBoardView(pending)).toMatchObject({ ready: false, drawn: false, champion: undefined });
        const { request, index } = completedSwiss();
        const records = Object.fromEntries(swissBoardView(request).qualified.map((t) => [t.id, t.record]));
        for (let seed = 0; seed < 20; seed++) {
            const seeded = { ...request, seed };
            const next = advanceKnockoutBoard(seeded, index);
            expect(advanceKnockoutBoard(seeded, index)).toEqual(next);
            expect(next.nextDrawIndex).toBe(index + 1);
            const quarters = next.fixtures.filter((f) => f.stage === 'quarterfinal');
            expect(quarters).toHaveLength(4);
            const undefeated = quarters.filter((f) => records[f.teamA] === '3-0' || records[f.teamB] === '3-0');
            expect(undefeated).toHaveLength(2);
            expect(undefeated.map((f) => Math.floor((f.slot - 1) / 2)).sort()).toEqual([0, 1]);
            for (const f of undefeated) expect([records[f.teamA], records[f.teamB]].sort()).toEqual(['3-0', '3-2']);
            expect(quarters.every((f) => f.bestOf === 5 && f.status === 'scheduled')).toBe(true);
            expect(advanceKnockoutBoard(withFixtures(seeded, next.fixtures), next.nextDrawIndex)).toEqual(next);
        }
    });

    it('preserves a partial published draw, scores and prefixes when filling the bracket', () => {
        const { request, index } = completedSwiss();
        const drawn = advanceKnockoutBoard(request, index);
        const quarters = drawn.fixtures.filter((f) => f.stage === 'quarterfinal');
        const first = quarters[0]!;
        const official: Fixture = { ...first, id: 'published-quarter', teamA: first.teamB, teamB: first.teamA,
            status: 'completed', score: { a: 3, b: 1 }, games: undefined };
        const second = { ...quarters[1]!, games: [quarters[1]!.teamB] };
        const partial = withFixtures(request, [...fixturesOf(request), official, second]);
        const next = advanceKnockoutBoard(partial, index);
        expect(next.fixtures.find((f) => f.id === official.id)).toEqual(official);
        expect(next.fixtures.find((f) => f.id === second.id)).toEqual(second);
        expect(next.fixtures.filter((f) => f.stage === 'quarterfinal')).toHaveLength(4);
        validateConstraints(request.snapshot, next.fixtures);
    });

    it('creates each semifinal as soon as its parents finish and preserves independent choices', () => {
        let { request, index } = completedSwiss();
        const drawn = advanceKnockoutBoard(request, index); request = withFixtures(request, drawn.fixtures); index = drawn.nextDrawIndex;
        ({ request, index } = pick(request, 'quarterfinal', 1, index));
        expect(knockoutBoardView(request).columns[1]!.slots[0]).toMatchObject({ teamA: fixturesOf(request).find((f) => f.stage === 'quarterfinal' && f.slot === 1)!.teamA, fixture: undefined });
        ({ request, index } = pick(request, 'quarterfinal', 2, index));
        ({ request, index } = pick(request, 'semifinal', 1, index));
        const semifinal = fixturesOf(request).find((f) => f.stage === 'semifinal')!;
        ({ request, index } = pick(request, 'quarterfinal', 3, index));
        expect(fixturesOf(request).find((f) => f.id === semifinal.id)).toEqual(semifinal);
        expect(fixturesOf(request).some((f) => f.stage === 'final')).toBe(false);
        ({ request, index } = pick(request, 'quarterfinal', 4, index));
        expect(fixturesOf(request).filter((f) => f.stage === 'semifinal')).toHaveLength(2);
        ({ request, index } = pick(request, 'semifinal', 2, index));
        expect(fixturesOf(request).find((f) => f.stage === 'final')).toMatchObject({ teamA: fixtureWinner(semifinal), bestOf: 5, status: 'scheduled' });
        expect(index).toBe(drawn.nextDrawIndex);
    });

    it('finishes all 40 winner-only series, simulates legal scores, and round-trips the scenario', () => {
        const { request } = completedTournament();
        const fixtures = fixturesOf(request);
        expect(fixtures).toHaveLength(40);
        expect(fixtures.every((f) => f.status === 'decided' && f.score === undefined)).toBe(true);
        const champion = knockoutBoardView(request).champion!;
        expect(champion).toBeTruthy();
        const output = runSimulations(request);
        expect(output.aggregates.teams[champion]!.finishCounts.champion).toBe(request.iterations);
        expect(output.example.matches.filter((f) => f.origin === 'constrained')).toHaveLength(40);
        for (const match of output.example.matches.filter((f) => f.stage !== 'swiss')) {
            expect(match.winner).toBe(fixtureWinner(fixtures.find((f) => f.id === match.id)!));
            expect(Math.max(match.score.a, match.score.b)).toBe(3);
        }
        const file = { kind: 'bracket-lab-scenario', schemaVersion: 2, id: 'knockout', name: 'Final',
            createdAt: '2026-10-21T12:00:00.000Z', updatedAt: '2026-10-21T12:00:00.000Z', request };
        expect(runSimulations(parseScenarioFile(JSON.stringify(file)).request)).toEqual(output);
    });

    it('changing or clearing a winner removes only its descendants and leaves the input untouched', () => {
        const { request, index } = completedTournament();
        const original = JSON.stringify(request);
        const changed = pick(request, 'quarterfinal', 1, index, true);
        expect(changed.removedResults).toBe(2);
        expect(knockoutBoardView(changed.request).champion).toBeUndefined();
        expect(fixturesOf(changed.request).find((f) => f.stage === 'semifinal' && f.slot === 1)?.status).toBe('scheduled');
        const unaffected = fixturesOf(request).filter((f) => (f.stage === 'quarterfinal' && f.slot !== 1) || (f.stage === 'semifinal' && f.slot === 2) || f.stage === 'swiss');
        for (const f of unaffected) expect(fixturesOf(changed.request).find((item) => item.id === f.id)).toEqual(f);
        const cleared = pick(request, 'quarterfinal', 1, index);
        expect(fixturesOf(cleared.request).some((f) => f.stage === 'semifinal' && f.slot === 1)).toBe(false);
        expect(knockoutBoardView(cleared.request).champion).toBeUndefined();
        const semiChanged = pick(request, 'semifinal', 2, index, true);
        expect(semiChanged.removedResults).toBe(1);
        expect(fixturesOf(semiChanged.request).find((f) => f.stage === 'final')?.status).toBe('scheduled');
        const finalChanged = pick(request, 'final', 1, index, true);
        expect(finalChanged.removedResults).toBe(0);
        expect(knockoutBoardView(finalChanged.request).champion).not.toBe(knockoutBoardView(request).champion);
        expect(JSON.stringify(request)).toBe(original);
    });

    it('redraws quarters reproducibly while preserving all Swiss results and clearing knockout picks', () => {
        const { request, index } = completedTournament();
        const before = JSON.stringify(request);
        const next = redrawKnockoutQuarters(request, index);
        expect(redrawKnockoutQuarters(request, index)).toEqual(next);
        expect(next.nextDrawIndex).toBe(index + 1);
        expect(next.removedResults).toBe(7);
        expect(next.fixtures.filter((f) => f.stage === 'swiss')).toEqual(fixturesOf(request).filter((f) => f.stage === 'swiss'));
        expect(next.fixtures.filter((f) => f.stage !== 'swiss')).toHaveLength(4);
        expect(next.fixtures.filter((f) => f.stage !== 'swiss').every((f) => f.status === 'scheduled')).toBe(true);
        validateConstraints(request.snapshot, next.fixtures);
        expect(JSON.stringify(request)).toBe(before);
        const initial = gprSeedRequest(1, 42);
        expect(() => redrawKnockoutQuarters(withFixtures(initial, initial.snapshot.fixtures), 0)).toThrow('invalid_constraints');
    });

    it('rejects invalid picks and invalidates knockout after a changed Swiss choice', () => {
        const { request, index } = completedTournament();
        const first = fixturesOf(request)[0]!;
        expect(() => chooseKnockoutWinner(request, first.id, first.teamA, index)).toThrow('invalid_fixture');
        expect(() => chooseKnockoutWinner(request, 'missing', first.teamA, index)).toThrow('invalid_fixture');
        const final = fixturesOf(request).find((f) => f.stage === 'final')!;
        expect(() => chooseKnockoutWinner(request, final.id, 'foreign', index)).toThrow('invalid_fixture');
        const changed = chooseSwissWinner(request, first.id, first.teamB, index);
        expect(changed.removedResults).toBeGreaterThanOrEqual(7);
        const advanced = advanceKnockoutBoard(withFixtures(request, changed.fixtures), changed.nextDrawIndex);
        expect(advanced.fixtures.every((f) => f.stage === 'swiss')).toBe(true);
    });
});

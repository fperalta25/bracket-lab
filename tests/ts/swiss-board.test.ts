import { describe, expect, it } from 'vitest';
import { gprSeedRequest } from '../../scripts/seed-snapshot';
import { runSimulations, fixtureWinner, validateConstraints, type GprSimulationRequest } from '../../resources/ts/simulator';
import { advanceSwissBoard, chooseSwissWinner, swissBoardView } from '../../resources/ts/public/swiss-board';
import { parseScenarioFile } from '../../resources/ts/public/scenarios';

const initial = (): GprSimulationRequest => { const r = gprSeedRequest(3, 42); return { ...r, scenario: { mode: 'custom', fixtures: r.snapshot.fixtures } }; };

function pick(request: GprSimulationRequest, fixtureId: string, winner: string, index: number) {
    const next = chooseSwissWinner(request, fixtureId, winner, index);
    return { request: { ...request, scenario: { mode: 'custom', fixtures: next.fixtures } } as GprSimulationRequest, index: next.nextDrawIndex };
}

describe('automatic clickable Swiss board', () => {
    it('moves winner and loser immediately, and draws each complete record group independently', () => {
        let request = initial(); let index = 0;
        const first = request.snapshot.fixtures[0]!;
        ({ request, index } = pick(request, first.id, first.teamA, index));
        let view = swissBoardView(request);
        expect(view.columns[1]!.groups[0]!.arrivals.map((t) => t.id)).toContain(first.teamA);
        expect(view.columns[1]!.groups[1]!.arrivals.map((t) => t.id)).toContain(first.teamB);
        expect(view.columns[1]!.groups.every((g) => !g.drawn)).toBe(true);
        for (const f of request.snapshot.fixtures.slice(1)) ({ request, index } = pick(request, f.id, f.teamA, index));
        view = swissBoardView(request);
        expect(view.columns[1]!.groups.map((g) => [g.arrivals.length, g.matches.length])).toEqual([[8, 4], [8, 4]]);
        const upper = view.columns[1]!.groups[0]!.matches;
        for (const f of upper) ({ request, index } = pick(request, f.id, f.teamA, index));
        view = swissBoardView(request);
        expect(view.columns[2]!.groups[0]).toMatchObject({ record: '2-0', drawn: true });
        expect(view.columns[2]!.groups[0]!.matches).toHaveLength(2);
        expect(view.columns[2]!.groups[1]).toMatchObject({ record: '1-1', drawn: false });
        expect(view.columns[1]!.groups[1]!.matches.every((f) => !fixtureWinner(f))).toBe(true);
        const nextGroup = view.columns[2]!.groups[0]!.matches;
        ({ request, index } = pick(request, nextGroup[0]!.id, nextGroup[0]!.teamA, index));
        const lower = view.columns[1]!.groups[1]!.matches[0]!;
        ({ request, index } = pick(request, lower.id, lower.teamA, index));
        const preserved = swissBoardView(request).columns[2]!.groups[0]!.matches;
        expect(preserved.map((m) => [m.id, m.teamA, m.teamB])).toEqual(nextGroup.map((m) => [m.id, m.teamA, m.teamB]));
        expect(fixtureWinner(preserved[0]!)).toBe(nextGroup[0]!.teamA);
    });

    it('completes 33 winner-only series into exactly eight qualifiers and eight eliminations', () => {
        let request = initial(); let index = 0; let choices = 0;
        while (true) {
            const view = swissBoardView(request);
            const unresolved = view.columns.flatMap((c) => c.groups.flatMap((g) => g.matches)).find((m) => !fixtureWinner(m));
            if (!unresolved) break;
            ({ request, index } = pick(request, unresolved.id, unresolved.teamA, index)); choices++;
        }
        expect(choices).toBe(33);
        const view = swissBoardView(request);
        expect(view.qualified).toHaveLength(8); expect(view.eliminated).toHaveLength(8);
        const fixtures = request.scenario.mode === 'custom' ? request.scenario.fixtures : [];
        expect(fixtures.every((f) => f.status === 'decided' && f.score === undefined)).toBe(true);
        validateConstraints(request.snapshot, fixtures);
        const output = runSimulations(request);
        expect(output.example.matches).toHaveLength(40);
        expect(output.example.matches.filter((m) => m.origin === 'constrained')).toHaveLength(33);
        expect(output.example.swissRecords).toEqual(Object.fromEntries([...view.qualified, ...view.eliminated].map((t) => [t.id, t.record])));
        const file = { kind: 'bracket-lab-scenario', schemaVersion: 2, id: 'board', name: 'Board',
            createdAt: '2026-10-21T12:00:00.000Z', updatedAt: '2026-10-21T12:00:00.000Z', request };
        expect(runSimulations(parseScenarioFile(JSON.stringify(file)).request)).toEqual(output);
        expect(() => parseScenarioFile(JSON.stringify({ ...file, schemaVersion: 1 }))).toThrow('incompatible_model');
    });

    it('makes draw advancement idempotent and keeps changed early choices free of stale downstream results', () => {
        let request = initial(); let index = 0;
        for (const f of request.snapshot.fixtures) ({ request, index } = pick(request, f.id, f.teamA, index));
        const stable = advanceSwissBoard(request, index);
        expect(stable.nextDrawIndex).toBe(index);
        expect(stable.fixtures).toEqual(request.scenario.mode === 'custom' ? request.scenario.fixtures : []);
        const later = swissBoardView(request).columns[1]!.groups[0]!.matches[0]!;
        ({ request, index } = pick(request, later.id, later.teamA, index));
        const before = JSON.stringify(request);
        const first = request.snapshot.fixtures[0]!;
        const changed = chooseSwissWinner(request, first.id, first.teamB, index);
        expect(changed.removedResults).toBe(1);
        expect(changed.fixtures.filter((f) => f.stage === 'swiss' && f.round > 1).every((f) => f.status === 'scheduled')).toBe(true);
        expect(JSON.stringify(request)).toBe(before);
        const toggled = chooseSwissWinner({ ...request, scenario: { mode: 'custom', fixtures: changed.fixtures } }, first.id, first.teamB, changed.nextDrawIndex);
        expect(fixtureWinner(toggled.fixtures.find((f) => f.id === first.id)!)).toBeUndefined();
        expect(toggled.fixtures.every((f) => f.stage === 'swiss' && f.round === 1)).toBe(true);
    });
});

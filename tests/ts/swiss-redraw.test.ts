import { describe, expect, it } from 'vitest';
import { gprSeedRequest } from '../../scripts/seed-snapshot';
import { runSimulations, validateConstraints, type GprSimulationRequest } from '../../resources/ts/simulator';
import { redrawSwissGroup, swissBoardView } from '../../resources/ts/public/swiss-board';

function completedRequest(): GprSimulationRequest {
    const r = gprSeedRequest(2, 42);
    return { ...r, scenario: { mode: 'custom', fixtures: runSimulations(r).example.matches } };
}

describe('Swiss record group redraws', () => {
    it('redraws 2-1 without changing 1-2 or earlier rounds, then clears only dependent fixtures', () => {
        const request = completedRequest();
        const original = JSON.stringify(request);
        const view = swissBoardView(request);
        const lower = view.columns[3]!.groups[1]!.matches;
        const target = view.columns[3]!.groups[0]!.matches;
        const result = redrawSwissGroup(request, 4, '2-1', 0);
        expect(redrawSwissGroup(request, 4, '2-1', 0)).toEqual(result);
        expect(result.nextDrawIndex).toBe(1);
        expect(result.fixtures.filter((f) => f.stage === 'swiss' && f.round === 4 && f.status === 'scheduled')).toHaveLength(3);
        for (const f of lower) expect(result.fixtures.find((item) => item.id === f.id)).toEqual(expect.objectContaining({ teamA: f.teamA, teamB: f.teamB, score: f.score }));
        const drawn = result.fixtures.filter((f) => f.stage === 'swiss' && f.round === 4 && f.status === 'scheduled');
        expect(drawn.flatMap((f) => [f.teamA, f.teamB]).sort()).toEqual(target.flatMap((f) => [f.teamA, f.teamB]).sort());
        expect(result.fixtures.some((f) => f.stage !== 'swiss')).toBe(false);
        expect(result.removedResults).toBeGreaterThanOrEqual(10);
        expect(JSON.stringify(request)).toBe(original);
        validateConstraints(request.snapshot, result.fixtures);
    });
    it('preserves later independent groups and applies first-round pool and region rules', () => {
        const request = completedRequest();
        const independent = swissBoardView(request).columns[2]!.groups[2]!.matches;
        const result = redrawSwissGroup(request, 2, '1-0', 10);
        for (const match of independent) expect(result.fixtures.find((f) => f.id === match.id)).toBeTruthy();
        const first = redrawSwissGroup(request, 1, '0-0', 0);
        expect(first.fixtures).toHaveLength(8);
        expect(first.fixtures.every((f) => f.stage === 'swiss' && f.round === 1 && f.status === 'scheduled')).toBe(true);
        validateConstraints(request.snapshot, first.fixtures);
    });
    it('rejects incomplete or unknown groups without mutating the scenario', () => {
        const r = gprSeedRequest(1, 42);
        const request = { ...r, scenario: { mode: 'custom', fixtures: r.snapshot.fixtures } } as GprSimulationRequest;
        expect(() => redrawSwissGroup(request, 4, '2-1', 0)).toThrow('invalid_constraints');
        expect(() => redrawSwissGroup(request, 4, '2-0', 0)).toThrow('invalid_fixture');
        expect(() => redrawSwissGroup(request, 6, '2-2', 0)).toThrow('invalid_fixture');
    });
});

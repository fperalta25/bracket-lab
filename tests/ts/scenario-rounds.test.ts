import { describe, expect, it } from 'vitest';
import { gprSeedRequest } from '../../scripts/seed-snapshot';
import { runSimulations, validateConstraints, SWISS_MATCH_COUNTS, type Fixture, type GprSimulationRequest } from '../../resources/ts/simulator';
import { clearSwissRound, completeSwissDraw, swapSwissOpponent, swissRoundState, updateSwissScore } from '../../resources/ts/public/scenario-rounds';

const initial = (): GprSimulationRequest => {
    const request = gprSeedRequest(2, 42);
    return { ...request, scenario: { mode: 'custom', fixtures: request.snapshot.fixtures } };
};
const withFixtures = (request: GprSimulationRequest, fixtures: readonly Fixture[]): GprSimulationRequest => ({ ...request, scenario: { mode: 'custom', fixtures } });
const custom = (request: GprSimulationRequest): readonly Fixture[] => request.scenario.mode === 'custom' ? request.scenario.fixtures : [];

function fixedHistory(round: number): GprSimulationRequest {
    const request = initial();
    const matches = runSimulations(request).example.matches;
    return withFixtures(request, matches.filter((match) => match.stage === 'swiss' && match.round < round));
}

// Independent exhaustive minimum for small record groups; no DP/sampler reuse.
function minimumRepeats(ids: readonly string[], repeated: (a: string, b: string) => boolean): number {
    if (!ids.length) return 0;
    return Math.min(...ids.slice(1).map((opponent, i) => Number(repeated(ids[0]!, opponent))
        + minimumRepeats(ids.filter((_, j) => j !== 0 && j !== i + 1), repeated)));
}

describe('Swiss round editor', () => {
    it('does not infer participants from unresolved games or sort a premature round', () => {
        const request = initial();
        expect(swissRoundState(request, 1)).toMatchObject({ ready: true, expected: 16 });
        expect(swissRoundState(request, 2).participants).toHaveLength(0);
        expect(() => completeSwissDraw(request, 2, 0)).toThrow('invalid_constraints');
        expect(() => swissRoundState(request, 6)).toThrow('invalid_request');
        const f = request.snapshot.fixtures[0]!;
        const partial = withFixtures(request, updateSwissScore(request, 1, f.slot, { a: 1, b: 0 }));
        expect(swissRoundState(partial, 2).participants).toHaveLength(2);
        expect(swissRoundState(partial, 2).ready).toBe(false);
    });

    it.each([1, 2, 3, 4, 5])('completes round %i deterministically with known records and exact formats', (round) => {
        const request = fixedHistory(round);
        const info = swissRoundState(request, round);
        expect(info.ready).toBe(true);
        const before = JSON.stringify(request);
        const fixtures = completeSwissDraw(request, round, 7);
        expect(fixtures).toEqual(completeSwissDraw(request, round, 7));
        expect(JSON.stringify(request)).toBe(before);
        const current = fixtures.filter((f) => f.stage === 'swiss' && f.round === round);
        expect(current).toHaveLength(SWISS_MATCH_COUNTS[round - 1]!);
        expect(new Set(current.flatMap((f) => [f.teamA, f.teamB])).size).toBe(current.length * 2);
        for (const f of current) {
            const a = info.states.get(f.teamA)!;
            const b = info.states.get(f.teamB)!;
            expect([a.wins, a.losses]).toEqual([b.wins, b.losses]);
            expect(f.bestOf).toBe(a.wins === 2 || a.losses === 2 ? 3 : 1);
        }
        if (round > 1) {
            const groups = new Map<string, string[]>();
            for (const team of info.participants) {
                const state = info.states.get(team.id)!;
                const record = `${state.wins}-${state.losses}`;
                groups.set(record, [...(groups.get(record) ?? []), team.id]);
            }
            for (const ids of groups.values()) {
                const repeated = (a: string, b: string) => info.states.get(a)!.opponents.has(b);
                const actual = current.filter((f) => ids.includes(f.teamA)).reduce((sum, f) => sum + Number(repeated(f.teamA, f.teamB)), 0);
                expect(actual).toBe(minimumRepeats(ids, repeated));
            }
        }
        validateConstraints(request.snapshot, fixtures);
        expect(() => runSimulations(withFixtures(request, fixtures))).not.toThrow();
    });

    it('preserves fixed scores and IDs when completing a partial draw', () => {
        const request = fixedHistory(3);
        const drawn = completeSwissDraw(request, 3, 0);
        const fixture = drawn.find((f) => f.stage === 'swiss' && f.round === 3)!;
        const target = (fixture.bestOf + 1) / 2;
        const partial = withFixtures(request, [...custom(request), { ...fixture, status: 'completed', score: { a: target, b: 0 } }]);
        const result = completeSwissDraw(partial, 3, 99);
        expect(result.find((f) => f.id === fixture.id)).toEqual(custom(partial).at(-1));
        expect(result.filter((f) => f.stage === 'swiss' && f.round === 3)).toHaveLength(8);
    });

    it('swaps two pending R1 opponents atomically and keeps pools, regions and team uniqueness valid', () => {
        const request = initial();
        const first = custom(request)[0]!;
        const original = JSON.stringify(request);
        const candidate = request.snapshot.teams.find((team) => {
            if (team.id === first.teamB) return false;
            try { swapSwissOpponent(request, 1, first.slot, team.id); return true; } catch { return false; }
        })!;
        expect(candidate).toBeDefined();
        const result = swapSwissOpponent(request, 1, first.slot, candidate.id);
        expect(result.find((f) => f.slot === first.slot)?.teamB).toBe(candidate.id);
        expect(new Set(result.flatMap((f) => [f.teamA, f.teamB])).size).toBe(16);
        expect(result.filter((f, i) => JSON.stringify(f) !== JSON.stringify(custom(request)[i]))).toHaveLength(2);
        expect(JSON.stringify(request)).toBe(original);
        validateConstraints(request.snapshot, result);
    });

    it('rejects regional/pool conflicts and never rewrites a completed or partially observed series', () => {
        const request = initial();
        const first = custom(request)[0]!;
        const firstTeam = request.snapshot.teams.find((t) => t.id === first.teamA)!;
        const sameRegion = request.snapshot.teams.find((t) => t.region === firstTeam.region && t.id !== firstTeam.id)!;
        expect(() => swapSwissOpponent(request, 1, first.slot, sameRegion.id)).toThrow();
        expect(() => swapSwissOpponent(request, 1, first.slot, first.teamA)).toThrow();
        const completed = withFixtures(request, updateSwissScore(request, 1, first.slot, { a: 1, b: 0 }));
        expect(() => swapSwissOpponent(completed, 1, first.slot, first.teamB)).toThrow();
        const history = fixedHistory(3);
        const drawn = completeSwissDraw(history, 3, 0);
        const bo3 = drawn.find((f) => f.stage === 'swiss' && f.round === 3 && f.bestOf === 3)!;
        const prefix = withFixtures(request, drawn.map((f) => f.id === bo3.id ? { ...f, status: 'scheduled', score: undefined, games: [f.teamA] } : f));
        expect(() => swapSwissOpponent(prefix, 3, bo3.slot, bo3.teamB)).toThrow();
    });

    it('accepts all legal Bo3 scores without inventing a game order and rejects invalid scores', () => {
        const history = fixedHistory(3);
        const request = withFixtures(history, completeSwissDraw(history, 3, 0));
        const f = custom(request).find((f) => f.round === 3 && f.bestOf === 3)!;
        for (const score of [{ a: 2, b: 0 }, { a: 2, b: 1 }, { a: 0, b: 2 }, { a: 1, b: 2 }]) {
            const result = updateSwissScore(request, 3, f.slot, score);
            const edited = result.find((match) => match.id === f.id)!;
            expect(edited).toMatchObject({ status: 'completed', score });
            expect(edited.games).toBeUndefined();
        }
        for (const score of [{ a: 1, b: 1 }, { a: 3, b: 0 }, { a: 2, b: 2 }, { a: NaN, b: 0 }]) {
            expect(() => updateSwissScore(request, 3, f.slot, score)).toThrow('invalid_score');
        }
    });

    it('protects dependent rounds and allows removing them before changing earlier results', () => {
        const request = fixedHistory(3);
        expect(() => clearSwissRound(request, 1)).toThrow('invalid_constraints');
        const r2 = clearSwissRound(request, 2);
        expect(r2).toHaveLength(8);
        const cleared = clearSwissRound(withFixtures(request, r2), 1);
        expect(cleared).toHaveLength(0);
    });
});

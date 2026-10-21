import { describe, expect, it } from 'vitest';
import { createRandom, gprGameLogProbabilities, playWinnerConstrainedSeries, runSimulations,
    validateSeries, type Fixture } from '../../../resources/ts/simulator';
import { gprSeedRequest } from '../../../scripts/seed-snapshot';

const fixture = (bestOf: 1 | 3 | 5, winner = 'a'): Extract<Fixture, { status: 'decided' }> => ({ id: 'pick', stage: 'swiss', round: 3, slot: 1,
    teamA: 'a', teamB: 'b', bestOf, status: 'decided', winner });

describe('winner-only constraints', () => {
    it('samples legal scores conditional on either winner, matching exact stationary score distributions', () => {
        const n = 15000;
        for (const p of [0.2, 0.5, 0.8]) {
            const logs = { a: Math.log(p), b: Math.log1p(-p) };
            for (const bestOf of [3, 5] as const) for (const winner of ['a', 'b']) {
                const target = (bestOf + 1) / 2;
                const q = winner === 'a' ? p : 1 - p;
                const masses = bestOf === 3 ? [q ** 2, 2 * q ** 2 * (1 - q)]
                    : [q ** 3, 3 * q ** 3 * (1 - q), 6 * q ** 3 * (1 - q) ** 2];
                const total = masses.reduce((a, b) => a + b, 0);
                const counts = Array(target).fill(0) as number[];
                const rng = createRandom(42);
                let invalidSamples = 0;
                for (let i = 0; i < n; i++) {
                    const match = playWinnerConstrainedSeries(fixture(bestOf, winner), logs, rng);
                    if (match.winner !== winner || (winner === 'a' ? match.score.a : match.score.b) !== target
                        || match.games!.at(-1) !== winner || match.games!.length !== match.score.a + match.score.b) invalidSamples++;
                    counts[winner === 'a' ? match.score.b : match.score.a]!++;
                }
                expect(invalidSamples).toBe(0);
                for (let k = 0; k < target; k++) {
                    const expected = masses[k]! / total;
                    expect(Math.abs(counts[k]! / n - expected)).toBeLessThan(5 * Math.sqrt(expected * (1 - expected) / n));
                }
            }
        }
    });

    it('preserves known prefixes, supports extremely rare winners in log space and rejects impossible support', () => {
        const prefix = { ...fixture(3), games: ['b'] };
        const result = playWinnerConstrainedSeries(prefix, gprGameLogProbabilities(0, 200000), createRandom(42));
        expect(result.games).toEqual(['b', 'a', 'a']);
        expect(result.simulatedGames).toBe(2);
        expect(result.origin).toBe('constrained');
        expect(() => playWinnerConstrainedSeries(fixture(3), { a: -Infinity, b: 0 }, createRandom(42))).toThrow('invalid_constraints');
        expect(() => validateSeries({ ...fixture(3), winner: 'foreign' })).toThrow('invalid_score');
        expect(() => validateSeries({ ...fixture(3), score: { a: 2, b: 0 } } as unknown as Fixture)).toThrow('invalid_score');
    });

    it('keeps series winner picks separate from observed scores and records the execution version', () => {
        const request = gprSeedRequest(30, 42);
        const original = runSimulations(request).example;
        const bo3 = original.matches.find((m) => m.stage === 'swiss' && m.bestOf === 3)!;
        const fixtures: Fixture[] = original.matches.filter((m) => m.stage === 'swiss' && m.round < bo3.round);
        fixtures.push({ id: bo3.id, stage: bo3.stage, round: bo3.round, slot: bo3.slot, teamA: bo3.teamA,
            teamB: bo3.teamB, bestOf: 3, status: 'decided', winner: bo3.teamA });
        const output = runSimulations({ ...request, scenario: { mode: 'custom', fixtures } });
        expect(output.example.matches.find((m) => m.id === bo3.id)).toMatchObject({ winner: bo3.teamA, origin: 'constrained' });
        expect(fixtures.at(-1)).not.toHaveProperty('score');
        expect(output.metadata.model).toMatchObject({ engineVersion: 'swiss16-gpr-winner-constraints-v1',
            hypothetical: true, winnerConstraints: 'stationary-log-doob-v1' });
        expect(runSimulations(output.metadata.request)).toEqual(output);
        expect(() => runSimulations({ ...request, scenario: { mode: 'custom', fixtures }, preset: 'contextual_v1',
            contextualTerms: { tournamentForm: true, seriesForm: true, pressure: true, sequence: true } })).toThrow('unsupported_model');
    });
});

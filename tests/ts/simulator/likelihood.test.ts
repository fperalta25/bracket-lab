import { describe, expect, it } from 'vitest';
import { gprGameLogProbabilities, gprGameProbability, seriesLogLikelihood, type Fixture,
    type SeriesGameState, type GameLogProbabilities } from '../../../resources/ts/simulator';

const fixture = (bestOf: 1 | 3 | 5, a: number, b: number): Fixture => ({ id: 'observed', stage: 'swiss', round: 3,
    slot: 1, teamA: 'a', teamB: 'b', bestOf, status: 'completed', score: { a, b } });
const fixed = (p: number): GameLogProbabilities => ({ a: Math.log(p), b: Math.log1p(-p) });

// Independent exhaustive paths, using ordinary probability products rather than log-DP.
function enumerate(bestOf: 1 | 3 | 5, probability: (state: SeriesGameState) => GameLogProbabilities) {
    const paths: { games: string[]; a: number; b: number; probability: number }[] = [];
    const target = (bestOf + 1) / 2;
    const visit = (games: string[], a: number, b: number, mass: number): void => {
        if (a === target || b === target) { paths.push({ games, a, b, probability: mass }); return; }
        const logs = probability({ a, b, previousWinner: games.at(-1) });
        visit([...games, 'a'], a + 1, b, mass * Math.exp(logs.a));
        visit([...games, 'b'], a, b + 1, mass * Math.exp(logs.b));
    };
    visit([], 0, 0, 1);
    return paths;
}

const choose = (n: number, k: number): number => {
    let value = 1;
    for (let i = 1; i <= k; i++) value *= (n - i + 1) / i;
    return value;
};

describe('stable Elo log probabilities', () => {
    it('agrees with game probabilities, symmetry and normalization across the supported D range', () => {
        for (const d of [200, 320, 400, 520, 800]) {
            for (let a = -10000; a <= 10000; a += 137) {
                const logs = gprGameLogProbabilities(a, 1400, d);
                const reversed = gprGameLogProbabilities(1400, a, d);
                expect(Math.exp(logs.a)).toBeCloseTo(gprGameProbability(a, 1400, d), 14);
                expect(Math.exp(logs.a) + Math.exp(logs.b)).toBeCloseTo(1, 14);
                expect(logs.a).toBe(reversed.b);
                expect(logs.b).toBe(reversed.a);
            }
        }
        expect(gprGameLogProbabilities(1400, 1400)).toEqual({ a: -Math.LN2, b: -Math.LN2 });
        expect(gprGameLogProbabilities(1800, 1400).a).toBeCloseTo(Math.log(10 / 11), 14);
    });

    it('retains log evidence after probability rounding or underflow and validates finite inputs', () => {
        expect(gprGameProbability(200000, 0)).toBe(1);
        expect(gprGameProbability(0, 200000)).toBe(0);
        const logs = gprGameLogProbabilities(200000, 0);
        expect(Number.isFinite(logs.b)).toBe(true);
        expect(logs.b).toBeCloseTo(-500 * Math.LN10, 10);
        expect(gprGameLogProbabilities(Number.MAX_VALUE, -Number.MAX_VALUE)).toEqual({ a: -0, b: -Infinity });
        for (const a of [NaN, Infinity, -Infinity]) expect(() => gprGameLogProbabilities(a, 1400)).toThrow('invalid_request');
        for (const d of [199, 801, NaN]) expect(() => gprGameLogProbabilities(1400, 1400, d)).toThrow('invalid_request');
    });
});

describe('observed series likelihood', () => {
    it('matches closed-form score probabilities for every Bo1/Bo3/Bo5 terminal score', () => {
        for (const p of [0.02, 0.2, 0.5, 0.8, 0.98]) {
            for (const bestOf of [1, 3, 5] as const) {
                const target = (bestOf + 1) / 2;
                let sum = 0;
                for (let loser = 0; loser < target; loser++) {
                    for (const [a, b] of [[target, loser], [loser, target]]) {
                        const expected = choose(target + loser - 1, loser) * p ** a! * (1 - p) ** b!;
                        const actual = Math.exp(seriesLogLikelihood(fixture(bestOf, a!, b!), fixed(p)));
                        expect(actual).toBeCloseTo(expected, 14);
                        sum += actual;
                    }
                }
                expect(sum).toBeCloseTo(1, 14);
            }
        }
    });

    it('sums exactly the legal per-game orders under score- and previous-winner-dependent effects', () => {
        const probability = (state: SeriesGameState) => gprGameLogProbabilities(
            1400 + state.a * 11 + (state.previousWinner === 'a' ? 37 : state.previousWinner === 'b' ? -19 : 0),
            1350 + state.b * 17);
        for (const bestOf of [1, 3, 5] as const) {
            const paths = enumerate(bestOf, probability);
            const scores = new Set(paths.map((path) => `${path.a}:${path.b}`));
            let total = 0;
            for (const score of scores) {
                const [a, b] = score.split(':').map(Number);
                const matching = paths.filter((path) => path.a === a && path.b === b);
                const expected = matching.reduce((sum, path) => sum + path.probability, 0);
                const logLikelihood = seriesLogLikelihood(fixture(bestOf, a!, b!), probability);
                expect(Math.exp(logLikelihood)).toBeCloseTo(expected, 14);
                total += Math.exp(logLikelihood);
                for (const path of matching) {
                    expect(Math.exp(seriesLogLikelihood({ ...fixture(bestOf, a!, b!), games: path.games }, probability)))
                        .toBeCloseTo(path.probability, 14);
                }
            }
            expect(total).toBeCloseTo(1, 14);
        }
    });

    it('distinguishes an observed order from a score and never adds fictional games', () => {
        const f = fixture(3, 2, 1);
        expect(Math.exp(seriesLogLikelihood(f, fixed(0.7)))).toBeCloseTo(2 * 0.7 ** 2 * 0.3, 14);
        expect(Math.exp(seriesLogLikelihood({ ...f, games: ['a', 'b', 'a'] }, fixed(0.7)))).toBeCloseTo(0.7 ** 2 * 0.3, 14);
        expect(f.games).toBeUndefined();
        expect(() => seriesLogLikelihood({ ...f, games: ['a', 'a', 'b'] }, fixed(0.7))).toThrow('invalid_score');
    });

    it('uses only an observed prefix, with no contribution from future games or fixture selection', () => {
        const pending: Fixture = { id: 'pending', stage: 'final', round: 3, slot: 1, teamA: 'a', teamB: 'b',
            bestOf: 5, status: 'scheduled' };
        let calls = 0;
        const probability = () => { calls++; return fixed(0.7); };
        expect(seriesLogLikelihood(pending, probability)).toBe(0);
        expect(calls).toBe(0);
        const prefix = { ...pending, games: ['b', 'a', 'b'] };
        expect(seriesLogLikelihood(prefix, probability)).toBeCloseTo(2 * Math.log(0.3) + Math.log(0.7), 14);
        expect(calls).toBe(3);
        expect(seriesLogLikelihood({ ...prefix, id: 'different-draw', round: 4, slot: 2 }, probability))
            .toBe(seriesLogLikelihood(prefix, probability));
    });

    it('preserves impossible evidence and finite tiny likelihoods in log space', () => {
        expect(seriesLogLikelihood(fixture(3, 0, 2), fixed(1))).toBe(-Infinity);
        expect(seriesLogLikelihood(fixture(3, 2, 0), fixed(1))).toBe(0);
        expect(seriesLogLikelihood(fixture(3, 2, 0), fixed(0))).toBe(-Infinity);
        const result = seriesLogLikelihood(fixture(5, 3, 2), gprGameLogProbabilities(0, 200000));
        expect(Number.isFinite(result)).toBe(true);
        expect(result).toBeLessThan(-3000);
        expect(Math.exp(result)).toBe(0);
    });

    it('rejects invalid scores and non-normalized, NaN or positive log probabilities', () => {
        expect(() => seriesLogLikelihood(fixture(3, 1, 1), fixed(0.5))).toThrow('invalid_score');
        for (const logs of [{ a: NaN, b: 0 }, { a: 0, b: 0 }, { a: -Infinity, b: -Infinity },
            { a: 0.01, b: -10 }, { a: Infinity, b: -Infinity }]) {
            expect(() => seriesLogLikelihood(fixture(1, 1, 0), logs)).toThrow('invalid_request');
        }
    });
});

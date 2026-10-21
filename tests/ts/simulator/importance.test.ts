import { describe, expect, it } from 'vitest';
import { gprGameLogProbabilities, normalizeLogWeights, seriesLogLikelihood, type Fixture } from '../../../resources/ts/simulator';

const upset: Fixture = { id: 'known', stage: 'swiss', round: 1, slot: 1,
    teamA: 'underdog', teamB: 'favorite', bestOf: 1, status: 'completed', score: { a: 1, b: 0 } };

describe('importance weights and effective sample size', () => {
    it('normalizes known ratios and reports the exact ESS, largest mass and mean unnormalized weight', () => {
        const result = normalizeLogWeights([Math.log(1), Math.log(2), Math.log(3)], 2);
        for (const [i, expected] of [1 / 6, 2 / 6, 3 / 6].entries()) expect(result.weights[i]).toBeCloseTo(expected, 14);
        expect(result.ess).toBeCloseTo(36 / 14, 14);
        expect(result.essFraction).toBeCloseTo(12 / 14, 14);
        expect(result.maxWeight).toBeCloseTo(0.5, 14);
        expect(result.logMeanWeight).toBeCloseTo(Math.log(2), 14);
        expect(result.status).toBe('sufficient_ess');
        expect(result.minEss).toBe(2);
    });

    it('is invariant to common log offsets and preserves uniform support after ordinary probabilities underflow', () => {
        const base = normalizeLogWeights([-1000, -1001, -1002], 2);
        const shifted = normalizeLogWeights([0, -1, -2], 2);
        expect(base.weights).toEqual(shifted.weights);
        expect(base.ess).toBe(shifted.ess);
        expect(base.logMeanWeight).toBeCloseTo(shifted.logMeanWeight - 1000, 12);
        for (const n of [1, 3, 10, 100]) {
            const uniform = normalizeLogWeights(Array(n).fill(-1e10), n);
            expect(uniform.weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 14);
            expect(uniform.ess).toBe(n);
            expect(uniform.status).toBe('sufficient_ess');
        }
    });

    it('flags weight collapse instead of reporting a successful conditioned estimate', () => {
        const result = normalizeLogWeights([3000 * Math.log(0.1), 3000 * Math.log(0.9)], 2);
        expect(result.ess).toBe(1);
        expect(result.maxWeight).toBe(1);
        expect(result.status).toBe('insufficient_ess');
        expect(result.weights).toEqual([0, 1]);
    });

    it('keeps zero sample support distinct from a valid uniform distribution or impossible global evidence', () => {
        const result = normalizeLogWeights([-Infinity, -Infinity], 1);
        expect(result).toEqual({ weights: [0, 0], ess: 0, essFraction: 0, maxWeight: 0,
            logMeanWeight: -Infinity, minEss: 1, status: 'zero_sample_support' });
        expect(normalizeLogWeights([-Infinity, 0, -Infinity], 2).status).toBe('insufficient_ess');
    });

    it('matches exact Bayes for a two-state toy prior after an unexpected observed win', () => {
        const minus = gprGameLogProbabilities(1100, 1400);
        const plus = gprGameLogProbabilities(1300, 1400);
        const logs = [minus, plus].map((p) => seriesLogLikelihood(upset, p));
        const result = normalizeLogWeights(logs, 1);
        const pMinus = Math.exp(minus.a);
        const pPlus = Math.exp(plus.a);
        const exactPositivePosterior = pPlus / (pPlus + pMinus);
        expect(result.weights[1]).toBeCloseTo(exactPositivePosterior, 14);
        expect(result.weights[1]).toBeGreaterThan(0.5);
        const predictive = result.weights[0]! * pMinus + result.weights[1]! * pPlus;
        expect(predictive).toBeCloseTo((pMinus ** 2 + pPlus ** 2) / (pMinus + pPlus), 14);
        expect(predictive).toBeGreaterThan((pMinus + pPlus) / 2);
        expect(Math.exp(result.logMeanWeight)).toBeCloseTo((pMinus + pPlus) / 2, 14);
    });

    it('rejects invalid weights and demands an explicit valid ESS threshold', () => {
        for (const weights of [[], [NaN], [Infinity], [0, undefined], Array(3)]) {
            expect(() => normalizeLogWeights(weights as number[], 1)).toThrow('invalid_request');
        }
        for (const threshold of [undefined, NaN, Infinity, 0, 3]) {
            expect(() => normalizeLogWeights([0, 0], threshold as number)).toThrow('invalid_request');
        }
    });
});

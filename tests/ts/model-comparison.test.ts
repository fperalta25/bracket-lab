import { describe, expect, it } from 'vitest';
import { comparisonRequests, validateComparison, comparisonCount, differenceMargin } from '../../resources/ts/public/comparison';
import { runSimulations, type ContextualTerms, type GprSimulationRequest } from '../../resources/ts/simulator';
import { gprSeedRequest } from '../../scripts/seed-snapshot';

const terms: ContextualTerms = { tournamentForm: true, seriesForm: true, pressure: true, sequence: true };
const requests = comparisonRequests(gprSeedRequest(20), terms);
const comparison = { baseline: runSimulations(requests[0]), contextual: runSimulations(requests[1]) };

describe('public model comparison', () => {
    it('keeps seed, N, dated profiles, fixtures, overrides and calendar identical without mutating input', () => {
        const request = { ...gprSeedRequest(10), preset: 'contextual_v1' as const, denominator: 320,
            gprOverrides: { [requests[0].snapshot.teams[0]!.id]: 1500 }, contextualTerms: terms };
        const original = structuredClone(request);
        const [base, contextual] = comparisonRequests(request, terms);
        expect(base.preset).toBe('gpr_baseline');
        expect(base.contextualTerms).toBeUndefined();
        expect(contextual.preset).toBe('contextual_experimental_v2');
        expect(contextual.contextualTerms).toEqual(terms);
        const { preset: _a, contextualTerms: _b, ...left } = base;
        const { preset: _c, contextualTerms: _d, ...right } = contextual;
        expect(left).toEqual(right);
        expect(request).toEqual(original);
    });
    it('is reproducible and agrees with standalone runs of both models', () => {
        expect(() => validateComparison(comparison)).not.toThrow();
        expect(runSimulations(requests[0])).toEqual(comparison.baseline);
        expect(runSimulations(requests[1])).toEqual(comparison.contextual);
        expect(requests[0].preset).toBe('gpr_baseline');
    });
    it('preserves imported term switches', () => {
        const disabled = { tournamentForm: false, seriesForm: false, pressure: false, sequence: false };
        expect(comparisonRequests(requests[0], disabled)[1].contextualTerms).toEqual(disabled);
    });
    it('rejects fixed results rather than silently discarding them', () => {
        const original = requests[0].snapshot.fixtures[0]!;
        const request: GprSimulationRequest = { ...requests[0], scenario: { mode: 'custom', fixtures: [
            { ...original, status: 'completed', score: { a: 1, b: 0 } },
        ] } };
        expect(() => comparisonRequests(request, terms)).toThrow('unsupported_model');
        expect(request.scenario).toEqual({ mode: 'custom', fixtures: [{ ...original, status: 'completed', score: { a: 1, b: 0 } }] });
        expect(() => comparisonRequests({ ...request, scenario: { mode: 'from_scratch' } }, terms)).not.toThrow();
    });
    it('keeps aggregate qualification and champion counts on the same denominator', () => {
        for (const output of Object.values(comparison)) {
            const ids = output.metadata.request.snapshot.teams.map((team) => team.id);
            expect(ids.reduce((sum, id) => sum+comparisonCount(output,id,'qualify'),0)).toBe(8*20);
            expect(ids.reduce((sum, id) => sum+comparisonCount(output,id,'champion'),0)).toBe(20);
        }
    });
    it('rejects different seeds, iterations, snapshots, profiles or denominators', () => {
        for (const patch of [{ seed: 7 }, { iterations: 21 }, { denominator: 320 },
            { snapshot: { ...requests[1].snapshot, revision: 3 } },
            { strengths: { ...requests[1].strengths, revision: 999 } }]) {
            const pair = structuredClone(comparison);
            Object.assign(pair.contextual.metadata.request, patch);
            expect(() => validateComparison(pair)).toThrow();
        }
    });
    it('rejects incomplete or invalid counts and swapped models', () => {
        for (const mutate of [
            (pair: typeof comparison) => { pair.contextual.aggregates.completedIterations--; },
            (pair: typeof comparison) => { pair.baseline.aggregates.teams[requests[0].snapshot.teams[0]!.id]!.finishCounts.champion = NaN; },
            (pair: typeof comparison) => { pair.contextual = pair.baseline; },
        ]) {
            const pair = structuredClone(comparison); mutate(pair);
            expect(() => validateComparison(pair)).toThrow();
        }
    });
    it('restores a pair after JSON serialization and ignores property order', () => {
        const pair = JSON.parse(JSON.stringify(comparison));
        pair.contextual.metadata.request.snapshot = Object.fromEntries(Object.entries(pair.contextual.metadata.request.snapshot).reverse());
        expect(() => validateComparison(pair)).not.toThrow();
    });
    it('uses a finite conservative difference bound without assuming independent model outputs', () => {
        const margin = differenceMargin(10000);
        expect(margin).toBeCloseTo(0.0296041437, 7);
        const epsilon = margin/2;
        expect(4*Math.exp(-2*10000*epsilon**2)).toBeCloseTo(.05, 12);
        expect(differenceMargin(40000)).toBeCloseTo(margin/2);
        expect(differenceMargin(1)).toBe(1);
        for (const n of [0,-1,NaN,1.5]) expect(() => differenceMargin(n)).toThrow();
    });
});

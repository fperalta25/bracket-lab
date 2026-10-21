import { describe, expect, it } from 'vitest';
import { gprSeedRequest, seedSnapshot } from '../../../scripts/seed-snapshot';
import { createSimulationRunner, runSimulations, type SimulationRequest } from '../../../resources/ts/simulator';

const base = gprSeedRequest(11, 42);
const requests: SimulationRequest[] = [base, { ...base, preset: 'contextual_v1', contextualTerms: {
    tournamentForm: true, seriesForm: true, pressure: true, sequence: true,
} }, { modelVersion: 'legacy-score-v1', snapshot: seedSnapshot(), scenario: { mode: 'official_state' },
    variance: 'normal', iterations: 11, seed: 42 }];

describe('incremental tournament execution', () => {
    it.each(requests)('matches synchronous execution exactly for $modelVersion / $preset', (request) => {
        const runner = createSimulationRunner(request);
        expect(() => runner.result()).toThrow('invalid_request');
        expect(runner.advance(1)).toBe(1);
        expect(runner.advance(3)).toBe(4);
        expect(runner.advance(100)).toBe(11);
        expect(runner.result()).toEqual(runSimulations(request));
        expect(runner.advance(100)).toBe(11);
        expect(runner.result()).toEqual(runSimulations(request));
    });

    it('does not publish partial runs and starts again from the original seed after cancellation', () => {
        const partial = createSimulationRunner(base);
        partial.advance(3);
        expect(() => partial.result()).toThrow('invalid_request');
        const fresh = createSimulationRunner(base);
        fresh.advance(11);
        expect(fresh.result()).toEqual(runSimulations(base));
        for (const size of [0, -1, 1.5, 1001, NaN]) expect(() => fresh.advance(size)).toThrow('invalid_request');
    });
});

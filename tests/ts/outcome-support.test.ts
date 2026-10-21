import { describe, expect, it } from 'vitest';
import { gprSeedRequest } from '../../scripts/seed-snapshot';
import { runSimulations, type GprSimulationRequest, type Fixture } from '../../resources/ts/simulator';
import { outcomeSupport } from '../../resources/ts/public/outcome-support';
import { probabilityText } from '../../resources/ts/public/presentation';

function requestWith(fixtures: readonly Fixture[]): GprSimulationRequest {
    const r = gprSeedRequest(1, 42); return { ...r, scenario: { mode: 'custom', fixtures } };
}

describe('structural zero probabilities', () => {
    it('distinguishes impossible outcomes from unobserved possible outcomes in both languages', () => {
        expect(probabilityText(0, 10000, 'en', true)).toBe('0%');
        expect(probabilityText(0, 10000, 'es', true)).toMatch(/^0\s%$/);
        expect(probabilityText(0, 10000, 'en')).toBe('<0.03%');
        expect(probabilityText(1, 10000, 'en', true)).not.toBe('0%');
    });
    it('uses fixed Swiss wins and losses without confusing from-scratch with the official state', () => {
        const r = gprSeedRequest(1, 42);
        const f = r.snapshot.fixtures[0]!;
        const fixed: Fixture = { ...f, status: 'decided', winner: f.teamA, score: undefined };
        const request = requestWith([fixed]);
        const support = outcomeSupport(request);
        expect(support[f.teamA]!.swiss.has('0-3')).toBe(false);
        expect(support[f.teamA]!.final.has('15_16')).toBe(false);
        expect(support[f.teamB]!.swiss.has('3-0')).toBe(false);
        expect(support[f.teamB]!.final.has('champion')).toBe(true);
        const official = { ...r, snapshot: { ...r.snapshot, fixtures: [fixed] }, scenario: { mode: 'official_state' } as const };
        expect(outcomeSupport(official)).toEqual(support);
        expect(outcomeSupport({ ...official, scenario: { mode: 'from_scratch' } })[f.teamB]!.swiss.has('3-0')).toBe(true);
    });
    it('matches every fixed record and final placement, including partial knockout progress', () => {
        const output = runSimulations(gprSeedRequest(1, 42));
        const matches = output.example.matches;
        const support = outcomeSupport(requestWith(matches));
        for (const [id, record] of Object.entries(output.example.swissRecords)) {
            expect([...support[id]!.swiss]).toEqual([record]);
            expect([...support[id]!.final]).toEqual([output.example.finishes[id]]);
            expect(support[id]!.qualify).toBe(record.startsWith('3-'));
        }
        const quarter = matches.find((m) => m.stage === 'quarterfinal')!;
        const partial = outcomeSupport(requestWith(matches.filter((m) => m.stage === 'swiss' || m.id === quarter.id)));
        expect(partial[quarter.winner]!.final.has('quarterfinalist')).toBe(false);
        expect(partial[quarter.winner]!.final.has('champion')).toBe(true);
        const loser = quarter.winner === quarter.teamA ? quarter.teamB : quarter.teamA;
        expect([...partial[loser]!.final]).toEqual(['quarterfinalist']);
    });
    it('never rules out an outcome that appears in a simulated completion of partial constraints', () => {
        const played = runSimulations(gprSeedRequest(1, 42)).example.matches;
        for (const round of [0, 1, 2, 3, 4, 5]) {
            const request = { ...requestWith(played.filter((f) => f.stage === 'swiss' && f.round <= round)), iterations: 100 };
            const support = outcomeSupport(request);
            const output = runSimulations(request);
            for (const [id, aggregate] of Object.entries(output.aggregates.teams)) {
                for (const [record, count] of Object.entries(aggregate.swissRecordCounts)) if (count) expect(support[id]!.swiss.has(record)).toBe(true);
                for (const [bucket, count] of Object.entries(aggregate.finishCounts)) if (count) expect(support[id]!.final.has(bucket as keyof typeof aggregate.finishCounts)).toBe(true);
            }
        }
    });
});

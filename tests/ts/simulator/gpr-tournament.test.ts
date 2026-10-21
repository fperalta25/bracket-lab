import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { gprSeedRequest, seedSnapshot } from '../../../scripts/seed-snapshot';
import { FINAL_BUCKETS, SWISS_RECORDS, gprGameProbability, prepareSimulation, runSimulations,
    type Fixture, type SimulationRequest } from '../../../resources/ts/simulator';

describe('GPR baseline integration and compatibility', () => {
    it('keeps the existing legacy tournament bit-for-bit when explicitly versioned', () => {
        const { aggregates, example } = runSimulations({ modelVersion: 'legacy-score-v1', snapshot: seedSnapshot(),
            scenario: { mode: 'official_state' }, variance: 'normal', iterations: 10, seed: 42 });
        // Captured from the unmodified phase-one engine, before adding GPR support.
        expect(createHash('sha256').update(JSON.stringify({ aggregates, example })).digest('hex'))
            .toBe('8583e6d8e2f021f715c1817e8dddb1a64758983126580e05a9d559fac7e06dc4');
    });

    it('pins the keyed GPR engine output to its recorded version', () => {
        const { aggregates, example } = runSimulations(gprSeedRequest(10, 42));
        expect(createHash('sha256').update(JSON.stringify({ aggregates, example })).digest('hex'))
            .toBe('b5a0987c12e58b01c2c55d1645122afe9f1a0f5f8771dec97880caf76dabf4fc');
    });

    it('rejects unversioned, mixed and unsupported contextual requests without reinterpretation', () => {
        const legacy = { snapshot: seedSnapshot(), scenario: { mode: 'official_state' }, variance: 'normal', iterations: 1, seed: 42 };
        expect(() => runSimulations(legacy as SimulationRequest)).toThrow('incompatible_model');
        expect(() => runSimulations({ ...gprSeedRequest(), powerScores: { x: 50 } } as unknown as SimulationRequest)).toThrow('incompatible_model');
        expect(() => runSimulations({ ...gprSeedRequest(), preset: 'contextual_v1' } as unknown as SimulationRequest)).toThrow('unsupported_model');
        expect(() => runSimulations({ ...gprSeedRequest(), strengths: undefined } as unknown as SimulationRequest)).toThrow('invalid_request');
    });

    it('uses only GPR even when stored experimental sigma, pressure and TES context are nonzero', () => {
        const request = gprSeedRequest(30);
        const prepared = prepareSimulation(request);
        const hle = request.snapshot.teams.find((team) => team.acronym === 'HLE')!.id;
        const tes = request.snapshot.teams.find((team) => team.acronym === 'TES')!.id;
        expect(prepared.probabilities.get(hle)!.get(tes)).toBe(gprGameProbability(1540, 1364));
        const neutral = { ...request, strengths: { ...request.strengths, profiles: request.strengths.profiles.map((profile) => ({ ...profile,
            sigmaTournament: 0, sigmaSeries: 0, pressureElo: 0, afterWinElo: 0, afterLossElo: 0,
            contextAdjustment: { ...profile.contextAdjustment, elo: 0 },
        })) } };
        const first = runSimulations(request);
        const second = runSimulations(neutral);
        expect(first.aggregates).toEqual(second.aggregates);
        expect(first.example).toEqual(second.example);
        expect(first.metadata.model).toMatchObject({ modelVersion: 'gpr-context-v2', preset: 'gpr_baseline',
            denominator: 400, calibration: { status: 'provisional', calibrationId: null }, hypothetical: false,
            enabledTerms: { context: false, tournamentForm: false, seriesForm: false, pressure: false, sequence: false } });
        expect(first.metadata.request).toEqual(prepareSimulation(request).request);
    });

    it('retains exact tournament invariants and reproduces a result from its full manifest', () => {
        const result = runSimulations(gprSeedRequest(200));
        const teams = Object.values(result.aggregates.teams);
        expect(result.example.matches).toHaveLength(40);
        expect(FINAL_BUCKETS.map((bucket) => teams.reduce((sum, team) => sum + team.finishCounts[bucket], 0)))
            .toEqual([1, 1, 2, 4, 3, 3, 2].map((count) => count * 200));
        expect(SWISS_RECORDS.map((record) => teams.reduce((sum, team) => sum + team.swissRecordCounts[record], 0)))
            .toEqual([2, 3, 3, 3, 3, 2].map((count) => count * 200));
        expect(runSimulations(result.metadata.request)).toEqual(result);
    });

    it('labels explicit denominator and rating overrides as hypothetical without changing the frozen profiles', () => {
        const request = gprSeedRequest(2);
        const id = request.snapshot.teams[0]!.id;
        const result = runSimulations({ ...request, denominator: 520, gprOverrides: { [id]: 1800 } });
        expect(result.metadata.model).toMatchObject({ hypothetical: true, denominator: 520, effectiveRatings: { [id]: 1800 } });
        expect(request.strengths.profiles.find((profile) => profile.teamId === id)!.gpr).not.toBe(1800);
        for (const value of [-1, NaN, Infinity, 5001]) expect(() => runSimulations({ ...request, gprOverrides: { [id]: value } })).toThrow('invalid_request');
    });

    it('never resimulates a fully fixed official tournament under changed ratings, D or seed', () => {
        const request = gprSeedRequest(1);
        const original = runSimulations(request).example;
        const fixtures: Fixture[] = original.matches.map(({ origin: _origin, winner: _winner, simulatedGames: _games, ...fixture }) => fixture);
        const fixed = { ...request, snapshot: { ...request.snapshot, fixtures } };
        const overrides = Object.fromEntries(request.snapshot.teams.map((team, i) => [team.id, i % 2 ? 1000 : 2000]));
        const result = runSimulations({ ...fixed, gprOverrides: overrides, denominator: 800, seed: 19, iterations: 3 });
        expect(result.example.finishes).toEqual(original.finishes);
        expect(result.example.swissRecords).toEqual(original.swissRecords);
        expect(result.example.matches.every((match) => match.origin === 'fixed' && match.simulatedGames === 0)).toBe(true);
        expect(Object.values(result.aggregates.teams).every((team) => team.simulatedGames === 0)).toBe(true);
    });
});

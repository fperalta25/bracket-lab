import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { gprSeedRequest } from '../../../scripts/seed-snapshot';
import { createContextualProbabilities, createRandom, createTournamentRandom, gprGameProbability, playSeries,
    pressureIntensity, runSimulations, sequenceAdjustment, standardNormal, FINAL_BUCKETS, SWISS_RECORDS,
    createAggregates, accumulate, prepareSimulation, simulateTournament, type ContextualTerms, type Fixture, type GprSimulationRequest, type SeriesGameState } from '../../../resources/ts/simulator';

const disabled: ContextualTerms = { tournamentForm: false, seriesForm: false, pressure: false, sequence: false };
const enabled: ContextualTerms = { tournamentForm: true, seriesForm: true, pressure: true, sequence: true };
const contextual = (iterations = 10): GprSimulationRequest => ({ ...gprSeedRequest(iterations),
    preset: 'contextual_v1', contextualTerms: enabled });
const fixture = (bestOf: 1 | 3 | 5 = 3): Fixture => ({ id: 's', stage: bestOf === 5 ? 'final' : 'swiss',
    round: 3, slot: 1, teamA: 'a', teamB: 'b', bestOf, status: 'scheduled' });
const initial: SeriesGameState = { a: 0, b: 0, previousWinner: undefined };

describe('experimental contextual form', () => {
    it('samples a zero-mean Gaussian with unit variance, finite endpoints and untruncated tails', () => {
        const rng = createRandom(2026);
        const n = 100000;
        let sum = 0; let squares = 0; let tail = 0;
        for (let i = 0; i < n; i++) {
            const z = standardNormal(rng);
            sum += z; squares += z * z; tail += Number(Math.abs(z) > 3);
        }
        // Five-SE tolerances for mean and variance of independent standard normals.
        expect(Math.abs(sum / n)).toBeLessThan(5 / Math.sqrt(n));
        expect(Math.abs(squares / n - (sum / n) ** 2 - 1)).toBeLessThan(5 * Math.sqrt(2 / n));
        expect(Math.abs(tail / n - 0.002699796)).toBeLessThan(5 * Math.sqrt(0.002699796 / n));
        expect(Number.isFinite(standardNormal({ next: () => 0 }))).toBe(true);
        expect(Number.isFinite(standardNormal({ next: () => 1 - 2 ** -32 }))).toBe(true);
        for (const value of [NaN, Infinity, -0.1, 1]) expect(() => standardNormal({ next: () => value })).toThrow('invalid_request');
    });

    it('is exactly baseline with disabled terms or neutral coefficients under aligned streams', () => {
        const base = gprSeedRequest(100);
        const reference = runSimulations(base);
        const variants = [
            { ...base, preset: 'contextual_v1', contextualTerms: disabled },
            { ...contextual(100), strengths: { ...base.strengths, profiles: base.strengths.profiles.map((p) => ({ ...p,
                sigmaTournament: 0, sigmaSeries: 0, pressureElo: 0, afterWinElo: 0, afterLossElo: 0 })) } },
        ] as const;
        for (const variant of variants) {
            const result = runSimulations(variant);
            expect(result.example).toEqual(reference.example);
            expect(result.aggregates).toEqual(reference.aggregates);
        }
    });

    it('draws tournament form once/team, series form once/team/series and reuses it across games', () => {
        const request = { ...contextual(1), contextualTerms: { ...enabled, pressure: false, sequence: false } };
        const rng = createTournamentRandom(42, 0);
        const stream = vi.spyOn(rng, 'stream');
        const ratings = Object.fromEntries(request.strengths.profiles.map((p) => [p.teamId, p.gpr]));
        const series = createContextualProbabilities(request, ratings, rng);
        expect(stream.mock.calls.filter(([family]) => family === 'tournament_form')).toHaveLength(16);
        const [a, b] = request.strengths.profiles;
        const f = { ...fixture(), teamA: a!.teamId, teamB: b!.teamId };
        const probability = series(f);
        const value = probability(initial);
        expect(probability({ a: 1, b: 1, previousWinner: f.teamA })).toBe(value);
        expect(series({ ...f, id: 'renamed' })).toBe(probability);
        const normal = (family: 'tournament_form' | 'series_form', id: string) => standardNormal(createTournamentRandom(42, 0)
            .stream(family, ...(family === 'tournament_form' ? [id] : [f.stage, f.round, f.slot, f.teamA, f.teamB, id])));
        expect(value).toBe(gprGameProbability(a!.gpr + normal('tournament_form', a!.teamId) * a!.sigmaTournament
            + normal('series_form', a!.teamId) * a!.sigmaSeries,
        b!.gpr + normal('tournament_form', b!.teamId) * b!.sigmaTournament + normal('series_form', b!.teamId) * b!.sigmaSeries));
        series({ ...f, round: 4 })(initial);
        expect(stream.mock.calls.filter(([family]) => family === 'series_form')).toHaveLength(4);
        expect(stream.mock.calls.filter(([family]) => family === 'tournament_form')).toHaveLength(16);
    });

    it('uses only structural pressure, symmetrically, before each game', () => {
        expect(pressureIntensity(fixture(1), initial)).toBe(0);
        expect(pressureIntensity(fixture(3), initial)).toBe(0.5);
        expect(pressureIntensity(fixture(3), { a: 1, b: 0, previousWinner: 'a' })).toBe(0.5);
        expect(pressureIntensity(fixture(3), { a: 1, b: 1, previousWinner: 'b' })).toBe(1);
        for (const [a, b] of [[0, 0], [1, 0], [0, 2], [2, 1]]) {
            expect(pressureIntensity(fixture(5), { a: a!, b: b!, previousWinner: undefined })).toBe(0.5);
        }
        expect(pressureIntensity(fixture(5), { a: 2, b: 2, previousWinner: 'a' })).toBe(1);
    });

    it('recalculates pressure and non-compounding win/loss transitions from the previous game only', () => {
        const request = contextual(1);
        const [pa, pb] = request.strengths.profiles;
        const a = { ...pa!, pressureElo: 10, afterWinElo: 12, afterLossElo: 7 };
        const b = { ...pb!, pressureElo: 4, afterWinElo: -3, afterLossElo: 5 };
        expect(sequenceAdjustment(a, a.teamId, undefined)).toBe(0);
        expect(sequenceAdjustment(a, a.teamId, a.teamId)).toBe(12);
        expect(sequenceAdjustment(a, a.teamId, b.teamId)).toBe(7);
        const config = { ...request, contextualTerms: { ...disabled, pressure: true, sequence: true },
            strengths: { ...request.strengths, profiles: [a, b, ...request.strengths.profiles.slice(2)] } };
        const get = createContextualProbabilities(config, { [a.teamId]: 1400, [b.teamId]: 1400 }, createTournamentRandom(42, 0));
        const f = { ...fixture(5), teamA: a.teamId, teamB: b.teamId };
        const p = get(f);
        expect(p(initial)).toBe(gprGameProbability(1405, 1402));
        expect(p({ a: 1, b: 0, previousWinner: a.teamId })).toBe(gprGameProbability(1417, 1407));
        expect(p({ a: 2, b: 0, previousWinner: a.teamId })).toBe(gprGameProbability(1417, 1407));
        expect(p({ a: 2, b: 2, previousWinner: b.teamId })).toBe(gprGameProbability(1417, 1401));
        expect(get({ ...f, slot: 2 })(initial)).toBe(p(initial));
    });

    it('passes the pre-game score and prior winner, stops at target and never calls probability for fixed scores', () => {
        const states: SeriesGameState[] = [];
        const random = createRandom(42);
        const result = playSeries(fixture(3), (state) => { states.push(state); return state.a === 0 ? 0 : 1; }, random);
        expect(result.games).toEqual(['b', 'b']);
        expect(states).toEqual([initial, { a: 0, b: 1, previousWinner: 'b' }]);
        const callback = vi.fn(() => 1);
        const fixed = playSeries({ ...fixture(3), status: 'completed', score: { a: 2, b: 1 } }, callback, random);
        expect(callback).not.toHaveBeenCalled();
        expect(fixed.games).toBeUndefined();
        for (const value of [NaN, -1, 1.1]) expect(() => playSeries(fixture(), () => value, random)).toThrow('invalid_request');
    });

    it('rejects observed contextual games until posterior inference exists, including prefixes and custom scenarios', () => {
        const request = contextual(1);
        const f = request.snapshot.fixtures[0]!;
        const baseline = runSimulations(gprSeedRequest(1)).example;
        const partial = baseline.matches.find((match) => match.stage === 'swiss' && match.bestOf === 3)!;
        const history: Fixture[] = baseline.matches.filter((match) => match.stage === 'swiss' && match.round < partial.round);
        const cases: Fixture[][] = [
            [{ ...f, status: 'completed', score: { a: 1, b: 0 } }, ...request.snapshot.fixtures.slice(1)],
            [...history, { id: partial.id, stage: partial.stage, round: partial.round, slot: partial.slot,
                teamA: partial.teamA, teamB: partial.teamB, bestOf: 3, status: 'scheduled', games: [partial.teamA] }],
        ];
        for (const fixtures of cases) {
            expect(() => runSimulations({ ...request, snapshot: { ...request.snapshot, fixtures } })).toThrow('unsupported_model');
            expect(() => runSimulations({ ...request, scenario: { mode: 'custom', fixtures } })).toThrow('unsupported_model');
            expect(() => runSimulations({ ...request, snapshot: { ...request.snapshot, fixtures }, scenario: { mode: 'from_scratch' } })).not.toThrow();
        }
    });

    it('rejects malformed custom fixtures with structured validation errors', () => {
        for (const fixtures of [undefined, null, {}, [null]]) {
            expect(() => runSimulations({ ...contextual(1), scenario: { mode: 'custom', fixtures } } as unknown as GprSimulationRequest))
                .toThrow(/invalid_constraints|invalid_fixture/);
        }
    });

    it('keeps contextual runs stable across batch order, labels and input ordering', () => {
        const request = contextual(20);
        const result = runSimulations(request);
        const reordered = { ...request, snapshot: { ...request.snapshot, teams: [...request.snapshot.teams].reverse()
            .map((team, i) => ({ ...team, acronym: `TEST${i}` })) },
        strengths: { ...request.strengths, profiles: [...request.strengths.profiles].reverse() } };
        const prepared = prepareSimulation(reordered);
        const aggregates = createAggregates(request.snapshot.teams);
        for (let i = 19; i >= 0; i--) {
            const tournament = simulateTournament(prepared, createTournamentRandom(request.seed, i));
            accumulate(aggregates, tournament);
            if (i === 0) expect(tournament).toEqual(result.example);
        }
        expect(aggregates).toEqual(result.aggregates);
    });

    it('requires explicit family switches, rejects hidden fields and leaves roster adjustments inactive', () => {
        const request = contextual(1);
        for (const terms of [undefined, null, [], {}, { ...enabled, pressure: 1 }, { ...enabled, context: true }]) {
            expect(() => runSimulations({ ...request, contextualTerms: terms } as GprSimulationRequest)).toThrow('invalid_request');
        }
        expect(() => runSimulations({ ...gprSeedRequest(1), contextualTerms: enabled })).toThrow('incompatible_model');
        const profile = request.strengths.profiles[0]!;
        expect(() => runSimulations({ ...request, strengths: { ...request.strengths, profiles: [
            { ...profile, contextAdjustment: { ...profile.contextAdjustment, active: true } }, ...request.strengths.profiles.slice(1),
        ] } })).toThrow('unsupported_model');
    });

    it('preserves tournament totals and reproduces complete experimental manifests', () => {
        const result = runSimulations(contextual(200));
        const teams = Object.values(result.aggregates.teams);
        expect(FINAL_BUCKETS.map((bucket) => teams.reduce((sum, team) => sum + team.finishCounts[bucket], 0)))
            .toEqual([1, 1, 2, 4, 3, 3, 2].map((n) => n * 200));
        expect(SWISS_RECORDS.map((record) => teams.reduce((sum, team) => sum + team.swissRecordCounts[record], 0)))
            .toEqual([2, 3, 3, 3, 3, 2].map((n) => n * 200));
        expect(result.metadata.model).toMatchObject({ preset: 'contextual_v1', hypothetical: true,
            engineVersion: 'swiss16-contextual-prior-keyed-v1', enabledTerms: { context: false, ...enabled },
            contextual: { status: 'experimental', conditioning: 'prior_without_observed_games', normalSampler: 'box-muller-cos-midpoint32-v1' } });
        expect(runSimulations(result.metadata.request)).toEqual(result);
        const again = runSimulations(contextual(1));
        expect(again.example).toEqual(result.example);
        expect(createHash('sha256').update(JSON.stringify(again.example)).digest('hex')).toBe('9edb158786811bb33299c14fe27d838010a9169cae60bd1fefcd4d245c21fa0f');
    });
});

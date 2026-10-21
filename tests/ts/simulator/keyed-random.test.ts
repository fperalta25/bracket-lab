import { describe, expect, it, vi } from 'vitest';
import { gprSeedRequest } from '../../../scripts/seed-snapshot';
import { createKeyedRandom, createTournamentRandom, createRandom, prepareSimulation, simulateTournament,
    runSimulations, createAggregates, accumulate, type TournamentResult } from '../../../resources/ts/simulator';

describe('versioned event-keyed randomness', () => {
    it('matches cross-language reference vectors for JSON tuples and UTF-16LE bytes', () => {
        // Independently computed with Python's UTF-16LE encoder and 32-bit integer arithmetic.
        expect(createKeyedRandom(42, 0, 'game', 'swiss', 1, 1, 'a', 'b', 0).next()).toBe(0.3424311026465148);
        expect(createKeyedRandom(42, 17, 'pairing', 'quarterfinal').next()).toBe(0.09307985892519355);
        expect(createKeyedRandom(0, 0, 'game', 'á😀').next()).toBe(0.49328360008075833);
        expect(createKeyedRandom(42, 0, 'game', 'a', 'bc').next()).not.toBe(createKeyedRandom(42, 0, 'game', 'ab', 'c').next());
        expect(() => createKeyedRandom(42, -1, 'game')).toThrow('invalid_request');
        expect(() => createKeyedRandom(42, 0, 'game', Infinity)).toThrow('invalid_request');
    });

    it('isolates latent-form and pairing draws from game outcomes', () => {
        const streams = createTournamentRandom(2026, 7);
        const expected = streams.stream('game', 'series-key', 0).next();
        for (const family of ['pairing', 'tournament_form', 'series_form', 'posterior'] as const) {
            const stream = streams.stream(family, 'series-key');
            for (let i = 0; i < 100; i++) stream.next();
        }
        expect(streams.stream('game', 'series-key', 0).next()).toBe(expected);
        expect(streams.stream('game', 'series-key', 1).next()).not.toBe(expected);
        expect(createTournamentRandom(2026, 8).stream('game', 'series-key', 0).next()).not.toBe(expected);
    });

    it('gives identical indexed results and aggregates across batching and execution order', () => {
        const request = gprSeedRequest(20);
        const prepared = prepareSimulation(request);
        const result = runSimulations(request);
        const byIndex = new Map<number, TournamentResult>();
        const aggregates = createAggregates(request.snapshot.teams);
        for (let index = 19; index >= 0; index--) {
            const tournament = simulateTournament(prepared, createTournamentRandom(request.seed, index));
            byIndex.set(index, tournament);
            accumulate(aggregates, tournament);
        }
        expect(aggregates).toEqual(result.aggregates);
        expect(byIndex.get(0)).toEqual(result.example);
        expect(runSimulations({ ...request, iterations: 1 }).example).toEqual(result.example);
        expect(() => simulateTournament(prepared, createRandom(42))).toThrow('incompatible_model');
    });

    it('is unaffected by input team/profile order, UI language, acronym labels or global random state', () => {
        const request = gprSeedRequest(3);
        const first = runSimulations(request);
        const spy = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('ambient RNG'); });
        try {
            vi.stubGlobal('document', { documentElement: { lang: 'en' } });
            const reordered = { ...request,
                snapshot: { ...request.snapshot, teams: [...request.snapshot.teams].reverse().map((team, index) => ({ ...team, acronym: `TEAM${index}` })) },
                strengths: { ...request.strengths, profiles: [...request.strengths.profiles].reverse() },
            };
            const second = runSimulations(reordered);
            expect(second.aggregates).toEqual(first.aggregates);
            expect(second.example).toEqual(first.example);
        } finally { spy.mockRestore(); vi.unstubAllGlobals(); }
    });

    it('copies the execution configuration and makes saved manifests independent of later edits', () => {
        const request = gprSeedRequest(1);
        const prepared = prepareSimulation(request);
        const before = simulateTournament(prepared, createTournamentRandom(42, 0));
        const profile = request.strengths.profiles[0]!;
        Object.assign(profile, { gpr: profile.gpr + 200 });
        expect(simulateTournament(prepared, createTournamentRandom(42, 0))).toEqual(before);
        const output = runSimulations(prepared.request);
        expect(runSimulations(output.metadata.request)).toEqual(output);
        expect(output.metadata.model.randomness).toEqual({ algorithm: 'mulberry32-v1', hashVersion: 'fnv1a-utf16le-v1', streams: 'event-keyed-v1' });
    });
});

import { describe, expect, it, vi } from 'vitest';
import { seedSnapshot } from '../../../scripts/seed-snapshot';
import { runSimulations, createRandom, prepareSimulation, simulateTournament, SimulationError,
    createPairingSampler, FINAL_BUCKETS, SWISS_RECORDS, type Fixture, type SimulationRequest, type TournamentResult } from '../../../resources/ts/simulator';

function request(overrides: Partial<SimulationRequest> = {}): SimulationRequest {
    return { snapshot: seedSnapshot(), scenario: { mode: 'official_state' }, variance: 'normal', iterations: 10, seed: 42, ...overrides };
}

function assertTournament(result: TournamentResult): void {
    expect(result.matches).toHaveLength(40);
    expect(SWISS_RECORDS.map((record) => Object.values(result.swissRecords).filter((value) => value === record).length)).toEqual([2, 3, 3, 3, 3, 2]);
    expect(FINAL_BUCKETS.map((bucket) => Object.values(result.finishes).filter((value) => value === bucket).length)).toEqual([1, 1, 2, 4, 3, 3, 2]);
    expect(new Set(result.matches.map((match) => match.id)).size).toBe(40);
    const records = new Map(Object.keys(result.swissRecords).map((id) => [id, { wins: 0, losses: 0, opponents: new Set<string>() }]));
    for (let round = 1; round <= 5; round++) {
        const matches = result.matches.filter((match) => match.stage === 'swiss' && match.round === round);
        expect(matches).toHaveLength([8, 8, 8, 6, 3][round - 1]!);
        expect(new Set(matches.flatMap((match) => [match.teamA, match.teamB])).size).toBe(matches.length * 2);
        for (const match of matches) {
            const a = records.get(match.teamA)!;
            const b = records.get(match.teamB)!;
            expect([a.wins, a.losses]).toEqual([b.wins, b.losses]);
            expect(a.wins).toBeLessThan(3);
            expect(a.losses).toBeLessThan(3);
            expect(match.bestOf).toBe(a.wins === 2 || a.losses === 2 ? 3 : 1);
            if (a.opponents.has(match.teamB)) expect(result.rematchExceptions.some((exception) => exception.round === round && exception.record === `${a.wins}-${a.losses}`)).toBe(true);
            if (match.winner === match.teamA) { a.wins++; b.losses++; } else { b.wins++; a.losses++; }
            a.opponents.add(match.teamB); b.opponents.add(match.teamA);
        }
    }
    const quarters = result.matches.filter((match) => match.stage === 'quarterfinal');
    const undefeatedSlots = quarters.filter((match) => result.swissRecords[match.teamA] === '3-0' || result.swissRecords[match.teamB] === '3-0');
    expect(undefeatedSlots).toHaveLength(2);
    expect(Math.floor((undefeatedSlots[0]!.slot - 1) / 2)).not.toBe(Math.floor((undefeatedSlots[1]!.slot - 1) / 2));
    for (const match of undefeatedSlots) expect([result.swissRecords[match.teamA], result.swissRecords[match.teamB]].sort()).toEqual(['3-0', '3-2']);
    const semis = result.matches.filter((match) => match.stage === 'semifinal');
    expect([semis[0]!.teamA, semis[0]!.teamB].sort()).toEqual([quarters[0]!.winner, quarters[1]!.winner].sort());
    expect([semis[1]!.teamA, semis[1]!.teamB].sort()).toEqual([quarters[2]!.winner, quarters[3]!.winner].sort());
    for (const match of result.matches) {
        const target = (match.bestOf + 1) / 2;
        expect(Math.max(match.score.a, match.score.b)).toBe(target);
        expect(Math.min(match.score.a, match.score.b)).toBeLessThan(target);
        expect(match.winner).toBe(match.score.a > match.score.b ? match.teamA : match.teamB);
    }
}

function freezeDeep<T>(object: T): T {
    if (object && typeof object === 'object') {
        for (const value of Object.values(object)) freezeDeep(value);
        Object.freeze(object);
    }
    return object;
}

describe('complete tournament and aggregates', () => {
    it('satisfies all Swiss, series, bracket and final bucket invariants over many seeds', () => {
        const prepared = prepareSimulation(request());
        const random = createRandom(782);
        for (let i = 0; i < 200; i++) assertTournament(simulateTournament(prepared, random));
    });

    it('reproduces exact outputs and never mutates an official snapshot or scenario', () => {
        const input = freezeDeep(request({ iterations: 50 }));
        expect(runSimulations(input)).toEqual(runSimulations(input));
        expect(runSimulations({ ...input, seed: 43 }).example).not.toEqual(runSimulations(input).example);
        expect(runSimulations({ ...input, iterations: 1 }).example).toEqual(runSimulations(input).example);
    });

    it('does not depend on UI language or global Math.random', () => {
        const spy = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('global randomness'); });
        try {
            vi.stubGlobal('document', { documentElement: { lang: 'es' } });
            const spanish = runSimulations(request());
            vi.stubGlobal('document', { documentElement: { lang: 'en' } });
            expect(runSimulations(request())).toEqual(spanish);
        } finally {
            spy.mockRestore();
            vi.unstubAllGlobals();
        }
    });

    it('ignores official locks from scratch but preserves every official pending pairing', () => {
        const official = runSimulations(request()).example;
        const initial = seedSnapshot().fixtures;
        expect(official.matches.slice(0, 8).map((match) => [match.id, match.teamA, match.teamB])).toEqual(initial.map((match) => [match.id, match.teamA, match.teamB]));
        const scratch = runSimulations(request({ scenario: { mode: 'from_scratch' } })).example;
        expect(scratch.matches.slice(0, 8).map((match) => [match.teamA, match.teamB])).not.toEqual(initial.map((match) => [match.teamA, match.teamB]));
        assertTournament(scratch);
    });

    it('preserves fixed scores, including unknown game order, and local hypothetical edits', () => {
        const snapshot = seedSnapshot();
        const first = snapshot.fixtures[0]!;
        const completed: Fixture = { ...first, status: 'completed', score: { a: 0, b: 1 } };
        const officialRequest = request({ snapshot: { ...snapshot, fixtures: [completed, ...snapshot.fixtures.slice(1)] } });
        const official = runSimulations(officialRequest).example.matches[0]!;
        expect(official.winner).toBe(first.teamB);
        expect(official.games).toBeUndefined();
        const hypothetical: Fixture = { ...completed, score: { a: 1, b: 0 } };
        const custom = runSimulations({ ...officialRequest, scenario: { mode: 'custom', fixtures: [hypothetical] } });
        expect(custom.example.matches.find((match) => match.id === first.id)!.winner).toBe(first.teamA);
        expect(completed.score).toEqual({ a: 0, b: 1 });
    });

    it('replays a fully fixed tournament independently of seed, powers and variance', () => {
        const original = runSimulations(request()).example;
        const fixtures: Fixture[] = original.matches.map(({ origin: _origin, simulatedGames: _simulated, winner: _winner, ...fixture }) => fixture);
        const base = request({ snapshot: { ...seedSnapshot(), fixtures }, iterations: 3 });
        const powers = Object.fromEntries(base.snapshot.teams.map((team, index) => [team.id, index % 2 ? 0 : 100]));
        for (const seed of [0, 17, 0xffff_ffff]) {
            const result = runSimulations({ ...base, seed, variance: 'high', powerScores: powers });
            expect(result.example.finishes).toEqual(original.finishes);
            expect(result.example.swissRecords).toEqual(original.swissRecords);
            expect(result.example.matches.every((match) => match.origin === 'fixed' && match.simulatedGames === 0)).toBe(true);
            for (const [id, team] of Object.entries(result.aggregates.teams)) expect(team.finishCounts[original.finishes[id]!]).toBe(3);
        }
    });

    it('aggregates exact exclusive counts without retaining all trajectories', () => {
        const iterations = 300;
        const { aggregates, example } = runSimulations(request({ iterations }));
        expect(aggregates.completedIterations).toBe(iterations);
        for (const team of Object.values(aggregates.teams)) {
            expect(Object.values(team.finishCounts).reduce((a, b) => a + b)).toBe(iterations);
            expect(Object.values(team.swissRecordCounts).reduce((a, b) => a + b)).toBe(iterations);
            expect(team.simulatedGames).toBe(team.gamesPlayed);
        }
        expect(FINAL_BUCKETS.map((bucket) => Object.values(aggregates.teams).reduce((sum, team) => sum + team.finishCounts[bucket], 0)))
            .toEqual([1, 1, 2, 4, 3, 3, 2].map((count) => count * iterations));
        expect(SWISS_RECORDS.map((record) => Object.values(aggregates.teams).reduce((sum, team) => sum + team.swissRecordCounts[record], 0)))
            .toEqual([2, 3, 3, 3, 3, 2].map((count) => count * iterations));
        expect(JSON.stringify(aggregates)).not.toMatch(/NaN|Infinity/);
        assertTournament(example);
    });

    it('reports machine-readable conflicts without accepting partial trajectories', () => {
        const input = request();
        const nextRound: Fixture = { ...input.snapshot.fixtures[0]!, id: 'r2', round: 2 };
        try {
            runSimulations({ ...input, scenario: { mode: 'custom', fixtures: [nextRound] } });
            throw new Error('expected a conflict');
        } catch (error) {
            expect(error).toBeInstanceOf(SimulationError);
            expect((error as SimulationError).context).toMatchObject({ round: 2, reason: 'undetermined_participants' });
        }
    });

    it('records unavoidable rematches caused by valid partial locks without retrying trajectories', () => {
        const prior = runSimulations(request()).example.matches.filter((match) => match.stage === 'swiss' && match.round <= 2);
        const wins = new Map<string, number>();
        for (const match of prior) wins.set(match.winner, (wins.get(match.winner) ?? 0) + 1);
        const middle = request().snapshot.teams.filter((team) => wins.get(team.id) === 1).map((team) => team.id);
        const previous = (a: string, b: string): boolean => prior.some((match) => [match.teamA, match.teamB].includes(a) && [match.teamA, match.teamB].includes(b));
        let locks: Fixture[] | undefined;
        for (const old of prior) {
            if (!middle.includes(old.teamA) || !middle.includes(old.teamB)) continue;
            const rest = middle.filter((id) => id !== old.teamA && id !== old.teamB);
            const sampler = createPairingSampler(rest, () => true, previous);
            if (sampler.minimumRematches) continue;
            locks = sampler.sample(createRandom(1)).map(([teamA, teamB], index) => ({ id: `locked:${index}`, stage: 'swiss',
                round: 3, slot: index + 1, teamA, teamB, bestOf: 1, status: 'scheduled' }));
            break;
        }
        expect(locks).toBeDefined();
        const constrained = request({ scenario: { mode: 'custom', fixtures: [...prior, ...locks!] }, iterations: 30 });
        const result = runSimulations(constrained);
        expect(result.aggregates.completedIterations).toBe(30);
        expect(result.aggregates.rematches.affectedIterations).toBe(30);
        expect(result.aggregates.rematches.repeatedSeries).toBeGreaterThanOrEqual(30);
        expect(result.example.rematchExceptions).toContainEqual({ round: 3, record: '1-1', count: 1 });
        expect(runSimulations(constrained)).toEqual(result);
        assertTournament(result.example);
    });
});

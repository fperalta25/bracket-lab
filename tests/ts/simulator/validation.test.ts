import { describe, expect, it } from 'vitest';
import { seedSnapshot } from '../../../scripts/seed-snapshot';
import { prepareSimulation, runSimulations, type Fixture, type SimulationRequest, type TournamentSnapshot } from '../../../resources/ts/simulator';

const input = (): SimulationRequest => ({ snapshot: seedSnapshot(), scenario: { mode: 'official_state' }, variance: 'normal', iterations: 1, seed: 42 });
const custom = (fixtures: readonly Fixture[]): SimulationRequest => ({ ...input(), scenario: { mode: 'custom', fixtures } });

describe('strict request and snapshot validation', () => {
    it('rejects unsafe iteration counts, invalid seeds, variance and power overrides', () => {
        for (const iterations of [0, -1, 1.5, 50001, Infinity]) expect(() => prepareSimulation({ ...input(), iterations })).toThrow('invalid_request');
        for (const seed of [-1, NaN, 0x1_0000_0000]) expect(() => prepareSimulation({ ...input(), seed })).toThrow('invalid_request');
        expect(() => prepareSimulation({ ...input(), variance: 'extreme' as 'normal' })).toThrow('invalid_request');
        const id = input().snapshot.teams[0]!.id;
        for (const power of [-1, 101, Infinity, NaN]) expect(() => prepareSimulation({ ...input(), powerScores: { [id]: power } })).toThrow('invalid_request');
        expect(() => prepareSimulation({ ...input(), powerScores: { unknown: 50 } })).toThrow('invalid_request');
    });

    it('rejects malformed teams, unsupported rules, duplicate IDs and impossible R1 configurations', () => {
        const snapshot = seedSnapshot();
        const invalid = (value: TournamentSnapshot): void => { expect(() => prepareSimulation({ ...input(), snapshot: value })).toThrow(); };
        invalid({ ...snapshot, teams: snapshot.teams.slice(1) });
        invalid({ ...snapshot, teams: [snapshot.teams[1]!, ...snapshot.teams.slice(1)] });
        invalid({ ...snapshot, teams: snapshot.teams.map((team) => ({ ...team, region: 'APAC' as 'LCP' })) });
        invalid({ ...snapshot, teams: snapshot.teams.map((team) => ({ ...team, region: 'LCK' })) });
        invalid({ ...snapshot, rules: { ...snapshot.rules, qualifyingWins: 4 as 3 } });
        invalid({ ...snapshot, rules: { ...snapshot.rules, firstRoundPoolPairs: [[1, 4], [1, 3]] } });
        invalid({ ...snapshot, teams: snapshot.teams.map((team, index) => index === 0 ? { ...team, pool: 2 } : team) });
        invalid({ ...snapshot, fixtures: null as unknown as Fixture[] });
    });

    it('handles opaque identifiers safely, including object prototype names', () => {
        const snapshot = seedSnapshot();
        const oldId = snapshot.teams[0]!.id;
        const rename = (id: string): string => id === oldId ? '__proto__' : id;
        const renamed: TournamentSnapshot = { ...snapshot,
            teams: snapshot.teams.map((team) => ({ ...team, id: rename(team.id) })),
            fixtures: snapshot.fixtures.map((fixture) => ({ ...fixture, teamA: rename(fixture.teamA), teamB: rename(fixture.teamB) })),
        };
        const result = runSimulations({ ...input(), snapshot: renamed, powerScores: {} });
        expect(Object.hasOwn(result.aggregates.teams, '__proto__')).toBe(true);
        expect(Object.values(result.aggregates.teams['__proto__']!.finishCounts).reduce((a, b) => a + b)).toBe(1);
    });
});

describe('locked draws and fixed result conflicts', () => {
    it('rejects duplicate slots, repeated participants, unknown opponents and invalid BoX', () => {
        const first = input().snapshot.fixtures[0]!;
        expect(() => prepareSimulation(custom([first, { ...first, id: 'other' }]))).toThrow('invalid_fixture');
        expect(() => prepareSimulation(custom([first, { ...first, id: 'other', slot: 2 }]))).toThrow('invalid_fixture');
        expect(() => prepareSimulation(custom([{ ...first, teamB: 'unknown' }]))).toThrow('invalid_fixture');
        expect(() => prepareSimulation(custom([{ ...first, teamB: first.teamA }]))).toThrow('invalid_fixture');
        expect(() => prepareSimulation(custom([{ ...first, bestOf: 3 }]))).toThrow('invalid_fixture');
        expect(() => prepareSimulation(custom([{ ...first, status: 'completed', score: { a: 1, b: 1 } }]))).toThrow('invalid_score');
    });

    it('never relaxes R1 regional or pool constraints, even for a manual lock', () => {
        const snapshot = seedSnapshot();
        const gen = snapshot.teams.find((team) => team.acronym === 'GEN')!;
        const dk = snapshot.teams.find((team) => team.acronym === 'DK')!;
        const al = snapshot.teams.find((team) => team.acronym === 'AL')!;
        const first = snapshot.fixtures[0]!;
        expect(() => prepareSimulation(custom([{ ...first, teamA: gen.id, teamB: dk.id }]))).toThrow('impossible_pairing');
        expect(() => prepareSimulation(custom([{ ...first, teamA: gen.id, teamB: al.id }]))).toThrow('impossible_pairing');
    });

    it('accepts partial later fixtures only when their participants are determined and share a record', () => {
        const trace = runSimulations(input()).example.matches;
        const roundOne = trace.filter((match) => match.stage === 'swiss' && match.round === 1);
        const winners = roundOne.map((match) => match.winner);
        const loser = roundOne[0]!.winner === roundOne[0]!.teamA ? roundOne[0]!.teamB : roundOne[0]!.teamA;
        const fixture: Fixture = { id: 'r2', stage: 'swiss', round: 2, slot: 8, teamA: winners[0]!, teamB: winners[1]!, bestOf: 1, status: 'scheduled' };
        const result = runSimulations(custom([...roundOne, fixture]));
        expect(result.example.matches.find((match) => match.id === 'r2')!.slot).toBe(8);
        expect(() => prepareSimulation(custom([...roundOne, { ...fixture, teamB: loser }]))).toThrow('invalid_constraints');
        expect(() => prepareSimulation(custom([fixture]))).toThrow('invalid_constraints');
    });

    it('rejects an old result correction that contradicts a later draw', () => {
        const trace = runSimulations(input()).example.matches;
        const prior: Fixture[] = trace.filter((match) => match.stage === 'swiss' && match.round <= 2);
        const first = prior[0]!;
        const corrected: Fixture = { ...first, status: 'completed', score: first.status === 'completed' && first.score.a === 1 ? { a: 0, b: 1 } : { a: 1, b: 0 }, games: undefined };
        expect(() => prepareSimulation(custom([corrected, ...prior.slice(1)]))).toThrow('invalid_constraints');
    });

    it('requires known qualifiers and parent winners before fixing knockout slots', () => {
        const trace = runSimulations(input()).example.matches;
        const swiss = trace.filter((match) => match.stage === 'swiss');
        const quarter = trace.find((match) => match.stage === 'quarterfinal')!;
        const semi = trace.find((match) => match.stage === 'semifinal')!;
        expect(() => prepareSimulation(custom([quarter]))).toThrow('invalid_constraints');
        const result = runSimulations(custom([...swiss, quarter]));
        expect(result.example.matches.find((match) => match.id === quarter.id)!.winner).toBe(quarter.winner);
        expect(() => prepareSimulation(custom([...swiss, quarter, semi]))).toThrow('invalid_constraints');
        const quarters = trace.filter((match) => match.stage === 'quarterfinal');
        const outsider = swiss.find((match) => match.teamA !== semi.teamA && match.teamA !== semi.teamB)!.teamA;
        expect(() => prepareSimulation(custom([...swiss, ...quarters, { ...semi, teamA: outsider, games: undefined }]))).toThrow('invalid_constraints');
    });
});

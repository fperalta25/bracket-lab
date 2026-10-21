import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { predictionRegressionRequests } from '../fixtures/prediction-requests';
import { gprSeedRequest } from '../../../scripts/seed-snapshot';
import { canonicalPreset, createTournamentRandom, MODEL_PRESETS, prepareSimulation, runSimulations, simulateTournament,
    type GameResult, type PredictionModel, type SimulatedWorldState } from '../../../resources/ts/simulator';

const digests = {
    legacy: '73cc6f4e39b99356ee7086a61e0f8eb19c9ac8e36c085aeac840a46037bee5b6',
    baseline: '958adce6739199e9f881ef5cac07d4c16e06934057c5101a3321a7f9c61d5b41',
    scratch: '0d3e4f76bad91ba5ae1a979bb46a2ea57de50be8da77dbfad7b68906ee0f8f13',
    fixed: '7716e1a4db71872455465e59977a676340180e8bb0d09c590f080e1f1d2ac070',
    winner: '324d13f9b6ad33f226ac7f7a67167ad49624628d509f47ca14c2b85c052a36e9',
    experimental: 'ed767a6afb0cf0fb052438c24c14926425196ca96f3f60fc5a36019ed060fd58',
} as const;

describe('prediction contract v3-A', () => {
    it.each(Object.keys(digests) as (keyof typeof digests)[])('preserves the complete pre-refactor %s output, including its manifest', (name) => {
        // Captured before extracting the predictor, not generated from the implementation under test.
        const output = runSimulations(predictionRegressionRequests()[name]!);
        expect(createHash('sha256').update(JSON.stringify(output)).digest('hex')).toBe(digests[name]);
    });

    it('injects a game predictor with fresh state per tournament and no future scores in its input', () => {
        const worlds: SimulatedWorldState[] = [];
        const observed = new Map<SimulatedWorldState, GameResult[]>();
        const model: PredictionModel = {
            id: 'test-predictor',
            createState() { const world = { modelId: 'test-predictor' }; worlds.push(world); observed.set(world, []); return world; },
            predictGame(context, state) {
                const prior = observed.get(state)!;
                expect(context.gameIndex).toBe(context.winsA + context.winsB + 1);
                expect(context).not.toHaveProperty('score'); expect(context).not.toHaveProperty('winner');
                if (context.previousWinner) expect(prior.at(-1)!.winner).toBe(context.previousWinner);
                return { pWinA: 1 };
            },
            onGameResolved(world, result) { observed.get(world)!.push(result); },
        };
        const prepared = prepareSimulation(gprSeedRequest(1, 42));
        for (let i = 0; i < 2; i++) {
            const result = simulateTournament(prepared, createTournamentRandom(42, i), model);
            expect(result.matches).toHaveLength(40);
            expect(result.matches.every((m) => m.winner === m.teamA && m.score.b === 0)).toBe(true);
            expect(new Set(result.matches.map((m) => m.bestOf))).toEqual(new Set([1, 3, 5]));
            expect(observed.get(worlds[i]!)!.length).toBe(result.matches.reduce((sum, m) => sum + m.simulatedGames, 0));
        }
        expect(worlds[0]).not.toBe(worlds[1]);
    });

    it('never predicts or fabricates chronological games for fixed scores', () => {
        const requests = predictionRegressionRequests();
        const prepared = prepareSimulation(requests.fixed!);
        const model: PredictionModel = { id: 'fixed-test', createState: () => ({ modelId: 'fixed-test' }),
            predictGame() { throw new Error('fixed result was resimulated'); }, onGameResolved() { throw new Error('invented game order'); } };
        const result = simulateTournament(prepared, createTournamentRandom(42, 0), model);
        expect(result.matches.every((m) => m.origin === 'fixed' && m.simulatedGames === 0)).toBe(true);
    });

    it('requires explicit stationary conditioning support for winner picks', () => {
        const prepared = prepareSimulation(predictionRegressionRequests().winner!);
        const model: PredictionModel = { id: 'dynamic-test', createState: () => ({ modelId: 'dynamic-test' }),
            predictGame: () => ({ pWinA: 0.5 }), onGameResolved() {} };
        expect(() => simulateTournament(prepared, createTournamentRandom(42, 0), model)).toThrow('unsupported_model');
    });

    it('rejects invalid injected game probabilities at the series boundary', () => {
        const prepared = prepareSimulation(gprSeedRequest(1, 42));
        for (const p of [NaN, Infinity, -0.01, 1.01]) {
            const model: PredictionModel = { id: 'invalid-test', createState: () => ({ modelId: 'invalid-test' }),
                predictGame: () => ({ pWinA: p }), onGameResolved() {} };
            expect(() => simulateTournament(prepared, createTournamentRandom(42, 0), model)).toThrow('invalid_request');
        }
    });

    it('starts after an observed game prefix without inventing an observation callback', () => {
        const base = gprSeedRequest(1, 42);
        const matches = runSimulations(base).example.matches;
        const match = matches.find((m) => m.stage === 'swiss' && m.bestOf === 3)!;
        const fixtures = [...matches.filter((m) => m.stage === 'swiss' && m.round < match.round),
            { ...match, status: 'scheduled' as const, score: undefined, games: [match.teamB] }];
        const prepared = prepareSimulation({ ...base, scenario: { mode: 'custom', fixtures } });
        const events: GameResult[] = [];
        const model: PredictionModel = { id: 'prefix-test', createState: () => ({ modelId: 'prefix-test' }),
            predictGame: () => ({ pWinA: 1 }), onGameResolved(_state, result) { if (result.context.seriesId === match.id) events.push(result); } };
        const result = simulateTournament(prepared, createTournamentRandom(42, 0), model);
        expect(result.matches.find((m) => m.id === match.id)?.games).toEqual([match.teamB, match.teamA, match.teamA]);
        expect(events.map((e) => [e.context.gameIndex, e.context.winsA, e.context.winsB, e.context.previousWinner])).toEqual([
            [2, 0, 1, match.teamB], [3, 1, 1, match.teamA],
        ]);
    });

    it('notifies winner-conditioned games while preserving the conditional sampler', () => {
        const base = gprSeedRequest(1, 42);
        const matches = runSimulations(base).example.matches;
        const match = matches.find((m) => m.stage === 'swiss' && m.bestOf === 3)!;
        const fixtures = [...matches.filter((m) => m.stage === 'swiss' && m.round < match.round),
            { id: match.id, stage: match.stage, round: match.round, slot: match.slot, teamA: match.teamA, teamB: match.teamB,
                bestOf: match.bestOf, status: 'decided' as const, winner: match.teamA, games: [match.teamB] }];
        const prepared = prepareSimulation({ ...base, scenario: { mode: 'custom', fixtures } });
        const events: GameResult[] = [];
        const model: PredictionModel = { ...prepared.prediction, onGameResolved(_world, result) { if (result.context.seriesId === match.id) events.push(result); } };
        const result = simulateTournament(prepared, createTournamentRandom(42, 0), model);
        expect(result.matches.find((m) => m.id === match.id)?.score).toEqual({ a: 2, b: 1 });
        expect(events.map((e) => e.origin)).toEqual(['constrained', 'constrained']);
        expect(events.map((e) => e.context.gameIndex)).toEqual([2, 3]);
    });

    it('maps only the old experimental alias and rejects trained requests before any execution', () => {
        expect(canonicalPreset('contextual_v1')).toBe('contextual_experimental_v2');
        expect(MODEL_PRESETS.contextual_trained_v3.available).toBe(false);
        expect(() => runSimulations({ ...gprSeedRequest(1), preset: 'contextual_trained_v3' })).toThrow('unsupported_model');
        const old = predictionRegressionRequests().experimental!;
        const current = runSimulations({ ...old, preset: 'contextual_experimental_v2' } as typeof old);
        const previous = runSimulations(old);
        expect(current.aggregates).toEqual(previous.aggregates); expect(current.example).toEqual(previous.example);
        expect(current.metadata.model).toMatchObject({ preset: 'contextual_experimental_v2', hypothetical: true,
            contextual: { status: 'experimental' }, engineVersion: 'swiss16-contextual-prior-keyed-v1' });
    });
});

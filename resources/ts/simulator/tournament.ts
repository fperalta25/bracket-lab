import { requireCondition, SimulationError } from './errors';
import { knockoutSampler } from './knockout';
import { createPairingSampler, firstRoundSampler, samePair, type PairingSampler } from './pairing';
import { gameProbability, playSeries } from './series';
import { createContextualProbabilities } from './contextual';
import { playWinnerConstrainedSeries } from './conditional-series';
import { gprGameLogProbabilities, gprGameProbability } from './gpr';
import type { RandomKey, TournamentRandom } from './random';
import { applySwissMatch, createSwissState, eliminatedBucket, finalSwissRecords, isActive, recordOf, swissBestOf } from './state';
import { KNOCKOUT_ROUNDS, SWISS_MATCH_COUNTS, validateRequest } from './validation';
import { FINAL_BUCKETS, type FinalBucket, type Fixture, type Pair, type PlayedMatch, type RandomSource,
    type RematchException, type SimulationRequest, type Stage, type TournamentResult } from './types';

export interface PreparedSimulation {
    readonly request: SimulationRequest;
    readonly fixtures: readonly Fixture[];
    readonly roundOne: PairingSampler;
    readonly powers: Readonly<Record<string, number>>;
    readonly probabilities: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

export function prepareSimulation(request: SimulationRequest): PreparedSimulation {
    let fixtures = validateRequest(request);
    if (request.modelVersion === 'gpr-context-v2') {
        // Freeze the execution input by value; source array order must not choose RNG paths.
        const copy = JSON.parse(JSON.stringify(request)) as typeof request;
        const compareId = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
        request = { ...copy, snapshot: { ...copy.snapshot, teams: [...copy.snapshot.teams].sort((a, b) => compareId(a.id, b.id)) },
            strengths: { ...copy.strengths, profiles: [...copy.strengths.profiles].sort((a, b) => compareId(a.teamId, b.teamId)) } };
        fixtures = request.scenario.mode === 'from_scratch' ? [] : request.scenario.mode === 'official_state'
            ? request.snapshot.fixtures : request.scenario.fixtures;
    }
    const teams = request.snapshot.teams;
    const powers = request.modelVersion === 'legacy-score-v1'
        ? Object.fromEntries(request.snapshot.teams.map((team) => [team.id,
            request.powerScores && Object.hasOwn(request.powerScores, team.id) ? request.powerScores[team.id]! : team.powerScore]))
        : Object.fromEntries(request.strengths.profiles.map((profile) => [profile.teamId,
            request.gprOverrides && Object.hasOwn(request.gprOverrides, profile.teamId) ? request.gprOverrides[profile.teamId]! : profile.gpr]));
    const probability = (a: string, b: string): number => request.modelVersion === 'legacy-score-v1'
        ? gameProbability(powers[a]!, powers[b]!, request.variance)
        : gprGameProbability(powers[a]!, powers[b]!, request.denominator ?? request.strengths.calibration.eloDenominator);
    const probabilities = new Map(teams.map((a) => [a.id, new Map(teams.map((b) => [b.id, probability(a.id, b.id)]))]));
    const roundOne = firstRoundSampler(teams, request.snapshot.rules,
        fixtures.filter((fixture) => fixture.stage === 'swiss' && fixture.round === 1).map((fixture) => [fixture.teamA, fixture.teamB]));
    return { request, fixtures, powers, probabilities, roundOne };
}

/** One fresh tournament; the caller owns/injects the advancing PRNG. No UI or locale dependency. */
export function simulateTournament(prepared: PreparedSimulation, random: RandomSource | TournamentRandom): TournamentResult {
    const { request, fixtures } = prepared;
    requireCondition(request.modelVersion === 'gpr-context-v2' ? 'stream' in random : 'next' in random,
        'incompatible_model', { field: 'random_streams' });
    const contextual = request.modelVersion === 'gpr-context-v2' && request.preset === 'contextual_v1' && 'stream' in random
        ? createContextualProbabilities(request, prepared.powers, random) : undefined;
    const pairingRandom = (...keys: RandomKey[]): RandomSource => 'stream' in random ? random.stream('pairing', ...keys) : random;
    const { rules, teams } = request.snapshot;
    const states = createSwissState(teams);
    const matches: PlayedMatch[] = [];
    const rematchExceptions: RematchException[] = [];
    const usedIds = new Set(fixtures.map((fixture) => fixture.id));
    const generatedFixture = (stage: Stage, round: number, slot: number, pair: Pair, bestOf: 1 | 3 | 5): Fixture => {
        let id = `simulated:${stage}:${round}:${slot}`;
        while (usedIds.has(id)) id += ':';
        usedIds.add(id);
        return { id, stage, round, slot, teamA: pair[0], teamB: pair[1], bestOf, status: 'scheduled' };
    };
    const play = (fixture: Fixture): PlayedMatch => {
        let gameIndex = fixture.games?.length ?? 0;
        const gameRandom = 'stream' in random ? { next: () => random.stream('game', fixture.stage, fixture.round,
            fixture.slot, fixture.teamA, fixture.teamB, gameIndex++).next() } : random;
        const result = fixture.status === 'decided' && request.modelVersion === 'gpr-context-v2'
            ? playWinnerConstrainedSeries(fixture, gprGameLogProbabilities(prepared.powers[fixture.teamA]!, prepared.powers[fixture.teamB]!,
                request.denominator ?? request.strengths.calibration.eloDenominator), gameRandom)
            : playSeries(fixture, contextual ? contextual(fixture) : prepared.probabilities.get(fixture.teamA)!.get(fixture.teamB)!, gameRandom);
        matches.push(result);
        return result;
    };

    for (let round = 1; round <= rules.maxSwissRounds; round++) {
        const locks = fixtures.filter((fixture) => fixture.stage === 'swiss' && fixture.round === round);
        const groups = new Map<string, string[]>();
        for (const [id, state] of states) {
            if (isActive(state)) {
                const record = recordOf(state);
                if (!groups.has(record)) groups.set(record, []);
                groups.get(record)!.push(id);
            }
        }
        let pairs: Pair[] = [];
        if (round === 1) pairs = prepared.roundOne.sample(pairingRandom('swiss', round, '0-0'));
        else {
            for (const [record, participants] of [...groups].sort(([a], [b]) => a < b ? -1 : 1)) {
                try {
                    const sampler = createPairingSampler(participants, () => true,
                        (a, b) => states.get(a)!.opponents.has(b),
                        locks.filter((fixture) => participants.includes(fixture.teamA)).map((fixture) => [fixture.teamA, fixture.teamB]));
                    pairs.push(...sampler.sample(pairingRandom('swiss', round, record)));
                    if (sampler.minimumRematches) rematchExceptions.push({ round, record, count: sampler.minimumRematches });
                } catch (error) {
                    if (error instanceof SimulationError) throw new SimulationError(error.code, { ...error.context, round, record });
                    throw error;
                }
            }
        }
        const assigned = new Map<number, Fixture>(locks.map((fixture) => [fixture.slot, fixture]));
        for (const pair of pairs) {
            if (locks.some((fixture) => samePair(pair, [fixture.teamA, fixture.teamB]))) continue;
            let slot = 1;
            while (assigned.has(slot)) slot++;
            assigned.set(slot, generatedFixture('swiss', round, slot, pair, swissBestOf(states.get(pair[0])!)));
        }
        requireCondition(assigned.size === SWISS_MATCH_COUNTS[round - 1], 'invariant_violation', { round });
        for (const [, fixture] of [...assigned].sort(([a], [b]) => a - b)) applySwissMatch(states, play(fixture));
    }

    const swissRecords = finalSwissRecords(states);
    const finishes = Object.create(null) as Record<string, FinalBucket>;
    for (const [id, record] of Object.entries(swissRecords)) {
        const bucket = eliminatedBucket(record);
        if (bucket) finishes[id] = bucket;
    }
    const playStage = (stage: 'quarterfinal' | 'semifinal' | 'final', pairs: readonly Pair[]): PlayedMatch[] => {
        return pairs.map((pair, index) => {
            const slot = index + 1;
            const locked = fixtures.find((fixture) => fixture.stage === stage && fixture.slot === slot);
            requireCondition(!locked || samePair(pair, [locked.teamA, locked.teamB]), 'invalid_constraints', { stage, slot });
            const result = play(locked ?? generatedFixture(stage, KNOCKOUT_ROUNDS[stage], slot, pair, rules.knockoutBestOf));
            const loser = result.winner === result.teamA ? result.teamB : result.teamA;
            finishes[loser] = stage === 'quarterfinal' ? 'quarterfinalist' : stage === 'semifinal' ? 'semifinalist' : 'runner_up';
            return result;
        });
    };
    const quarters = playStage('quarterfinal', knockoutSampler(swissRecords, fixtures.filter((fixture) => fixture.stage === 'quarterfinal')).sample(pairingRandom('quarterfinal')));
    const semis = playStage('semifinal', [[quarters[0]!.winner, quarters[1]!.winner], [quarters[2]!.winner, quarters[3]!.winner]]);
    const final = playStage('final', [[semis[0]!.winner, semis[1]!.winner]])[0]!;
    finishes[final.winner] = 'champion';
    const expected = [1, 1, 2, 4, 3, 3, 2];
    FINAL_BUCKETS.forEach((bucket, index) => {
        requireCondition(Object.values(finishes).filter((value) => value === bucket).length === expected[index], 'invariant_violation', { bucket });
    });
    return { matches, swissRecords, finishes, rematchExceptions,
        ...('stream' in random ? { simulationIndex: random.simulationIndex } : {}) };
}

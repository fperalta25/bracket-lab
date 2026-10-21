import { requireCondition, SimulationError } from './errors';
import { knockoutSampler } from './knockout';
import { createPairingSampler, firstRoundSampler, samePair, type PairingSampler } from './pairing';
import { gameProbability, playSeries } from './series';
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
    const fixtures = validateRequest(request);
    const teams = request.snapshot.teams;
    const powers = Object.fromEntries(teams.map((team) => [team.id,
        request.powerScores && Object.hasOwn(request.powerScores, team.id) ? request.powerScores[team.id]! : team.powerScore]));
    const probabilities = new Map(teams.map((a) => [a.id, new Map(teams.map((b) => [b.id, gameProbability(powers[a.id]!, powers[b.id]!, request.variance)]))]));
    const roundOne = firstRoundSampler(teams, request.snapshot.rules,
        fixtures.filter((fixture) => fixture.stage === 'swiss' && fixture.round === 1).map((fixture) => [fixture.teamA, fixture.teamB]));
    return { request, fixtures, powers, probabilities, roundOne };
}

/** One fresh tournament; the caller owns/injects the advancing PRNG. No UI or locale dependency. */
export function simulateTournament(prepared: PreparedSimulation, random: RandomSource): TournamentResult {
    const { request, fixtures } = prepared;
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
        const result = playSeries(fixture, prepared.probabilities.get(fixture.teamA)!.get(fixture.teamB)!, random);
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
        if (round === 1) pairs = prepared.roundOne.sample(random);
        else {
            for (const [record, participants] of [...groups].sort(([a], [b]) => a < b ? -1 : 1)) {
                try {
                    const sampler = createPairingSampler(participants, () => true,
                        (a, b) => states.get(a)!.opponents.has(b),
                        locks.filter((fixture) => participants.includes(fixture.teamA)).map((fixture) => [fixture.teamA, fixture.teamB]));
                    pairs.push(...sampler.sample(random));
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
    const quarters = playStage('quarterfinal', knockoutSampler(swissRecords, fixtures.filter((fixture) => fixture.stage === 'quarterfinal')).sample(random));
    const semis = playStage('semifinal', [[quarters[0]!.winner, quarters[1]!.winner], [quarters[2]!.winner, quarters[3]!.winner]]);
    const final = playStage('final', [[semis[0]!.winner, semis[1]!.winner]])[0]!;
    finishes[final.winner] = 'champion';
    const expected = [1, 1, 2, 4, 3, 3, 2];
    FINAL_BUCKETS.forEach((bucket, index) => {
        requireCondition(Object.values(finishes).filter((value) => value === bucket).length === expected[index], 'invariant_violation', { bucket });
    });
    return { matches, swissRecords, finishes, rematchExceptions };
}

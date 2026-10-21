import { createRandom } from './random';
import { prepareSimulation, simulateTournament } from './tournament';
import { modelManifest } from './manifest';
import { FINAL_BUCKETS, SWISS_RECORDS, type FinalBucket, type SimulationRequest, type SwissRecord, type Team, type TournamentResult } from './types';

export interface TeamAggregate {
    swissRecordCounts: Record<SwissRecord, number>;
    finishCounts: Record<FinalBucket, number>;
    matchesPlayed: number;
    gamesPlayed: number;
    simulatedMatches: number;
    simulatedGames: number;
}

export interface Aggregates {
    completedIterations: number;
    teams: Record<string, TeamAggregate>;
    rematches: { affectedIterations: number; repeatedSeries: number };
}

export function createAggregates(teams: readonly Team[]): Aggregates {
    return {
        completedIterations: 0,
        teams: Object.fromEntries(teams.map((team) => [team.id, {
            swissRecordCounts: Object.fromEntries(SWISS_RECORDS.map((record) => [record, 0])) as Record<SwissRecord, number>,
            finishCounts: Object.fromEntries(FINAL_BUCKETS.map((bucket) => [bucket, 0])) as Record<FinalBucket, number>,
            matchesPlayed: 0, gamesPlayed: 0, simulatedMatches: 0, simulatedGames: 0,
        }])),
        rematches: { affectedIterations: 0, repeatedSeries: 0 },
    };
}

export function accumulate(aggregates: Aggregates, result: TournamentResult): void {
    for (const [id, record] of Object.entries(result.swissRecords)) {
        aggregates.teams[id]!.swissRecordCounts[record]++;
        aggregates.teams[id]!.finishCounts[result.finishes[id]!]++;
    }
    for (const match of result.matches) {
        for (const id of [match.teamA, match.teamB]) {
            const team = aggregates.teams[id]!;
            team.matchesPlayed++;
            team.gamesPlayed += match.score.a + match.score.b;
            team.simulatedMatches += Number(match.origin === 'simulated');
            team.simulatedGames += match.simulatedGames;
        }
    }
    aggregates.rematches.affectedIterations += Number(result.rematchExceptions.length > 0);
    aggregates.rematches.repeatedSeries += result.rematchExceptions.reduce((sum, exception) => sum + exception.count, 0);
    aggregates.completedIterations++;
}

export function runSimulations(request: SimulationRequest): {
    aggregates: Aggregates;
    example: TournamentResult;
    metadata: { seed: number; iterations: number; revision: number | null;
        sourceMode: SimulationRequest['scenario']['mode']; rulesVersion: string; model: ReturnType<typeof modelManifest>;
        request: SimulationRequest };
} {
    const prepared = prepareSimulation(request);
    const random = createRandom(request.seed);
    const aggregates = createAggregates(request.snapshot.teams);
    const example = simulateTournament(prepared, random);
    accumulate(aggregates, example);
    for (let iteration = 1; iteration < request.iterations; iteration++) accumulate(aggregates, simulateTournament(prepared, random));
    return { aggregates, example, metadata: {
        seed: request.seed, iterations: request.iterations, revision: request.snapshot.revision,
        sourceMode: request.scenario.mode, rulesVersion: request.snapshot.rules.version,
        model: modelManifest(request, prepared.powers), request: JSON.parse(JSON.stringify(request)) as SimulationRequest,
    } };
}

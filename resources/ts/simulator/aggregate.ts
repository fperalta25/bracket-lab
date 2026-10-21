import { createRandom, createTournamentRandom } from './random';
import { prepareSimulation, simulateTournament } from './tournament';
import { requireCondition } from './errors';
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

export type SimulationOutput = ReturnType<ReturnType<typeof createSimulationRunner>['result']>;

/** One prepared execution, advanced in bounded batches without resetting streams. */
export function createSimulationRunner(request: SimulationRequest) {
    const prepared = prepareSimulation(request);
    request = prepared.request;
    const random = createRandom(request.seed);
    const aggregates = createAggregates(request.snapshot.teams);
    let example: TournamentResult | undefined;
    return {
        advance(batchSize: number): number {
            requireCondition(Number.isInteger(batchSize) && batchSize >= 1 && batchSize <= 1000, 'invalid_request', { field: 'batch_size' });
            const end = Math.min(request.iterations, aggregates.completedIterations + batchSize);
            while (aggregates.completedIterations < end) {
                const index = aggregates.completedIterations;
                const tournament = simulateTournament(prepared, request.modelVersion === 'legacy-score-v1'
                    ? random : createTournamentRandom(request.seed, index));
                example ??= tournament;
                accumulate(aggregates, tournament);
            }
            return aggregates.completedIterations;
        },
        result() {
            requireCondition(aggregates.completedIterations === request.iterations && example, 'invalid_request', { field: 'incomplete_run' });
            return { aggregates, example, metadata: {
                seed: request.seed, iterations: request.iterations, revision: request.snapshot.revision,
                sourceMode: request.scenario.mode, rulesVersion: request.snapshot.rules.version,
                model: modelManifest(request, prepared.powers), request: JSON.parse(JSON.stringify(request)) as SimulationRequest,
            } };
        },
    };
}

export function runSimulations(request: SimulationRequest): SimulationOutput {
    const runner = createSimulationRunner(request);
    for (let completed = 0; completed < request.iterations;) completed = runner.advance(1000);
    return runner.result();
}

import { FINAL_BUCKETS, SWISS_RECORDS, runSimulations, requireCondition, SimulationError } from '../resources/ts/simulator';
import { gprSeedRequest } from './seed-snapshot';

export function benchmark(iterations: number, seed: number, preset = 'gpr_baseline'): void {
    const started = performance.now();
    try {
        requireCondition(preset === 'gpr_baseline' || preset === 'contextual_v1', 'unsupported_model', { field: 'preset' });
        const request = gprSeedRequest(iterations, seed);
        const { aggregates, metadata } = runSimulations(preset === 'contextual_v1' ? { ...request, preset,
            contextualTerms: { tournamentForm: true, seriesForm: true, pressure: true, sequence: true } } : request);
        const elapsed = performance.now() - started;
        const teams = Object.values(aggregates.teams);
        const finalTotals = FINAL_BUCKETS.map((bucket) => teams.reduce((sum, team) => sum + team.finishCounts[bucket], 0));
        const swissTotals = SWISS_RECORDS.map((record) => teams.reduce((sum, team) => sum + team.swissRecordCounts[record], 0));
        if (JSON.stringify(finalTotals) !== JSON.stringify([1, 1, 2, 4, 3, 3, 2].map((n) => n * iterations))
            || JSON.stringify(swissTotals) !== JSON.stringify([2, 3, 3, 3, 3, 2].map((n) => n * iterations))) {
            throw new Error('Aggregate invariant failed');
        }
        console.log(JSON.stringify({ seed, iterations, model: metadata.model, completedIterations: aggregates.completedIterations,
            elapsedMs: Math.round(elapsed), tournamentsPerSecond: Math.round(iterations * 1000 / elapsed),
            finalTotals, swissTotals, rematches: aggregates.rematches }, null, 2));
    } catch (error) {
        if (!(error instanceof SimulationError)) throw error;
        console.error(JSON.stringify({ code: error.code, context: error.context }));
        process.exitCode = 1;
    }
}

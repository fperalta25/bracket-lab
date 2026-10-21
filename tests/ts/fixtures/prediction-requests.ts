import { gprSeedRequest, seedSnapshot } from '../../../scripts/seed-snapshot';
import { runSimulations, type Fixture, type SimulationRequest } from '../../../resources/ts/simulator';

export function predictionRegressionRequests(): Record<string, SimulationRequest> {
    const baseline = gprSeedRequest(10, 42);
    const example = runSimulations({ ...baseline, iterations: 1 }).example;
    const first = baseline.snapshot.fixtures[0]!;
    const winner: Fixture = { ...first, status: 'decided', winner: first.teamB, score: undefined };
    return {
        legacy: { modelVersion: 'legacy-score-v1', snapshot: seedSnapshot(), scenario: { mode: 'official_state' }, variance: 'normal', iterations: 10, seed: 42 },
        baseline,
        scratch: { ...baseline, scenario: { mode: 'from_scratch' } },
        fixed: { ...baseline, scenario: { mode: 'custom', fixtures: example.matches } },
        winner: { ...baseline, scenario: { mode: 'custom', fixtures: [winner, ...baseline.snapshot.fixtures.slice(1)] } },
        experimental: { ...baseline, preset: 'contextual_v1', contextualTerms: { tournamentForm: true, seriesForm: true, pressure: true, sequence: true } },
    };
}

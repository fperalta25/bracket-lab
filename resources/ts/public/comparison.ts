import { FINAL_BUCKETS, SWISS_RECORDS, validateConstraints, validateRequest,
    type ContextualTerms, type GprSimulationRequest, type SimulationOutput } from '../simulator';
import { qualificationCount } from './presentation';

export interface ModelComparison { baseline: SimulationOutput; contextual: SimulationOutput }
export type ComparisonMetric = 'qualify' | 'champion';

export function comparisonRequests(request: GprSimulationRequest, terms: ContextualTerms) {
    const { contextualTerms: _terms, ...common } = request;
    const baseline: GprSimulationRequest = { ...common, preset: 'gpr_baseline' };
    const contextual: GprSimulationRequest = { ...common, preset: 'contextual_experimental_v2', contextualTerms: { ...terms } };
    validateRequest(baseline); validateRequest(contextual);
    return [baseline, contextual] as const;
}

function conditions(request: GprSimulationRequest): string {
    const { preset: _preset, contextualTerms: _terms, ...common } = request;
    return JSON.stringify(common, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : value);
}

export function validateComparison(comparison: ModelComparison): void {
    for (const [output, preset] of [[comparison.baseline, 'gpr_baseline'], [comparison.contextual, 'contextual_experimental_v2']] as const) {
        const request = output.metadata.request;
        if (request.modelVersion !== 'gpr-context-v2' || request.preset !== preset) throw new Error('comparison_model');
        validateRequest(request);
        validateConstraints(request.snapshot, output.example.matches);
        const total = request.iterations;
        if (output.metadata.iterations !== total || output.aggregates.completedIterations !== total) throw new Error('comparison_incomplete');
        for (const team of request.snapshot.teams) {
            const aggregate = output.aggregates.teams[team.id]!;
            for (const [keys, counts] of [[FINAL_BUCKETS, aggregate.finishCounts], [SWISS_RECORDS, aggregate.swissRecordCounts]] as const) {
                const values = keys.map((key) => (counts as Record<string, number>)[key]!);
                if (!values.every((n) => Number.isInteger(n) && n >= 0 && n <= total)
                    || values.reduce((a, b) => a+b, 0) !== total) throw new Error('comparison_counts');
            }
        }
    }
    if (conditions(comparison.baseline.metadata.request as GprSimulationRequest)
        !== conditions(comparison.contextual.metadata.request as GprSimulationRequest)) throw new Error('comparison_conditions');
}

export function comparisonCount(output: SimulationOutput, teamId: string, metric: ComparisonMetric): number {
    const aggregate = output.aggregates.teams[teamId]!;
    return metric === 'qualify' ? qualificationCount(aggregate) : aggregate.finishCounts.champion;
}

/** Per-difference 95% bound by Hoeffding + union bound, valid under arbitrary within-pair dependence.
 * P(|p_hat-p|>e) <= 2 exp(-2 N e²); two estimates => 4 exp(-2 N e²) = .05.
 * This covers simulation noise, not predictive validity or all teams/metrics simultaneously.
 */
export function differenceMargin(iterations: number): number {
    if (!Number.isSafeInteger(iterations) || iterations < 1) throw new Error('comparison_iterations');
    return Math.min(1, 2*Math.sqrt(Math.log(80)/(2*iterations)));
}

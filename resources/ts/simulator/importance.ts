import { requireCondition } from './errors';

export const IMPORTANCE_WEIGHTS_VERSION = 'log-weights-ess-v1';

/**
 * Diagnostics for an explicit set of importance log-weights; no sampling or fallback.
 * minEss is a caller-specified numerical guard, not a fitted or convergence threshold.
 * Zero sample support does not establish that the observations are impossible globally.
 */
export function normalizeLogWeights(logWeights: readonly number[], minEss: number) {
    requireCondition(Array.isArray(logWeights) && logWeights.length > 0,
        'invalid_request', { field: 'log_weights' });
    requireCondition(Number.isFinite(minEss) && minEss >= 1 && minEss <= logWeights.length,
        'invalid_request', { field: 'minimum_ess' });
    let maximum = -Infinity;
    for (const value of logWeights) {
        requireCondition(Number.isFinite(value) || value === -Infinity, 'invalid_request', { field: 'log_weights' });
        maximum = Math.max(maximum, value);
    }
    if (maximum === -Infinity) {
        return { weights: logWeights.map(() => 0), ess: 0, essFraction: 0, maxWeight: 0,
            logMeanWeight: -Infinity, minEss, status: 'zero_sample_support' as const };
    }
    const scaled = logWeights.map((value) => Math.exp(value - maximum));
    const total = scaled.reduce((sum, value) => sum + value, 0);
    const weights = scaled.map((value) => value / total);
    const ess = Math.min(weights.length, total * total / scaled.reduce((sum, weight) => sum + weight * weight, 0));
    return { weights, ess, essFraction: ess / weights.length, maxWeight: 1 / total,
        logMeanWeight: maximum + Math.log(total) - Math.log(weights.length), minEss,
        status: ess >= minEss ? 'sufficient_ess' as const : 'insufficient_ess' as const };
}

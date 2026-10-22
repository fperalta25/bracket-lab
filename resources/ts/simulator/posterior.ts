import { requireCondition } from './errors';
import { normalizeLogWeights } from './importance';
import { seriesLogLikelihood, winnerConstraintLogLikelihood, type GameLogProbabilities } from './likelihood';
import type { SeriesGameState } from './series';
import type { Fixture } from './types';

export const POSTERIOR_DIAGNOSTIC_VERSION = 'series-particle-weights-v1';
export interface SeriesEvidence {
    readonly fixture: Fixture;
    readonly availableAt: string;
    readonly kind: 'observed' | 'hypothetical';
}
export interface PriorParticle {
    readonly id: string;
    /** Pure pre-game log probabilities given this particle's latent state, not an outcome-derived bonus. */
    readonly predict: (fixture: Fixture, state: SeriesGameState) => GameLogProbabilities;
}

function timestamp(value: string): number {
    requireCondition(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value),
        'invalid_request', { field: 'evidence_time' });
    const at = Date.parse(value);
    requireCondition(Number.isFinite(at) && new Date(at).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z'),
        'invalid_request', { field: 'evidence_time' });
    return at;
}

/** Equal-prior particle importance weights, diagnostic only. No resampling or public forecast.
 * Condition on results given actual participants; draw selection supplies no strength likelihood.
 * Series-specific latent state must already be consistent inside each particle's pure predictor.
 */
export function diagnosePosterior(particles: readonly PriorParticle[], evidence: readonly SeriesEvidence[], cutoff: string, minEss: number) {
    const before = timestamp(cutoff);
    requireCondition(particles.length > 0 && particles.every((p) => typeof p.id === 'string' && p.id.length > 0 && typeof p.predict === 'function')
        && new Set(particles.map((p) => p.id)).size === particles.length, 'invalid_request', { field: 'prior_particles' });
    const observations = evidence.map((item) => ({ item, at: timestamp(item.availableAt) }))
        .filter(({ at }) => at < before).sort((a, b) => a.at - b.at || (a.item.fixture.id < b.item.fixture.id ? -1 : 1));
    const ids = new Set<string>();
    for (const { item } of observations) {
        requireCondition(typeof item.fixture.id === 'string' && item.fixture.id.length > 0 && !ids.has(item.fixture.id),
            'invalid_request', { field: 'duplicate_evidence' });
        ids.add(item.fixture.id);
        requireCondition(item.kind === 'observed' && (item.fixture.status === 'completed'
            || (item.fixture.status === 'scheduled' && (item.fixture.games?.length ?? 0) > 0))
            || item.kind === 'hypothetical' && item.fixture.status === 'decided', 'invalid_request', { field: 'evidence_kind' });
    }
    const logWeights = particles.map((particle) => observations.reduce((sum, { item }) => sum + (
        item.kind === 'hypothetical' ? winnerConstraintLogLikelihood(item.fixture, (state) => particle.predict(item.fixture, state))
            : seriesLogLikelihood(item.fixture, (state) => particle.predict(item.fixture, state))), 0));
    return { version: POSTERIOR_DIAGNOSTIC_VERSION, mode: 'diagnostic_only' as const, cutoff,
        observationIds: observations.map(({ item }) => item.fixture.id), particleIds: particles.map((p) => p.id),
        ...normalizeLogWeights(logWeights, minEss) };
}

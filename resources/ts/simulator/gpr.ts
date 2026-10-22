import { validateTrainedEloArtifact } from './trained-elo';
import { isExperimentalPreset, validatePreset } from './presets';
import { requireCondition } from './errors';
import type { GameLogProbabilities } from './likelihood';
import type { GprSimulationRequest, StrengthProfileSet, Team } from './types';

export const GPR_MODEL_VERSION = 'gpr-context-v2';
export const GPR_ENGINE_VERSION = 'swiss16-gpr-baseline-keyed-v2';
export const CONTEXTUAL_ENGINE_VERSION = 'swiss16-contextual-prior-keyed-v1';
export const DEFAULT_ELO_DENOMINATOR = 400;

export function validateDenominator(value: number): void {
    requireCondition(Number.isFinite(value) && value >= 200 && value <= 800, 'invalid_request', { field: 'elo_denominator' });
}

/** Elo transform, evaluated on the numerically stable side. Effective ratings may be negative. */
export function gprGameProbability(ratingA: number, ratingB: number, denominator = DEFAULT_ELO_DENOMINATOR): number {
    requireCondition(Number.isFinite(ratingA) && Number.isFinite(ratingB), 'invalid_request', { field: 'gpr_rating' });
    validateDenominator(denominator);
    const difference = ratingA - ratingB;
    const tail = Math.exp(-Math.abs(difference) * (Math.LN10 / denominator));
    return difference >= 0 ? 1 / (1 + tail) : tail / (1 + tail);
}

/** Stable log probabilities: never take log(1 - a rounded game probability). */
export function gprGameLogProbabilities(ratingA: number, ratingB: number, denominator = DEFAULT_ELO_DENOMINATOR): GameLogProbabilities {
    requireCondition(Number.isFinite(ratingA) && Number.isFinite(ratingB), 'invalid_request', { field: 'gpr_rating' });
    validateDenominator(denominator);
    const difference = (ratingA - ratingB) * (Math.LN10 / denominator);
    const correction = Math.log1p(Math.exp(-Math.abs(difference)));
    return difference >= 0 ? { a: -correction, b: -difference - correction }
        : { a: difference - correction, b: -correction };
}

const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 500;
const bounded = (value: unknown, min: number, max: number): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const revision = (value: unknown): boolean => bounded(value, 1, Number.MAX_SAFE_INTEGER) && Number.isInteger(value);
const sourceUrl = (value: unknown): boolean => nonempty(value) && /^https:\/\/[^\s]+$/.test(value);
function calendarDate(value: unknown): value is string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Validates the entire frozen set, including inactive experimental fields, before any draws. */
export function validateStrengthProfiles(set: StrengthProfileSet, teams: readonly Team[]): void {
    requireCondition(set && typeof set === 'object' && set.schemaVersion === 2 && set.modelVersion === GPR_MODEL_VERSION
        && nonempty(set.id) && revision(set.revision) && calendarDate(set.dataCutoffDate), 'invalid_request', { field: 'strength_profiles' });
    const snapshot = set.ratingSnapshot;
    requireCondition(snapshot && nonempty(snapshot.id) && calendarDate(snapshot.asOf) && snapshot.asOf <= set.dataCutoffDate
        && sourceUrl(snapshot.sourceUrl) && nonempty(snapshot.publisher), 'invalid_request', { field: 'rating_snapshot' });
    const calibration = set.calibration;
    requireCondition(calibration && calibration.status === 'provisional' && calibration.calibrationId === null,
        'invalid_request', { field: 'calibration' });
    validateDenominator(calibration.eloDenominator);
    requireCondition(Array.isArray(set.profiles) && set.profiles.length === teams.length, 'invalid_request', { field: 'strength_profiles' });
    const remaining = new Set(teams.map((team) => team.id));
    for (const profile of set.profiles) {
        const context = { field: 'strength_profile', team: String(profile?.teamId) };
        requireCondition(profile && remaining.delete(profile.teamId) && profile.ratingSnapshotId === snapshot.id && revision(profile.revision)
            && bounded(profile.gpr, 0, 5000) && ['high', 'normal', 'low'].includes(profile.consistency)
            && bounded(profile.sigmaTournament, 0, 300) && bounded(profile.sigmaSeries, 0, 300)
            && bounded(profile.pressureElo, -100, 100) && bounded(profile.afterWinElo, -100, 100) && bounded(profile.afterLossElo, -100, 100)
            && profile.calibrationStatus === 'experimental' && profile.evidence && nonempty(profile.evidence.key)
            && sourceUrl(profile.evidence.sourceUrl)
            && ['medium', 'medium_low', 'low', 'context_medium_magnitude_low'].includes(profile.evidence.confidence), 'invalid_request', context);
        const adjustment = profile.contextAdjustment;
        requireCondition(adjustment && bounded(adjustment.elo, -100, 100) && typeof adjustment.active === 'boolean'
            && (adjustment.condition === null || nonempty(adjustment.condition)), 'invalid_request', context);
        // Roster confirmation remains a separate milestone. Never silently activate an unverified adjustment.
        requireCondition(!adjustment.active, 'unsupported_model', { ...context, reason: 'roster_confirmation_required' });
    }
}

export function validateGprRequest(request: GprSimulationRequest): void {
    validatePreset(request.preset);
    if (isExperimentalPreset(request.preset)) {
        const terms = request.contextualTerms;
        const keys = ['tournamentForm', 'seriesForm', 'pressure', 'sequence'] as const;
        requireCondition(terms && typeof terms === 'object' && !Array.isArray(terms)
            && Object.keys(terms).length === keys.length && keys.every((key) => typeof terms[key] === 'boolean'),
        'invalid_request', { field: 'contextual_terms' });
        const fixtures = request.scenario.mode === 'from_scratch' ? [] : request.scenario.mode === 'official_state'
            ? request.snapshot.fixtures : request.scenario.fixtures;
        // No prior-only forecast may masquerade as inference conditioned on observed games.
        requireCondition(!fixtures.some((fixture) => fixture.status !== 'scheduled' || (fixture.games?.length ?? 0) > 0),
            'unsupported_model', { reason: 'contextual_posterior_required' });
    } else {
        requireCondition(request.contextualTerms === undefined, 'incompatible_model', { field: 'contextual_terms' });
    }
    if (request.preset === 'historical_elo_trained_v1') {
        validateTrainedEloArtifact(request.learnedModel!, request.snapshot.teams);
        requireCondition(request.denominator === undefined && request.gprOverrides === undefined, 'incompatible_model', { field: 'learned_model_overrides' });
    } else requireCondition(request.learnedModel === undefined, 'incompatible_model', { field: 'learned_model' });
    requireCondition(!('variance' in request) && !('powerScores' in request), 'incompatible_model', { reason: 'legacy_fields' });
    requireCondition(request.snapshot.teams.every((team) => !Object.hasOwn(team, 'powerScore') && !Object.hasOwn(team, 'power_score')),
        'incompatible_model', { reason: 'legacy_team_scores' });
    validateStrengthProfiles(request.strengths, request.snapshot.teams);
    if (request.denominator !== undefined) validateDenominator(request.denominator);
    if (request.gprOverrides !== undefined) {
        requireCondition(request.gprOverrides && typeof request.gprOverrides === 'object' && !Array.isArray(request.gprOverrides),
            'invalid_request', { field: 'gpr_overrides' });
        const ids = new Set(request.snapshot.teams.map((team) => team.id));
        for (const [id, value] of Object.entries(request.gprOverrides)) {
            requireCondition(ids.has(id) && bounded(value, 0, 5000), 'invalid_request', { field: 'gpr_overrides', team: id });
        }
    }
}

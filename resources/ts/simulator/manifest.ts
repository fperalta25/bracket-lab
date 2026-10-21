import { isExperimentalPreset } from './presets';
import { WINNER_CONSTRAINT_VERSION } from './conditional-series';
import { NORMAL_SAMPLER_VERSION } from './contextual';
import { CONTEXTUAL_ENGINE_VERSION, GPR_ENGINE_VERSION } from './gpr';
import { KEYED_RANDOM_VERSION } from './random';
import type { SimulationRequest } from './types';

export function modelManifest(request: SimulationRequest, ratings: Readonly<Record<string, number>>) {
    if (request.modelVersion === 'legacy-score-v1') {
        return { modelVersion: request.modelVersion, engineVersion: 'swiss16-legacy-v1',
            variance: request.variance, powerScores: { ...ratings },
            randomness: { algorithm: 'mulberry32-v1', hashVersion: null, streams: 'sequential-v1' } } as const;
    }
    const fixtures = request.scenario.mode === 'custom' ? request.scenario.fixtures : request.scenario.mode === 'official_state' ? request.snapshot.fixtures : [];
    const hasPicks = fixtures.some((f) => f.status === 'decided');
    const denominator = request.denominator ?? request.strengths.calibration.eloDenominator;
    return {
        modelVersion: request.modelVersion, engineVersion: hasPicks ? 'swiss16-gpr-winner-constraints-v1' : isExperimentalPreset(request.preset) ? CONTEXTUAL_ENGINE_VERSION : GPR_ENGINE_VERSION, preset: request.preset,
        profileSetId: request.strengths.id, profileRevision: request.strengths.revision,
        ratingSnapshot: { ...request.strengths.ratingSnapshot }, calibration: { ...request.strengths.calibration }, denominator,
        ...(hasPicks ? { winnerConstraints: WINNER_CONSTRAINT_VERSION } : {}),
        hypothetical: hasPicks || isExperimentalPreset(request.preset) || denominator !== request.strengths.calibration.eloDenominator || Object.keys(request.gprOverrides ?? {}).length > 0,
        effectiveRatings: { ...ratings },
        enabledTerms: isExperimentalPreset(request.preset) ? { context: false, ...request.contextualTerms! }
            : { context: false, tournamentForm: false, seriesForm: false, pressure: false, sequence: false },
        ...(isExperimentalPreset(request.preset) ? { contextual: {
            status: 'experimental', conditioning: 'prior_without_observed_games', normalSampler: NORMAL_SAMPLER_VERSION,
            pressureVersion: 'structural-intensity-v1', sequenceVersion: 'previous-game-v1',
        } } as const : {}),
        randomness: { ...KEYED_RANDOM_VERSION },
    } as const;
}

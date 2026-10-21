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
    const denominator = request.denominator ?? request.strengths.calibration.eloDenominator;
    return {
        modelVersion: request.modelVersion, engineVersion: request.preset === 'contextual_v1' ? CONTEXTUAL_ENGINE_VERSION : GPR_ENGINE_VERSION, preset: request.preset,
        profileSetId: request.strengths.id, profileRevision: request.strengths.revision,
        ratingSnapshot: { ...request.strengths.ratingSnapshot }, calibration: { ...request.strengths.calibration }, denominator,
        hypothetical: request.preset === 'contextual_v1' || denominator !== request.strengths.calibration.eloDenominator || Object.keys(request.gprOverrides ?? {}).length > 0,
        effectiveRatings: { ...ratings },
        enabledTerms: request.preset === 'contextual_v1' ? { context: false, ...request.contextualTerms! }
            : { context: false, tournamentForm: false, seriesForm: false, pressure: false, sequence: false },
        ...(request.preset === 'contextual_v1' ? { contextual: {
            status: 'experimental', conditioning: 'prior_without_observed_games', normalSampler: NORMAL_SAMPLER_VERSION,
            pressureVersion: 'structural-intensity-v1', sequenceVersion: 'previous-game-v1',
        } } as const : {}),
        randomness: { ...KEYED_RANDOM_VERSION },
    } as const;
}

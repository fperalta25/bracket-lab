import { GPR_ENGINE_VERSION } from './gpr';
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
        modelVersion: request.modelVersion, engineVersion: GPR_ENGINE_VERSION, preset: request.preset,
        profileSetId: request.strengths.id, profileRevision: request.strengths.revision,
        ratingSnapshot: { ...request.strengths.ratingSnapshot }, calibration: { ...request.strengths.calibration }, denominator,
        hypothetical: denominator !== request.strengths.calibration.eloDenominator || Object.keys(request.gprOverrides ?? {}).length > 0,
        effectiveRatings: { ...ratings },
        enabledTerms: { context: false, tournamentForm: false, seriesForm: false, pressure: false, sequence: false },
        randomness: { ...KEYED_RANDOM_VERSION },
    } as const;
}

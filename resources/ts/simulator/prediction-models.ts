import { trainedEloPayload } from './trained-elo';
import { createContextualProbabilities } from './contextual';
import { requireCondition } from './errors';
import { gprGameLogProbabilities, gprGameProbability } from './gpr';
import { canonicalPreset, isExperimentalPreset, validatePreset } from './presets';
import type { PredictionModel, PreGameContext, SimulatedWorldState } from './prediction';
import { gameProbability } from './series';
import type { SimulationRequest } from './types';

class ExperimentalWorldState implements SimulatedWorldState {
    readonly modelId = 'contextual_experimental_v2';
    constructor(readonly probability: ReturnType<typeof createContextualProbabilities>) {}
}

/** Prepare immutable ratings/probabilities once; every tournament owns a fresh model state. */
export function preparePredictionModel(request: SimulationRequest) {
    if (request.modelVersion !== 'legacy-score-v1') validatePreset(request.preset);
    const id = request.modelVersion === 'legacy-score-v1' ? 'legacy-score-v1' : canonicalPreset(request.preset);
    const learned = request.modelVersion === 'gpr-context-v2' && request.preset === 'historical_elo_trained_v1' ? trainedEloPayload(request.learnedModel!) : undefined;
    const divisor = learned ? learned.parameters.divisor / learned.parameters.logOddsSlope
        : request.modelVersion === 'gpr-context-v2' ? request.denominator ?? request.strengths.calibration.eloDenominator : 400;
    const ratings = learned ? Object.fromEntries(learned.teams.map((team) => [team.teamId, team.rating])) : request.modelVersion === 'legacy-score-v1'
        ? Object.fromEntries(request.snapshot.teams.map((team) => [team.id,
            request.powerScores && Object.hasOwn(request.powerScores, team.id) ? request.powerScores[team.id]! : team.powerScore]))
        : Object.fromEntries(request.strengths.profiles.map((profile) => [profile.teamId,
            request.gprOverrides && Object.hasOwn(request.gprOverrides, profile.teamId) ? request.gprOverrides[profile.teamId]! : profile.gpr]));
    const probability = (a: string, b: string) => request.modelVersion === 'legacy-score-v1'
        ? gameProbability(ratings[a]!, ratings[b]!, request.variance)
        : gprGameProbability(ratings[a]!, ratings[b]!, divisor);
    const probabilities = new Map(request.snapshot.teams.map((a) => [a.id,
        new Map(request.snapshot.teams.map((b) => [b.id, probability(a.id, b.id)]))]));
    const experimental = request.modelVersion !== 'legacy-score-v1' && isExperimentalPreset(request.preset);
    const model: PredictionModel = {
        id,
        createState(random) {
            if (experimental) {
                requireCondition('stream' in random, 'incompatible_model', { field: 'random_streams' });
                return new ExperimentalWorldState(createContextualProbabilities(request, ratings, random));
            }
            return { modelId: id };
        },
        predictGame(context: PreGameContext, state: SimulatedWorldState) {
            requireCondition(state.modelId === id, 'incompatible_model', { field: 'prediction_state' });
            if (experimental) {
                requireCondition(state instanceof ExperimentalWorldState, 'incompatible_model', { field: 'prediction_state' });
                const p = state.probability({ id: context.seriesId, stage: context.stage, round: context.round, slot: context.slot,
                    teamA: context.teamAId, teamB: context.teamBId, bestOf: context.bestOf, status: 'scheduled' });
                return { pWinA: p({ a: context.winsA, b: context.winsB, previousWinner: context.previousWinner }) };
            }
            return { pWinA: probabilities.get(context.teamAId)!.get(context.teamBId)! };
        },
        onGameResolved() { /* Current models obtain series history from the next pre-game context; no Elo rewards. */ },
        ...(!experimental && request.modelVersion !== 'legacy-score-v1' ? {
            stationaryGameLogProbabilities: (context: PreGameContext) => gprGameLogProbabilities(ratings[context.teamAId]!, ratings[context.teamBId]!,
                divisor),
        } : {}),
    };
    return { model, ratings, probabilities };
}

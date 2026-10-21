import { gprGameProbability } from './gpr';
import { standardNormal, type TournamentRandom } from './random';
import type { SeriesGameState } from './series';
import type { Fixture, GprSimulationRequest, StrengthProfile } from './types';

export const NORMAL_SAMPLER_VERSION = 'box-muller-cos-midpoint32-v1';

/** Structural intensity before the game; never rewards a team simply for trailing. */
export function pressureIntensity(fixture: Fixture, state: SeriesGameState): number {
    if (fixture.stage === 'swiss') {
        return fixture.bestOf === 3 ? (state.a === 1 && state.b === 1 ? 1 : 0.5) : 0;
    }
    return state.a === 2 && state.b === 2 ? 1 : 0.5;
}

export function sequenceAdjustment(profile: StrengthProfile, teamId: string, previousWinner: string | undefined): number {
    return previousWinner === undefined ? 0 : previousWinner === teamId ? profile.afterWinElo : profile.afterLossElo;
}

/** One isolated prior-form state per tournament. No observation conditioning or roster activation. */
export function createContextualProbabilities(request: GprSimulationRequest, ratings: Readonly<Record<string, number>>, random: TournamentRandom) {
    const terms = request.contextualTerms!; // Validated at the execution boundary.
    const profiles = new Map(request.strengths.profiles.map((profile) => [profile.teamId, profile]));
    const tournamentForm = new Map(request.strengths.profiles.map((profile) => [profile.teamId,
        terms.tournamentForm && profile.sigmaTournament > 0
            ? standardNormal(random.stream('tournament_form', profile.teamId)) * profile.sigmaTournament : 0]));
    // A repeated request for the same series reuses its state. IDs and translated labels are not RNG keys.
    const seriesCache = new Map<string, (state: SeriesGameState) => number>();
    return (fixture: Fixture): ((state: SeriesGameState) => number) => {
        const keys = [fixture.stage, fixture.round, fixture.slot, fixture.teamA, fixture.teamB];
        const key = JSON.stringify(keys);
        const cached = seriesCache.get(key);
        if (cached) return cached;
        const form = (id: string): number => {
            const profile = profiles.get(id)!;
            return terms.seriesForm && profile.sigmaSeries > 0
                ? standardNormal(random.stream('series_form', ...keys, id)) * profile.sigmaSeries : 0;
        };
        const baseA = ratings[fixture.teamA]! + tournamentForm.get(fixture.teamA)! + form(fixture.teamA);
        const baseB = ratings[fixture.teamB]! + tournamentForm.get(fixture.teamB)! + form(fixture.teamB);
        const probability = (state: SeriesGameState): number => {
            const intensity = terms.pressure ? pressureIntensity(fixture, state) : 0;
            const dynamic = (id: string): number => {
                const profile = profiles.get(id)!;
                return intensity * profile.pressureElo + (terms.sequence ? sequenceAdjustment(profile, id, state.previousWinner) : 0);
            };
            return gprGameProbability(baseA + dynamic(fixture.teamA), baseB + dynamic(fixture.teamB),
                request.denominator ?? request.strengths.calibration.eloDenominator);
        };
        seriesCache.set(key, probability);
        return probability;
    };
}

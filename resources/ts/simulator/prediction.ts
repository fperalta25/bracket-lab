import type { GameLogProbabilities } from './likelihood';
import type { TournamentRandom } from './random';
import type { SeriesGameState } from './series';
import type { BestOf, Fixture, RandomSource, Stage } from './types';

export const PREDICTION_CONTRACT_VERSION = 'pregame-model-v1';

/** Only pre-game facts. Unknown dates/rosters are omitted, never fabricated from future results. */
export interface PreGameContext {
    readonly seriesId: string;
    readonly teamAId: string;
    readonly teamBId: string;
    readonly stage: Stage;
    readonly round: number;
    readonly slot: number;
    readonly bestOf: BestOf;
    /** One-based position within this series, including any known prefix. */
    readonly gameIndex: number;
    readonly winsA: number;
    readonly winsB: number;
    readonly previousWinner: string | undefined;
    readonly atUtc?: string;
    readonly rosterAId?: string;
    readonly rosterBId?: string;
}

export interface Prediction { readonly pWinA: number }
export interface SimulatedWorldState { readonly modelId: string }
export interface GameResult {
    readonly context: PreGameContext;
    readonly winner: string;
    readonly origin: 'simulated' | 'constrained';
}

export interface PredictionModel {
    readonly id: string;
    createState(random: RandomSource | TournamentRandom): SimulatedWorldState;
    predictGame(context: PreGameContext, state: SimulatedWorldState): Prediction;
    onGameResolved(state: SimulatedWorldState, result: GameResult): void;
    /** Explicit capability for exact winner conditioning; absent for dynamic models. */
    stationaryGameLogProbabilities?(context: PreGameContext, state: SimulatedWorldState): GameLogProbabilities;
}

export function preGameContext(fixture: Fixture, state: SeriesGameState): PreGameContext {
    return { seriesId: fixture.id, teamAId: fixture.teamA, teamBId: fixture.teamB, stage: fixture.stage,
        round: fixture.round, slot: fixture.slot, bestOf: fixture.bestOf, gameIndex: state.a + state.b + 1,
        winsA: state.a, winsB: state.b, previousWinner: state.previousWinner };
}

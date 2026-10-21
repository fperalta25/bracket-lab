export type TeamId = string;
export type Region = 'LCK' | 'LPL' | 'LEC' | 'LCS' | 'LCP' | 'CBLOL';
export type Variance = 'low' | 'normal' | 'high';
export type BestOf = 1 | 3 | 5;
export type Stage = 'swiss' | 'quarterfinal' | 'semifinal' | 'final';
export type Pair = readonly [TeamId, TeamId];

export interface Team {
    readonly id: TeamId;
    readonly name: string;
    readonly acronym: string;
    readonly region: Region;
    readonly regionalSeed: number;
    readonly pool: number;
}

/** Historical development scores; never interpreted as GPR. */
export interface LegacyTeam extends Team { readonly powerScore: number }

export interface StrengthProfile {
    readonly teamId: TeamId;
    readonly ratingSnapshotId: string;
    readonly revision: number;
    readonly gpr: number;
    readonly consistency: 'high' | 'normal' | 'low';
    readonly sigmaTournament: number;
    readonly sigmaSeries: number;
    readonly pressureElo: number;
    readonly afterWinElo: number;
    readonly afterLossElo: number;
    readonly contextAdjustment: { readonly elo: number; readonly active: boolean; readonly condition: string | null };
    readonly calibrationStatus: 'experimental';
    readonly evidence: { readonly key: string; readonly sourceUrl: string;
        readonly confidence: 'medium' | 'medium_low' | 'low' | 'context_medium_magnitude_low' };
}

export interface StrengthProfileSet {
    readonly schemaVersion: 2;
    readonly modelVersion: 'gpr-context-v2';
    readonly id: string;
    readonly revision: number;
    readonly dataCutoffDate: string;
    readonly ratingSnapshot: { readonly id: string; readonly asOf: string; readonly sourceUrl: string; readonly publisher: string };
    readonly calibration: { readonly eloDenominator: number; readonly status: 'provisional'; readonly calibrationId: null };
    readonly profiles: readonly StrengthProfile[];
}

export interface Rules {
    readonly version: string;
    readonly teamCount: 16;
    readonly poolSize: 4;
    readonly firstRoundPoolPairs: readonly (readonly [number, number])[];
    readonly qualifyingWins: 3;
    readonly eliminationLosses: 3;
    readonly maxSwissRounds: 5;
    readonly knockoutBestOf: 5;
}

export const SWISS_16_RULES: Rules = Object.freeze({
    version: 'worlds-2026-v1', teamCount: 16, poolSize: 4,
    firstRoundPoolPairs: Object.freeze([Object.freeze([1, 4] as const), Object.freeze([2, 3] as const)]),
    qualifyingWins: 3, eliminationLosses: 3, maxSwissRounds: 5, knockoutBestOf: 5,
});

interface FixtureBase {
    readonly id: string;
    readonly stage: Stage;
    readonly round: number;
    readonly slot: number;
    readonly teamA: TeamId;
    readonly teamB: TeamId;
    readonly bestOf: BestOf;
    /** Omitted when the official game order is unknown. Scheduled games are a known prefix. */
    readonly games?: readonly TeamId[];
}

export type Fixture = FixtureBase & (
    | { readonly status: 'scheduled'; readonly score?: never }
    | { readonly status: 'completed'; readonly score: Readonly<{ a: number; b: number }> }
);

export interface TournamentSnapshot {
    readonly id: string;
    readonly revision: number | null;
    readonly rules: Rules;
    readonly teams: readonly Team[];
    readonly fixtures: readonly Fixture[];
}

export type LegacyTournamentSnapshot = Omit<TournamentSnapshot, 'teams'> & { readonly teams: readonly LegacyTeam[] };

export type Scenario =
    | { readonly mode: 'from_scratch' }
    | { readonly mode: 'official_state' }
    // A complete local constraints copy, rather than a patch that could silently retain old locks.
    | { readonly mode: 'custom'; readonly fixtures: readonly Fixture[] };

interface SimulationRequestBase {
    readonly snapshot: TournamentSnapshot;
    readonly scenario: Scenario;
    readonly iterations: number;
    readonly seed: number;
}

export interface LegacySimulationRequest extends SimulationRequestBase {
    readonly modelVersion: 'legacy-score-v1';
    readonly snapshot: LegacyTournamentSnapshot;
    readonly powerScores?: Readonly<Record<TeamId, number>>;
    readonly variance: Variance;
}

export interface ContextualTerms {
    readonly tournamentForm: boolean;
    readonly seriesForm: boolean;
    readonly pressure: boolean;
    readonly sequence: boolean;
}

export interface GprSimulationRequest extends SimulationRequestBase {
    readonly modelVersion: 'gpr-context-v2';
    readonly preset: 'gpr_baseline' | 'contextual_v1';
    /** Required explicitly for contextual; absent for baseline. Roster adjustments remain disabled. */
    readonly contextualTerms?: ContextualTerms;
    readonly strengths: StrengthProfileSet;
    /** An explicit sensitivity experiment; does not change calibration or individual sigmas. */
    readonly denominator?: number;
    readonly gprOverrides?: Readonly<Record<TeamId, number>>;
}

export type SimulationRequest = LegacySimulationRequest | GprSimulationRequest;

export interface RandomSource {
    next(): number;
    integer(exclusiveMax: number): number;
}

export const SWISS_RECORDS = ['3-0', '3-1', '3-2', '2-3', '1-3', '0-3'] as const;
export type SwissRecord = typeof SWISS_RECORDS[number];
export const FINAL_BUCKETS = ['champion', 'runner_up', 'semifinalist', 'quarterfinalist', '9_11', '12_14', '15_16'] as const;
export type FinalBucket = typeof FINAL_BUCKETS[number];

export interface PlayedMatch extends FixtureBase {
    readonly status: 'completed';
    readonly score: Readonly<{ a: number; b: number }>;
    readonly winner: TeamId;
    readonly origin: 'fixed' | 'simulated';
    readonly simulatedGames: number;
}

export interface RematchException {
    readonly round: number;
    readonly record: string;
    readonly count: number;
}

export interface TournamentResult {
    readonly simulationIndex?: number;
    readonly matches: readonly PlayedMatch[];
    readonly swissRecords: Readonly<Record<TeamId, SwissRecord>>;
    readonly finishes: Readonly<Record<TeamId, FinalBucket>>;
    readonly rematchExceptions: readonly RematchException[];
}

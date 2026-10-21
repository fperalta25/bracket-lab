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
    readonly powerScore: number;
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

export type Scenario =
    | { readonly mode: 'from_scratch' }
    | { readonly mode: 'official_state' }
    // A complete local constraints copy, rather than a patch that could silently retain old locks.
    | { readonly mode: 'custom'; readonly fixtures: readonly Fixture[] };

export interface SimulationRequest {
    readonly snapshot: TournamentSnapshot;
    readonly scenario: Scenario;
    readonly powerScores?: Readonly<Record<TeamId, number>>;
    readonly variance: Variance;
    readonly iterations: number;
    readonly seed: number;
}

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
    readonly matches: readonly PlayedMatch[];
    readonly swissRecords: Readonly<Record<TeamId, SwissRecord>>;
    readonly finishes: Readonly<Record<TeamId, FinalBucket>>;
    readonly rematchExceptions: readonly RematchException[];
}

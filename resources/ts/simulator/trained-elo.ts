import frozen from '../../../models/artifacts/internal-elo-trained-2026-10-21-v1.json';
import formFrozen from '../../../models/artifacts/internal-elo-last-observed-form-2026-10-21-v1.json';
import { requireCondition } from './errors';
import type { Team } from './types';

export interface TrainedEloArtifact { readonly schemaVersion: number; readonly sha256: string; readonly payloadJson: string }
export interface TrainedEloPayload {
    readonly schemaVersion: number; readonly modelId: string; readonly status: 'trained_experimental'; readonly recommended: false;
    readonly cutoffUtc: string; readonly parameterSelectionEndUtc: string;
    readonly parameters: { readonly initialRating: number; readonly k: number; readonly divisor: number; readonly logOddsSlope: number; readonly availabilityAssumedDays: number; readonly formSourceDays?: number; readonly formCoefficient?: number; readonly formShrinkageDays?: number };
    readonly teams: readonly { readonly teamId: string; readonly acronym: string; readonly rating: number; readonly games: number;
        readonly sourceTeamId: string | null; readonly sourceName: string | null; readonly lastGameUtc: string | null; readonly status: 'learned' | 'prior_only'; readonly formRatingAdjustment?: number;
        readonly form?: { readonly status: 'estimated' | 'missing'; readonly value: number | null; readonly days: number; readonly games: number; readonly age_days: number | null } }[];
    readonly source: Readonly<Record<string, string>>;
}
// Immutable registry entry. Existing artifacts must stay bundled when a new version is added.
const registry = [frozen, formFrozen];
export type LearnedVariant = 'elo' | 'form';
export function defaultTrainedEloArtifact(variant: LearnedVariant = 'elo'): TrainedEloArtifact { return JSON.parse(JSON.stringify(variant === 'form' ? formFrozen : frozen)) as TrainedEloArtifact; }
export function trainedEloPayload(value: TrainedEloArtifact): TrainedEloPayload {
    requireCondition(value && registry.some((entry) => value.schemaVersion === entry.schemaVersion && value.sha256 === entry.sha256 && value.payloadJson === entry.payloadJson), 'incompatible_model', { field: 'trained_artifact' });
    return JSON.parse(value.payloadJson) as TrainedEloPayload;
}
export function validateTrainedEloArtifact(value: TrainedEloArtifact, teams: readonly Team[]): void {
    const payload = trainedEloPayload(value);
    requireCondition(payload.status === 'trained_experimental' && payload.recommended === false
        && payload.teams.length === teams.length && new Set(payload.teams.map((team) => team.teamId)).size === teams.length
        && teams.every((team) => payload.teams.some((entry) => entry.teamId === team.id))
        && payload.teams.every((team) => Number.isFinite(team.rating) && Number.isSafeInteger(team.games) && team.games >= 0),
    'incompatible_model', { field: 'trained_team_coverage' });
}

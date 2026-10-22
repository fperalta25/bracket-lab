import frozen from '../../../models/artifacts/internal-elo-trained-2026-10-21-v1.json';
import { requireCondition } from './errors';
import type { Team } from './types';

export interface TrainedEloArtifact { readonly schemaVersion: number; readonly sha256: string; readonly payloadJson: string }
export interface TrainedEloPayload {
    readonly schemaVersion: number; readonly modelId: string; readonly status: 'trained_experimental'; readonly recommended: false;
    readonly cutoffUtc: string; readonly parameterSelectionEndUtc: string;
    readonly parameters: { readonly initialRating: number; readonly k: number; readonly divisor: number; readonly logOddsSlope: number; readonly availabilityAssumedDays: number };
    readonly teams: readonly { readonly teamId: string; readonly acronym: string; readonly rating: number; readonly games: number;
        readonly sourceTeamId: string | null; readonly sourceName: string | null; readonly lastGameUtc: string | null; readonly status: 'learned' | 'prior_only' }[];
    readonly source: Readonly<Record<string, string>>;
}
// Immutable registry entry. Existing artifacts must stay bundled when a new version is added.
const frozenJson = JSON.stringify(frozen);
export function defaultTrainedEloArtifact(): TrainedEloArtifact { return JSON.parse(frozenJson) as TrainedEloArtifact; }
export function trainedEloPayload(value: TrainedEloArtifact): TrainedEloPayload {
    requireCondition(value && value.schemaVersion === frozen.schemaVersion && value.sha256 === frozen.sha256
        && value.payloadJson === frozen.payloadJson, 'incompatible_model', { field: 'trained_artifact' });
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

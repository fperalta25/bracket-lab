import { requireCondition } from './errors';
import type { BestOf, FinalBucket, PlayedMatch, SwissRecord, Team } from './types';

export interface SwissState {
    wins: number;
    losses: number;
    opponents: Set<string>;
}

export const recordOf = (state: SwissState): string => `${state.wins}-${state.losses}`;
export const swissBestOf = (state: SwissState): BestOf => state.wins === 2 || state.losses === 2 ? 3 : 1;
export const isActive = (state: SwissState): boolean => state.wins < 3 && state.losses < 3;

export function createSwissState(teams: readonly Team[]): Map<string, SwissState> {
    return new Map(teams.map((team) => [team.id, { wins: 0, losses: 0, opponents: new Set<string>() }]));
}

export function applySwissMatch(states: Map<string, SwissState>, match: Pick<PlayedMatch, 'teamA' | 'teamB' | 'winner'>): void {
    const a = states.get(match.teamA)!;
    const b = states.get(match.teamB)!;
    a.opponents.add(match.teamB);
    b.opponents.add(match.teamA);
    if (match.winner === match.teamA) { a.wins++; b.losses++; }
    else { b.wins++; a.losses++; }
}

export function finalSwissRecords(states: Map<string, SwissState>): Record<string, SwissRecord> {
    const records: Record<string, SwissRecord> = {};
    const counts = new Map<string, number>();
    for (const [id, state] of states) {
        requireCondition(!isActive(state), 'invariant_violation', { team: id });
        const record = recordOf(state) as SwissRecord;
        records[id] = record;
        counts.set(record, (counts.get(record) ?? 0) + 1);
    }
    for (const [record, count] of Object.entries({ '3-0': 2, '3-1': 3, '3-2': 3, '2-3': 3, '1-3': 3, '0-3': 2 })) {
        requireCondition(counts.get(record) === count, 'invariant_violation', { record });
    }
    return records;
}

export function eliminatedBucket(record: SwissRecord): FinalBucket | undefined {
    if (record === '2-3') return '9_11';
    if (record === '1-3') return '12_14';
    if (record === '0-3') return '15_16';
    return undefined;
}

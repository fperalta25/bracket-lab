import { requireCondition } from './errors';
import { samePair } from './pairing';
import type { Fixture, Pair, RandomSource, SwissRecord, TeamId } from './types';

export interface BracketSampler {
    readonly count: number;
    sample(random: RandomSource): readonly Pair[];
}

/** Enumerates the 288 distinct slot-aware legal brackets, ignoring pair orientation. */
export function knockoutSampler(records: Readonly<Record<TeamId, SwissRecord>>, locks: readonly Fixture[] = []): BracketSampler {
    const entries = Object.entries(records).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    const undefeated = entries.filter(([, record]) => record === '3-0').map(([id]) => id);
    const middle = entries.filter(([, record]) => record === '3-1').map(([id]) => id);
    const last = entries.filter(([, record]) => record === '3-2').map(([id]) => id);
    requireCondition(undefeated.length === 2 && middle.length === 3 && last.length === 3, 'invalid_constraints', { stage: 'quarterfinal' });
    const brackets: Pair[][] = [];
    for (let firstSlot = 0; firstSlot < 4; firstSlot++) {
        for (let secondSlot = 0; secondSlot < 4; secondSlot++) {
            if (Math.floor(firstSlot / 2) === Math.floor(secondSlot / 2)) continue;
            for (const firstOpponent of last) {
                for (const secondOpponent of last) {
                    if (firstOpponent === secondOpponent) continue;
                    const remaining = [...middle, ...last.filter((id) => id !== firstOpponent && id !== secondOpponent)].sort();
                    const emptySlots = [0, 1, 2, 3].filter((slot) => slot !== firstSlot && slot !== secondSlot);
                    for (let i = 0; i < 4; i++) {
                        for (let j = i + 1; j < 4; j++) {
                            const rest = remaining.filter((_, index) => index !== i && index !== j);
                            const bracket: Pair[] = [];
                            bracket[firstSlot] = [undefeated[0]!, firstOpponent];
                            bracket[secondSlot] = [undefeated[1]!, secondOpponent];
                            bracket[emptySlots[0]!] = [remaining[i]!, remaining[j]!];
                            bracket[emptySlots[1]!] = [rest[0]!, rest[1]!];
                            if (locks.every((fixture) => fixture.slot >= 1 && fixture.slot <= 4
                                && samePair(bracket[fixture.slot - 1]!, [fixture.teamA, fixture.teamB]))) brackets.push(bracket);
                        }
                    }
                }
            }
        }
    }
    requireCondition(brackets.length > 0, 'impossible_pairing', { stage: 'quarterfinal' });
    return { count: brackets.length, sample: (random) => brackets[brackets.length === 1 ? 0 : random.integer(brackets.length)]!.map(([a, b]) => [a, b]) };
}

import { requireCondition } from './errors';
import type { Pair, RandomSource, Rules, Team } from './types';

interface Completion { readonly cost: number; readonly count: number }
export interface PairingSampler {
    readonly count: number;
    readonly minimumRematches: number;
    sample(random: RandomSource): Pair[];
}

/** Counts optimal complete matchings, then samples by completion count, never greedily. */
export function createPairingSampler(
    participants: readonly string[],
    allowed: (a: string, b: string) => boolean,
    repeated: (a: string, b: string) => boolean = () => false,
    locks: readonly Pair[] = [],
): PairingSampler {
    const ids = [...participants].sort();
    requireCondition(ids.length <= 16 && ids.length % 2 === 0 && new Set(ids).size === ids.length, 'impossible_pairing');
    let mask = (1 << ids.length) - 1;
    let lockedCost = 0;
    for (const [a, b] of locks) {
        const i = ids.indexOf(a);
        const j = ids.indexOf(b);
        requireCondition(i >= 0 && j >= 0 && i !== j && (mask & (1 << i)) && (mask & (1 << j)) && allowed(a, b),
            'impossible_pairing', { teamA: a, teamB: b });
        mask &= ~(1 << i) & ~(1 << j);
        lockedCost += Number(repeated(a, b));
    }
    const edges = ids.map((a, i) => ids.map((b, j) => i !== j && allowed(a, b) ? Number(repeated(a, b)) : Infinity));
    const memo = new Map<number, Completion>([[0, { cost: 0, count: 1 }]]);
    const first = (bits: number): number => 31 - Math.clz32(bits & -bits);
    const count = (bits: number): Completion => {
        const cached = memo.get(bits);
        if (cached) return cached;
        const i = first(bits);
        const remaining = bits & ~(1 << i);
        let bestCost = Infinity;
        let completions = 0;
        for (let candidates = remaining; candidates; candidates &= candidates - 1) {
            const j = first(candidates);
            const edge = edges[i]![j]!;
            if (!Number.isFinite(edge)) continue;
            const child = count(remaining & ~(1 << j));
            const cost = edge + child.cost;
            if (cost < bestCost) { bestCost = cost; completions = child.count; }
            else if (cost === bestCost) completions += child.count;
        }
        const result = { cost: bestCost, count: completions };
        memo.set(bits, result);
        return result;
    };
    const root = count(mask);
    requireCondition(root.count > 0, 'impossible_pairing');
    return {
        count: root.count,
        minimumRematches: lockedCost + root.cost,
        sample(random) {
            const pairs: Pair[] = locks.map(([a, b]) => [a, b]);
            let bits = mask;
            while (bits) {
                const current = count(bits);
                let ticket = current.count === 1 ? 0 : random.integer(current.count);
                const i = first(bits);
                const remaining = bits & ~(1 << i);
                for (let candidates = remaining; candidates; candidates &= candidates - 1) {
                    const j = first(candidates);
                    const child = count(remaining & ~(1 << j));
                    if (edges[i]![j]! + child.cost !== current.cost || !child.count) continue;
                    if (ticket < child.count) {
                        pairs.push([ids[i]!, ids[j]!]);
                        bits = remaining & ~(1 << j);
                        break;
                    }
                    ticket -= child.count;
                }
            }
            return pairs;
        },
    };
}

export function samePair(a: Pair, b: Pair): boolean {
    return (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);
}

export function firstRoundSampler(teams: readonly Team[], rules: Rules, locks: readonly Pair[] = []): PairingSampler {
    const byId = new Map(teams.map((team) => [team.id, team]));
    return createPairingSampler(teams.map((team) => team.id), (a, b) => {
        const first = byId.get(a)!;
        const second = byId.get(b)!;
        return first.region !== second.region && rules.firstRoundPoolPairs.some(([x, y]) =>
            (first.pool === x && second.pool === y) || (first.pool === y && second.pool === x));
    }, undefined, locks);
}

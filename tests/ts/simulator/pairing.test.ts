import { describe, expect, it } from 'vitest';
import { createPairingSampler, firstRoundSampler } from '../../../resources/ts/simulator/pairing';
import { createRandom } from '../../../resources/ts/simulator/random';
import { SWISS_16_RULES, type Pair, type Team } from '../../../resources/ts/simulator/types';
import seed from '../../../database/data/worlds-2026.json';

const teams = seed.teams.map((team) => ({ ...team, regionalSeed: team.regional_seed, powerScore: team.power_score })) as Team[];
const key = (pairs: readonly Pair[]): string => pairs.map((pair) => [...pair].sort().join('-')).sort().join('|');

describe('complete uniform matching', () => {
    it('counts known combinatorial totals, including the empty completion', () => {
        expect(createPairingSampler([], () => true).count).toBe(1);
        expect(createPairingSampler(['a', 'b', 'c', 'd'], () => true).count).toBe(3);
        expect(createPairingSampler(['a', 'b', 'c', 'd', 'e', 'f'], () => true).count).toBe(15);
        expect(createPairingSampler(Array.from({ length: 16 }, (_, i) => String(i)), () => true).count).toBe(2027025);
    });

    it('backtracks past a locally valid edge that prevents completion', () => {
        const allowed = (a: string, b: string): boolean => ['a-b', 'a-c', 'b-d'].includes([a, b].sort().join('-'));
        const sampler = createPairingSampler(['a', 'b', 'c', 'd'], allowed);
        expect(sampler.count).toBe(1);
        expect(key(sampler.sample(createRandom(1)))).toBe('a-c|b-d');
        expect(() => createPairingSampler(['a', 'b', 'c', 'd'], allowed, undefined, [['a', 'b']])).toThrow('impossible_pairing');
    });

    it('weights local choices by their unequal numbers of complete solutions', () => {
        const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
        const sampler = createPairingSampler(ids, (a, b) => !['b-c', 'b-d'].includes([a, b].sort().join('-')));
        expect(sampler.count).toBe(9);
        const random = createRandom(1919);
        const frequencies = new Map<string, number>();
        for (let i = 0; i < 45000; i++) {
            const draw = key(sampler.sample(random));
            frequencies.set(draw, (frequencies.get(draw) ?? 0) + 1);
        }
        expect(frequencies.size).toBe(9);
        for (const count of frequencies.values()) expect(Math.abs(count - 5000)).toBeLessThan(300);
    });

    it('minimizes total rematches globally and samples optimal solutions uniformly', () => {
        const ids = ['a', 'b', 'c', 'd'];
        // Every complete draw needs at least one rematch; two optimal solutions, one worse.
        const repeated = (a: string, b: string): boolean => ['a-b', 'a-c', 'a-d', 'c-d'].includes([a, b].sort().join('-'));
        const sampler = createPairingSampler(ids, () => true, repeated);
        expect(sampler.minimumRematches).toBe(1);
        expect(sampler.count).toBe(2);
        const random = createRandom(22);
        const frequencies = new Map<string, number>();
        for (let i = 0; i < 10000; i++) {
            const pairs = sampler.sample(random);
            expect(pairs.filter(([a, b]) => repeated(a, b))).toHaveLength(1);
            frequencies.set(key(pairs), (frequencies.get(key(pairs)) ?? 0) + 1);
        }
        expect(frequencies.size).toBe(2);
        for (const count of frequencies.values()) expect(Math.abs(count - 5000)).toBeLessThan(250);
        const clean = createPairingSampler(ids, () => true, (a, b) => [a, b].sort().join('-') === 'a-b');
        expect(clean.minimumRematches).toBe(0);
        expect(clean.count).toBe(2);
    });

    it('keeps valid locks and rejects duplicate, odd or unknown participants', () => {
        const sampler = createPairingSampler(['a', 'b', 'c', 'd'], () => true, undefined, [['b', 'a']]);
        expect(sampler.sample(createRandom(1))[0]).toEqual(['b', 'a']);
        expect(() => createPairingSampler(['a'], () => true)).toThrow('impossible_pairing');
        expect(() => createPairingSampler(['a', 'a'], () => true)).toThrow('impossible_pairing');
        expect(() => createPairingSampler(['a', 'b'], () => true, undefined, [['a', 'x']])).toThrow('impossible_pairing');
        expect(() => createPairingSampler(['a', 'b'], () => false)).toThrow('impossible_pairing');
    });
});

describe('first round bipartite pool draw', () => {
    it('produces thousands of complete cross-pool and cross-region draws', () => {
        const sampler = firstRoundSampler(teams, SWISS_16_RULES);
        const random = createRandom(88);
        for (let i = 0; i < 3000; i++) {
            const pairs = sampler.sample(random);
            expect(new Set(pairs.flat()).size).toBe(16);
            for (const [a, b] of pairs) {
                const first = teams.find((team) => team.id === a)!;
                const second = teams.find((team) => team.id === b)!;
                expect(first.pool + second.pool).toBe(5);
                expect(first.region).not.toBe(second.region);
            }
        }
    });

    it('respects a partial official draw and cannot relax regional restrictions', () => {
        const lock: Pair = [seed.fixtures[0]!.team_a_id, seed.fixtures[0]!.team_b_id];
        expect(firstRoundSampler(teams, SWISS_16_RULES, [lock]).sample(createRandom(1))[0]).toEqual(lock);
        expect(() => firstRoundSampler(teams.map((team) => ({ ...team, region: 'LCK' })), SWISS_16_RULES)).toThrow('impossible_pairing');
    });
});

import { describe, expect, it } from 'vitest';
import { knockoutSampler } from '../../../resources/ts/simulator/knockout';
import { createRandom } from '../../../resources/ts/simulator/random';
import type { Fixture, SwissRecord } from '../../../resources/ts/simulator/types';

const records: Record<string, SwissRecord> = { a: '3-0', b: '3-0', c: '3-1', d: '3-1', e: '3-1', f: '3-2', g: '3-2', h: '3-2' };
const lock = (slot: number, teamA: string, teamB: string): Fixture => ({ id: `q${slot}`, stage: 'quarterfinal', round: 1,
    slot, teamA, teamB, bestOf: 5, status: 'scheduled' });

describe('slot-aware knockout bracket', () => {
    it('has 288 unique uniformly sampled legal brackets with opposite undefeated teams', () => {
        const sampler = knockoutSampler(records);
        expect(sampler.count).toBe(288);
        const random = createRandom(39);
        const seen = new Set<string>();
        for (let i = 0; i < 10000; i++) {
            const bracket = sampler.sample(random);
            const first = bracket.findIndex((pair) => pair.includes('a'));
            const second = bracket.findIndex((pair) => pair.includes('b'));
            expect(Math.floor(first / 2)).not.toBe(Math.floor(second / 2));
            for (const team of ['a', 'b']) {
                const opponent = bracket.find((pair) => pair.includes(team))!.find((id) => id !== team)!;
                expect(records[opponent]).toBe('3-2');
            }
            expect(new Set(bracket.flat()).size).toBe(8);
            seen.add(bracket.map((pair) => [...pair].sort().join('-')).join('|'));
        }
        expect(seen.size).toBe(288);
    });

    it('preserves partial official quarterfinal slots and allows Swiss rematches', () => {
        const sampler = knockoutSampler(records, [lock(2, 'f', 'a')]);
        expect(sampler.count).toBe(24);
        expect(sampler.sample(createRandom(1))[1]).toContain('a');
        expect(sampler.sample(createRandom(1))[1]).toContain('f');
        expect(() => knockoutSampler(records, [lock(1, 'a', 'c')])).toThrow('impossible_pairing');
        expect(() => knockoutSampler(records, [lock(1, 'a', 'f'), lock(2, 'b', 'g')])).toThrow('impossible_pairing');
    });
});

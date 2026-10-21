import { describe, expect, it } from 'vitest';
import { createRandom } from '../../../resources/ts/simulator/random';
import { gameProbability, playSeries } from '../../../resources/ts/simulator/series';
import type { BestOf, Fixture, RandomSource } from '../../../resources/ts/simulator/types';

const fixture = (bestOf: BestOf): Fixture => ({ id: 'm', stage: 'swiss', round: 1, slot: 1,
    teamA: 'a', teamB: 'b', bestOf, status: 'scheduled' });

describe('reproducible randomness and game model', () => {
    it('uses a stable Mulberry32 sequence, including seed zero', () => {
        const random = createRandom(1);
        expect(Array.from({ length: 4 }, () => random.next())).toEqual([
            0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741,
        ]);
        const a = createRandom(0);
        const b = createRandom(0);
        expect(Array.from({ length: 100 }, () => a.next())).toEqual(Array.from({ length: 100 }, () => b.next()));
        expect(createRandom(2).next()).not.toBe(createRandom(1).next());
        expect(() => createRandom(-1)).toThrow('invalid_request');
        expect(() => a.integer(0)).toThrow('invalid_request');
        for (let i = 0; i < 1000; i++) expect(a.integer(3)).toBeOneOf([0, 1, 2]);
    });

    it('is symmetric, monotonic and exactly 50/50 at equal power for every variance', () => {
        for (const variance of ['low', 'normal', 'high'] as const) {
            expect(gameProbability(50, 50, variance)).toBe(0.5);
            for (let power = 0; power < 100; power++) {
                expect(gameProbability(power, 35, variance) + gameProbability(35, power, variance)).toBeCloseTo(1, 14);
                expect(gameProbability(power + 1, 35, variance)).toBeGreaterThan(gameProbability(power, 35, variance));
            }
        }
        expect(gameProbability(70, 40, 'low')).toBeGreaterThan(gameProbability(70, 40, 'high'));
        expect(() => gameProbability(NaN, 50, 'normal')).toThrow('invalid_request');
    });
});

describe('individual games and series', () => {
    it('stops Bo1/Bo3/Bo5 at 1/2/3 wins with no extra random draw', () => {
        for (const bestOf of [1, 3, 5] as const) {
            let calls = 0;
            const random: RandomSource = { next: () => { calls++; return 0; }, integer: () => 0 };
            const result = playSeries(fixture(bestOf), 0.5, random);
            expect(result.score).toEqual({ a: (bestOf + 1) / 2, b: 0 });
            expect(result.games).toHaveLength((bestOf + 1) / 2);
            expect(calls).toBe((bestOf + 1) / 2);
            expect(result.winner).toBe('a');
        }
    });

    it('preserves official scores without inventing game order or consuming randomness', () => {
        const random: RandomSource = { next: () => { throw new Error('unexpected draw'); }, integer: () => 0 };
        const result = playSeries({ ...fixture(3), status: 'completed', score: { a: 1, b: 2 } }, 1, random);
        expect(result.winner).toBe('b');
        expect(result.games).toBeUndefined();
        expect(result.simulatedGames).toBe(0);
    });

    it('resumes known game prefixes and rejects incoherent scores or extra games', () => {
        const result = playSeries({ ...fixture(3), games: ['b', 'a'] }, 1, createRandom(3));
        expect(result.games).toEqual(['b', 'a', 'a']);
        expect(result.simulatedGames).toBe(1);
        expect(() => playSeries({ ...fixture(3), status: 'completed', score: { a: 2, b: 2 } }, 0.5, createRandom(1))).toThrow('invalid_score');
        expect(() => playSeries({ ...fixture(3), status: 'completed', score: { a: 2, b: 1 }, games: ['a', 'a', 'b'] }, 0.5, createRandom(1))).toThrow('invalid_score');
        expect(() => playSeries({ ...fixture(3), games: ['a', 'a'] }, 0.5, createRandom(1))).toThrow('invalid_score');
    });
});

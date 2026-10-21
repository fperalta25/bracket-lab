import { requireCondition } from './errors';
import type { RandomSource } from './types';

/** Mulberry32: explicit unsigned 32-bit state, including seed zero. */
export function createRandom(seed: number): RandomSource {
    requireCondition(Number.isInteger(seed) && seed >= 0 && seed <= 0xffff_ffff, 'invalid_request', { field: 'seed' });
    let state = seed >>> 0;
    const uint32 = (): number => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = Math.imul(state ^ (state >>> 15), state | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return (value ^ (value >>> 14)) >>> 0;
    };
    return {
        next: () => uint32() / 0x1_0000_0000,
        integer(exclusiveMax) {
            requireCondition(Number.isInteger(exclusiveMax) && exclusiveMax > 0 && exclusiveMax <= 0x1_0000_0000,
                'invalid_request', { field: 'random_bound' });
            // Rejection avoids modulo bias in weighted matching and bracket draws.
            const limit = Math.floor(0x1_0000_0000 / exclusiveMax) * exclusiveMax;
            let value: number;
            do { value = uint32(); } while (value >= limit);
            return value % exclusiveMax;
        },
    };
}

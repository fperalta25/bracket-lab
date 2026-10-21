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

export const KEYED_RANDOM_VERSION = Object.freeze({ algorithm: 'mulberry32-v1', hashVersion: 'fnv1a-utf16le-v1', streams: 'event-keyed-v1' });
export type RandomFamily = 'pairing' | 'game' | 'tournament_form' | 'series_form' | 'posterior';
export type RandomKey = string | number;
export interface TournamentRandom {
    readonly simulationIndex: number;
    stream(family: RandomFamily, ...keys: readonly RandomKey[]): RandomSource;
}

/** Length-safe JSON tuple hashed as explicit UTF-16LE bytes, independent of locale/platform. */
export function createKeyedRandom(seed: number, simulationIndex: number, family: RandomFamily, ...keys: readonly RandomKey[]): RandomSource {
    requireCondition(Number.isInteger(seed) && seed >= 0 && seed <= 0xffff_ffff
        && Number.isSafeInteger(simulationIndex) && simulationIndex >= 0, 'invalid_request', { field: 'random_key' });
    requireCondition(keys.every((key) => typeof key === 'string' || Number.isFinite(key)), 'invalid_request', { field: 'random_key' });
    const serialized = JSON.stringify([seed, simulationIndex, family, ...keys]);
    let hash = 0x811c9dc5;
    for (let i = 0; i < serialized.length; i++) {
        const unit = serialized.charCodeAt(i);
        hash = Math.imul(hash ^ (unit & 0xff), 0x01000193);
        hash = Math.imul(hash ^ (unit >>> 8), 0x01000193);
    }
    return createRandom(hash >>> 0);
}

export function createTournamentRandom(seed: number, simulationIndex: number): TournamentRandom {
    requireCondition(Number.isInteger(seed) && seed >= 0 && seed <= 0xffff_ffff
        && Number.isSafeInteger(simulationIndex) && simulationIndex >= 0, 'invalid_request', { field: 'random_key' });
    return { simulationIndex, stream: (family, ...keys) => createKeyedRandom(seed, simulationIndex, family, ...keys) };
}

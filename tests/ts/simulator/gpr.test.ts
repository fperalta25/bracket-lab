import { describe, expect, it } from 'vitest';
import strengths from '../../../database/data/worlds-2026-strengths-v2.json';
import source from '../../../docs/WORLDS_2026_STRENGTH_PROFILES_V2.json';
import seed from '../../../database/data/worlds-2026.json';
import { gprGameProbability, validateStrengthProfiles } from '../../../resources/ts/simulator/gpr';
import { createRandom } from '../../../resources/ts/simulator/random';
import { playSeries } from '../../../resources/ts/simulator/series';
import type { StrengthProfileSet, Team } from '../../../resources/ts/simulator/types';

const profiles = (): StrengthProfileSet => JSON.parse(JSON.stringify(strengths)) as StrengthProfileSet;
const teams: Team[] = seed.teams.map((team) => ({ id: team.id, name: team.name, acronym: team.acronym,
    region: team.region as Team['region'], regionalSeed: team.regional_seed, pool: team.pool }));

describe('dated GPR profile set', () => {
    it('matches the complete supplied snapshot by stable IDs and acronym, independently of row order', () => {
        validateStrengthProfiles(profiles(), [...teams].reverse());
        expect(strengths.ratingSnapshot.asOf).toBe('2026-10-19');
        expect(strengths.calibration).toEqual({ eloDenominator: 400, status: 'provisional', calibrationId: null });
        const confidence: Record<string, string> = { media: 'medium', 'media-baja': 'medium_low', baja: 'low',
            'media (contexto), baja (magnitud)': 'context_medium_magnitude_low' };
        for (const profile of strengths.profiles) {
            const team = teams.find((team) => team.id === profile.teamId)!;
            const original = source.profiles.find((item) => item.team_acronym === team.acronym)!;
            expect(original.region).toBe(team.region);
            expect(profile.gpr).toBe(original.gpr_rating);
            expect(profile.sigmaTournament).toBe(original.sigma_tournament);
            expect(profile.sigmaSeries).toBe(original.sigma_series);
            expect(profile.pressureElo).toBe(original.pressure_elo_experimental);
            expect(profile.afterWinElo).toBe(0);
            expect(profile.afterLossElo).toBe(0);
            expect(profile.contextAdjustment.elo).toBe(original.context_adjustment_elo_experimental);
            expect(profile.contextAdjustment.active).toBe(false);
            expect(profile.calibrationStatus).toBe('experimental');
            expect(profile.evidence.confidence).toBe(confidence[original.confidence_label]);
        }
    });

    it('rejects missing, duplicated, foreign and invalid profiles before simulation', () => {
        const base = profiles();
        expect(() => validateStrengthProfiles({ ...base, profiles: base.profiles.slice(1) }, teams)).toThrow('invalid_request');
        expect(() => validateStrengthProfiles({ ...base, profiles: [base.profiles[1]!, ...base.profiles.slice(1)] }, teams)).toThrow('invalid_request');
        for (const patch of [
            { teamId: 'foreign' }, { gpr: NaN }, { gpr: 5001 }, { sigmaTournament: -1 }, { sigmaSeries: Infinity },
            { ratingSnapshotId: 'other' }, { consistency: 'inconsistent' }, { pressureElo: 101 },
        ]) {
            const altered = { ...base, profiles: [{ ...base.profiles[0], ...patch }, ...base.profiles.slice(1)] } as StrengthProfileSet;
            expect(() => validateStrengthProfiles(altered, teams)).toThrow('invalid_request');
        }
        expect(() => validateStrengthProfiles({ ...base, ratingSnapshot: { ...base.ratingSnapshot, asOf: '2026-10-22' } }, teams)).toThrow('invalid_request');
        expect(() => validateStrengthProfiles({ ...base, ratingSnapshot: { ...base.ratingSnapshot, asOf: '2026-02-30' } }, teams)).toThrow('invalid_request');
        const active = { ...base.profiles[0]!, contextAdjustment: { elo: -25, active: true, condition: null } };
        expect(() => validateStrengthProfiles({ ...base, profiles: [active, ...base.profiles.slice(1)] }, teams)).toThrow('unsupported_model');
    });
});

describe('provisional Elo game model', () => {
    it('uses original rating distances with D=400 and no 5% floor', () => {
        expect(gprGameProbability(1400, 1400)).toBe(0.5);
        expect(gprGameProbability(1800, 1400)).toBeCloseTo(10 / 11, 14);
        expect(gprGameProbability(1400, 1800)).toBeCloseTo(1 / 11, 14);
        expect(gprGameProbability(1400 + 400 * Math.log10(9), 1400)).toBeCloseTo(0.9, 14);
        expect(gprGameProbability(800, 1800)).toBeLessThan(0.05);
        expect(gprGameProbability(1800, 800)).toBeGreaterThan(0.95);
    });

    it('is symmetric, monotonic and numerically stable for extreme finite ratings', () => {
        for (const denominator of [200, 320, 400, 520, 800]) {
            let previous = -1;
            for (let a = -10000; a <= 10000; a += 50) {
                const probability = gprGameProbability(a, 1400, denominator);
                expect(probability + gprGameProbability(1400, a, denominator)).toBeCloseTo(1, 14);
                expect(probability).toBeGreaterThanOrEqual(previous);
                expect(Number.isFinite(probability) && probability >= 0 && probability <= 1).toBe(true);
                previous = probability;
            }
        }
        expect(gprGameProbability(Number.MAX_VALUE, -Number.MAX_VALUE)).toBe(1);
        expect(gprGameProbability(-Number.MAX_VALUE, Number.MAX_VALUE)).toBe(0);
        expect(() => gprGameProbability(NaN, 1400)).toThrow('invalid_request');
        for (const denominator of [0, -1, 199, 801, NaN, Infinity]) expect(() => gprGameProbability(1500, 1400, denominator)).toThrow('invalid_request');
    });

    it('matches exact stationary Bo3 and Bo5 probabilities within five Monte Carlo standard errors', () => {
        const trials = 25000;
        for (const p of [0.2, 0.5, 0.8]) {
            const rating = 1400 + 400 * Math.log10(p / (1 - p));
            const gameP = gprGameProbability(rating, 1400);
            for (const bestOf of [3, 5] as const) {
                const exact = bestOf === 3 ? 3 * p ** 2 - 2 * p ** 3 : 10 * p ** 3 - 15 * p ** 4 + 6 * p ** 5;
                const random = createRandom(211 + bestOf);
                let wins = 0;
                for (let i = 0; i < trials; i++) {
                    const result = playSeries({ id: 'series', stage: 'swiss', round: 1, slot: 1, teamA: 'a', teamB: 'b',
                        bestOf, status: 'scheduled' }, gameP, random);
                    wins += Number(result.winner === 'a');
                }
                expect(Math.abs(wins / trials - exact)).toBeLessThan(5 * Math.sqrt(exact * (1 - exact) / trials));
            }
        }
    });
});

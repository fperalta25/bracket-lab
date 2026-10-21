import { describe, expect, it } from 'vitest';
import { probabilityText, qualificationCount } from '../../resources/ts/public/presentation';
import { runSimulations } from '../../resources/ts/simulator';
import { gprSeedRequest } from '../../scripts/seed-snapshot';

describe('public probability presentation', () => {
    it('localizes fractions without rounding rare observations or zero observations to exact zero', () => {
        expect(probabilityText(125, 1000, 'es')).toMatch(/12,5\s%/);
        expect(probabilityText(125, 1000, 'en')).toBe('12.5%');
        expect(probabilityText(0, 10000, 'en')).toBe('<0.03%');
        expect(probabilityText(0, 50000, 'en')).toBe('<0.01%');
        expect(probabilityText(1, 50000, 'en')).toBe('<0.1%');
    });
    it('uses the sum of the three qualifying records with all simulations as denominator', () => {
        const result = runSimulations(gprSeedRequest(10));
        const total = Object.values(result.aggregates.teams).reduce((sum, team) => sum + qualificationCount(team), 0);
        expect(total).toBe(80);
    });
});

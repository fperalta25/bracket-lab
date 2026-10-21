import { describe, expect, it } from 'vitest';
import en from '../../lang/en.json';
import es from '../../lang/es.json';
import { formatDate, formatNumber, formatPercent, resolveLocale, t, type TranslationKey } from '../../resources/ts/i18n';

describe('shared translation catalogs', () => {
    it('has matching nonempty keys and interpolation parameters in both languages', () => {
        expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
        for (const key of Object.keys(en) as TranslationKey[]) {
            expect(es[key].trim()).not.toBe('');
            expect(en[key].trim()).not.toBe('');
            expect(es[key].match(/:[a-z_]+/g)?.sort()).toEqual(en[key].match(/:[a-z_]+/g)?.sort());
        }
    });

    it('interpolates complete phrases as plain text without recursively replacing values', () => {
        expect(t('tournament.match', { slot: 2 }, 'es')).toBe('Cruce 2');
        expect(t('tournament.match', { slot: '<b>:pool</b>', pool: 1 }, 'en')).toBe('Match <b>:pool</b>');
        expect(t('tournament.teams', {}, resolveLocale('fr'))).toBe('Teams');
        expect(t('missing.key' as TranslationKey)).toBe('Text unavailable.');
    });

    it('formats numbers and probabilities without changing the original values', () => {
        const probability = 0.125;
        expect(formatNumber(1234.5, 'es')).toContain(',5');
        expect(formatNumber(1234.5, 'en')).toContain('.5');
        expect(formatPercent(probability, 'es')).toMatch(/12,5\s%/);
        expect(formatPercent(probability, 'en')).toBe('12.5%');
        expect(probability).toBe(0.125);
    });

    it('formats dates with an explicit data timezone independent of the UI language', () => {
        const date = new Date('2026-10-21T00:00:00Z');
        expect(formatDate(date, 'es', { timeZone: 'UTC' })).toBe('21 de octubre de 2026');
        expect(formatDate(date, 'en', { timeZone: 'UTC' })).toBe('October 21, 2026');
        expect(date.toISOString()).toBe('2026-10-21T00:00:00.000Z');
    });
});

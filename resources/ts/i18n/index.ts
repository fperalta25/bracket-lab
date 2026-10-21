import en from '../../../lang/en.json';
import es from '../../../lang/es.json';

export type Locale = 'es' | 'en';
export type TranslationKey = keyof typeof en;
type Parameters = Record<string, string | number>;

const catalogs = { en, es } satisfies Record<Locale, Record<TranslationKey, string>>;

export function resolveLocale(value: string): Locale {
    return value === 'es' ? 'es' : 'en';
}

export function currentLocale(): Locale {
    return resolveLocale(typeof document === 'undefined' ? 'en' : document.documentElement.lang);
}

// Returns plain text: render via textContent / x-text, never innerHTML / x-html.
export function t(key: TranslationKey, params: Parameters = {}, locale = currentLocale()): string {
    const text = catalogs[resolveLocale(locale)][key] ?? en[key] ?? en['errors.translation'];
    return text.replace(/:([A-Za-z_][A-Za-z_0-9]*)/g, (placeholder, name: string) =>
        Object.hasOwn(params, name) ? String(params[name]) : placeholder,
    );
}

export function formatNumber(value: number, locale = currentLocale(), options: Intl.NumberFormatOptions = {}): string {
    return new Intl.NumberFormat(resolveLocale(locale), options).format(value);
}

// Probabilities remain fractions (0..1); only the displayed string is localized.
export function formatPercent(value: number, locale = currentLocale(), digits = 1): string {
    return formatNumber(value, locale, { style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatDate(value: Date, locale = currentLocale(), options: Intl.DateTimeFormatOptions = { dateStyle: 'long' }): string {
    return new Intl.DateTimeFormat(resolveLocale(locale), options).format(value);
}

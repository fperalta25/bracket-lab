import { formatPercent, type Locale } from '../i18n';
import type { TeamAggregate } from '../simulator';

export function qualificationCount(team: TeamAggregate): number {
    return team.swissRecordCounts['3-0'] + team.swissRecordCounts['3-1'] + team.swissRecordCounts['3-2'];
}

export function probabilityText(count: number, total: number, locale: Locale): string {
    if (count === 0) return `<${formatPercent(Math.ceil(Math.min(1, 3 / total) * 10000) / 10000, locale, 2)}`;
    if (count / total < 0.0005) return `<${formatPercent(0.001, locale)}`;
    return formatPercent(count / total, locale);
}

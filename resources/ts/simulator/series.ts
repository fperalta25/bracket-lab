import { requireCondition } from './errors';
import type { Fixture, PlayedMatch, RandomSource, Variance } from './types';

export const VARIANCE_SCALES = Object.freeze({ low: 9, normal: 15, high: 24 });

export function gameProbability(powerA: number, powerB: number, variance: Variance): number {
    requireCondition([powerA, powerB].every((power) => Number.isFinite(power) && power >= 0 && power <= 100),
        'invalid_request', { field: 'power_score' });
    requireCondition(Object.hasOwn(VARIANCE_SCALES, variance), 'invalid_request', { field: 'variance' });
    return 1 / (1 + Math.exp(-(powerA - powerB) / VARIANCE_SCALES[variance]));
}

export function validateSeries(fixture: Fixture): void {
    requireCondition(fixture && typeof fixture === 'object', 'invalid_fixture');
    const context = { fixture: fixture.id };
    requireCondition(typeof fixture.teamA === 'string' && fixture.teamA.length > 0 && typeof fixture.teamB === 'string'
        && fixture.teamB.length > 0 && fixture.teamA !== fixture.teamB, 'invalid_fixture', context);
    requireCondition([1, 3, 5].includes(fixture.bestOf), 'invalid_fixture', context);
    requireCondition(fixture.status === 'scheduled' || fixture.status === 'completed' || fixture.status === 'decided', 'invalid_fixture', context);
    const target = (fixture.bestOf + 1) / 2;
    if (fixture.games !== undefined) {
        requireCondition(Array.isArray(fixture.games) && fixture.games.length <= fixture.bestOf, 'invalid_score', context);
        let a = 0;
        let b = 0;
        for (const winner of fixture.games) {
            requireCondition(a < target && b < target, 'invalid_score', context);
            requireCondition(winner === fixture.teamA || winner === fixture.teamB, 'invalid_score', context);
            if (winner === fixture.teamA) a++; else b++;
        }
        if (fixture.status === 'completed') {
            requireCondition(fixture.score && fixture.score.a === a && fixture.score.b === b, 'invalid_score', context);
        } else {
            requireCondition(a < target && b < target, 'invalid_score', context);
        }
    }
    if (fixture.status === 'completed') {
        const score = fixture.score;
        requireCondition(score && Number.isInteger(score.a) && Number.isInteger(score.b)
            && score.a >= 0 && score.b >= 0
            && ((score.a === target && score.b < target) || (score.b === target && score.a < target)), 'invalid_score', context);
    } else {
        requireCondition(fixture.score === undefined, 'invalid_score', context);
        if (fixture.status === 'decided') requireCondition(fixture.winner === fixture.teamA || fixture.winner === fixture.teamB, 'invalid_score', context);
    }
}

export function fixtureWinner(fixture: Fixture): string | undefined {
    return fixture.status === 'decided' ? fixture.winner : fixture.status === 'completed'
        ? fixture.score.a > fixture.score.b ? fixture.teamA : fixture.teamB : undefined;
}

export interface SeriesGameState {
    readonly a: number;
    readonly b: number;
    readonly previousWinner: string | undefined;
}
export type SeriesProbability = number | ((state: SeriesGameState) => number);

export function playSeries(fixture: Fixture, probability: SeriesProbability, random: Pick<RandomSource, 'next'>): PlayedMatch {
    validateSeries(fixture);
    requireCondition(fixture.status !== 'decided', 'unsupported_model', { field: 'winner_constraint' });
    requireCondition(typeof probability === 'function' || (Number.isFinite(probability) && probability >= 0 && probability <= 1), 'invalid_request', { field: 'probability' });
    if (fixture.status === 'completed') {
        return { ...fixture, score: { ...fixture.score }, games: fixture.games && [...fixture.games],
            winner: fixture.score.a > fixture.score.b ? fixture.teamA : fixture.teamB, origin: 'fixed', simulatedGames: 0 };
    }
    const games = [...(fixture.games ?? [])];
    const knownGames = games.length;
    let a = games.filter((id) => id === fixture.teamA).length;
    let b = games.length - a;
    const target = (fixture.bestOf + 1) / 2;
    while (a < target && b < target) {
        const p = typeof probability === 'function' ? probability({ a, b, previousWinner: games[games.length - 1] }) : probability;
        requireCondition(Number.isFinite(p) && p >= 0 && p <= 1, 'invalid_request', { field: 'probability' });
        const winner = random.next() < p ? fixture.teamA : fixture.teamB;
        games.push(winner);
        if (winner === fixture.teamA) a++; else b++;
    }
    return { ...fixture, status: 'completed', score: { a, b }, games,
        winner: a > b ? fixture.teamA : fixture.teamB, origin: 'simulated', simulatedGames: games.length - knownGames };
}

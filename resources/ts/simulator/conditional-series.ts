import { requireCondition } from './errors';
import { validateSeries } from './series';
import type { GameLogProbabilities } from './likelihood';
import type { Fixture, PlayedMatch, RandomSource } from './types';

export const WINNER_CONSTRAINT_VERSION = 'stationary-log-doob-v1';

/** Exact conditional game paths for a stationary model, given the selected series winner. */
export function playWinnerConstrainedSeries(fixture: Fixture, logs: GameLogProbabilities, random: Pick<RandomSource, 'next'>): PlayedMatch {
    validateSeries(fixture);
    requireCondition(fixture.status === 'decided', 'invalid_fixture');
    requireCondition([logs.a, logs.b].every((p) => p === -Infinity || (Number.isFinite(p) && p <= 0))
        && Math.abs(Math.exp(logs.a) + Math.exp(logs.b) - 1) < 1e-12, 'invalid_request', { field: 'game_log_probabilities' });
    const target = (fixture.bestOf + 1) / 2;
    const aMustWin = fixture.winner === fixture.teamA;
    const memo = new Map<string, number>();
    const add = (a: number, b: number): number => {
        if (a === -Infinity) return b;
        if (b === -Infinity) return a;
        return Math.max(a, b) + Math.log1p(Math.exp(-Math.abs(a - b)));
    };
    const continuation = (a: number, b: number): number => {
        if (a === target) return aMustWin ? 0 : -Infinity;
        if (b === target) return aMustWin ? -Infinity : 0;
        const key = `${a}:${b}`;
        const cached = memo.get(key); if (cached !== undefined) return cached;
        const result = add(logs.a + continuation(a + 1, b), logs.b + continuation(a, b + 1));
        memo.set(key, result); return result;
    };
    const games = [...(fixture.games ?? [])];
    const known = games.length;
    let a = games.filter((id) => id === fixture.teamA).length;
    let b = games.length - a;
    requireCondition(Number.isFinite(continuation(a, b)), 'invalid_constraints', { reason: 'zero_winner_support' });
    while (a < target && b < target) {
        const viaA = logs.a + continuation(a + 1, b);
        const viaB = logs.b + continuation(a, b + 1);
        const probability = viaA === -Infinity ? 0 : viaB === -Infinity ? 1
            : Math.exp(viaA - add(viaA, viaB));
        const winner = random.next() < probability ? fixture.teamA : fixture.teamB;
        games.push(winner); if (winner === fixture.teamA) a++; else b++;
    }
    requireCondition(aMustWin ? a === target : b === target, 'invariant_violation', { field: 'winner_constraint' });
    return { ...fixture, status: 'completed', winner: fixture.winner, score: { a, b }, games,
        origin: 'constrained', simulatedGames: games.length - known };
}

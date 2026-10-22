import { requireCondition } from './errors';
import { validateSeries, type SeriesGameState } from './series';
import type { Fixture } from './types';

export const SERIES_LIKELIHOOD_VERSION = 'series-log-dp-v1';
export interface GameLogProbabilities { readonly a: number; readonly b: number }
export type SeriesLogProbability = GameLogProbabilities | ((state: SeriesGameState) => GameLogProbabilities);

/** log(exp(a) + exp(b)); preserves zero support as -Infinity. */
function logAddExp(a: number, b: number): number {
    if (a === -Infinity) return b;
    if (b === -Infinity) return a;
    const maximum = Math.max(a, b);
    return maximum + Math.log1p(Math.exp(-Math.abs(a - b)));
}

function checkedProbabilities(probability: SeriesLogProbability, state: SeriesGameState): GameLogProbabilities {
    const logs = typeof probability === 'function' ? probability(state) : probability;
    requireCondition(logs && [logs.a, logs.b].every((value) => value === -Infinity || (Number.isFinite(value) && value <= 0))
        && Math.abs(logAddExp(logs.a, logs.b)) <= 1e-12, 'invalid_request', { field: 'game_log_probabilities' });
    return logs;
}

/**
 * Likelihood conditional on participants and fixed latent strengths, never on the draw.
 * Known sequence: product over observed games. Score only: sum over all legal orders.
 * Scheduled series: likelihood of the observed prefix only; no future games contribute.
 * Callbacks must be pure functions of score and previous winner (the v1 Markov state).
 */
export function seriesLogLikelihood(fixture: Fixture, probability: SeriesLogProbability): number {
    validateSeries(fixture);
    requireCondition(fixture.status !== 'decided', 'unsupported_model', { field: 'hypothetical_winner' });
    if (fixture.games !== undefined || fixture.status === 'scheduled') {
        let a = 0; let b = 0;
        let previousWinner: string | undefined;
        let likelihood = 0;
        for (const winner of fixture.games ?? []) {
            const logs = checkedProbabilities(probability, { a, b, previousWinner });
            likelihood += winner === fixture.teamA ? logs.a : logs.b;
            if (winner === fixture.teamA) a++; else b++;
            previousWinner = winner;
        }
        return likelihood;
    }
    const target = (fixture.bestOf + 1) / 2;
    const score = fixture.score;
    const memo = new Map<string, number>();
    const visit = (a: number, b: number, previousWinner: string | undefined): number => {
        if (a === score.a && b === score.b) return 0;
        if (a >= target || b >= target) return -Infinity;
        const key = JSON.stringify([a, b, previousWinner]);
        const cached = memo.get(key);
        if (cached !== undefined) return cached;
        const logs = checkedProbabilities(probability, { a, b, previousWinner });
        const viaA = a < score.a ? logs.a + visit(a + 1, b, fixture.teamA) : -Infinity;
        const viaB = b < score.b ? logs.b + visit(a, b + 1, fixture.teamB) : -Infinity;
        const result = logAddExp(viaA, viaB);
        memo.set(key, result);
        return result;
    };
    return visit(0, 0, undefined);
}

/** Hypothetical winner constraint, including any known prefix, marginalized over all legal finishes.
 * It is distinct from an observed final score: never choose a synthetic score as evidence.
 */
export function winnerConstraintLogLikelihood(fixture: Fixture, probability: SeriesLogProbability): number {
    validateSeries(fixture);
    requireCondition(fixture.status === 'decided', 'invalid_fixture', { field: 'winner_constraint' });
    const target = (fixture.bestOf + 1) / 2;
    let prefixA = 0; let prefixB = 0; let previous: string | undefined;
    let prefixLikelihood = 0;
    for (const winner of fixture.games ?? []) {
        const logs = checkedProbabilities(probability, { a: prefixA, b: prefixB, previousWinner: previous });
        prefixLikelihood += winner === fixture.teamA ? logs.a : logs.b;
        if (winner === fixture.teamA) prefixA++; else prefixB++;
        previous = winner;
    }
    const memo = new Map<string, number>();
    const visit = (a: number, b: number, previousWinner: string | undefined): number => {
        if (a === target || b === target) return (a === target ? fixture.teamA : fixture.teamB) === fixture.winner ? 0 : -Infinity;
        const key = JSON.stringify([a, b, previousWinner]);
        const cached = memo.get(key);
        if (cached !== undefined) return cached;
        const logs = checkedProbabilities(probability, { a, b, previousWinner });
        const value = logAddExp(logs.a + visit(a + 1, b, fixture.teamA), logs.b + visit(a, b + 1, fixture.teamB));
        memo.set(key, value);
        return value;
    };
    return prefixLikelihood + visit(prefixA, prefixB, previous);
}

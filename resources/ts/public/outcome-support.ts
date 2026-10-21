import { FINAL_BUCKETS, SWISS_RECORDS, fixtureWinner, type FinalBucket, type SimulationRequest } from '../simulator';
import { applySwissMatch, createSwissState } from '../simulator/state';

/** Conservative support from known results, never inferred from Monte Carlo frequencies. */
export function outcomeSupport(request: SimulationRequest) {
    const fixtures = request.scenario.mode === 'from_scratch' ? []
        : request.scenario.mode === 'custom' ? request.scenario.fixtures : request.snapshot.fixtures;
    const states = createSwissState(request.snapshot.teams);
    for (const fixture of fixtures.filter((f) => f.stage === 'swiss')) {
        const winner = fixtureWinner(fixture); if (winner) applySwissMatch(states, { ...fixture, winner });
    }
    return Object.fromEntries(request.snapshot.teams.map((team) => {
        const state = states.get(team.id)!;
        const swiss = new Set<string>(SWISS_RECORDS.filter((record) => {
            if (state.wins === 3 || state.losses === 3) return record === `${state.wins}-${state.losses}`;
            const [wins, losses] = record.split('-').map(Number);
            return wins! >= state.wins && losses! >= state.losses;
        }));
        const final = new Set<FinalBucket>();
        if (['3-0', '3-1', '3-2'].some((record) => swiss.has(record))) {
            for (const bucket of FINAL_BUCKETS.slice(0, 4)) final.add(bucket);
        }
        for (const [record, bucket] of [['2-3', '9_11'], ['1-3', '12_14'], ['0-3', '15_16']] as const) {
            if (swiss.has(record)) final.add(bucket);
        }
        for (const stage of ['quarterfinal', 'semifinal', 'final'] as const) {
            const match = fixtures.find((f) => f.stage === stage && (f.teamA === team.id || f.teamB === team.id));
            const winner = match && fixtureWinner(match);
            if (!winner) continue;
            const lossBucket = stage === 'quarterfinal' ? 'quarterfinalist' : stage === 'semifinal' ? 'semifinalist' : 'runner_up';
            if (winner !== team.id) { final.clear(); final.add(lossBucket); break; }
            final.delete(lossBucket);
        }
        return [team.id, { swiss, final, qualify: ['3-0', '3-1', '3-2'].some((record) => swiss.has(record)) }];
    }));
}

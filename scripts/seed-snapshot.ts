import seed from '../database/data/worlds-2026.json';
import strengths from '../database/data/worlds-2026-strengths-v2.json';
import { SWISS_16_RULES, type Region, type LegacyTournamentSnapshot, type GprSimulationRequest, type StrengthProfileSet } from '../resources/ts/simulator/types';

/** Development-only adapter. The pure engine does not depend on Laravel's seed schema. */
export function seedSnapshot(): LegacyTournamentSnapshot {
    return {
        id: seed.tournament.id, revision: seed.tournament.published_revision, rules: SWISS_16_RULES,
        teams: seed.teams.map((team) => ({ id: team.id, name: team.name, acronym: team.acronym,
            region: team.region as Region, regionalSeed: team.regional_seed, pool: team.pool, powerScore: team.power_score })),
        fixtures: seed.fixtures.map((fixture) => ({ id: fixture.id, stage: 'swiss', round: fixture.round, slot: fixture.slot,
            teamA: fixture.team_a_id, teamB: fixture.team_b_id, bestOf: 1, status: 'scheduled' })),
    };
}

export function gprSeedRequest(iterations = 10, seed = 42): GprSimulationRequest {
    const legacy = seedSnapshot();
    return { modelVersion: 'gpr-context-v2', preset: 'gpr_baseline', iterations, seed,
        snapshot: { ...legacy, teams: legacy.teams.map(({ powerScore: _legacy, ...team }) => team) },
        strengths: JSON.parse(JSON.stringify(strengths)) as StrengthProfileSet, scenario: { mode: 'official_state' } };
}

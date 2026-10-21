import seed from '../database/data/worlds-2026.json';
import { SWISS_16_RULES, type Region, type TournamentSnapshot } from '../resources/ts/simulator/types';

/** Development-only adapter. The pure engine does not depend on Laravel's seed schema. */
export function seedSnapshot(): TournamentSnapshot {
    return {
        id: seed.tournament.id, revision: seed.tournament.published_revision, rules: SWISS_16_RULES,
        teams: seed.teams.map((team) => ({ id: team.id, name: team.name, acronym: team.acronym,
            region: team.region as Region, regionalSeed: team.regional_seed, pool: team.pool, powerScore: team.power_score })),
        fixtures: seed.fixtures.map((fixture) => ({ id: fixture.id, stage: 'swiss', round: fixture.round, slot: fixture.slot,
            teamA: fixture.team_a_id, teamB: fixture.team_b_id, bestOf: 1, status: 'scheduled' })),
    };
}

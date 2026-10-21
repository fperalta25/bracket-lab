import { requireCondition } from './errors';
import { knockoutSampler } from './knockout';
import { firstRoundSampler, samePair } from './pairing';
import { validateSeries, VARIANCE_SCALES } from './series';
import { applySwissMatch, createSwissState, isActive, recordOf, swissBestOf } from './state';
import type { Fixture, SimulationRequest, Stage, SwissRecord, TournamentSnapshot } from './types';

export const MAX_ITERATIONS = 50000;
export const SWISS_MATCH_COUNTS = [8, 8, 8, 6, 3] as const;
export const KNOCKOUT_ROUNDS = Object.freeze({ quarterfinal: 1, semifinal: 2, final: 3 });

const isArray = (value: unknown): boolean => Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 120;
const integer = (value: unknown, minimum: number, maximum: number): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;

export function validateSnapshot(snapshot: TournamentSnapshot): void {
    requireCondition(snapshot && nonempty(snapshot.id), 'invalid_snapshot');
    requireCondition(snapshot.revision === null || integer(snapshot.revision, 1, Number.MAX_SAFE_INTEGER), 'invalid_snapshot', { field: 'revision' });
    const rules = snapshot.rules;
    requireCondition(rules && nonempty(rules.version) && rules.teamCount === 16 && rules.poolSize === 4
        && rules.qualifyingWins === 3 && rules.eliminationLosses === 3 && rules.maxSwissRounds === 5 && rules.knockoutBestOf === 5,
    'unsupported_format');
    requireCondition(isArray(rules.firstRoundPoolPairs) && rules.firstRoundPoolPairs.length === 2
        && rules.firstRoundPoolPairs.every((pair) => isArray(pair) && pair.length === 2 && pair.every((pool) => integer(pool, 1, 16))), 'unsupported_format');
    const pools = rules.firstRoundPoolPairs.flat();
    requireCondition(new Set(pools).size === 4, 'unsupported_format');
    requireCondition(isArray(snapshot.teams) && snapshot.teams.length === rules.teamCount, 'invalid_snapshot', { field: 'teams' });
    const ids = new Set<string>();
    const acronyms = new Set<string>();
    for (const team of snapshot.teams) {
        requireCondition(team && nonempty(team.id) && !ids.has(team.id) && nonempty(team.name) && nonempty(team.acronym)
            && !acronyms.has(team.acronym) && ['LCK', 'LPL', 'LEC', 'LCS', 'LCP', 'CBLOL'].includes(team.region)
            && pools.includes(team.pool) && integer(team.regionalSeed, 1, 16)
            && Number.isFinite(team.powerScore) && team.powerScore >= 0 && team.powerScore <= 100, 'invalid_snapshot', { field: 'team' });
        ids.add(team.id);
        acronyms.add(team.acronym);
    }
    for (const pool of pools) {
        requireCondition(snapshot.teams.filter((team) => team.pool === pool).length === rules.poolSize, 'invalid_snapshot', { pool });
    }
    firstRoundSampler(snapshot.teams, rules);
    validateConstraints(snapshot, snapshot.fixtures);
}

/** Replays only known results: no guessed participants and no random trajectories to discard. */
export function validateConstraints(snapshot: TournamentSnapshot, fixtures: readonly Fixture[]): void {
    requireCondition(isArray(fixtures) && fixtures.length <= 40, 'invalid_constraints', { field: 'fixtures' });
    const ids = new Set<string>();
    const positions = new Set<string>();
    const appearances = new Set<string>();
    const teamIds = new Set(snapshot.teams.map((team) => team.id));
    const stages: readonly Stage[] = ['swiss', 'quarterfinal', 'semifinal', 'final'];
    for (const fixture of fixtures) {
        requireCondition(fixture && nonempty(fixture.id) && !ids.has(fixture.id) && stages.includes(fixture.stage), 'invalid_fixture');
        const context = { fixture: fixture.id, round: fixture.round };
        const maxSlots = fixture.stage === 'swiss' ? SWISS_MATCH_COUNTS[fixture.round - 1]
            : fixture.stage === 'quarterfinal' ? 4 : fixture.stage === 'semifinal' ? 2 : 1;
        requireCondition(integer(fixture.round, 1, 5) && maxSlots !== undefined && integer(fixture.slot, 1, maxSlots), 'invalid_fixture', context);
        requireCondition(fixture.stage === 'swiss' || (fixture.round === KNOCKOUT_ROUNDS[fixture.stage] && fixture.bestOf === 5), 'invalid_fixture', context);
        requireCondition(teamIds.has(fixture.teamA) && teamIds.has(fixture.teamB) && fixture.teamA !== fixture.teamB, 'invalid_fixture', context);
        const position = `${fixture.stage}:${fixture.round}:${fixture.slot}`;
        requireCondition(!positions.has(position), 'invalid_fixture', context);
        for (const team of [fixture.teamA, fixture.teamB]) {
            const appearance = `${fixture.stage}:${fixture.round}:${team}`;
            requireCondition(!appearances.has(appearance), 'invalid_fixture', { ...context, team });
            appearances.add(appearance);
        }
        ids.add(fixture.id);
        positions.add(position);
        validateSeries(fixture);
    }
    const roundOne = fixtures.filter((fixture) => fixture.stage === 'swiss' && fixture.round === 1);
    firstRoundSampler(snapshot.teams, snapshot.rules, roundOne.map((fixture) => [fixture.teamA, fixture.teamB]));
    const states = createSwissState(snapshot.teams);
    for (let round = 1; round <= snapshot.rules.maxSwissRounds; round++) {
        const current = fixtures.filter((fixture) => fixture.stage === 'swiss' && fixture.round === round);
        for (const fixture of current) {
            const a = states.get(fixture.teamA)!;
            const b = states.get(fixture.teamB)!;
            const context = { fixture: fixture.id, round, record: recordOf(a) };
            requireCondition(a.wins + a.losses === round - 1 && b.wins + b.losses === round - 1,
                'invalid_constraints', { ...context, reason: 'undetermined_participants' });
            requireCondition(isActive(a) && isActive(b) && recordOf(a) === recordOf(b), 'invalid_constraints', { ...context, reason: 'record_conflict' });
            requireCondition(fixture.bestOf === swissBestOf(a), 'invalid_fixture', context);
        }
        // Apply after validating the entire round, always against pre-round records.
        for (const fixture of current) {
            if (fixture.status === 'completed') {
                applySwissMatch(states, { ...fixture, winner: fixture.score.a > fixture.score.b ? fixture.teamA : fixture.teamB });
            }
        }
    }
    const quarters = fixtures.filter((fixture) => fixture.stage === 'quarterfinal');
    if (quarters.length) {
        const knownRecords = Object.create(null) as Record<string, SwissRecord>;
        for (const [id, state] of states) {
            if (state.wins === snapshot.rules.qualifyingWins) knownRecords[id] = recordOf(state) as SwissRecord;
        }
        knockoutSampler(knownRecords, quarters);
    }
    for (const stage of ['semifinal', 'final'] as const) {
        const previous = stage === 'semifinal' ? 'quarterfinal' : 'semifinal';
        for (const fixture of fixtures.filter((item) => item.stage === stage)) {
            const expected = [fixture.slot * 2 - 1, fixture.slot * 2].map((slot) => {
                const parent = fixtures.find((item) => item.stage === previous && item.slot === slot);
                requireCondition(parent?.status === 'completed', 'invalid_constraints', { fixture: fixture.id, reason: 'undetermined_participants' });
                return parent.score.a > parent.score.b ? parent.teamA : parent.teamB;
            });
            requireCondition(samePair([expected[0]!, expected[1]!], [fixture.teamA, fixture.teamB]),
                'invalid_constraints', { fixture: fixture.id, reason: 'bracket_conflict' });
        }
    }
}

export function validateRequest(request: SimulationRequest): readonly Fixture[] {
    requireCondition(request && typeof request === 'object', 'invalid_request');
    validateSnapshot(request.snapshot);
    requireCondition(request.scenario && ['from_scratch', 'official_state', 'custom'].includes(request.scenario.mode), 'invalid_request', { field: 'scenario' });
    requireCondition(integer(request.iterations, 1, MAX_ITERATIONS), 'invalid_request', { field: 'iterations' });
    requireCondition(integer(request.seed, 0, 0xffff_ffff), 'invalid_request', { field: 'seed' });
    requireCondition(Object.hasOwn(VARIANCE_SCALES, request.variance), 'invalid_request', { field: 'variance' });
    if (request.powerScores !== undefined) {
        requireCondition(request.powerScores && typeof request.powerScores === 'object' && !isArray(request.powerScores), 'invalid_request', { field: 'power_scores' });
        const ids = new Set(request.snapshot.teams.map((team) => team.id));
        for (const [id, power] of Object.entries(request.powerScores)) {
            requireCondition(ids.has(id) && Number.isFinite(power) && power >= 0 && power <= 100, 'invalid_request', { field: 'power_scores', team: id });
        }
    }
    const fixtures = request.scenario.mode === 'from_scratch' ? []
        : request.scenario.mode === 'official_state' ? request.snapshot.fixtures : request.scenario.fixtures;
    if (fixtures !== request.snapshot.fixtures) validateConstraints(request.snapshot, fixtures);
    return fixtures;
}

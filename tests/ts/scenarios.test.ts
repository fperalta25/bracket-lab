import { describe, expect, it } from 'vitest';
import { gprSeedRequest } from '../../scripts/seed-snapshot';
import { runSimulations, type Fixture, type GprSimulationRequest } from '../../resources/ts/simulator';
import { parseScenarioFile, SCENARIO_FILE_LIMIT, updateRoundOne, validateSavedScenario, type SavedScenario } from '../../resources/ts/public/scenarios';

function document(): SavedScenario {
    const base = gprSeedRequest(10, 42);
    return { kind: 'bracket-lab-scenario', schemaVersion: 1, id: 'test-scenario', name: 'My <scenario>',
        createdAt: '2026-10-21T12:00:00.000Z', updatedAt: '2026-10-21T13:00:00.000Z',
        request: { ...base, scenario: { mode: 'custom', fixtures: base.snapshot.fixtures } } };
}

describe('portable frozen scenarios', () => {
    it('preserves the complete request and reproduces outputs after a JSON round trip', () => {
        const doc = document();
        const copy = parseScenarioFile(JSON.stringify(doc));
        expect(copy).toEqual(doc);
        expect(runSimulations(copy.request)).toEqual(runSimulations(doc.request));
        expect(JSON.stringify(copy)).not.toContain('locale');
        expect(copy.request.strengths.profiles).toHaveLength(16);
    });

    it('copies by value, including archived GPR overrides and individual contextual switches', () => {
        const doc = document();
        const id = doc.request.snapshot.teams[0]!.id;
        const altered = { ...doc, request: { ...doc.request, preset: 'contextual_v1',
            contextualTerms: { tournamentForm: false, seriesForm: true, pressure: false, sequence: true }, gprOverrides: { [id]: 1800 } } } as SavedScenario;
        const copy = validateSavedScenario(altered);
        Object.assign(altered.request.strengths.profiles[0]!, { gpr: 2000 });
        expect(copy.request.strengths.profiles[0]!.gpr).not.toBe(2000);
        expect(copy.request.gprOverrides?.[id]).toBe(1800);
        expect(copy.request.contextualTerms?.tournamentForm).toBe(false);
    });

    it('rejects invalid versions, names, dates, legacy scores and malformed requests without conversion', () => {
        const doc = document();
        for (const patch of [{ schemaVersion: 3 }, { kind: 'other' }, { name: '' }, { name: 'a'.repeat(81) },
            { createdAt: 'invalid' }, { id: null }, { request: { ...doc.request, seed: -1 } }]) {
            expect(() => validateSavedScenario({ ...doc, ...patch })).toThrow('invalid_request');
        }
        expect(() => validateSavedScenario({ ...doc, request: { ...doc.request, modelVersion: 'legacy-score-v1' } })).toThrow('incompatible_model');
        expect(() => parseScenarioFile('{broken')).toThrow();
        expect(() => parseScenarioFile('x'.repeat(SCENARIO_FILE_LIMIT + 1))).toThrow('invalid_request');
        expect(() => parseScenarioFile('😀'.repeat(SCENARIO_FILE_LIMIT / 3))).toThrow('invalid_request');
    });
});

describe('round-one local constraints', () => {
    it('locks a winner without inventing a game order or changing structural teams and original fixtures', () => {
        const request = document().request;
        const before = JSON.stringify(request);
        const fixture = request.snapshot.fixtures[0]!;
        const fixtures = updateRoundOne(request, fixture.slot, fixture.teamB);
        const locked = fixtures.find((f) => f.slot === fixture.slot)!;
        expect(locked).toMatchObject({ status: 'completed', score: { a: 0, b: 1 } });
        expect(locked.games).toBeUndefined();
        expect(JSON.stringify(request)).toBe(before);
        const output = runSimulations({ ...request, scenario: { mode: 'custom', fixtures } });
        expect(output.example.matches.find((match) => match.stage === 'swiss' && match.round === 1 && match.slot === fixture.slot)?.winner).toBe(fixture.teamB);
        expect(output.example.matches[0]?.origin).toBe('fixed');
    });

    it('releases a matchup completely and can lock it again or reset only its result', () => {
        const request = document().request;
        const original = request.snapshot.fixtures[0]!;
        const removed = updateRoundOne(request, original.slot, 'random');
        expect(removed).toHaveLength(7);
        const unlocked = { ...request, scenario: { mode: 'custom', fixtures: removed } } as const;
        const relocked = updateRoundOne(unlocked, original.slot, original.teamA);
        expect(relocked).toHaveLength(8);
        const pending = updateRoundOne({ ...request, scenario: { mode: 'custom', fixtures: relocked } }, original.slot, null);
        expect(pending.find((f) => f.slot === original.slot)).toMatchObject({ status: 'scheduled' });
        expect(pending.find((f) => f.slot === original.slot)).not.toHaveProperty('score');
    });

    it('can add a single constraint from scratch without retaining all official locks', () => {
        const request = { ...document().request, scenario: { mode: 'custom', fixtures: [] } } as GprSimulationRequest;
        const fixture = request.snapshot.fixtures[0]!;
        const fixtures = updateRoundOne(request, fixture.slot, fixture.teamA);
        expect(fixtures).toHaveLength(1);
        expect(() => runSimulations({ ...request, scenario: { mode: 'custom', fixtures } })).not.toThrow();
        expect(() => updateRoundOne(request, 99, null)).toThrow('invalid_fixture');
        expect(() => updateRoundOne(request, fixture.slot, 'foreign')).toThrow('invalid_score');
    });

    it('retains later rounds and rejects earlier changes that invalidate their fixed participants', () => {
        const request = document().request;
        const output = runSimulations(request);
        const all: readonly Fixture[] = output.example.matches;
        const fixture = all[0]!;
        const winner = fixture.status === 'completed' && fixture.score.a > fixture.score.b ? fixture.teamA : fixture.teamB;
        const fixed: GprSimulationRequest = { ...request, scenario: { mode: 'custom', fixtures: all } };
        expect(updateRoundOne(fixed, fixture.slot, winner)).toHaveLength(40);
        expect(() => updateRoundOne(fixed, fixture.slot, winner === fixture.teamA ? fixture.teamB : fixture.teamA)).toThrow();
        expect(fixed.scenario.mode === 'custom' && fixed.scenario.fixtures).toHaveLength(40);
    });
});

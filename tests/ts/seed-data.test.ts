import { describe, expect, it } from 'vitest';
import data from '../../database/data/worlds-2026.json';

describe('Worlds 2026 bootstrap data', () => {
    it('uses unique stable identifiers and explicit pools', () => {
        expect(data.teams).toHaveLength(16);
        expect(new Set(data.teams.map((team) => team.id)).size).toBe(16);
        expect(new Set(data.teams.map((team) => team.acronym)).size).toBe(16);
        for (const team of data.teams) {
            expect(team.id).toMatch(/^[a-f0-9-]{36}$/);
            expect(['LCK', 'LPL', 'LEC', 'LCS', 'LCP', 'CBLOL']).toContain(team.region);
            expect(team.power_score).toBe(50);
        }
        for (const pool of [1, 2, 3, 4]) {
            expect(data.teams.filter((team) => team.pool === pool)).toHaveLength(4);
        }
    });

    it('contains one valid R1 appearance per team, with no regional conflicts', () => {
        const participants = new Set<string>();
        expect(data.fixtures).toHaveLength(8);
        expect(data.fixtures.map((fixture) => fixture.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
        for (const fixture of data.fixtures) {
            const a = data.teams.find((team) => team.id === fixture.team_a_id);
            const b = data.teams.find((team) => team.id === fixture.team_b_id);
            expect(a).toBeDefined();
            expect(b).toBeDefined();
            expect(a?.region).not.toBe(b?.region);
            expect((a?.pool ?? 0) + (b?.pool ?? 0)).toBe(5);
            participants.add(fixture.team_a_id);
            participants.add(fixture.team_b_id);
        }
        expect(participants.size).toBe(16);
    });

    it('does not invent results or a published revision', () => {
        expect(data.tournament.published_revision).toBeNull();
        expect(data.tournament.status).toBe('draft');
        for (const fixture of data.fixtures) {
            expect(fixture.stage).toBe('swiss');
            expect(fixture.round).toBe(1);
            expect(fixture.best_of).toBe(1);
            expect(fixture.status).toBe('scheduled');
            expect(fixture.score_a).toBeNull();
            expect(fixture.score_b).toBeNull();
        }
    });
});

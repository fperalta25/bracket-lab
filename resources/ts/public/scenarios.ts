import { validateRequest, validateConstraints, SimulationError, type Fixture, type GprSimulationRequest } from '../simulator';

export const SCENARIO_FILE_LIMIT = 1024 * 1024;
export interface SavedScenario {
    kind: 'bracket-lab-scenario';
    schemaVersion: 1;
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    request: GprSimulationRequest;
}

export function validateSavedScenario(value: unknown): SavedScenario {
    const doc = value as SavedScenario;
    const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
    const date = (value: unknown): boolean => text(value, 50) && Number.isFinite(Date.parse(value));
    if (!doc || doc.kind !== 'bracket-lab-scenario' || doc.schemaVersion !== 1 || !text(doc.id, 120)
        || !text(doc.name, 80) || !date(doc.createdAt) || !date(doc.updatedAt)) throw new SimulationError('invalid_request', { field: 'scenario_file' });
    if (doc.request?.modelVersion !== 'gpr-context-v2') throw new SimulationError('incompatible_model');
    validateRequest(doc.request);
    return JSON.parse(JSON.stringify(doc)) as SavedScenario;
}

export function parseScenarioFile(text: string): SavedScenario {
    if (new TextEncoder().encode(text).length > SCENARIO_FILE_LIMIT) throw new SimulationError('invalid_request', { field: 'file_size' });
    return validateSavedScenario(JSON.parse(text));
}

/** Replace exactly one R1 constraint. Other rounds survive; validate their participants again. */
export function updateRoundOne(request: GprSimulationRequest, slot: number, winner: string | null | 'random'): readonly Fixture[] {
    if (request.scenario.mode !== 'custom') throw new SimulationError('invalid_request');
    const matchesSlot = (f: Fixture): boolean => f.stage === 'swiss' && f.round === 1 && f.slot === slot;
    const original = request.scenario.fixtures.find(matchesSlot) ?? request.snapshot.fixtures.find(matchesSlot);
    if (!original) throw new SimulationError('invalid_fixture', { round: 1, slot });
    if (winner !== null && winner !== 'random' && winner !== original.teamA && winner !== original.teamB) throw new SimulationError('invalid_score');
    const fixtures = request.scenario.fixtures.filter((f) => f !== original);
    if (winner !== 'random') {
        const base = { id: original.id, stage: original.stage, round: 1, slot, teamA: original.teamA, teamB: original.teamB, bestOf: 1 as const };
        fixtures.push(winner === null ? { ...base, status: 'scheduled' } : { ...base, status: 'completed',
            score: { a: Number(winner === original.teamA), b: Number(winner === original.teamB) } });
    }
    fixtures.sort((a, b) => a.round - b.round || a.slot - b.slot);
    validateConstraints(request.snapshot, fixtures);
    return fixtures;
}

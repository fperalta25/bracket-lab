import { describe, expect, it } from 'vitest';
import { gprSeedRequest } from '../../scripts/seed-snapshot';
import { runSimulations } from '../../resources/ts/simulator';
import { copyScenarioWithCurrentPreset, parseScenarioFile, type SavedScenario } from '../../resources/ts/public/scenarios';

const document = (schemaVersion: 1 | 2): SavedScenario => ({ kind: 'bracket-lab-scenario', schemaVersion, id: 'old', name: 'Original',
    createdAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z', request: {
        ...gprSeedRequest(10, 42), preset: 'contextual_v1', contextualTerms: { tournamentForm: true, seriesForm: false, pressure: true, sequence: false },
    } });

describe('voluntary preset copies', () => {
    it.each([1, 2] as const)('reads schema %i without migration and canonicalizes only an explicit copy', (version) => {
        const source = document(version);
        const text = JSON.stringify(source);
        const imported = parseScenarioFile(text);
        expect(imported).toEqual(source);
        const copy = copyScenarioWithCurrentPreset(imported, { id: 'new', name: 'Copy', at: '2026-10-21T12:00:00Z' });
        expect(JSON.stringify(source)).toBe(text);
        expect(imported.request.preset).toBe('contextual_v1');
        expect(copy.schemaVersion).toBe(version);
        expect(copy.request).toEqual({ ...source.request, preset: 'contextual_experimental_v2' });
        expect(copy.request.strengths).not.toBe(imported.request.strengths);
        const before = runSimulations(source.request); const after = runSimulations(copy.request);
        expect(after.example).toEqual(before.example); expect(after.aggregates).toEqual(before.aggregates);
        expect(after.metadata.model.engineVersion).toBe(before.metadata.model.engineVersion);
        expect(runSimulations(parseScenarioFile(JSON.stringify(copy)).request)).toEqual(after);
    });
    it('cannot overwrite the source or enable a trained model through an imported document', () => {
        const source = document(2);
        expect(() => copyScenarioWithCurrentPreset(source, { id: source.id, name: 'Copy', at: source.createdAt })).toThrow('invalid_request');
        expect(() => parseScenarioFile(JSON.stringify({ ...source, request: { ...source.request, preset: 'contextual_trained_v3' } }))).toThrow('unsupported_model');
    });
});

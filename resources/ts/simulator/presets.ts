import { requireCondition } from './errors';

export type ModelPreset = 'gpr_baseline' | 'contextual_experimental_v2' | 'contextual_trained_v3';
/** Read compatibility only; this alias always means the experimental v2 model. */
export type CompatiblePreset = ModelPreset | 'contextual_v1';
export const MODEL_PRESETS = Object.freeze({
    gpr_baseline: { available: true, status: 'provisional' },
    contextual_experimental_v2: { available: true, status: 'experimental' },
    contextual_trained_v3: { available: false, status: 'unavailable' },
} as const);

export function canonicalPreset(preset: unknown): ModelPreset {
    if (preset === 'contextual_v1') return 'contextual_experimental_v2';
    requireCondition(typeof preset === 'string' && Object.hasOwn(MODEL_PRESETS, preset), 'unsupported_model', { field: 'preset' });
    return preset as ModelPreset;
}

export function validatePreset(preset: unknown): void {
    const id = canonicalPreset(preset);
    requireCondition(MODEL_PRESETS[id].available, 'unsupported_model', { field: 'preset', reason: 'trained_model_unavailable' });
}

export const isExperimentalPreset = (preset: unknown): boolean => preset === 'contextual_v1' || preset === 'contextual_experimental_v2';

export type ErrorCode = 'invalid_request' | 'invalid_snapshot' | 'invalid_fixture' | 'invalid_score'
    | 'invalid_constraints' | 'impossible_pairing' | 'unsupported_format' | 'invariant_violation';

export class SimulationError extends Error {
    constructor(public readonly code: ErrorCode, public readonly context: Readonly<Record<string, string | number>> = {}) {
        super(code);
        this.name = 'SimulationError';
    }
}

export function requireCondition(condition: unknown, code: ErrorCode, context: Record<string, string | number> = {}): asserts condition {
    if (!condition) throw new SimulationError(code, context);
}

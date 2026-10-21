/// <reference lib="webworker" />
import { createSimulationRunner, SimulationError, type SimulationRequest, type SimulationOutput } from '../simulator';

export type WorkerMessage = { type: 'progress'; completed: number; total: number }
    | { type: 'result'; output: SimulationOutput }
    | { type: 'error'; code: string; context: Readonly<Record<string, string | number>> };

self.onmessage = async (event: MessageEvent<SimulationRequest>) => {
    try {
        const runner = createSimulationRunner(event.data);
        let completed = 0;
        while (completed < event.data.iterations) {
            completed = runner.advance(100);
            self.postMessage({ type: 'progress', completed, total: event.data.iterations } satisfies WorkerMessage);
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        self.postMessage({ type: 'result', output: runner.result() } satisfies WorkerMessage);
    } catch (error) {
        self.postMessage({ type: 'error', code: error instanceof SimulationError ? error.code : 'unexpected',
            context: error instanceof SimulationError ? error.context : {} } satisfies WorkerMessage);
    }
};

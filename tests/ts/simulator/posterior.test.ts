import { describe, expect, it } from 'vitest';
import { diagnosePosterior, winnerConstraintLogLikelihood, seriesLogLikelihood, gprGameLogProbabilities,
    type Fixture, type SeriesGameState, type SeriesEvidence, type PriorParticle } from '../../../resources/ts/simulator';

const logs = (p: number) => ({ a: Math.log(p), b: Math.log1p(-p) });
const decided = (bestOf: 1 | 3 | 5, winner = 'a'): Extract<Fixture, { status: 'decided' }> => ({ id: 'choice', stage: 'swiss', round: 3,
    slot: 1, teamA: 'a', teamB: 'b', bestOf, status: 'decided', winner });
const observed: Fixture = { ...decided(1), status: 'completed', score: { a: 1, b: 0 } };
const cutoff = '2026-10-22T00:00:00Z';
const evidence = (fixture: Fixture = observed, kind: SeriesEvidence['kind'] = 'observed'): SeriesEvidence => ({ fixture, kind, availableAt: '2026-10-21T00:00:00Z' });
const particles: PriorParticle[] = [{ id: 'negative_form', predict: () => logs(.1) }, { id: 'positive_form', predict: () => logs(.9) }];

// Independent exhaustive sequence probabilities, no memoization or log-space recursion.
function terminalPaths(bestOf: number, predict: (state: SeriesGameState) => ReturnType<typeof logs>) {
    const paths: { games: string[]; mass: number }[] = [];
    const target = (bestOf+1)/2;
    const walk = (a: number, b: number, games: string[], mass: number) => {
        if (a === target || b === target) { paths.push({ games, mass }); return; }
        const p = predict({ a, b, previousWinner: games.at(-1) });
        walk(a+1,b,[...games,'a'],mass*Math.exp(p.a));
        walk(a,b+1,[...games,'b'],mass*Math.exp(p.b));
    };
    walk(0,0,[],1); return paths;
}

describe('winner constraints without invented scores', () => {
    it('matches known Bo3 series probability, not the probability of an invented sweep', () => {
        expect(Math.exp(winnerConstraintLogLikelihood(decided(3), logs(.2)))).toBeCloseTo(.104,14);
        expect(Math.exp(winnerConstraintLogLikelihood(decided(3,'b'), logs(.2)))).toBeCloseTo(.896,14);
        expect(() => seriesLogLikelihood(decided(3),logs(.2))).toThrow('unsupported_model');
    });
    it('sums all legal paths, including score/sequence-dependent probabilities and an observed prefix', () => {
        const predict = (state: SeriesGameState) => gprGameLogProbabilities(1400+state.a*15+(state.previousWinner==='a'?80:0),1450+state.b*10);
        for (const bestOf of [1,3,5] as const) {
            const paths = terminalPaths(bestOf,predict);
            for (const winner of ['a','b']) for (const prefix of [[],...(bestOf===1?[]:[['a'],['b']])]) {
                const expected = paths.filter((path) => path.games.at(-1)===winner && prefix.every((v,i)=>path.games[i]===v))
                    .reduce((sum,path)=>sum+path.mass,0);
                expect(Math.exp(winnerConstraintLogLikelihood({ ...decided(bestOf,winner), games: prefix },predict))).toBeCloseTo(expected,14);
            }
        }
    });
    it('preserves impossible support and rejects non-normalized game probabilities', () => {
        expect(winnerConstraintLogLikelihood(decided(5),logs(0))).toBe(-Infinity);
        expect(winnerConstraintLogLikelihood(decided(5),logs(1))).toBe(0);
        expect(() => winnerConstraintLogLikelihood(decided(3),{a:0,b:0})).toThrow('invalid_request');
        expect(() => winnerConstraintLogLikelihood(observed,logs(.5))).toThrow('invalid_fixture');
    });
});

describe('diagnostic posterior weights', () => {
    it('matches a closed-form posterior: an upset increases mass on positive latent form', () => {
        const prior = diagnosePosterior(particles,[],cutoff,1);
        const posterior = diagnosePosterior(particles,[evidence()],cutoff,1);
        expect(prior.weights).toEqual([.5,.5]);
        expect(posterior.weights[1]).toBeCloseTo(.9,14);
        expect(posterior.weights[0]).toBeCloseTo(.1,14);
        expect(posterior.ess).toBeCloseTo(1/(.9**2+.1**2),14);
        expect(posterior.mode).toBe('diagnostic_only');
    });
    it('uses only evidence available strictly before the cutoff and ignores future outcomes', () => {
        const future = { ...evidence(), availableAt: cutoff };
        const first = diagnosePosterior(particles,[evidence(),future],cutoff,1);
        future.fixture = { ...observed, score: {a:0,b:1} };
        expect(diagnosePosterior(particles,[future,evidence()],cutoff,1)).toEqual(first);
        expect(first.observationIds).toEqual(['choice']);
    });
    it('multiplies distinct series likelihoods once, with deterministic evidence ordering', () => {
        const a=evidence(), b=evidence({...observed,id:'other'});
        const first=diagnosePosterior(particles,[a,b],cutoff,1);
        expect(first.weights[1]).toBeCloseTo(.81/(.81+.01),14);
        expect(diagnosePosterior(particles,[b,a],cutoff,1)).toEqual(first);
        expect(()=>diagnosePosterior(particles,[a,a],cutoff,1)).toThrow('invalid_request');
    });
    it('distinguishes hypothetical winners from actual observations and integrates missing scores', () => {
        const choice=evidence(decided(3),'hypothetical');
        const posterior=diagnosePosterior(particles,[choice],cutoff,1);
        expect(posterior.weights[1]).toBeCloseTo(.972,14);
        expect(()=>diagnosePosterior(particles,[{...choice,kind:'observed'}],cutoff,1)).toThrow('invalid_request');
        expect(()=>diagnosePosterior(particles,[evidence(observed,'hypothetical')],cutoff,1)).toThrow('invalid_request');
    });
    it('handles known partial game sequences without treating future games as observed', () => {
        const prefix: Fixture={...decided(3),status:'scheduled',games:['a']};
        expect(diagnosePosterior(particles,[evidence(prefix)],cutoff,1).weights[1]).toBeCloseTo(.9,14);
        expect(()=>diagnosePosterior(particles,[evidence({...prefix,games:[]})],cutoff,1)).toThrow('invalid_request');
    });
    it('signals insufficient ESS and zero sample support without claiming global impossibility', () => {
        expect(diagnosePosterior(particles,[evidence()],cutoff,2).status).toBe('insufficient_ess');
        const impossible=diagnosePosterior([{id:'no_support',predict:()=>logs(0)}],[evidence()],cutoff,1);
        expect(impossible.status).toBe('zero_sample_support'); expect(impossible.weights).toEqual([0]);
    });
    it('validates timestamps, particle identity and guards without mutating inputs', () => {
        const inputs=[evidence()]; const before=structuredClone(inputs);
        diagnosePosterior(particles,inputs,cutoff,1); expect(inputs).toEqual(before);
        for (const time of ['2026-02-30T00:00:00Z','2026-10-21','2026-10-21T00:00:00+02:00']) {
            expect(()=>diagnosePosterior(particles,inputs,time,1)).toThrow('invalid_request');
        }
        expect(()=>diagnosePosterior([particles[0]!,particles[0]!],inputs,cutoff,1)).toThrow('invalid_request');
        expect(()=>diagnosePosterior([],inputs,cutoff,1)).toThrow('invalid_request');
        expect(()=>diagnosePosterior(particles,inputs,cutoff,3)).toThrow('invalid_request');
    });
});

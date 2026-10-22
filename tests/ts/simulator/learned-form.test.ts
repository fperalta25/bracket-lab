import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { defaultTrainedEloArtifact, trainedEloPayload, prepareSimulation, createTournamentRandom, preGameContext,
    runSimulations, validateRequest, type GprSimulationRequest } from '../../../resources/ts/simulator';
import { gprSeedRequest } from '../../../scripts/seed-snapshot';
import { parseScenarioFile } from '../../../resources/ts/public/scenarios';
import { comparisonRequests, validateComparison } from '../../../resources/ts/public/comparison';

const request = (): GprSimulationRequest => ({ ...gprSeedRequest(5), preset: 'historical_elo_trained_v1', learnedModel: defaultTrainedEloArtifact('form') });

describe('optional learned form artifact', () => {
    it('keeps the existing M0 artifact and default unchanged', () => {
        expect(defaultTrainedEloArtifact().sha256).toBe('e12280767edf9b3554efe9e7782eecba597efe4e487f018d41200a5bca60af6e');
        expect(defaultTrainedEloArtifact()).toEqual(defaultTrainedEloArtifact('elo'));
        expect(defaultTrainedEloArtifact('form').sha256).not.toBe(defaultTrainedEloArtifact().sha256);
    });
    it('registers the learned variant with its age, fitted coefficient and no fabricated recent observations', () => {
        const artifact=defaultTrainedEloArtifact('form'), payload=trainedEloPayload(artifact);
        expect(createHash('sha256').update(artifact.payloadJson).digest('hex')).toBe(artifact.sha256);
        expect(payload.parameters).toMatchObject({formSourceDays:5,formCoefficient:1,formShrinkageDays:3});
        expect(payload.teams.find((t)=>t.acronym==='LOS')!.form!.age_days).toBeGreaterThan(365);
        expect(payload.teams.every((t)=>t.form!.days<=5 && t.form!.games<=t.games)).toBe(true);
        expect(payload.recommended).toBe(false);
    });
    it('adds the trained residual contribution in log odds, without changing base ratings or applying v2 bonuses', () => {
        const r=request(), payload=trainedEloPayload(r.learnedModel!);
        const prepared=prepareSimulation(r), world=prepared.prediction.createState(createTournamentRandom(42,0));
        const fixture=r.snapshot.fixtures[0]!, context=preGameContext(fixture,{a:0,b:0,previousWinner:undefined});
        const a=payload.teams.find((t)=>t.teamId===fixture.teamA)!, b=payload.teams.find((t)=>t.teamId===fixture.teamB)!;
        const logit=Math.LN10*.75*(a.rating-b.rating)/400+(a.form!.value!-b.form!.value!);
        expect(prepared.prediction.predictGame(context,world).pWinA).toBeCloseTo(1/(1+Math.exp(-logit)),14);
        expect(prepared.powers[a.teamId]).toBe(a.rating+a.formRatingAdjustment!);
        const m0=trainedEloPayload(defaultTrainedEloArtifact());
        expect(payload.teams.map((t)=>t.rating)).toEqual(m0.teams.map((t)=>t.rating));
    });
    it('persists full model identity through JSON and executes reproducibly with a fixed winner', () => {
        const r=request(), fixture=r.snapshot.fixtures[0]!;
        const constrained: GprSimulationRequest={...r,scenario:{mode:'custom',fixtures:[{...fixture,status:'decided',score:undefined,winner:fixture.teamB}]}};
        const doc={kind:'bracket-lab-scenario',schemaVersion:2,id:'form',name:'Form',createdAt:'2026-10-22T00:00:00Z',updatedAt:'2026-10-22T00:00:00Z',request:constrained};
        const copy=parseScenarioFile(JSON.stringify(doc));expect(copy.request.learnedModel).toEqual(r.learnedModel);
        const result=runSimulations(copy.request);expect(result).toEqual(runSimulations(constrained));
        expect(result.example.matches.find((m)=>m.id===fixture.id)?.score).toEqual({a:0,b:1});
        const [base,candidate]=comparisonRequests(constrained,{tournamentForm:true,seriesForm:true,pressure:true,sequence:true});
        expect(()=>validateComparison({baseline:runSimulations(base),contextual:runSimulations(candidate)})).not.toThrow();
    });
    it('rejects silently modified adjustments even if a client keeps the original artifact hash', () => {
        const r=request(), artifact=r.learnedModel!, payload=JSON.parse(artifact.payloadJson);
        payload.teams[0].formRatingAdjustment=1000;
        expect(()=>validateRequest({...r,learnedModel:{...artifact,payloadJson:JSON.stringify(payload)}})).toThrow('incompatible_model');
    });
});

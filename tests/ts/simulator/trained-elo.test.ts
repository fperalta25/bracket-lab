import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultTrainedEloArtifact, trainedEloPayload, prepareSimulation, createTournamentRandom, preGameContext,
    runSimulations, validateRequest, type GprSimulationRequest } from '../../../resources/ts/simulator';
import { gprSeedRequest } from '../../../scripts/seed-snapshot';
import { comparisonRequests, validateComparison } from '../../../resources/ts/public/comparison';
import { parseScenarioFile } from '../../../resources/ts/public/scenarios';

const artifact = defaultTrainedEloArtifact();
const payload = trainedEloPayload(artifact);
const request = (n = 10): GprSimulationRequest => ({ ...gprSeedRequest(n), preset: 'historical_elo_trained_v1', learnedModel: artifact });

describe('learned M0 Elo experimental artifact', () => {
    it('is hash-verifiable, covers all teams and records actual linked coverage and age', () => {
        expect(createHash('sha256').update(artifact.payloadJson).digest('hex')).toBe(artifact.sha256);
        expect(payload.status).toBe('trained_experimental'); expect(payload.recommended).toBe(false);
        expect(payload.teams).toHaveLength(16); expect(payload.parameters).toMatchObject({k:32,divisor:400,logOddsSlope:.75});
        const unknown=payload.teams.find((t)=>t.acronym==='LOS')!;
        expect(unknown).toMatchObject({status:'learned',games:89,sourceName:'Los Grandes'});
        expect(unknown.lastGameUtc?.startsWith('2025-')).toBe(true);
        expect(payload.teams.filter((t)=>t.status==='learned'&&t.games>0)).toHaveLength(16);
        const clone=defaultTrainedEloArtifact();Object.assign(clone,{sha256:'changed'});
        expect(defaultTrainedEloArtifact()).toEqual(artifact);
    });
    it('rejects tampered, missing or unknown artifacts and mixing manual controls into the trained model', () => {
        for (const change of [{learnedModel:undefined},{learnedModel:{...artifact,sha256:'bad'}},
            {learnedModel:{...artifact,payloadJson:artifact.payloadJson+' '}},{denominator:400},
            {contextualTerms:{tournamentForm:true,seriesForm:true,pressure:true,sequence:true}},
            {gprOverrides:{[payload.teams[0]!.teamId]:2000}}]) {
            expect(()=>validateRequest({...request(),...change})).toThrow();
        }
        expect(()=>validateRequest({...gprSeedRequest(),learnedModel:artifact})).toThrow('incompatible_model');
    });
    it('rejects a bad payload hash during the build without requiring raw data', () => {
        const root = mkdtempSync(join(tmpdir(), 'elo-artifact-'));
        try {
            const dir = join(root, 'models/artifacts'); mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, 'internal-elo-trained-2026-10-21-v1.json'), JSON.stringify({ ...artifact, payloadJson: artifact.payloadJson + ' ' }));
            expect(() => execFileSync(process.execPath, [resolve('scripts/validate-trained-artifacts.mjs')], { cwd: root, stdio: 'pipe' }))
                .toThrow('Trained artifact payload hash mismatch');
        } finally { rmSync(root, { recursive: true, force: true }); }
    });
    it('requires exact team identities and never substitutes current GPR for a missing rating', () => {
        const r=request(); const teams=r.snapshot.teams.map((t,i)=>i===0?{...t,id:'unknown-id'}:t);
        expect(()=>validateRequest({...r,snapshot:{...r.snapshot,teams}})).toThrow();
    });
    it('uses the learned ratings and confidence slope for both probabilities and stable log probabilities', () => {
        const prepared=prepareSimulation(request());const world=prepared.prediction.createState(createTournamentRandom(42,0));
        const fixture=request().snapshot.fixtures[0]!;
        const context=preGameContext(fixture,{a:0,b:0,previousWinner:undefined});
        const a=payload.teams.find((t)=>t.teamId===fixture.teamA)!.rating;
        const b=payload.teams.find((t)=>t.teamId===fixture.teamB)!.rating;
        const expected=1/(1+10**((b-a)*.75/400));
        expect(prepared.prediction.predictGame(context,world).pWinA).toBeCloseTo(expected,14);
        expect(Math.exp(prepared.prediction.stationaryGameLogProbabilities!(context,world).a)).toBeCloseTo(expected,14);
        expect(prepared.powers[fixture.teamA]).toBe(a);
    });
    it('runs reproducibly with a complete manifest and differs from GPR without changing tournament rules', () => {
        const first=runSimulations(request());expect(runSimulations(request())).toEqual(first);
        expect(first.aggregates).not.toEqual(runSimulations(gprSeedRequest(10)).aggregates);
        expect(first.metadata.model).toMatchObject({status:'trained_experimental',recommended:false,artifactHash:artifact.sha256,
            modelId:payload.modelId,sourceCutoffUtc:payload.cutoffUtc,conditionalInferenceMode:'stationary_frozen_ratings'});
        expect(Object.values(first.aggregates.teams).reduce((s,t)=>s+t.finishCounts.champion,0)).toBe(10);
    });
    it('does not apply GPR values or manual v2 pressure/form bonuses to learned predictions', () => {
        const r=request();const altered={...r,strengths:{...r.strengths,profiles:r.strengths.profiles.map((p)=>({...p,gpr:2000,
            sigmaTournament:200,sigmaSeries:200,pressureElo:80,afterWinElo:70,afterLossElo:-70}))}};
        expect(runSimulations(altered).aggregates).toEqual(runSimulations(r).aggregates);
    });
    it('preserves fixed winners and observed scores, with no online Elo reward or latent posterior required', () => {
        const r=request();const fixture=r.snapshot.fixtures[0]!;
        for (const constraint of [{...fixture,status:'decided' as const,score:undefined,winner:fixture.teamB},
            {...fixture,status:'completed' as const,score:{a:0,b:1}}]) {
            const result=runSimulations({...r,scenario:{mode:'custom',fixtures:[constraint]}});
            expect(result.example.matches.find((m)=>m.id===fixture.id)?.score).toEqual({a:0,b:1});
            if (result.metadata.model.modelVersion !== 'gpr-context-v2') throw new Error('Unexpected legacy model');
            expect(result.metadata.model.effectiveRatings).toEqual(Object.fromEntries(payload.teams.map((t)=>[t.teamId,t.rating])));
        }
    });
    it('carries the full immutable artifact through scenario JSON and compares against GPR with fixed winners', () => {
        const r=request(3);const fixture=r.snapshot.fixtures[0]!;
        const fixed={...r,scenario:{mode:'custom' as const,fixtures:[{...fixture,status:'decided' as const,score:undefined,winner:fixture.teamA}]}};
        const doc={kind:'bracket-lab-scenario',schemaVersion:2,id:'learned',name:'Learned',createdAt:'2026-10-22T00:00:00Z',updatedAt:'2026-10-22T00:00:00Z',request:fixed};
        const copy=parseScenarioFile(JSON.stringify(doc));expect(copy.request.learnedModel).toEqual(artifact);
        expect(runSimulations(copy.request)).toEqual(runSimulations(fixed));
        const [base,candidate]=comparisonRequests(fixed,{tournamentForm:true,seriesForm:true,pressure:true,sequence:true});
        expect(base.preset).toBe('gpr_baseline');expect(base.learnedModel).toBeUndefined();
        expect(candidate.preset).toBe('historical_elo_trained_v1');expect(candidate.contextualTerms).toBeUndefined();
        expect(()=>validateComparison({baseline:runSimulations(base),contextual:runSimulations(candidate)})).not.toThrow();
    });
});

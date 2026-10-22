import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const hash = (data) => createHash('sha256').update(data).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
for (const name of ['internal-elo-trained-2026-10-21-v1.json', 'internal-elo-last-observed-form-2026-10-21-v1.json']) {
    const artifact = json('models/artifacts/'+name);
    assert.equal(artifact.schemaVersion, 1);
    assert.equal(hash(artifact.payloadJson), artifact.sha256, 'Trained artifact payload hash mismatch');
    const payload = JSON.parse(artifact.payloadJson);
    assert.equal(payload.status, 'trained_experimental');
    assert.equal(payload.recommended, false);
    assert.equal(payload.schemaVersion, 1);
    assert.deepEqual(payload.teams.map((t) => t.teamId).sort(), json('database/data/worlds-2026.json').teams.map((t) => t.id).sort());
    assert.equal(new Set(payload.teams.map((t) => t.sourceTeamId).filter(Boolean)).size, payload.teams.filter((t) => t.sourceTeamId).length);
    for (const team of payload.teams) {
        if (team.formRatingAdjustment !== undefined) {
            assert.ok(Number.isFinite(team.formRatingAdjustment));
            assert.ok(team.form.days <= payload.parameters.formSourceDays && team.form.games <= team.games);
            const expected = payload.parameters.formCoefficient * (team.form.value ?? 0) * payload.parameters.divisor / (payload.parameters.logOddsSlope * Math.LN10);
            assert.ok(Math.abs(team.formRatingAdjustment - expected) < 1e-10, 'Form adjustment disagrees with learned log odds');
        }
        assert.ok(Number.isFinite(team.rating) && Number.isSafeInteger(team.games) && team.games >= 0);
        if (team.status === 'learned') {
            assert.ok(team.sourceTeamId && team.sourceName && team.games > 0 && Date.parse(team.lastGameUtc) < Date.parse(payload.cutoffUtc));
        } else {
            assert.equal(team.status, 'prior_only'); assert.equal(team.games, 0); assert.equal(team.rating, payload.parameters.initialRating);
            assert.equal(team.sourceTeamId, null); assert.equal(team.lastGameUtc, null);
        }
    }
    const parameters = payload.parameters;
    assert.ok(Object.values(parameters).every(Number.isFinite));
    assert.ok(parameters.k > 0 && parameters.logOddsSlope > 0 && parameters.divisor / parameters.logOddsSlope >= 200 && parameters.divisor / parameters.logOddsSlope <= 800);
    assert.ok(Date.parse(payload.parameterSelectionEndUtc) < Date.parse(payload.cutoffUtc));
    for (const [key, path] of Object.entries({
        baselineReportSha256: 'models/reports/internal-elo-v1/metrics.json',
        confidenceReportSha256: 'models/reports/elo-confidence-v1/metrics.json',
        tuningReportSha256: 'models/reports/internal-elo-tuning-v1/metrics.json',
        identityAuditSha256: 'models/reports/chaincc-identities-v3b/audit.json',
        mappingSha256: 'analysis/config/worlds-2026-elo-mapping-v1.json',
    })) assert.equal(hash(readFileSync(path)), payload.source[key], `Trained artifact provenance mismatch: ${key}`);
    if (payload.source.formReportSha256) {
        assert.equal(hash(readFileSync('models/reports/last-observed-form-v1/metrics.json')), payload.source.formReportSha256);
        assert.equal(hash(readFileSync('models/artifacts/internal-elo-trained-2026-10-21-v1.json')), payload.source.baseArtifactSha256);
    }
}
console.log('Trained experimental Elo artifacts: hashes, coverage and provenance verified.');

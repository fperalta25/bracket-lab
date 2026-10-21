import { currentLocale, formatDate, formatNumber, t, type TranslationKey } from '../i18n';
import { SWISS_16_RULES, FINAL_BUCKETS, SWISS_RECORDS, validateRequest, validateConstraints,
    type GprSimulationRequest, type StrengthProfileSet, type TournamentSnapshot, type SimulationOutput, type Team } from '../simulator';
import type { WorkerMessage } from './worker';
import { probabilityText, qualificationCount } from './presentation';

const STORAGE_KEY = 'bracket-lab.public-simulation.v1';
interface Payload { snapshot: Omit<TournamentSnapshot, 'rules'>; strengths: StrengthProfileSet }
type Table = 'final' | 'swiss';
const columns = {
    final: FINAL_BUCKETS.map((key) => ({ key, label: `results.${key}` as TranslationKey })),
    swiss: ['qualify', ...SWISS_RECORDS].map((key) => ({ key, label: `results.${key}` as TranslationKey })),
};

export function publicSimulator() {
    const payload = JSON.parse(document.getElementById('simulation-data')!.textContent!) as Payload;
    let activeWorker: Worker | undefined;
    let pendingLanguage: string | undefined;
    return {
        mode: 'official_state' as 'official_state' | 'from_scratch',
        preset: 'gpr_baseline' as GprSimulationRequest['preset'],
        iterations: 10000, seed: 2026, denominator: 400,
        busy: false, completed: 0, canceled: false, error: '',
        output: null as SimulationOutput | null, finishedAt: '',
        search: '', region: '',
        sorts: { final: { key: 'champion', descending: true }, swiss: { key: 'qualify', descending: true } },
        tables: ['final', 'swiss'] as Table[], columns,
        teams: payload.snapshot.teams,
        regions: [...new Set(payload.snapshot.teams.map((team) => team.region))].sort(),
        init() {
            try {
                const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null');
                if (saved?.version === 1 && saved.snapshotId === payload.snapshot.id && saved.profileId === payload.strengths.id) {
                    const c = saved.controls;
                    for (const key of ['mode', 'preset', 'iterations', 'seed', 'denominator'] as const) {
                        Object.assign(this, { [key]: c[key] });
                    }
                    this.search = typeof c.search === 'string' ? c.search.slice(0, 200) : '';
                    this.region = typeof c.region === 'string' && this.regions.includes(c.region) ? c.region : '';
                    for (const table of this.tables) {
                        if (columns[table].some((column) => column.key === c.sorts?.[table]?.key)
                            && typeof c.sorts[table].descending === 'boolean') this.sorts[table] = c.sorts[table];
                    }
                    validateRequest(this.request());
                    if (saved.output) {
                        if (!Number.isFinite(Date.parse(saved.finishedAt)) || saved.output.metadata.request.modelVersion !== 'gpr-context-v2') throw new Error('stored_output');
                        validateRequest(saved.output.metadata.request);
                        validateConstraints(saved.output.metadata.request.snapshot, saved.output.example.matches);
                        const total = saved.output.metadata.iterations;
                        if (saved.output.aggregates.completedIterations !== total) throw new Error('incomplete');
                        for (const team of saved.output.metadata.request.snapshot.teams as Team[]) {
                            const aggregate = saved.output.aggregates.teams[team.id];
                            for (const counts of [aggregate.finishCounts, aggregate.swissRecordCounts]) {
                                const values = Object.values(counts) as number[];
                                if (!values.every((n) => Number.isInteger(n) && n >= 0 && n <= total)
                                    || values.reduce((a, b) => a + b, 0) !== total) throw new Error('counts');
                            }
                        }
                        this.output = saved.output;
                        this.finishedAt = saved.finishedAt;
                    }
                }
            } catch { try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* Storage may be blocked. */ } this.mode = 'official_state'; this.preset = 'gpr_baseline'; this.iterations = 10000; this.seed = 2026; this.denominator = 400; }
            window.addEventListener('pagehide', () => this.save());
            // Finish the current run before a language reload, then restore its completed output.
            for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>('.language-switch a'))) {
                link.addEventListener('click', (event) => {
                    this.save();
                    if (this.busy) { event.preventDefault(); pendingLanguage = link.href; }
                });
            }
        },
        request(): GprSimulationRequest {
            return { modelVersion: 'gpr-context-v2', preset: this.preset,
                snapshot: { ...payload.snapshot, rules: SWISS_16_RULES }, strengths: payload.strengths,
                scenario: { mode: this.mode }, seed: Number(this.seed), iterations: Number(this.iterations), denominator: Number(this.denominator),
                ...(this.preset === 'contextual_v1' ? { contextualTerms: { tournamentForm: true, seriesForm: true, pressure: true, sequence: true } } : {}) };
        },
        get contextualAvailable() {
            return this.mode === 'from_scratch' || !payload.snapshot.fixtures.some((f) => f.status === 'completed' || (f.games?.length ?? 0) > 0);
        },
        changeMode() { if (!this.contextualAvailable) this.preset = 'gpr_baseline'; this.save(); },
        save() {
            try {
                sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, snapshotId: payload.snapshot.id, profileId: payload.strengths.id,
                    controls: { mode: this.mode, preset: this.preset, iterations: this.iterations, seed: this.seed, denominator: this.denominator,
                        search: this.search, region: this.region, sorts: this.sorts }, output: this.output, finishedAt: this.finishedAt }));
            } catch { /* Storage availability must not prevent simulation. */ }
        },
        start() {
            if (this.busy) return;
            this.error = ''; this.canceled = false; this.completed = 0;
            try {
                const request = this.request();
                validateRequest(request);
                const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
                activeWorker = worker; this.busy = true; this.save();
                worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
                    if (activeWorker !== worker) return;
                    if (event.data.type === 'progress') this.completed = event.data.completed;
                    else {
                        if (event.data.type === 'result') {
                            this.output = event.data.output; this.finishedAt = new Date().toISOString();
                        } else this.error = t(event.data.context.reason === 'contextual_posterior_required' ? 'simulation.error_posterior' : 'simulation.error_data');
                        this.finish();
                    }
                };
                worker.onerror = (event) => { if (activeWorker !== worker) return; event.preventDefault(); this.error = t('simulation.error_worker'); this.finish(); };
                worker.postMessage(request);
            } catch { this.error = t('simulation.error_data'); this.finish(); }
        },
        finish() {
            activeWorker?.terminate(); activeWorker = undefined; this.busy = false; this.save();
            if (pendingLanguage) window.location.assign(pendingLanguage);
        },
        cancel() { this.canceled = true; this.finish(); },
        count(team: Team, table: Table, key: string): number {
            const aggregate = this.output!.aggregates.teams[team.id]!;
            if (key === 'qualify') return qualificationCount(aggregate);
            const values: Readonly<Record<string, number>> = table === 'final' ? aggregate.finishCounts : aggregate.swissRecordCounts;
            return values[key] ?? 0;
        },
        rows(table: Table): Team[] {
            if (!this.output) return [];
            const query = this.search.trim().toLowerCase();
            const sort = this.sorts[table];
            return this.output.metadata.request.snapshot.teams.filter((team) => (!this.region || team.region === this.region)
                && `${team.acronym} ${team.name}`.toLowerCase().includes(query)).sort((a, b) => {
                const diff = this.count(a, table, sort.key) - this.count(b, table, sort.key);
                return (sort.descending ? -diff : diff) || (a.id < b.id ? -1 : 1);
            });
        },
        sort(table: Table, key: string) {
            const previous = this.sorts[table];
            this.sorts[table] = { key, descending: previous.key === key ? !previous.descending : true }; this.save();
        },
        ariaSort(table: Table, key: string) { return this.sorts[table].key !== key ? 'none' : this.sorts[table].descending ? 'descending' : 'ascending'; },
        percent(count: number) { return probabilityText(count, this.output!.aggregates.completedIterations, currentLocale()); },
        number(value: number) { return formatNumber(value); },
        translate(key: TranslationKey) { return t(key); },
        teamName(id: string) { return this.output?.metadata.request.snapshot.teams.find((team) => team.id === id)?.acronym ?? id; },
        get resultSummary() {
            if (!this.output) return '';
            const r = this.output.metadata;
            return t('simulation.summary', { count: formatNumber(r.iterations), mode: t(r.sourceMode === 'from_scratch' ? 'simulation.scratch' : 'simulation.official'),
                model: t(r.request.modelVersion === 'gpr-context-v2' && r.request.preset === 'contextual_v1' ? 'simulation.contextual' : 'simulation.gpr') });
        },
        get methodSummary() {
            if (!this.output) return '';
            const r = this.output.metadata.request as GprSimulationRequest;
            return t('simulation.method_values', { seed: r.seed, denominator: r.denominator ?? 400, snapshot: r.strengths.ratingSnapshot.asOf,
                profile: r.strengths.revision, revision: r.snapshot.revision ?? t('tournament.initial_note'),
                date: formatDate(new Date(this.finishedAt), currentLocale(), { dateStyle: 'short', timeStyle: 'short' }) });
        },
        get samplingError() {
            return this.output ? t('simulation.sampling', { margin: formatNumber(1.96 * Math.sqrt(0.25 / this.output.metadata.iterations) * 100, currentLocale(), { maximumFractionDigits: 2 }) }) : '';
        },
        get rematches() {
            return this.output ? t('simulation.rematches', { runs: formatNumber(this.output.aggregates.rematches.affectedIterations), series: formatNumber(this.output.aggregates.rematches.repeatedSeries) }) : '';
        },
        get usedRatings() {
            if (!this.output) return [];
            const r = this.output.metadata.request as GprSimulationRequest;
            return r.snapshot.teams.map((team) => ({ name: team.acronym, rating: r.gprOverrides?.[team.id] ?? r.strengths.profiles.find((p) => p.teamId === team.id)!.gpr }));
        },
        get exampleRounds() {
            if (!this.output) return [];
            return [1, 2, 3, 4, 5].map((round) => ({ key: `swiss-${round}`, label: t('simulation.round', { round }),
                matches: this.output!.example.matches.filter((m) => m.stage === 'swiss' && m.round === round) }))
                .concat((['quarterfinal', 'semifinal', 'final'] as const).map((stage) => ({ key: stage,
                    label: t(`simulation.${stage}`), matches: this.output!.example.matches.filter((m) => m.stage === stage) })));
        },
    };
}

import { currentLocale, formatDate, formatNumber, t, type TranslationKey } from '../i18n';
import { SWISS_16_RULES, FINAL_BUCKETS, SWISS_RECORDS, validateRequest, validateConstraints,
    type GprSimulationRequest, type StrengthProfileSet, type TournamentSnapshot, type SimulationOutput, type Team, type Fixture, fixtureWinner } from '../simulator';
import type { WorkerMessage } from './worker';
import { parseScenarioFile, SCENARIO_FILE_LIMIT, validateSavedScenario, type SavedScenario } from './scenarios';
import { swissRoundState } from './scenario-rounds';
import { advanceSwissBoard, BOARD_GROUPS, chooseSwissWinner, redrawSwissGroup, swissBoardView } from './swiss-board';
import { advanceKnockoutBoard, chooseKnockoutWinner, knockoutBoardView } from './knockout-board';
import { listScenarios, storeScenario, removeScenario } from './scenario-storage';
import { outcomeSupport } from './outcome-support';
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
    let base = { snapshot: { ...payload.snapshot, rules: SWISS_16_RULES }, strengths: payload.strengths };
    let gprOverrides: GprSimulationRequest['gprOverrides'];
    let contextualTerms = { tournamentForm: true, seriesForm: true, pressure: true, sequence: true };
    let activeWorker: Worker | undefined;
    let pendingLanguage: string | undefined;
    let supportCache: { request: SimulationOutput['metadata']['request']; values: ReturnType<typeof outcomeSupport> } | undefined;
    return {
        mode: 'official_state' as 'official_state' | 'from_scratch' | 'custom',
        previousMode: 'official_state' as 'official_state' | 'from_scratch' | 'custom',
        draftFixtures: [] as readonly Fixture[], draftInitialized: false,
        editingRound: 1, knockoutRound: 1, drawIndex: 0,
        boardUndo: null as { fixtures: readonly Fixture[]; drawIndex: number; preset: GprSimulationRequest['preset']; editingRound?: number; knockoutRound?: number } | null,
        boardMessage: '', boardReset: false,
        scenarioName: '', selectedScenarioId: '', activeScenarioId: '', library: [] as SavedScenario[], scenarioMessage: '', libraryBusy: false,
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
                if ([1, 2].includes(saved?.version) && saved.snapshotId === payload.snapshot.id && saved.profileId === payload.strengths.id) {
                    const c = saved.controls;
                    if (saved.version === 2) {
                        base = saved.base; gprOverrides = saved.gprOverrides; contextualTerms = saved.contextualTerms;
                        this.editingRound = Number.isInteger(c.editingRound) && c.editingRound >= 1 && c.editingRound <= 5 ? c.editingRound : 1;
                        this.knockoutRound = Number.isInteger(c.knockoutRound) && c.knockoutRound >= 1 && c.knockoutRound <= 3 ? c.knockoutRound : 1;
                        this.drawIndex = Number.isSafeInteger(c.drawIndex) && c.drawIndex >= 0 ? c.drawIndex : 0;
                        this.draftFixtures = c.draftFixtures;
                        if (c.boardUndo && Array.isArray(c.boardUndo.fixtures) && Number.isSafeInteger(c.boardUndo.drawIndex)) {
                            validateConstraints(base.snapshot, c.boardUndo.fixtures); this.boardUndo = c.boardUndo;
                        } this.draftInitialized = Boolean(c.draftInitialized);
                        this.scenarioName = typeof c.scenarioName === 'string' ? c.scenarioName.slice(0, 80) : '';
                        this.selectedScenarioId = typeof c.selectedScenarioId === 'string' ? c.selectedScenarioId : '';
                        this.activeScenarioId = typeof c.activeScenarioId === 'string' ? c.activeScenarioId : '';
                        this.teams = base.snapshot.teams;
                    }
                    for (const key of ['mode', 'preset', 'iterations', 'seed', 'denominator'] as const) {
                        Object.assign(this, { [key]: c[key] });
                    }
                    this.search = typeof c.search === 'string' ? c.search.slice(0, 200) : '';
                    this.region = typeof c.region === 'string' && this.regions.includes(c.region) ? c.region : '';
                    for (const table of this.tables) {
                        if (columns[table].some((column) => column.key === c.sorts?.[table]?.key)
                            && typeof c.sorts[table].descending === 'boolean') this.sorts[table] = c.sorts[table];
                    }
                    this.previousMode = this.mode;
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
            } catch { try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* Storage may be blocked. */ } this.mode = 'official_state'; this.preset = 'gpr_baseline'; this.iterations = 10000; this.seed = 2026; this.denominator = 400; this.previousMode = 'official_state'; this.draftFixtures = []; this.draftInitialized = false; base = { snapshot: { ...payload.snapshot, rules: SWISS_16_RULES }, strengths: payload.strengths }; gprOverrides = undefined; contextualTerms = { tournamentForm: true, seriesForm: true, pressure: true, sequence: true }; this.teams = payload.snapshot.teams; this.editingRound = 1; this.knockoutRound = 1; this.drawIndex = 0; }
            void this.refreshLibrary();
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
                snapshot: base.snapshot, strengths: base.strengths,
                scenario: this.mode === 'custom' ? { mode: 'custom', fixtures: JSON.parse(JSON.stringify(this.draftFixtures)) as Fixture[] } : { mode: this.mode },
                ...(gprOverrides ? { gprOverrides } : {}), seed: Number(this.seed), iterations: Number(this.iterations), denominator: Number(this.denominator),
                ...(this.preset === 'contextual_v1' ? { contextualTerms: { ...contextualTerms } } : {}) };
        },
        get contextualAvailable() {
            return this.mode === 'from_scratch' || !(this.mode === 'custom' ? this.draftFixtures : base.snapshot.fixtures).some((f) => f.status !== 'scheduled' || (f.games?.length ?? 0) > 0);
        },
        changeMode() {
            if (this.mode === 'custom' && !this.draftInitialized) {
                this.draftFixtures = this.previousMode === 'from_scratch' ? [] : JSON.parse(JSON.stringify(base.snapshot.fixtures)) as Fixture[];
                this.draftInitialized = true;
            }
            this.previousMode = this.mode;
            this.ensureModel();
            if (this.mode === 'custom') this.fillBoard();
            this.save();
        },
        ensureModel() {
            if (!this.contextualAvailable && this.preset === 'contextual_v1') {
                this.preset = 'gpr_baseline'; this.scenarioMessage = t('scenario.gpr_selected');
            }
        },
        save() {
            try {
                sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, base, gprOverrides, contextualTerms, snapshotId: payload.snapshot.id, profileId: payload.strengths.id,
                    controls: { mode: this.mode, preset: this.preset, iterations: this.iterations, seed: this.seed, denominator: this.denominator,
                        search: this.search, region: this.region, sorts: this.sorts,
                        editingRound: this.editingRound, knockoutRound: this.knockoutRound, drawIndex: this.drawIndex, boardUndo: this.boardUndo, draftFixtures: this.draftFixtures, draftInitialized: this.draftInitialized, scenarioName: this.scenarioName, selectedScenarioId: this.selectedScenarioId, activeScenarioId: this.activeScenarioId }, output: this.output, finishedAt: this.finishedAt }));
            } catch { /* Storage availability must not prevent simulation. */ }
        },
        boardRequest(): GprSimulationRequest {
            const request = this.request();
            return { ...request, scenario: { mode: 'custom', fixtures: this.mode === 'custom' ? request.scenario.mode === 'custom' ? request.scenario.fixtures : []
                : this.mode === 'from_scratch' ? [] : base.snapshot.fixtures } };
        },
        get board() { return swissBoardView(this.boardRequest()); },
        get knockout() { return knockoutBoardView(this.boardRequest()); },
        currentTeamName(id: string) { return this.teams.find((team) => team.id === id)?.acronym ?? id; },
        startBoard() {
            if (this.mode === 'from_scratch') this.draftInitialized = false;
            this.mode = 'custom'; this.changeMode();
        },
        fillBoard() {
            this.error = '';
            try {
                const swiss = advanceSwissBoard(this.request(), this.drawIndex);
                const next = advanceKnockoutBoard({ ...this.request(), scenario: { mode: 'custom', fixtures: swiss.fixtures } }, swiss.nextDrawIndex);
                this.draftFixtures = next.fixtures; this.drawIndex = next.nextDrawIndex;
            }
            catch { this.error = t('scenario.error_constraints'); }
        },
        redrawGroup(round: number, record: string) {
            if (this.mode !== 'custom') this.startBoard();
            this.error = ''; this.boardReset = false;
            try {
                const previous = { fixtures: JSON.parse(JSON.stringify(this.draftFixtures)) as Fixture[], drawIndex: this.drawIndex,
                    preset: this.preset, editingRound: this.editingRound, knockoutRound: this.knockoutRound };
                const next = redrawSwissGroup(this.request(), round, record, this.drawIndex);
                this.boardUndo = previous; this.draftFixtures = next.fixtures; this.drawIndex = next.nextDrawIndex;
                this.boardReset = next.removedResults > 0; this.boardMessage = t('board.redrawn', { record });
                this.ensureModel(); this.save();
            } catch { this.error = t('scenario.error_constraints'); }
        },
        pickWinner(fixtureId: string, winner: string) {
            if (this.mode !== 'custom') this.startBoard();
            this.error = ''; this.boardReset = false;
            try {
                const previous = { fixtures: JSON.parse(JSON.stringify(this.draftFixtures)) as Fixture[], drawIndex: this.drawIndex, preset: this.preset, editingRound: this.editingRound, knockoutRound: this.knockoutRound };
                const old = this.draftFixtures.find((f) => f.id === fixtureId)!;
                const chosen = old.stage === 'swiss' ? chooseSwissWinner(this.request(), fixtureId, winner, this.drawIndex)
                    : chooseKnockoutWinner(this.request(), fixtureId, winner, this.drawIndex);
                const next = old.stage === 'swiss' ? advanceKnockoutBoard({ ...this.request(), scenario: { mode: 'custom', fixtures: chosen.fixtures } }, chosen.nextDrawIndex) : chosen;
                this.boardUndo = previous; this.draftFixtures = next.fixtures; this.drawIndex = next.nextDrawIndex;
                this.boardReset = chosen.removedResults > 0; this.ensureModel();
                const selected = this.draftFixtures.find((f) => f.id === fixtureId)!;
                if (fixtureWinner(selected) && old.stage !== 'swiss') {
                    this.boardMessage = old.stage === 'final' ? t('knockout.champion_announcement', { team: this.currentTeamName(winner) })
                        : t('knockout.advance', { team: this.currentTeamName(winner), stage: t(old.stage === 'quarterfinal' ? 'simulation.semifinal' : 'simulation.final') });
                    const current = this.draftFixtures.filter((f) => f.stage === old.stage);
                    const expected = old.stage === 'quarterfinal' ? 4 : old.stage === 'semifinal' ? 2 : 1;
                    if (current.length === expected && current.every((f) => fixtureWinner(f)) && old.stage !== 'final') {
                        this.knockoutRound = old.round + 1;
                        if (window.matchMedia('(max-width: 760px)').matches) requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.knockout-column[data-active="true"] .board-team:not(:disabled)')?.focus());
                    }
                } else if (fixtureWinner(selected)) {
                    const states = swissRoundState(this.request(), old.round).states;
                    const loser = winner === old.teamA ? old.teamB : old.teamA;
                    const a = states.get(winner)!; const b = states.get(loser)!;
                    this.boardMessage = t('board.advance', { winner: this.currentTeamName(winner), winnerRecord: `${a.wins + 1}-${a.losses}`,
                        loser: this.currentTeamName(loser), loserRecord: `${b.wins}-${b.losses + 1}` });
                    const current = this.draftFixtures.filter((f) => f.stage === 'swiss' && f.round === old.round);
                    const expected = BOARD_GROUPS[old.round - 1]!.reduce((sum, group) => sum + group.expected / 2, 0);
                    if (current.length === expected && current.every((f) => fixtureWinner(f))) {
                        this.editingRound = Math.min(5, old.round + 1);
                        if (old.round === 5) this.knockoutRound = 1;
                        if (window.matchMedia('(max-width: 760px)').matches) requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(old.round === 5 ? '.knockout-column[data-active="true"] .board-team:not(:disabled)' : '.board-column[data-active="true"] .board-team')?.focus());
                    }
                } else this.boardMessage = t('board.cleared');
                this.save();
            } catch { this.error = t('scenario.error_constraints'); }
        },
        undoBoard() {
            if (!this.boardUndo) return;
            this.draftFixtures = this.boardUndo.fixtures; this.drawIndex = this.boardUndo.drawIndex;
            this.preset = this.boardUndo.preset; this.editingRound = this.boardUndo.editingRound ?? 1; this.knockoutRound = this.boardUndo.knockoutRound ?? 1; this.boardUndo = null; this.boardReset = false;
            this.scenarioMessage = ''; this.boardMessage = t('board.undone'); this.ensureModel(); this.save();
        },
        resetBoard() {
            this.boardUndo = { fixtures: JSON.parse(JSON.stringify(this.draftFixtures)) as Fixture[], drawIndex: this.drawIndex, preset: this.preset, editingRound: this.editingRound, knockoutRound: this.knockoutRound };
            this.mode = 'custom'; this.previousMode = 'custom'; this.draftInitialized = true;
            this.draftFixtures = JSON.parse(JSON.stringify(base.snapshot.fixtures)) as Fixture[];
            this.editingRound = 1; this.knockoutRound = 1; this.boardReset = false; this.scenarioMessage = ''; this.ensureModel(); this.fillBoard(); this.save();
        },
        get constraintSummary() {
            const fixtures = this.mode === 'custom' ? this.draftFixtures : this.mode === 'from_scratch' ? [] : base.snapshot.fixtures;
            return t('scenario.constraints', { fixtures: fixtures.length, results: fixtures.filter((f) => f.status !== 'scheduled').length });
        },
        async refreshLibrary() {
            try { this.library = await listScenarios(); }
            catch { this.error = t('scenario.error_storage'); }
        },
        document(): SavedScenario {
            const name = this.scenarioName.trim();
            if (!name || name.length > 80) throw new Error('name');
            const now = new Date().toISOString();
            const existing = this.library.find((doc) => doc.id === this.activeScenarioId);
            return validateSavedScenario({ kind: 'bracket-lab-scenario', schemaVersion: 2,
                id: existing?.id ?? crypto.randomUUID(), name, createdAt: existing?.createdAt ?? now, updatedAt: now, request: this.request() });
        },
        async saveScenario() {
            this.error = '';
            if (!this.scenarioName.trim()) { this.error = t('scenario.error_name'); return; }
            if (!this.activeScenarioId && this.library.length >= 50) { this.error = t('scenario.error_limit'); return; }
            this.libraryBusy = true;
            try { const doc = this.document(); await storeScenario(doc); this.activeScenarioId = doc.id; this.selectedScenarioId = doc.id; await this.refreshLibrary(); this.save(); }
            catch { this.error = t('scenario.error_storage'); }
            finally { this.libraryBusy = false; }
        },
        applyScenario(doc: SavedScenario, duplicate = false) {
            const copy = validateSavedScenario(doc);
            if (copy.request.snapshot.id !== payload.snapshot.id
                || copy.request.snapshot.teams.map((team) => team.id).sort().join('|') !== payload.snapshot.teams.map((team) => team.id).sort().join('|')) throw new Error('tournament');
            const r = copy.request;
            base = { snapshot: r.snapshot, strengths: r.strengths }; gprOverrides = r.gprOverrides;
            contextualTerms = r.contextualTerms ? { ...r.contextualTerms } : { tournamentForm: true, seriesForm: true, pressure: true, sequence: true };
            this.editingRound = 1; this.knockoutRound = 1; this.drawIndex = 0; this.boardUndo = null; this.boardReset = false;
            this.teams = r.snapshot.teams; this.mode = r.scenario.mode; this.previousMode = this.mode;
            this.draftFixtures = r.scenario.mode === 'custom' ? r.scenario.fixtures : [];
            this.draftInitialized = r.scenario.mode === 'custom';
            this.preset = r.preset; this.seed = r.seed; this.iterations = r.iterations; this.denominator = r.denominator ?? r.strengths.calibration.eloDenominator;
            this.scenarioName = duplicate ? t('scenario.copy_name', { name: copy.name }).slice(0, 80) : copy.name;
            this.activeScenarioId = duplicate ? '' : copy.id; this.selectedScenarioId = this.activeScenarioId;
            this.output = null; this.finishedAt = ''; this.error = ''; this.scenarioMessage = ''; this.canceled = false; this.save();
        },
        loadScenario(duplicate = false) {
            const doc = this.library.find((item) => item.id === this.selectedScenarioId);
            if (doc) { try { this.applyScenario(doc, duplicate); } catch { this.error = t('scenario.error_file'); } }
        },
        async deleteScenario() {
            this.libraryBusy = true;
            try { await removeScenario(this.selectedScenarioId); if (this.activeScenarioId === this.selectedScenarioId) this.activeScenarioId = ''; this.selectedScenarioId = ''; await this.refreshLibrary(); this.save(); }
            catch { this.error = t('scenario.error_storage'); }
            finally { this.libraryBusy = false; }
        },
        exportScenario() {
            this.error = '';
            if (!this.scenarioName.trim()) { this.error = t('scenario.error_name'); return; }
            try {
                const doc = this.document();
                const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
                const anchor = document.createElement('a'); anchor.href = url; anchor.download = `scenario-${crypto.randomUUID()}.json`; anchor.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch { this.error = t('scenario.error_file'); }
        },
        async importScenario(event: Event) {
            const input = event.target as HTMLInputElement;
            const file = input.files?.[0]; if (!file) return;
            this.error = ''; this.libraryBusy = true;
            try {
                if (file.size > SCENARIO_FILE_LIMIT) throw new Error('size');
                this.applyScenario(parseScenarioFile(await file.text()), true);
            } catch { this.error = t('scenario.error_file'); }
            finally { input.value = ''; this.libraryBusy = false; }
        },
        start() {
            if (this.busy || this.libraryBusy) return;
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
        percent(team: Team, table: Table, key: string) {
            const output = this.output!;
            if (supportCache?.request !== output.metadata.request) supportCache = { request: output.metadata.request, values: outcomeSupport(output.metadata.request) };
            const support = supportCache.values[team.id]!;
            const possible = key === 'qualify' ? support.qualify : table === 'swiss' ? support.swiss.has(key) : support.final.has(key as typeof FINAL_BUCKETS[number]);
            return probabilityText(this.count(team, table, key), output.aggregates.completedIterations, currentLocale(), !possible);
        },
        number(value: number) { return formatNumber(value); },
        translate(key: TranslationKey) { return t(key); },
        originLabel(origin: string) { return t(origin === 'constrained' ? 'board.constrained' : origin === 'simulated' ? 'simulation.simulated' : this.output?.metadata.sourceMode === 'custom' ? 'scenario.locked' : 'simulation.fixed'); },
        teamName(id: string) { return this.output?.metadata.request.snapshot.teams.find((team) => team.id === id)?.acronym ?? id; },
        get resultSummary() {
            if (!this.output) return '';
            const r = this.output.metadata;
            return t('simulation.summary', { count: formatNumber(r.iterations), mode: t(r.sourceMode === 'custom' ? 'scenario.custom' : r.sourceMode === 'from_scratch' ? 'simulation.scratch' : 'simulation.official'),
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

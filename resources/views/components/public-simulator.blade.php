@props(['simulationData'])

<script type="application/json" id="simulation-data">@json($simulationData)</script>
<section id="simulacion" class="section simulator" x-data="publicSimulator" aria-labelledby="simulacion-titulo">
    <h2 id="simulacion-titulo">{{ __('simulation.title') }}</h2>
    <noscript><p class="notice">{{ __('simulation.no_js') }}</p></noscript>
    <form x-cloak @submit.prevent="start()" class="simulation-form">
        <fieldset :disabled="busy || libraryBusy">
            <div class="control-grid">
                <label>{{ __('simulation.from') }}<select aria-label="{{ __('simulation.from') }}" x-model="mode" @change="changeMode()"><option value="official_state">{{ __('simulation.official') }}</option><option value="from_scratch">{{ __('simulation.scratch') }}</option><option value="custom">{{ __('scenario.custom') }}</option></select></label>
                <label>{{ __('simulation.model') }}<select aria-label="{{ __('simulation.model') }}" x-model="preset" @change="save()"><option value="gpr_baseline">{{ __('simulation.gpr') }}</option><option value="contextual_v1" :disabled="!contextualAvailable">{{ __('simulation.contextual') }}</option></select></label>
                <label>{{ __('simulation.iterations') }}<select aria-label="{{ __('simulation.iterations') }}" x-model.number="iterations" @change="save()">
                    <template x-if="![1000, 10000, 50000].includes(iterations)"><option :value="iterations" x-text="number(iterations)"></option></template>
                @foreach ([1000, 10000, 50000] as $count)
                    <option value="{{ $count }}">{{ number_format($count, 0, ',', app()->getLocale() === 'es' ? '.' : ',') }}</option>
                @endforeach
</select></label>
            </div>
            <section class="scenario-editor" aria-labelledby="swiss-board-title">
                <div class="section-heading board-heading">
                    <h3 id="swiss-board-title">{{ __('board.title') }}</h3>
                    <div class="board-actions">
                        <button type="button" :disabled="!boardUndo || mode !== 'custom'" @click="undoBoard()">{{ __('board.undo') }}</button>
                        <button type="button" @click="resetBoard()">{{ __('board.reset') }}</button>
                    </div>
                </div>
                <p class="scenario-summary" x-show="boardReset" role="status">{{ __('board.reset_later') }}</p>
                <p class="scenario-summary" x-show="scenarioMessage" x-text="scenarioMessage" role="status"></p>
                <p class="sr-only" role="status" aria-live="polite" x-text="boardMessage"></p>
                <nav class="board-rounds" aria-label="{{ __('scenario.round') }}">
                    <template x-for="round in [1, 2, 3, 4, 5]" :key="round">
                        <button type="button" :aria-pressed="editingRound === round" :aria-label="translate('simulation.round').replace(':round', number(round))" @click="editingRound = round; save()" x-text="translate('board.short_round').replace(':round', number(round))"></button>
                    </template>
                </nav>
                <div class="board-scroll" tabindex="0" role="region" aria-label="{{ __('board.title') }}">
                    <div class="swiss-board">
                        <template x-for="column in board.columns" :key="column.round">
                            <section class="board-column" :data-active="editingRound === column.round ? 'true' : 'false'">
                                <h4 x-text="translate('simulation.round').replace(':round', number(column.round))"></h4>
                                <template x-for="group in column.groups" :key="group.record">
                                    <section class="board-group" :aria-label="group.record">
                                        <header><h5 x-text="group.record"></h5><button class="group-redraw" type="button" x-show="group.drawn" :aria-label="translate('board.redraw').replace(':record', group.record).replace(':round', number(column.round))" :title="translate('board.redraw').replace(':record', group.record).replace(':round', number(column.round))" @click="redrawGroup(column.round, group.record)"><span aria-hidden="true">↻</span></button><span x-text="group.drawn ? translate('board.series_progress').replace(':done', number(group.matches.filter(match => match.selectedWinner).length)).replace(':total', number(group.matches.length)) : translate('board.teams_progress').replace(':done', number(group.arrivals.length)).replace(':total', number(group.expected))"></span></header>
                                        <template x-for="match in group.matches" :key="match.id">
                                            <div class="board-match" :data-fixture-id="match.id" :data-round="column.round">
                                                <div class="board-match-meta" x-text="translate('board.best_of').replace(':count', number(match.bestOf))"></div>
                                                <template x-for="teamId in [match.teamA, match.teamB]" :key="teamId">
                                                    <button type="button" class="board-team" :class="{ 'is-picked': match.selectedWinner === teamId, 'is-loser': match.selectedWinner && match.selectedWinner !== teamId }" :aria-pressed="match.selectedWinner === teamId" :aria-label="translate('board.pick').replace(':team', currentTeamName(teamId))" @click="pickWinner(match.id, teamId)">
                                                        <span x-text="currentTeamName(teamId)"></span><span aria-hidden="true" x-text="match.status === 'completed' ? (teamId === match.teamA ? match.score.a : match.score.b) : match.selectedWinner === teamId ? '✓' : ''"></span>
                                                    </button>
                                                </template>
                                            </div>
                                        </template>
                                        <div class="board-arrivals" x-show="!group.drawn">
                                            <template x-for="team in group.arrivals" :key="team.id"><span class="board-arrival" x-text="team.acronym"></span></template>
                                            <span x-show="group.arrivals.length === 0" aria-hidden="true">—</span>
                                            <span class="sr-only">{{ __('board.waiting') }}</span>
                                            <button type="button" x-show="group.arrivals.length === group.expected" @click="mode === 'custom' ? (fillBoard(), save()) : startBoard()">{{ __('board.start') }}</button>
                                        </div>
                                        <p class="scenario-summary" x-show="group.rematches" x-text="translate('board.rematches').replace(':count', number(group.rematches))"></p>
                                    </section>
                                </template>
                            </section>
                        </template>
                    </div>
                </div>
                <div class="board-standings">
                    <section><h4>{{ __('board.qualified') }}</h4><ul><template x-for="team in board.qualified" :key="team.id"><li><strong x-text="team.acronym"></strong><span x-text="team.record"></span></li></template></ul></section>
                    <section><h4>{{ __('board.eliminated') }}</h4><ul><template x-for="team in board.eliminated" :key="team.id"><li><strong x-text="team.acronym"></strong><span x-text="team.record"></span></li></template></ul></section>
                </div>
            </section>
            <x-knockout-board />
            <details class="scenario-library">
                <summary>{{ __('scenario.title') }}</summary>
                <div class="scenario-actions">
                    <label>{{ __('scenario.name') }}<input type="text" maxlength="80" x-model="scenarioName" @input="save()"></label>
                    <button type="button" :disabled="libraryBusy" @click="saveScenario()">{{ __('scenario.save') }}</button>
                    <button type="button" @click="exportScenario()">{{ __('scenario.export') }}</button>
                </div>
                <div class="scenario-actions">
                    <label>{{ __('scenario.saved') }}<select aria-label="{{ __('scenario.saved') }}" x-model="selectedScenarioId"><option value="">{{ __('scenario.none') }}</option><template x-for="doc in library" :key="doc.id"><option :value="doc.id" x-text="doc.name"></option></template></select></label>
                    <button type="button" :disabled="!selectedScenarioId || libraryBusy" @click="loadScenario()">{{ __('scenario.load') }}</button>
                    <button type="button" :disabled="!selectedScenarioId || libraryBusy" @click="loadScenario(true)">{{ __('scenario.duplicate') }}</button>
                    <button type="button" :disabled="!selectedScenarioId || libraryBusy" @click="deleteScenario()">{{ __('scenario.delete') }}</button>
                </div>
                <label>{{ __('scenario.import') }}<input type="file" accept="application/json,.json" :disabled="libraryBusy" @change="importScenario($event)"></label>
                <p class="scenario-summary">{{ __('scenario.storage_note') }}</p>
            </details>
            <details class="settings"><summary>{{ __('simulation.advanced') }}</summary><div class="control-grid">
                <label>{{ __('simulation.seed') }}<input type="number" min="0" max="4294967295" step="1" required x-model.number="seed" @change="save()"></label>
                <label>{{ __('simulation.denominator') }}<select aria-label="{{ __('simulation.denominator') }}" x-model.number="denominator" @change="save()">
                    <template x-if="![320, 400, 520].includes(denominator)"><option :value="denominator" x-text="number(denominator)"></option></template>
                @foreach ([320, 400, 520] as $scale)
                    <option value="{{ $scale }}">{{ $scale }}</option>
                @endforeach
</select></label>
            </div></details>
            <button class="primary-button" type="submit">{{ __('simulation.run') }}</button>
        </fieldset>
        <div class="run-progress" x-show="busy" role="status" aria-live="polite">
            <progress :value="completed" :max="iterations" aria-label="{{ __('simulation.title') }}"></progress>
            <span x-text="translate('simulation.progress').replace(':done', number(completed)).replace(':total', number(iterations))"></span>
            <button type="button" @click="cancel()">{{ __('simulation.cancel') }}</button>
        </div>
        <p x-show="canceled" role="status">{{ __('simulation.canceled') }}</p>
        <p x-show="error" x-text="error" role="alert" class="simulation-error"></p>
    </form>
    <section id="resultados" class="section" aria-labelledby="resultados-titulo" x-cloak>
        <h2 id="resultados-titulo">{{ __('simulation.results') }}</h2>
        <p x-show="!output" class="empty-state">{{ __('simulation.empty') }}</p>
        <template x-if="output"><div>
            <p class="result-summary" x-text="resultSummary"></p>
            <div class="result-filters">
                <label>{{ __('simulation.search') }}<input type="search" x-model="search" @input="save()"></label>
                <label>{{ __('simulation.region') }}<select aria-label="{{ __('simulation.region') }}" x-model="region" @change="save()"><option value="">{{ __('simulation.all_regions') }}</option><template x-for="item in regions" :key="item"><option :value="item" x-text="item"></option></template></select></label>
            </div>
            <template x-for="table in tables" :key="table"><section class="results-table-section">
                <h3 x-text="translate(table === 'final' ? 'simulation.final_table' : 'simulation.swiss_table')"></h3>
                <div class="table-scroll" tabindex="0" role="region" :aria-label="translate(table === 'final' ? 'simulation.final_table' : 'simulation.swiss_table')">
                    <table>
                        <caption class="sr-only" x-text="translate(table === 'final' ? 'simulation.final_table' : 'simulation.swiss_table')"></caption>
                        <thead><tr><th scope="col">{{ __('simulation.team') }}</th><template x-for="column in columns[table]" :key="column.key"><th scope="col" :aria-sort="ariaSort(table, column.key)"><button type="button" @click="sort(table, column.key)"><span x-text="translate(column.label)"></span><span aria-hidden="true" x-text="sorts[table].key === column.key ? (sorts[table].descending ? ' ↓' : ' ↑') : ''"></span></button></th></template></tr></thead>
                        <tbody><template x-for="team in rows(table)" :key="team.id"><tr><th scope="row"><abbr :title="team.name" x-text="team.acronym"></abbr><small x-text="team.region"></small></th><template x-for="column in columns[table]" :key="column.key"><td :title="translate('simulation.count').replace(':count', number(count(team, table, column.key))).replace(':total', number(output.metadata.iterations))" x-text="percent(team, table, column.key)"></td></template></tr></template></tbody>
                    </table>
                </div>
                <p x-show="rows(table).length === 0" class="empty-state">{{ __('simulation.no_matches') }}</p>
            </section></template>
            <details class="method"><summary>{{ __('simulation.method') }}</summary><p x-text="methodSummary"></p><p x-text="samplingError"></p><p>{{ __('simulation.zero_note') }}</p><p>{{ __('board.score_note') }}</p><p x-text="rematches"></p><ul class="ratings-used"><template x-for="item in usedRatings" :key="item.name"><li><strong x-text="item.name"></strong> <span x-text="number(item.rating)"></span></li></template></ul></details>
            <details class="example"><summary>{{ __('simulation.example') }}</summary><div class="example-grid"><template x-for="round in exampleRounds" :key="round.key"><section><h3 x-text="round.label"></h3><ol><template x-for="match in round.matches" :key="match.id"><li><span x-text="teamName(match.teamA)"></span><strong x-text="`${match.score.a}–${match.score.b}`"></strong><span x-text="teamName(match.teamB)"></span><small x-text="originLabel(match.origin)"></small></li></template></ol></section></template></div></details>
        </div></template>
    </section>
</section>

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
            <div class="scenario-editor" x-show="mode === 'custom'">
                <h3>{{ __('tournament.round_one') }}</h3>
                <p class="scenario-summary" x-text="constraintSummary"></p>
                <div class="scenario-fixtures">
                    <template x-for="match in roundOneRows" :key="`${match.slot}-${match.selection}`">
                        <div class="scenario-fixture">
                            <strong x-text="`${currentTeamName(match.teamA)} — ${currentTeamName(match.teamB)}`"></strong>
                            <select :aria-label="translate('scenario.winner').replace(':match', `${currentTeamName(match.teamA)} — ${currentTeamName(match.teamB)}`)" :value="match.selection" x-init="$nextTick(() => $el.value = match.selection)" @change="changeFixture(match.slot, $event.target.value) || ($el.value = match.selection)">
                                <option value="random">{{ __('scenario.random') }}</option>
                                <option value="pending">{{ __('scenario.pending') }}</option>
                                <option :value="match.teamA" x-text="currentTeamName(match.teamA)"></option>
                                <option :value="match.teamB" x-text="currentTeamName(match.teamB)"></option>
                            </select>
                        </div>
                    </template>
                </div>
                <button type="button" @click="resetFixtures()">{{ __('scenario.clear') }}</button>
                <p class="scenario-summary" x-show="scenarioMessage" x-text="scenarioMessage" role="status"></p>
            </div>
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
                        <tbody><template x-for="team in rows(table)" :key="team.id"><tr><th scope="row"><abbr :title="team.name" x-text="team.acronym"></abbr><small x-text="team.region"></small></th><template x-for="column in columns[table]" :key="column.key"><td :title="translate('simulation.count').replace(':count', number(count(team, table, column.key))).replace(':total', number(output.metadata.iterations))" x-text="percent(count(team, table, column.key))"></td></template></tr></template></tbody>
                    </table>
                </div>
                <p x-show="rows(table).length === 0" class="empty-state">{{ __('simulation.no_matches') }}</p>
            </section></template>
            <details class="method"><summary>{{ __('simulation.method') }}</summary><p x-text="methodSummary"></p><p x-text="samplingError"></p><p>{{ __('simulation.zero_note') }}</p><p x-text="rematches"></p><ul class="ratings-used"><template x-for="item in usedRatings" :key="item.name"><li><strong x-text="item.name"></strong> <span x-text="number(item.rating)"></span></li></template></ul></details>
            <details class="example"><summary>{{ __('simulation.example') }}</summary><div class="example-grid"><template x-for="round in exampleRounds" :key="round.key"><section><h3 x-text="round.label"></h3><ol><template x-for="match in round.matches" :key="match.id"><li><span x-text="teamName(match.teamA)"></span><strong x-text="`${match.score.a}–${match.score.b}`"></strong><span x-text="teamName(match.teamB)"></span><small x-text="originLabel(match.origin)"></small></li></template></ol></section></template></div></details>
        </div></template>
    </section>
</section>

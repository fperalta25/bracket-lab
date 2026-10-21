<section class="knockout-editor" aria-labelledby="knockout-board-title">
    <div class="section-heading board-heading">
        <h3 id="knockout-board-title">{{ __('knockout.title') }}</h3>
        <div class="board-actions">
            <button type="button" :disabled="!boardUndo || mode !== 'custom'" @click="undoBoard()">{{ __('board.undo') }}</button>
            <button type="button" x-show="knockout.ready && !knockout.drawn" @click="mode === 'custom' ? (fillBoard(), save()) : startBoard()">{{ __('board.start') }}</button>
        </div>
    </div>
    <nav class="board-rounds knockout-rounds" aria-label="{{ __('knockout.title') }}">
        <template x-for="column in knockout.columns" :key="column.stage">
            <button type="button" :aria-pressed="knockoutRound === column.round" @click="knockoutRound = column.round; save()" x-text="translate('simulation.' + column.stage)"></button>
        </template>
    </nav>
    <div class="board-scroll" tabindex="0" role="region" aria-label="{{ __('knockout.title') }}">
        <div class="knockout-board">
            <template x-for="column in knockout.columns" :key="column.stage">
                <section class="knockout-column" :data-stage="column.stage" :data-active="knockoutRound === column.round ? 'true' : 'false'">
                    <h4 x-text="translate('simulation.' + column.stage)"></h4>
                    <div class="knockout-slots">
                        <template x-for="match in column.slots" :key="match.slot">
                            <div class="knockout-slot">
                                <div class="board-match knockout-match" :data-slot="match.slot" :data-stage="column.stage" :data-fixture-id="match.fixture?.id">
                                    <p class="board-match-meta" x-text="translate('tournament.match').replace(':slot', number(match.slot)) + ' · ' + translate('board.best_of').replace(':count', number(5))"></p>
                                    <template x-for="side in ['teamA', 'teamB']" :key="side">
                                        <button type="button" class="board-team" :class="{ 'is-picked': match[side] && match.selectedWinner === match[side], 'is-loser': match.selectedWinner && match.selectedWinner !== match[side] }" :disabled="!match.fixture" :aria-pressed="!!match[side] && match.selectedWinner === match[side]" :aria-label="match[side] ? translate('board.pick').replace(':team', currentTeamName(match[side])) : translate('knockout.pending_team')" @click="pickWinner(match.fixture.id, match[side])">
                                            <span x-text="match[side] ? currentTeamName(match[side]) : '—'"></span><span aria-hidden="true" x-text="match.fixture?.status === 'completed' ? (side === 'teamA' ? match.fixture.score.a : match.fixture.score.b) : match[side] && match.selectedWinner === match[side] ? '✓' : ''"></span>
                                        </button>
                                    </template>
                                </div>
                            </div>
                        </template>
                    </div>
                </section>
            </template>
        </div>
    </div>
    <div class="knockout-champion" x-show="knockout.champion">
        <h4>{{ __('knockout.champion') }}</h4><strong x-text="knockout.champion ? currentTeamName(knockout.champion) : ''"></strong>
    </div>
</section>

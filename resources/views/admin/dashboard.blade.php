@php
    $number = fn (int|float $value) => number_format($value, 0, app()->getLocale() === 'es' ? ',' : '.', app()->getLocale() === 'es' ? '.' : ',');
@endphp
<x-admin-layout :title="__('admin.title')">
    @if ($tournament)
        <div class="section-heading">
            <h2>{{ $tournament->name }}</h2>
            <span class="calibration">{{ $tournament->published_revision === null ? __('admin.unpublished') : __('admin.revision', ['revision' => $tournament->published_revision]) }}</span>
        </div>
        <section class="section" aria-labelledby="admin-teams">
            <div class="section-heading"><h2 id="admin-teams">{{ __('tournament.teams') }}</h2><a class="draft-link" href="{{ route('admin.teams.edit') }}">{{ __('draft.edit') }}</a></div>
            <div class="table-scroll" tabindex="0" role="region" aria-label="{{ __('tournament.teams') }}">
                <table>
                    <thead><tr><th scope="col">{{ __('admin.team') }}</th><th scope="col">{{ __('simulation.region') }}</th><th scope="col">{{ __('admin.seed') }}</th><th scope="col">{{ __('admin.pool') }}</th><th scope="col">{{ __('simulation.gpr') }}</th></tr></thead>
                    <tbody>
                        @foreach ($tournament->teams as $team)
                            <tr><th scope="row"><strong>{{ $team->acronym }}</strong><span>{{ $team->name }}</span></th><td>{{ $team->region }}</td><td>{{ $number($team->regional_seed) }}</td><td>{{ $number($team->pool) }}</td><td>{{ $strengthProfiles->has($team->id) ? $number($strengthProfiles[$team->id]['gpr']) : __('strength.unavailable') }}</td></tr>
                        @endforeach
                    </tbody>
                </table>
            </div>
            @if ($ratingDate)<p class="calibration">{{ __('strength.snapshot', ['date' => $ratingDate]) }}</p>@endif
        </section>
        <section class="section" aria-labelledby="admin-fixtures">
            <div class="section-heading"><h2 id="admin-fixtures">{{ __('tournament.fixtures') }}</h2></div>
            <div class="table-scroll" tabindex="0" role="region" aria-label="{{ __('tournament.fixtures') }}">
                <table>
                    <thead><tr><th scope="col">{{ __('admin.stage') }}</th><th scope="col">{{ __('admin.round') }}</th><th scope="col">{{ __('admin.slot') }}</th><th scope="col">{{ __('admin.match') }}</th><th scope="col">{{ __('admin.score') }}</th></tr></thead>
                    <tbody>
                        @foreach ($tournament->fixtures as $fixture)
                            <tr><td>{{ $fixture->stage === 'swiss' ? __('simulation.swiss_table') : __('simulation.'.$fixture->stage) }}</td><td>{{ $number($fixture->round) }}</td><td>{{ $number($fixture->slot) }}</td><th scope="row">{{ $fixture->teamA->acronym }} — {{ $fixture->teamB->acronym }}<span>{{ __('board.best_of', ['count' => $fixture->best_of]) }}</span></th><td>{{ $fixture->status === 'completed' ? $fixture->score_a.'–'.$fixture->score_b : __('tournament.pending') }}</td></tr>
                        @endforeach
                    </tbody>
                </table>
            </div>
        </section>
    @else
        <p class="notice">{{ __('tournament.empty') }}</p>
    @endif
</x-admin-layout>

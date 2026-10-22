<template x-if="comparison"><details class="model-comparison method" open>
    <summary>{{ __('comparison.title') }}</summary>
    <p x-text="comparisonSummary"></p>
    <div class="table-scroll" tabindex="0" role="region" aria-label="{{ __('comparison.title') }}">
        <table>
            <caption class="sr-only">{{ __('comparison.title') }}</caption>
            <thead>
                <tr><th scope="col" rowspan="2">{{ __('simulation.team') }}</th><th scope="colgroup" colspan="3">{{ __('results.qualify') }}</th><th scope="colgroup" colspan="3">{{ __('results.champion') }}</th></tr>
                <tr>
                    @foreach (['qualify', 'champion'] as $metric)
                        <th scope="col">{{ __('simulation.gpr') }}</th><th scope="col" x-text="comparisonModelLabel"></th><th scope="col" x-text="comparisonDifferenceLabel"></th>
                    @endforeach
                </tr>
            </thead>
            <tbody><template x-for="team in comparisonRows" :key="team.id"><tr>
                <th scope="row"><abbr :title="team.name" x-text="team.acronym"></abbr><small x-text="team.region"></small></th>
                @foreach (['qualify', 'champion'] as $metric)
                    <td x-text="comparisonPercent(team.id, '{{ $metric }}', 'baseline')"></td>
                    <td x-text="comparisonPercent(team.id, '{{ $metric }}', 'contextual')"></td>
                    <td x-text="comparisonDelta(team.id, '{{ $metric }}')"></td>
                @endforeach
            </tr></template></tbody>
        </table>
    </div>
    <p x-show="comparisonRows.length === 0" class="empty-state">{{ __('simulation.no_matches') }}</p>
    <p x-text="comparisonMargin"></p>
    <details><summary>{{ __('simulation.method') }}</summary><p x-text="comparisonMethod"></p><p x-show="comparisonLearned" x-text="comparisonArtifact"></p></details>
</details></template>

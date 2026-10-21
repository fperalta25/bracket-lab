<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark">
    <meta name="description" content="{{ __('page.description') }}">
    <title>Bracket Lab · {{ $tournament?->name ?? __('tournament.preview') }}</title>
    <link rel="icon" type="image/svg+xml" href="{{ asset('favicon.svg') }}">
    @vite(['resources/css/app.css', 'resources/ts/app.ts'])
</head>
<body>
    <a href="#contenido" class="skip-link">{{ __('tournament.skip') }}</a>
    <header class="site-header page-width">
        <a class="brand" href="{{ route('home') }}"><span class="brand-symbol" aria-hidden="true">⫶</span> Bracket Lab</a>
        <div class="header-controls">
            <nav aria-label="{{ __('nav.main') }}">
                <a href="#cruces">{{ __('tournament.fixtures') }}</a>
                <a href="#equipos">{{ __('tournament.teams') }}</a>
            </nav>
            <x-language-switch />
        </div>
    </header>

    <main id="contenido" class="page-width">
        <section class="hero" aria-labelledby="titulo">
            <p class="eyebrow">{{ __('tournament.independent') }}</p>
            <h1 id="titulo">{{ $tournament?->name ?? __('tournament.heading') }}</h1>
            <p class="status-note">{{ __('tournament.not_ready') }}</p>
        </section>

        @if ($tournament)
            <aside class="notice" aria-label="{{ __('tournament.initial_data', ['date' => $initialDataDate]) }}">
                <strong>{{ __('tournament.initial_data', ['date' => $initialDataDate]) }}</strong>
                <p>{{ __('tournament.initial_note') }}</p>
            </aside>

            <section id="cruces" class="section" aria-labelledby="cruces-titulo">
                <div class="section-heading">
                    <h2 id="cruces-titulo">{{ __('tournament.round_one') }}</h2>
                </div>
                <ol class="fixture-grid">
                    @foreach ($tournament->fixtures as $fixture)
                        <li class="fixture">
                            <div class="fixture-meta"><span>{{ __('tournament.fixture', ['slot' => $fixture->slot, 'best_of' => $fixture->best_of]) }}</span><span>{{ __('tournament.pending') }}</span></div>
                            <div class="matchup">
                                <div class="team"><span class="monogram" aria-hidden="true">{{ $fixture->teamA->acronym }}</span><div><strong>{{ $fixture->teamA->acronym }}</strong><span>{{ $fixture->teamA->name }}</span></div></div>
                                <span class="versus"><span aria-hidden="true">—</span><span class="sr-only">{{ __('tournament.versus') }}</span></span>
                                <div class="team team-right"><span class="monogram" aria-hidden="true">{{ $fixture->teamB->acronym }}</span><div><strong>{{ $fixture->teamB->acronym }}</strong><span>{{ $fixture->teamB->name }}</span></div></div>
                            </div>
                        </li>
                    @endforeach
                </ol>
            </section>

            <section id="equipos" class="section" aria-labelledby="equipos-titulo">
                <div class="section-heading"><h2 id="equipos-titulo">{{ __('tournament.teams') }}</h2></div>
                <div class="pool-grid">
                    @foreach ($tournament->teams->groupBy('pool') as $pool => $teams)
                        <section class="pool" aria-labelledby="pool-{{ $pool }}">
                            <h3 id="pool-{{ $pool }}">{{ __('tournament.pool', ['pool' => $pool]) }}</h3>
                            <ul>
                                @foreach ($teams as $team)
                                    <li><div><strong>{{ $team->acronym }}</strong><span>{{ $team->name }}</span>
                                        @if ($strengthProfiles->has($team->id))
                                            <span>{{ __('strength.gpr', ['rating' => number_format($strengthProfiles[$team->id]['gpr'], 0, app()->getLocale() === 'es' ? ',' : '.', app()->getLocale() === 'es' ? '.' : ',')]) }}</span>
                                        @else
                                            <span>{{ __('strength.unavailable') }}</span>
                                        @endif
                                    </div><span class="region">{{ $team->region }}</span></li>
                                @endforeach
                            </ul>
                        </section>
                    @endforeach
                </div>
                @if ($ratingDate)
                    <p class="calibration"><a href="{{ $ratingSource }}">{{ __('strength.snapshot', ['date' => $ratingDate]) }}</a></p>
                @endif
            </section>
        @else
            <p class="notice">{{ __('tournament.empty') }}</p>
        @endif

    </main>
    <footer class="page-width" aria-labelledby="acerca-titulo">
        <h2 id="acerca-titulo">{{ __('tournament.about') }}</h2>
        <p>{{ __('tournament.disclaimer') }}</p>
        <p>{{ __('tournament.trademarks') }}</p>
    </footer>
</body>
</html>

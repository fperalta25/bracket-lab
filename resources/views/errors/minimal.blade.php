@php
    $status = $exception->getStatusCode();
    $message = app('translator')->has('errors.'.$status) ? __('errors.'.$status) : __('errors.generic');
@endphp
<!DOCTYPE html>
<html lang="{{ app()->getLocale() }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark">
    <title>{{ $status }} · {{ $message }} · Bracket Lab</title>
    <link rel="icon" type="image/svg+xml" href="{{ asset('favicon.svg') }}">
    @if (file_exists(public_path('build/manifest.json')) || file_exists(public_path('hot')))
        @vite('resources/css/app.css')
    @endif
</head>
<body>
    <a href="#contenido" class="skip-link">{{ __('tournament.skip') }}</a>
    <header class="site-header page-width">
        <a class="brand" href="{{ route('home') }}">Bracket Lab</a>
        <x-language-switch />
    </header>
    <main id="contenido" class="page-width hero">
        <h1>{{ $status }}</h1>
        <p class="status-note">{{ $message }}</p>
        <a class="home-link" href="{{ route('home') }}">{{ __('nav.home') }}</a>
    </main>
</body>
</html>

@props(['title'])
<!DOCTYPE html>
<html lang="{{ app()->getLocale() }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark">
    <meta name="robots" content="noindex, nofollow">
    <title>{{ $title }} · Bracket Lab</title>
    <link rel="icon" type="image/svg+xml" href="{{ asset('favicon.svg') }}">
    @vite('resources/css/app.css')
</head>
<body class="admin">
    <a href="#contenido" class="skip-link">{{ __('tournament.skip') }}</a>
    <header class="site-header page-width">
        <a class="brand" href="{{ route('home') }}">Bracket Lab</a>
        <div class="header-controls">
            <x-language-switch />
            @auth
                <form action="{{ route('admin.logout') }}" method="post">
                    @csrf
                    <button type="submit">{{ __('admin.logout') }}</button>
                </form>
            @endauth
        </div>
    </header>
    <main id="contenido" class="page-width">
        <div class="hero"><h1>{{ $title }}</h1></div>
        {{ $slot }}
    </main>
    <footer class="page-width"><p>{{ __('tournament.disclaimer') }}</p></footer>
</body>
</html>

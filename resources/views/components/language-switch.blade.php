<nav class="language-switch" aria-label="{{ __('locale.label') }}">
    @foreach (['es', 'en'] as $locale)
        <a href="{{ request()->fullUrlWithQuery(['lang' => $locale]) }}"
           lang="{{ $locale }}" hreflang="{{ $locale }}"
           aria-label="{{ __('locale.'.$locale, [], $locale) }}"
           @if (app()->getLocale() === $locale) aria-current="true" @endif>{{ strtoupper($locale) }}</a>
    @endforeach
</nav>

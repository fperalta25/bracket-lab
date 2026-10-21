<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Laravel resolves dotted JSON keys natively, but needs an explicit JSON fallback.
        $translator = $this->app['translator'];
        $translator->handleMissingKeysUsing(function (string $key) use ($translator): string {
            if ($translator->hasForLocale($key, 'en')) {
                return $translator->get($key, [], 'en', false);
            }

            return $translator->get('errors.translation', [], 'en', false);
        });
    }
}

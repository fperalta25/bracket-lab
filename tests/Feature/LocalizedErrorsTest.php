<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Route;
use Tests\TestCase;

class LocalizedErrorsTest extends TestCase
{
    public function test_error_pages_and_their_language_selector_are_localized(): void
    {
        config(['app.debug' => false]);
        Route::get('/_test/error/{status}', fn (int $status) => abort($status));

        foreach (['es', 'en'] as $locale) {
            foreach ([401, 403, 404, 405, 419, 429, 500, 503] as $status) {
                $response = $this->get('/_test/error/'.$status.'?lang='.$locale);
                $response->assertStatus($status)
                    ->assertSee('lang="'.$locale.'"', false)
                    ->assertSee(__('errors.'.$status, [], $locale))
                    ->assertSee('aria-label="'.__('locale.label', [], $locale).'"', false)
                    ->assertSee('aria-current="true"', false)
                    ->assertDontSee('Text unavailable.')
                    ->assertDontSee('errors.');
            }
        }
    }

    public function test_unknown_paths_are_translated_using_the_browser_language(): void
    {
        $this->withHeader('Accept-Language', 'es')->get('/not-a-page')
            ->assertNotFound()->assertSee('Página no encontrada.');
        $this->withHeader('Accept-Language', 'en')->get('/not-a-page')
            ->assertNotFound()->assertSee('Page not found.');
    }
}

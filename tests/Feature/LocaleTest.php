<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Route;
use Tests\TestCase;

class LocaleTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Route::get('/_test/locale', fn () => response(app()->getLocale()));
    }

    public function test_browser_detection_uses_the_preferred_language_with_english_fallback(): void
    {
        foreach (['es-ES' => 'es', 'es-MX,en;q=0.8' => 'es', 'en-US,es;q=0.8' => 'en', 'fr,es;q=0.5' => 'en', '' => 'en'] as $header => $expected) {
            $response = $this->withHeader('Accept-Language', $header)->get('/_test/locale');
            $response->assertContent($expected);
            $this->assertCount(0, $response->headers->getCookies());
        }
    }

    public function test_manual_choice_is_persisted_without_a_session(): void
    {
        $response = $this->withHeader('Accept-Language', 'en')->get('/_test/locale?lang=es');
        $response->assertContent('es')->assertCookie('locale', 'es', false);
        $this->assertCount(1, $response->headers->getCookies());
        $cookie = $response->headers->getCookies()[0];
        $this->assertTrue($cookie->isHttpOnly());
        $this->assertSame('lax', $cookie->getSameSite());
        $this->assertGreaterThan(time() + 300 * 86400, $cookie->getExpiresTime());

        $this->withUnencryptedCookie('locale', 'es')->get('/_test/locale')->assertContent('es');
        $this->withHeader('Accept-Language', 'es')->withUnencryptedCookie('locale', 'en')
            ->get('/_test/locale')->assertContent('en');
        $this->get('/_test/locale?lang=es')->assertContent('es');
    }

    public function test_unsupported_or_malformed_values_fall_back_to_english(): void
    {
        foreach (['fr', '../es', ['es']] as $value) {
            $this->withHeader('Accept-Language', 'es')->get('/_test/locale?'.http_build_query(['lang' => $value]))
                ->assertContent('en');
        }
        $this->withUnencryptedCookie('locale', 'fr')->get('/_test/locale')->assertContent('en');
    }

    public function test_laravel_resolves_dotted_json_keys_and_safe_fallbacks(): void
    {
        $this->assertSame('Cruce 2', __('tournament.match', ['slot' => 2], 'es'));
        $this->assertSame('Match 2', __('tournament.match', ['slot' => 2], 'en'));
        $this->assertSame('Match 2', __('tournament.match', ['slot' => 2], 'fr'));
        $this->assertSame('Match :pool', __('tournament.match', ['slot' => ':pool', 'pool' => 3], 'fr'));
        $this->assertSame('Text unavailable.', __('missing.internal.key'));
    }
}

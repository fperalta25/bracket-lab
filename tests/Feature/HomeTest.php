<?php

namespace Tests\Feature;

use App\Models\Fixture;
use App\Models\Team;
use App\Models\Tournament;
use Database\Seeders\Worlds2026Seeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class HomeTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withHeader('Accept-Language', 'es-ES');
    }

    public function test_guests_can_read_the_initial_data_without_a_session(): void
    {
        $this->seed();

        $response = $this->get('/');

        $response->assertOk()
            ->assertSee('Bracket Lab')
            ->assertSee('Worlds 2026')
            ->assertSee('GPR 1.519')
            ->assertSee('19 de octubre de 2026')
            ->assertSee('Sin revisión publicada.')
            ->assertSee('sin respaldo ni patrocinio de Riot Games')
            ->assertSee('Karmine Corp')
            ->assertSee('CTBC Flying Oyster')
            ->assertSee('lang="es"', false);
        $this->assertCount(0, $response->headers->getCookies());
        $this->assertSame(8, substr_count($response->getContent(), 'class="fixture"'));
    }

    public function test_the_simulator_uses_database_ids_profiles_and_known_scores_without_legacy_scores(): void
    {
        $this->seed();
        $fixture = Fixture::orderBy('slot')->firstOrFail();
        $fixture->update(['status' => 'completed', 'score_a' => 1, 'score_b' => 0]);

        $this->get('/')->assertOk()->assertSee('Simular torneo')->assertViewHas('simulationData', function ($data) use ($fixture) {
            $this->assertCount(16, $data['snapshot']['teams']);
            $this->assertCount(16, $data['strengths']['profiles']);
            $this->assertArrayNotHasKey('powerScore', $data['snapshot']['teams'][0]);
            $this->assertArrayNotHasKey('power_score', $data['snapshot']['teams'][0]);
            $match = collect($data['snapshot']['fixtures'])->firstWhere('id', $fixture->id);
            $this->assertSame(['a' => 1, 'b' => 0], $match['score']);
            $this->assertSame('completed', $match['status']);
            $this->assertArrayNotHasKey('games', $match);

            return true;
        });
        $this->get('/?lang=en')->assertOk()->assertSee('Simulate tournament');
    }

    public function test_the_page_handles_an_empty_database(): void
    {
        $this->get('/')->assertOk()->assertSee('Todavía no hay datos del torneo.');
    }

    public function test_missing_gpr_profiles_do_not_fall_back_to_legacy_scores(): void
    {
        $this->seed(Worlds2026Seeder::class);
        $this->get('/')->assertOk()->assertSee('Sin GPR')->assertDontSee('50/100');
        $this->get('/?lang=en')->assertOk()->assertSee('GPR unavailable')->assertDontSee('50/100');
    }

    public function test_team_names_are_escaped(): void
    {
        $this->seed();
        Team::where('acronym', 'GEN')->update(['name' => '<script>alert(1)</script>']);

        $this->get('/')
            ->assertOk()
            ->assertSee('&lt;script&gt;alert(1)&lt;/script&gt;', false)
            ->assertDontSee('<script>alert(1)</script>', false);
    }

    public function test_no_public_authentication_or_administration_is_exposed(): void
    {
        $this->get('/register')->assertNotFound();
        $this->get('/admin')->assertNotFound();
        $this->post('/admin/publish')->assertNotFound();
    }

    public function test_both_languages_localize_the_page_without_changing_tournament_data(): void
    {
        $this->seed();
        $before = Tournament::with(['teams', 'fixtures'])->sole()->toJson();

        foreach ([
            'es' => ['Equipos', '21 de octubre de 2026', 'Navegación principal', 'Cruce 1 · Bo1'],
            'en' => ['Teams', 'October 21, 2026', 'Main navigation', 'Match 1 · Bo1'],
        ] as $locale => $texts) {
            $response = $this->get('/?lang='.$locale.'&seed=123&iterations=1000');
            $response->assertOk()->assertSee('lang="'.$locale.'"', false);
            foreach ($texts as $text) {
                $response->assertSee($text);
            }
            $response->assertSee('lang=es&amp;seed=123&amp;iterations=1000', false)
                ->assertSee('lang=en&amp;seed=123&amp;iterations=1000', false)
                ->assertSee('Karmine Corp')->assertSee('Worlds 2026')
                ->assertDontSee('Text unavailable.');
            $visibleText = strip_tags(preg_replace('/<script\b[^>]*>[\s\S]*?<\/script>/i', '', $response->getContent()));
            $this->assertDoesNotMatchRegularExpression('/\b(?:tournament|nav|locale)\.[a-z_]+\b/', $visibleText);
            $this->assertSame(8, substr_count($response->getContent(), 'class="fixture"'));
            $this->assertSame($before, Tournament::with(['teams', 'fixtures'])->sole()->toJson());
        }
    }

    public function test_english_empty_state_and_metadata_are_translated(): void
    {
        $this->get('/?lang=en')->assertOk()
            ->assertSee('No tournament data yet.')
            ->assertSee('Independent simulator for Worlds 2026.')
            ->assertSee('aria-label="Language"', false)
            ->assertDontSee('Todavía no hay datos');
    }
}

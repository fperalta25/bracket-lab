<?php

namespace Tests\Feature;

use App\Models\Team;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class HomeTest extends TestCase
{
    use RefreshDatabase;

    public function test_guests_can_read_the_initial_data_without_a_session(): void
    {
        $this->seed();

        $response = $this->get('/');

        $response->assertOk()
            ->assertSee('Bracket Lab')
            ->assertSee('Worlds 2026')
            ->assertSee('Puntuaciones iniciales sin calibrar')
            ->assertSee('Sin revisión publicada.')
            ->assertSee('sin respaldo ni patrocinio de Riot Games')
            ->assertSee('Karmine Corp')
            ->assertSee('CTBC Flying Oyster')
            ->assertSee('lang="es"', false);
        $this->assertCount(0, $response->headers->getCookies());
        $this->assertSame(8, substr_count($response->getContent(), 'class="fixture"'));
    }

    public function test_the_page_handles_an_empty_database(): void
    {
        $this->get('/')->assertOk()->assertSee('Todavía no hay datos del torneo.');
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
}

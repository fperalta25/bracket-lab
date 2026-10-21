<?php

namespace Tests\Feature;

use App\Domain\Tournament\TeamDrafts;
use App\Models\Team;
use App\Models\Tournament;
use App\Models\TournamentDraft;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class TeamDraftTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed();
        $this->admin = User::factory()->create(['is_admin' => true]);
        $this->actingAs($this->admin);
    }

    private function form(): array
    {
        $tournament = Tournament::firstOrFail();
        $drafts = app(TeamDrafts::class);
        $source = $drafts->source($tournament);
        $draft = TournamentDraft::find($tournament->id);

        return ['teams' => $draft?->teams ?? $source, 'version' => $draft?->version ?? 0,
            'source_hash' => $draft?->source_hash ?? $drafts->sourceHash($tournament, $source)];
    }

    public function test_forms_are_localized_and_reading_them_does_not_create_a_draft(): void
    {
        foreach (['es', 'en'] as $locale) {
            $this->get('/admin/teams?lang='.$locale)->assertOk()
                ->assertSee(__('draft.title', [], $locale))->assertSee(__('draft.save', [], $locale))
                ->assertSee('lang="'.$locale.'"', false)->assertDontSee('Text unavailable.')
                ->assertSee('name="version" value="0"', false)->assertSee('name="teams[15][pool]"', false);
        }
        $this->assertDatabaseCount('tournament_drafts', 0);
    }

    public function test_a_draft_saves_stable_ids_without_changing_public_data_profiles_or_results(): void
    {
        $before = json_encode($this->get('/')->viewData('simulationData'));
        $form = $this->form();
        $original = $form['teams'];
        $form['teams'][0]['name'] = 'Updated team';
        $form['teams'][0]['acronym'] = 'NEW';
        $this->put('/admin/teams', $form)->assertRedirect(route('admin.teams.edit'));
        $draft = TournamentDraft::firstOrFail();
        $this->assertSame(1, $draft->version);
        $this->assertSame($original, $draft->base_teams);
        $this->assertSame($form['teams'], $draft->teams);
        $this->assertSame($this->admin->id, $draft->updated_by);
        $this->assertNull($draft->base_revision);
        $this->assertSame($original[0]['name'], Team::findOrFail($original[0]['id'])->name);
        $this->assertSame($before, json_encode($this->get('/')->viewData('simulationData')));
        $this->get('/admin/teams')->assertSee('Updated team')->assertSee('NEW');
    }

    public function test_later_saves_keep_the_original_base_and_increment_the_version(): void
    {
        $initial = $this->form();
        $this->put('/admin/teams', $initial)->assertRedirect();
        $next = $this->form();
        $next['teams'][0]['regional_seed'] = '4';
        $next['teams'][0]['region'] = 'LCP';
        [$next['teams'][0]['pool'], $next['teams'][8]['pool']] = [$next['teams'][8]['pool'], $next['teams'][0]['pool']];
        $this->put('/admin/teams', $next)->assertRedirect()->assertSessionHasNoErrors();
        $draft = TournamentDraft::firstOrFail();
        $this->assertSame(2, $draft->version);
        $this->assertSame($initial['teams'], $draft->base_teams);
        $this->assertSame(4, $draft->teams[0]['regional_seed']);
        $this->assertSame('LCP', $draft->teams[0]['region']);
    }

    public function test_missing_duplicate_and_foreign_team_ids_are_rejected(): void
    {
        $form = $this->form();
        $missing = $form;
        array_pop($missing['teams']);
        $this->put('/admin/teams', $missing)->assertSessionHasErrors('teams');
        $duplicate = $form;
        $duplicate['teams'][0]['id'] = $duplicate['teams'][1]['id'];
        $this->put('/admin/teams', $duplicate)->assertSessionHasErrors('teams.0.id');
        $foreign = $form;
        $foreign['teams'][0]['id'] = 'foreign-team';
        $this->put('/admin/teams', $foreign)->assertSessionHasErrors('teams.0.id');
        $this->assertDatabaseCount('tournament_drafts', 0);
    }

    public function test_pool_counts_ranges_regions_acronyms_and_unknown_fields_are_validated(): void
    {
        $form = $this->form();
        $unbalanced = $form;
        $unbalanced['teams'][0]['pool'] = $form['teams'][0]['pool'] === 1 ? 2 : 1;
        $this->put('/admin/teams?lang=es', $unbalanced)->assertSessionHasErrors(['teams' => 'Cada pool debe tener cuatro equipos.']);
        foreach ([['pool', 5], ['regional_seed', 0], ['regional_seed', 1.5], ['region', 'APAC'], ['name', ''], ['name', str_repeat('a', 121)], ['acronym', str_repeat('a', 13)]] as [$field, $value]) {
            $invalid = $form;
            $invalid['teams'][0][$field] = $value;
            $this->put('/admin/teams', $invalid)->assertSessionHasErrors('teams.0.'.$field);
        }
        $duplicate = $form;
        $duplicate['teams'][0]['acronym'] = strtolower($form['teams'][1]['acronym']);
        $this->put('/admin/teams', $duplicate)->assertSessionHasErrors('teams.0.acronym');
        $extra = $form;
        $extra['teams'][0]['gpr'] = 9999;
        $this->put('/admin/teams', $extra)->assertSessionHasErrors('teams.0');
        $this->assertDatabaseCount('tournament_drafts', 0);
    }

    public function test_stale_tabs_cannot_overwrite_a_newer_draft_and_keep_their_entered_values(): void
    {
        $stale = $this->form();
        $new = $stale;
        $new['teams'][0]['name'] = 'Newer draft';
        $this->put('/admin/teams', $new)->assertRedirect();
        $stale['teams'][0]['name'] = 'Old tab edits';
        $this->from(route('admin.teams.edit'))->put('/admin/teams?lang=en', $stale)
            ->assertRedirect(route('admin.teams.edit'))->assertSessionHasErrors(['draft' => __('draft.conflict', [], 'en')]);
        $response = $this->get('/admin/teams?lang=en');
        $response->assertSee('Old tab edits')->assertSee('name="version" value="0"', false);
        $this->assertSame('Newer draft', TournamentDraft::firstOrFail()->teams[0]['name']);
        $this->assertSame(1, TournamentDraft::firstOrFail()->version);
    }

    public function test_a_changed_official_revision_cannot_be_silently_rebased(): void
    {
        $form = $this->form();
        $this->put('/admin/teams', $form)->assertRedirect();
        $saved = $this->form();
        Tournament::firstOrFail()->update(['published_revision' => 1]);
        $this->put('/admin/teams?lang=en', $saved)->assertSessionHasErrors(['draft' => __('draft.outdated', [], 'en')]);
        $this->get('/admin/teams?lang=en')->assertViewHas('outdated', true);
        $this->assertSame(1, TournamentDraft::firstOrFail()->version);
        $this->assertNull(TournamentDraft::firstOrFail()->base_revision);
    }

    public function test_official_team_changes_after_opening_the_form_also_prevent_stale_saves(): void
    {
        $form = $this->form();
        Team::findOrFail($form['teams'][0]['id'])->update(['name' => 'External correction']);
        $this->put('/admin/teams?lang=en', $form)->assertSessionHasErrors(['draft' => __('draft.outdated', [], 'en')]);
        $this->assertDatabaseCount('tournament_drafts', 0);
    }

    public function test_user_input_is_escaped_and_failed_validation_preserves_the_last_saved_draft(): void
    {
        $form = $this->form();
        $form['teams'][0]['name'] = '<script>alert(1)</script>';
        $this->put('/admin/teams', $form)->assertRedirect();
        $this->get('/admin/teams')->assertSee('&lt;script&gt;alert(1)&lt;/script&gt;', false)->assertDontSee('<script>alert(1)</script>', false);
        $invalid = $this->form();
        $invalid['teams'][0]['name'] = '';
        $this->put('/admin/teams', $invalid)->assertSessionHasErrors('teams.0.name');
        $this->assertSame(1, TournamentDraft::firstOrFail()->version);
        $this->assertSame('<script>alert(1)</script>', TournamentDraft::firstOrFail()->teams[0]['name']);
    }

    public function test_authorization_and_csrf_apply_to_both_draft_routes(): void
    {
        $form = $this->form();
        auth()->logout();
        $this->get('/admin/teams')->assertRedirect(route('admin.login'));
        $this->put('/admin/teams', $form)->assertRedirect(route('admin.login'));
        $this->actingAs(User::factory()->create())->get('/admin/teams')->assertForbidden();
        $this->put('/admin/teams', $form)->assertForbidden();
        $this->actingAs($this->admin);
        $this->app->instance('env', 'production');
        $this->put('/admin/teams', $form)->assertStatus(419);
        $this->assertDatabaseCount('tournament_drafts', 0);
    }
}

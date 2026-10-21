<?php

namespace Tests\Feature;

use App\Models\StrengthProfileSet;
use App\Models\Team;
use Database\Seeders\GprStrengthSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use LogicException;
use Tests\TestCase;

class GprStrengthSeederTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_seeds_a_complete_dated_profile_set_without_reinterpreting_legacy_scores(): void
    {
        $this->seed();
        $set = StrengthProfileSet::sole();
        $this->assertSame('riot-gpr-2026-10-19', $set->rating_snapshot_id);
        $this->assertSame('2026-10-19', $set->rating_as_of->toDateString());
        $this->assertSame('provisional', $set->payload['calibration']['status']);
        $this->assertCount(16, $set->payload['profiles']);
        $gen = Team::where('acronym', 'GEN')->sole();
        $this->assertSame(1519, collect($set->payload['profiles'])->firstWhere('teamId', $gen->id)['gpr']);
        $this->assertSame(50, $gen->power_score);
        $tes = Team::where('acronym', 'TES')->sole();
        $profile = collect($set->payload['profiles'])->firstWhere('teamId', $tes->id);
        $this->assertSame(1364, $profile['gpr']);
        $this->assertSame(['elo' => -25, 'active' => false, 'condition' => 'roster-change-369-substitute-confirmed'], $profile['contextAdjustment']);
    }

    public function test_reseeding_preserves_the_frozen_set_and_legacy_edits(): void
    {
        $this->seed();
        $before = StrengthProfileSet::sole()->toJson();
        Team::where('acronym', 'GEN')->sole()->update(['power_score' => 72]);
        $this->seed();
        $this->assertDatabaseCount('strength_profile_sets', 1);
        $this->assertSame($before, StrengthProfileSet::sole()->toJson());
        $this->assertDatabaseHas('teams', ['acronym' => 'GEN', 'power_score' => 72]);
    }

    public function test_profile_revisions_cannot_be_updated_in_place(): void
    {
        $this->seed();
        $this->expectException(LogicException::class);
        StrengthProfileSet::sole()->update(['revision' => 2]);
    }

    public function test_it_rejects_incomplete_team_correspondence(): void
    {
        $this->seed();
        $extra = Team::where('acronym', 'GEN')->sole()->replicate();
        $extra->id = 'unexpected-team';
        $extra->acronym = 'EXTRA';
        $extra->save();
        $this->expectException(LogicException::class);
        $this->seed(GprStrengthSeeder::class);
    }
}

<?php

namespace Tests\Feature;

use App\Models\Fixture;
use App\Models\Team;
use App\Models\Tournament;
use Database\Seeders\Worlds2026Seeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class Worlds2026SeederTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_loads_sixteen_teams_and_eight_pending_fixtures_without_users(): void
    {
        $this->seed();

        $this->assertDatabaseCount('tournaments', 1);
        $this->assertDatabaseCount('teams', 16);
        $this->assertDatabaseCount('fixtures', 8);
        $this->assertDatabaseCount('users', 0);
        $this->assertSame('worlds-2026-v1', Tournament::sole()->format_version);
        $this->assertNull(Tournament::sole()->published_revision);
        $this->assertSame([1 => 4, 2 => 4, 3 => 4, 4 => 4], Team::all()->countBy('pool')->all());
        $this->assertSame([50], Team::all()->pluck('power_score')->unique()->values()->all());
        $this->assertDatabaseHas('teams', ['acronym' => 'KC', 'pool' => 4, 'region' => 'LEC', 'regional_seed' => 3]);

        $pairs = Fixture::with(['teamA', 'teamB'])->orderBy('slot')->get()->map(function (Fixture $fixture): string {
            $this->assertSame('swiss', $fixture->stage);
            $this->assertSame(1, $fixture->round);
            $this->assertSame(1, $fixture->best_of);
            $this->assertSame('scheduled', $fixture->status);
            $this->assertNull($fixture->score_a);
            $this->assertNull($fixture->score_b);

            return $fixture->teamA->acronym.'-'.$fixture->teamB->acronym;
        })->all();

        $this->assertSame(['GEN-IG', 'HLE-TES', 'BLG-MKOI', 'AL-KC', 'G2-DK', 'TLAW-CFO', 'LOS-T1', 'TSW-LYON'], $pairs);
    }

    public function test_reseeding_preserves_ids_and_existing_edits(): void
    {
        $this->seed();
        $ids = Team::orderBy('id')->pluck('id')->all();
        $fixtureIds = Fixture::orderBy('id')->pluck('id')->all();
        $team = Team::where('acronym', 'GEN')->sole();
        $team->update(['power_score' => 72]);
        $fixture = Fixture::orderBy('slot')->firstOrFail();
        $fixture->update(['status' => 'completed', 'score_a' => 1, 'score_b' => 0]);

        $this->seed(Worlds2026Seeder::class);

        $this->assertDatabaseCount('tournaments', 1);
        $this->assertDatabaseCount('teams', 16);
        $this->assertDatabaseCount('fixtures', 8);
        $this->assertSame($ids, Team::orderBy('id')->pluck('id')->all());
        $this->assertSame($fixtureIds, Fixture::orderBy('id')->pluck('id')->all());
        $this->assertSame(72, $team->fresh()->power_score);
        $this->assertSame('completed', $fixture->fresh()->status);
        $this->assertSame(1, $fixture->fresh()->score_a);
    }
}

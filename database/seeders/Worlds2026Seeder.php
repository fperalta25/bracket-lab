<?php

namespace Database\Seeders;

use App\Models\Fixture;
use App\Models\Team;
use App\Models\Tournament;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class Worlds2026Seeder extends Seeder
{
    public function run(): void
    {
        $data = json_decode(file_get_contents(database_path('data/worlds-2026.json')), true, 512, JSON_THROW_ON_ERROR);

        DB::transaction(function () use ($data): void {
            $tournament = Tournament::firstOrCreate(['id' => $data['tournament']['id']], $data['tournament']);

            foreach ($data['teams'] as $team) {
                Team::firstOrCreate(['id' => $team['id']], [...$team, 'tournament_id' => $tournament->id]);
            }

            foreach ($data['fixtures'] as $fixture) {
                Fixture::firstOrCreate(['id' => $fixture['id']], [...$fixture, 'tournament_id' => $tournament->id]);
            }
        });
    }
}

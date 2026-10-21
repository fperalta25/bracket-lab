<?php

namespace Database\Seeders;

use App\Models\StrengthProfileSet;
use App\Models\Tournament;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use LogicException;

class GprStrengthSeeder extends Seeder
{
    public function run(): void
    {
        $payload = json_decode(file_get_contents(database_path('data/worlds-2026-strengths-v2.json')), true, 512, JSON_THROW_ON_ERROR);

        DB::transaction(function () use ($payload): void {
            $tournament = Tournament::where('slug', 'worlds-2026')->sole();
            $teamIds = $tournament->teams()->pluck('id')->sort()->values()->all();
            $profileIds = collect($payload['profiles'])->pluck('teamId')->sort()->values()->all();
            if (count($profileIds) !== 16 || $profileIds !== $teamIds) {
                throw new LogicException('The GPR profiles must match all 16 tournament team IDs exactly.');
            }

            StrengthProfileSet::firstOrCreate(['id' => $payload['id']], [
                'tournament_id' => $tournament->id,
                'revision' => $payload['revision'],
                'rating_snapshot_id' => $payload['ratingSnapshot']['id'],
                'rating_as_of' => $payload['ratingSnapshot']['asOf'],
                'payload' => $payload,
            ]);
        });
    }
}

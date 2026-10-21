<?php

namespace App\Http\Controllers;

use App\Models\StrengthProfileSet;
use App\Models\Tournament;
use Carbon\CarbonImmutable;
use Illuminate\View\View;

class HomeController extends Controller
{
    public function __invoke(): View
    {
        $tournament = Tournament::with([
            'teams' => fn ($query) => $query->orderBy('pool')->orderBy('name'),
            'fixtures' => fn ($query) => $query->with(['teamA', 'teamB'])->orderBy('round')->orderBy('slot'),
            'strengthProfileSets',
        ])->where('slug', 'worlds-2026')->first();

        $profileSet = $tournament?->strengthProfileSets->firstWhere('id', StrengthProfileSet::INITIAL_ID);

        $simulationData = $tournament && $profileSet ? [
            'strengths' => $profileSet->payload,
            'snapshot' => [
                'id' => $tournament->id,
                'revision' => $tournament->published_revision,
                'teams' => $tournament->teams->map(fn ($team) => [
                    'id' => $team->id, 'name' => $team->name, 'acronym' => $team->acronym,
                    'region' => $team->region, 'regionalSeed' => (int) $team->regional_seed, 'pool' => (int) $team->pool,
                ])->values(),
                'fixtures' => $tournament->fixtures->map(fn ($fixture) => array_merge([
                    'id' => $fixture->id, 'stage' => $fixture->stage, 'round' => (int) $fixture->round,
                    'slot' => (int) $fixture->slot, 'teamA' => $fixture->team_a_id, 'teamB' => $fixture->team_b_id,
                    'bestOf' => (int) $fixture->best_of, 'status' => $fixture->status,
                ], $fixture->status === 'completed' ? ['score' => ['a' => (int) $fixture->score_a, 'b' => (int) $fixture->score_b]] : []))->values(),
            ],
        ] : null;

        return view('welcome', [
            'tournament' => $tournament,
            'simulationData' => $simulationData,
            'initialDataDate' => CarbonImmutable::parse('2026-10-21', 'UTC')->locale(app()->getLocale())->isoFormat('LL'),
            'strengthProfiles' => collect($profileSet?->payload['profiles'] ?? [])->keyBy('teamId'),
            'ratingSource' => $profileSet?->payload['ratingSnapshot']['sourceUrl'],
            'ratingDate' => $profileSet?->rating_as_of->locale(app()->getLocale())->isoFormat('LL'),
        ]);
    }
}

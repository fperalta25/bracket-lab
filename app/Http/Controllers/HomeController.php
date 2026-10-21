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

        return view('welcome', [
            'tournament' => $tournament,
            'initialDataDate' => CarbonImmutable::parse('2026-10-21', 'UTC')->locale(app()->getLocale())->isoFormat('LL'),
            'strengthProfiles' => collect($profileSet?->payload['profiles'] ?? [])->keyBy('teamId'),
            'ratingSource' => $profileSet?->payload['ratingSnapshot']['sourceUrl'],
            'ratingDate' => $profileSet?->rating_as_of->locale(app()->getLocale())->isoFormat('LL'),
        ]);
    }
}

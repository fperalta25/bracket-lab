<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\StrengthProfileSet;
use App\Models\Tournament;
use Illuminate\View\View;

class DashboardController extends Controller
{
    public function __invoke(): View
    {
        $tournament = Tournament::with([
            'teams' => fn ($query) => $query->orderBy('pool')->orderBy('name'),
            'fixtures' => fn ($query) => $query->with(['teamA', 'teamB'])->orderBy('round')->orderBy('slot'),
            'strengthProfileSets',
        ])->where('slug', 'worlds-2026')->first();
        $profileSet = $tournament?->strengthProfileSets->firstWhere('id', StrengthProfileSet::INITIAL_ID);

        return view('admin.dashboard', [
            'tournament' => $tournament,
            'strengthProfiles' => collect($profileSet?->payload['profiles'] ?? [])->keyBy('teamId'),
            'ratingDate' => $profileSet?->rating_as_of->locale(app()->getLocale())->isoFormat('LL'),
        ]);
    }
}

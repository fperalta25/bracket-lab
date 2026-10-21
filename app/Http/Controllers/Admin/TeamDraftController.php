<?php

namespace App\Http\Controllers\Admin;

use App\Domain\Tournament\TeamDrafts;
use App\Http\Controllers\Controller;
use App\Models\Tournament;
use App\Models\TournamentDraft;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Illuminate\View\View;

class TeamDraftController extends Controller
{
    public function edit(TeamDrafts $drafts): View
    {
        $tournament = Tournament::where('slug', 'worlds-2026')->firstOrFail();
        $source = $drafts->source($tournament);
        $draft = TournamentDraft::find($tournament->id);
        $sourceHash = $drafts->sourceHash($tournament, $source);

        return view('admin.teams', [
            'tournament' => $tournament, 'teams' => $draft?->teams ?? $source, 'draft' => $draft,
            'sourceHash' => $draft?->source_hash ?? $sourceHash,
            'outdated' => $draft && $draft->source_hash !== $sourceHash,
        ]);
    }

    public function update(Request $request, TeamDrafts $drafts): RedirectResponse
    {
        $tournament = Tournament::where('slug', 'worlds-2026')->firstOrFail();
        $source = $drafts->source($tournament);
        $data = $request->validate([
            'version' => ['required', 'integer', 'min:0', 'max:2147483646'],
            'source_hash' => ['required', 'string', 'regex:/^[a-f0-9]{64}$/'],
            'teams' => ['required', 'array', 'size:16'],
            'teams.*' => ['array:id,name,acronym,region,regional_seed,pool'],
            'teams.*.id' => ['required', 'string', 'distinct', Rule::in(array_column($source, 'id'))],
            'teams.*.name' => ['required', 'string', 'max:120'],
            'teams.*.acronym' => ['required', 'string', 'max:12', 'distinct:ignore_case'],
            'teams.*.region' => ['required', Rule::in(['LCK', 'LPL', 'LEC', 'LCS', 'LCP', 'CBLOL'])],
            'teams.*.regional_seed' => ['required', 'integer', 'between:1,16'],
            'teams.*.pool' => ['required', 'integer', 'between:1,4'],
        ], [
            'required' => __('draft.required'), 'string' => __('draft.invalid'), 'integer' => __('draft.invalid'),
            'min' => __('draft.invalid'), 'max' => __('draft.too_long'), 'regex' => __('draft.invalid'),
            'array' => __('draft.invalid_teams'), 'size' => __('draft.team_count'), 'in' => __('draft.invalid'),
            'distinct' => __('draft.duplicate'), 'between' => __('draft.range'),
        ]);
        $teams = array_values(array_map(fn ($team) => [...$team, 'regional_seed' => (int) $team['regional_seed'], 'pool' => (int) $team['pool']], $data['teams']));
        foreach ([1, 2, 3, 4] as $pool) {
            if (count(array_filter($teams, fn ($team) => $team['pool'] === $pool)) !== 4) {
                throw ValidationException::withMessages(['teams' => __('draft.pool_count')]);
            }
        }
        $drafts->save($tournament->id, $teams, $data['source_hash'], (int) $data['version'], $request->user()->id);

        return redirect()->route('admin.teams.edit');
    }
}

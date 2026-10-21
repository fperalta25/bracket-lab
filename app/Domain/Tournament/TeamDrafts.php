<?php

namespace App\Domain\Tournament;

use App\Models\Tournament;
use App\Models\TournamentDraft;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class TeamDrafts
{
    public function source(Tournament $tournament): array
    {
        return $tournament->teams()->orderBy('id')->get()->map(fn ($team) => [
            'id' => $team->id, 'name' => $team->name, 'acronym' => $team->acronym,
            'region' => $team->region, 'regional_seed' => (int) $team->regional_seed, 'pool' => (int) $team->pool,
        ])->all();
    }

    public function sourceHash(Tournament $tournament, array $teams): string
    {
        return hash('sha256', json_encode(['revision' => $tournament->published_revision, 'teams' => $teams], JSON_THROW_ON_ERROR));
    }

    public function save(string $tournamentId, array $teams, string $sourceHash, int $version, int $userId): TournamentDraft
    {
        return DB::transaction(function () use ($tournamentId, $teams, $sourceHash, $version, $userId) {
            $tournament = Tournament::whereKey($tournamentId)->lockForUpdate()->firstOrFail();
            $source = $this->source($tournament);
            $draft = TournamentDraft::whereKey($tournamentId)->lockForUpdate()->first();
            if ($sourceHash !== $this->sourceHash($tournament, $source) || ($draft && $draft->source_hash !== $sourceHash)) {
                throw ValidationException::withMessages(['draft' => __('draft.outdated')]);
            }
            if ($version !== ($draft?->version ?? 0)) {
                throw ValidationException::withMessages(['draft' => __('draft.conflict')]);
            }
            $draft ??= new TournamentDraft([
                'tournament_id' => $tournamentId, 'base_revision' => $tournament->published_revision,
                'source_hash' => $sourceHash, 'base_teams' => $source,
            ]);
            $draft->teams = $teams;
            $draft->version = $version + 1;
            $draft->updated_by = $userId;
            $draft->save();

            return $draft;
        }, attempts: 3);
    }
}

<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TournamentDraft extends Model
{
    protected $primaryKey = 'tournament_id';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = ['tournament_id', 'base_revision', 'source_hash', 'version', 'base_teams', 'teams', 'updated_by'];

    protected function casts(): array
    {
        return ['base_revision' => 'integer', 'version' => 'integer', 'base_teams' => 'array', 'teams' => 'array'];
    }
}

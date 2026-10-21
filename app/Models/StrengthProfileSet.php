<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use LogicException;

class StrengthProfileSet extends Model
{
    public const INITIAL_ID = 'worlds-2026-pre-swiss-experimental-v2';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = ['id', 'tournament_id', 'revision', 'rating_snapshot_id', 'rating_as_of', 'payload'];

    protected function casts(): array
    {
        return ['payload' => 'array', 'rating_as_of' => 'immutable_date'];
    }

    protected static function booted(): void
    {
        static::updating(function (): never {
            throw new LogicException('Strength profile revisions are immutable; create a new revision.');
        });
    }
}

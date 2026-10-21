<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Team extends Model
{
    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = ['id', 'tournament_id', 'name', 'acronym', 'region', 'regional_seed', 'pool', 'power_score'];
}

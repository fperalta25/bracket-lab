<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tournaments', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->unsignedSmallInteger('year');
            $table->string('slug')->unique();
            $table->string('name');
            $table->string('format_version');
            $table->string('status')->default('draft');
            $table->unsignedInteger('published_revision')->nullable();
            $table->timestamps();
        });

        Schema::create('teams', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tournament_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('acronym', 12);
            $table->string('region', 12);
            $table->unsignedTinyInteger('regional_seed');
            $table->unsignedTinyInteger('pool');
            $table->unsignedTinyInteger('power_score')->default(50);
            $table->timestamps();
            $table->unique(['tournament_id', 'acronym']);
        });

        Schema::create('fixtures', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tournament_id')->constrained()->cascadeOnDelete();
            $table->string('stage');
            $table->unsignedTinyInteger('round');
            $table->unsignedTinyInteger('slot');
            $table->foreignUuid('team_a_id')->constrained('teams')->restrictOnDelete();
            $table->foreignUuid('team_b_id')->constrained('teams')->restrictOnDelete();
            $table->unsignedTinyInteger('best_of');
            $table->string('status')->default('scheduled');
            $table->unsignedTinyInteger('score_a')->nullable();
            $table->unsignedTinyInteger('score_b')->nullable();
            $table->timestamps();
            $table->unique(['tournament_id', 'stage', 'round', 'slot']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fixtures');
        Schema::dropIfExists('teams');
        Schema::dropIfExists('tournaments');
    }
};

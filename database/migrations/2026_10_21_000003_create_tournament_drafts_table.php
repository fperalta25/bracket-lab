<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tournament_drafts', function (Blueprint $table): void {
            $table->foreignUuid('tournament_id')->primary()->constrained()->cascadeOnDelete();
            $table->unsignedInteger('base_revision')->nullable();
            $table->string('source_hash', 64);
            $table->unsignedInteger('version');
            $table->json('base_teams');
            $table->json('teams');
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tournament_drafts');
    }
};

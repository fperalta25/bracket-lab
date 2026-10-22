<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PredictiveResearchTest extends TestCase
{
    use RefreshDatabase;

    public function test_research_metrics_are_localized_and_keep_the_trained_preset_disabled(): void
    {
        $this->seed();
        foreach (['es' => ['Validación histórica', '0,6417', '7.839'], 'en' => ['Historical validation', '0.6417', '7,839']] as $locale => $texts) {
            $response = $this->get('/?lang='.$locale)->assertOk();
            foreach ($texts as $text) {
                $response->assertSee($text);
            }
            $response->assertSee('id="validacion"', false)
                ->assertSee('value="contextual_trained_v3" disabled', false)
                ->assertDontSee('research.evaluation_2026')
                ->assertViewHas('predictiveResearch', fn ($data) => $data['promotion_allowed'] === false && count($data['rows']) === 6);
            $this->assertSame(['locale'], array_map(fn ($cookie) => $cookie->getName(), $response->headers->getCookies()));
        }
    }

    public function test_published_summary_matches_the_frozen_reports(): void
    {
        $summary = json_decode(file_get_contents(resource_path('data/predictive-research.json')), true, flags: JSON_THROW_ON_ERROR);
        $reportPath = base_path('models/reports/elo-confidence-v1/metrics.json');
        $baselinePath = base_path('models/reports/internal-elo-v1/metrics.json');
        $report = json_decode(file_get_contents($reportPath), true, flags: JSON_THROW_ON_ERROR);
        $baseline = json_decode(file_get_contents($baselinePath), true, flags: JSON_THROW_ON_ERROR);
        $this->assertSame(hash_file('sha256', $reportPath), $summary['report_sha256']);
        $this->assertSame(hash_file('sha256', $baselinePath), $summary['baseline_sha256']);
        $this->assertFalse($report['public_promotion_allowed']);
        $this->assertSame($report['selected_on_development_only']['slope'], $summary['slope']);
        foreach ($summary['rows'] as $row) {
            $candidate = $report['runs']['1']['periods'][$row['period']];
            $reference = $baseline['runs']['1']['periods'][$row['period']];
            if ($row['scope'] === 'international') {
                $candidate = $candidate['international_by_source_label'];
                $reference = $reference['international_by_source_label'];
            }
            $this->assertSame($candidate['games'], $row['games']);
            $this->assertSame($candidate['log_loss'], $row['adjusted_log_loss']);
            $this->assertSame($reference['log_loss'], $row['reference_log_loss']);
            $this->assertSame($candidate['brier'], $row['adjusted_brier']);
            $this->assertSame($reference['brier'], $row['reference_brier']);
            $this->assertSame($candidate['paired_vs_internal_elo']['log_loss_advantage_95'], $row['log_loss_advantage_95']);
        }
    }
}

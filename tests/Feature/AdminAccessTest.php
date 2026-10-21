<?php

namespace Tests\Feature;

use App\Models\Team;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AdminAccessTest extends TestCase
{
    use RefreshDatabase;

    private function administrator(): User
    {
        return User::factory()->create(['email' => 'admin@example.test', 'password' => 'a-long-test-password', 'is_admin' => true]);
    }

    public function test_guests_cannot_access_administration_and_public_registration_stays_unavailable(): void
    {
        $this->get('/admin')->assertRedirect(route('admin.login'));
        $this->get('/register')->assertNotFound();
        $this->post('/register', [])->assertNotFound();
        $this->get('/admin/logout')->assertMethodNotAllowed();
    }

    public function test_login_validation_is_localized_and_does_not_flash_passwords(): void
    {
        foreach (['es', 'en'] as $locale) {
            $this->get('/admin/login?lang='.$locale)->assertOk()->assertSee(__('admin.sign_in', [], $locale))->assertSee('autocomplete="current-password"', false);
            $this->from('/admin/login')->post('/admin/login?lang='.$locale, ['email' => 'invalid', 'password' => ''])
                ->assertRedirect('/admin/login')->assertSessionHasErrors(['email' => __('admin.email_invalid', [], $locale), 'password' => __('admin.password_required', [], $locale)]);
        }
        $this->post('/admin/login', ['email' => 'unknown@example.test', 'password' => 'private-value'])->assertSessionHasErrors('email');
        $this->assertArrayNotHasKey('password', session()->getOldInput());
    }

    public function test_only_administrators_can_sign_in_and_existing_non_admin_sessions_are_rejected(): void
    {
        $user = User::factory()->create(['email' => 'reader@example.test', 'password' => 'a-long-test-password']);
        $this->assertFalse($user->is_admin);
        $this->post('/admin/login?lang=en', ['email' => $user->email, 'password' => 'a-long-test-password'])
            ->assertSessionHasErrors(['email' => 'Incorrect email or password.']);
        $this->assertGuest();
        $this->actingAs($user)->get('/admin')->assertForbidden();
        $this->get('/')->assertOk();
    }

    public function test_sign_in_rotates_the_session_and_logout_revokes_access(): void
    {
        $admin = $this->administrator();
        $this->get('/admin/login');
        $previousId = session()->getId();
        $this->post('/admin/login', ['email' => 'ADMIN@EXAMPLE.TEST', 'password' => 'a-long-test-password'])->assertRedirect(route('admin.dashboard'));
        $this->assertAuthenticatedAs($admin);
        $this->assertNotSame($previousId, session()->getId());
        $this->get('/admin/login')->assertRedirect(route('admin.dashboard'));
        $this->post('/admin/logout')->assertRedirect(route('admin.login'));
        $this->assertGuest();
        $this->get('/admin')->assertRedirect(route('admin.login'));
    }

    public function test_failed_logins_are_limited_even_if_the_next_password_is_correct(): void
    {
        $this->freezeTime();
        $this->administrator();
        for ($i = 0; $i < 5; $i++) {
            $this->post('/admin/login?lang=en', ['email' => 'admin@example.test', 'password' => 'wrong'])->assertSessionHasErrors(['email' => 'Incorrect email or password.']);
        }
        $this->post('/admin/login?lang=en', ['email' => 'admin@example.test', 'password' => 'a-long-test-password'])->assertSessionHasErrors(['email' => 'Too many attempts. Wait 60 seconds.']);
        $this->assertGuest();
        $this->travel(61)->seconds();
        $this->post('/admin/login', ['email' => 'admin@example.test', 'password' => 'a-long-test-password'])->assertRedirect(route('admin.dashboard'));
        $this->assertAuthenticated();
    }

    public function test_ip_limit_prevents_bypassing_throttling_by_changing_email(): void
    {
        for ($i = 0; $i < 30; $i++) {
            $this->post('/admin/login', ['email' => 'user'.$i.'@example.test', 'password' => 'wrong'])->assertRedirect();
        }
        $this->post('/admin/login?lang=en', ['email' => 'another@example.test', 'password' => 'wrong'])->assertTooManyRequests();
        $this->assertGuest();
    }

    public function test_dashboard_shows_existing_data_in_both_languages_without_mutating_it(): void
    {
        $this->seed();
        $admin = $this->administrator();
        $this->actingAs($admin);
        foreach (['es', 'en'] as $locale) {
            $response = $this->get('/admin?lang='.$locale)->assertOk()
                ->assertSee(__('admin.title', [], $locale))->assertSee('Karmine Corp')
                ->assertSee(__('admin.unpublished', [], $locale))->assertSee('1'.($locale === 'es' ? '.' : ',').'519')
                ->assertSee('lang="'.$locale.'"', false)->assertDontSee('Text unavailable.');
            $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));
            $this->assertSame(26, substr_count($response->getContent(), '<tr>'));
        }
        $this->assertDatabaseCount('teams', 16);
        $this->assertDatabaseCount('fixtures', 8);
        $this->assertDatabaseHas('tournaments', ['published_revision' => null]);
        $admin->is_admin = false;
        $admin->save();
        $this->get('/admin')->assertForbidden();
    }

    public function test_dashboard_empty_state_and_escaped_names(): void
    {
        $admin = $this->administrator();
        $this->actingAs($admin)->get('/admin?lang=en')->assertOk()->assertSee(__('tournament.empty', [], 'en'));
        $this->seed();
        Team::where('acronym', 'GEN')->update(['name' => '<script>alert(1)</script>']);
        $this->get('/admin')->assertOk()->assertSee('&lt;script&gt;alert(1)&lt;/script&gt;', false)->assertDontSee('<script>alert(1)</script>', false);
    }

    public function test_login_and_logout_require_csrf_protection(): void
    {
        $this->app->instance('env', 'production');
        $this->post('/admin/login', ['email' => 'admin@example.test', 'password' => 'wrong'])->assertStatus(419);
        $this->actingAs($this->administrator())->post('/admin/logout')->assertStatus(419);
    }

    public function test_command_creates_a_hashed_admin_without_password_arguments_or_default_accounts(): void
    {
        $this->artisan('admin:create', ['email' => 'ADMIN@EXAMPLE.TEST', '--name' => 'Operator'])
            ->expectsQuestion('Password (12+ characters, up to 72 bytes)', 'a-long-test-password')
            ->expectsQuestion('Confirm password', 'a-long-test-password')->assertSuccessful();
        $user = User::firstOrFail();
        $this->assertSame('admin@example.test', $user->email);
        $this->assertTrue($user->is_admin);
        $this->assertTrue(Hash::check('a-long-test-password', $user->password));
        $this->assertNotContains('is_admin', $user->getFillable());
        $this->assertArrayNotHasKey('password', $user->toArray());
    }

    public function test_command_refuses_duplicate_users_and_invalid_passwords_without_overwriting_them(): void
    {
        $existing = User::factory()->create(['email' => 'existing@example.test']);
        $this->artisan('admin:create', ['email' => $existing->email, '--name' => 'Operator'])->assertFailed();
        $this->assertFalse($existing->fresh()->is_admin);
        $this->artisan('admin:create', ['email' => 'new@example.test', '--name' => 'Operator'])
            ->expectsQuestion('Password (12+ characters, up to 72 bytes)', 'short')
            ->expectsQuestion('Confirm password', 'short')->assertFailed();
        $this->artisan('admin:create', ['email' => 'long@example.test', '--name' => 'Operator'])
            ->expectsQuestion('Password (12+ characters, up to 72 bytes)', str_repeat('é', 40))
            ->expectsQuestion('Confirm password', str_repeat('é', 40))->assertFailed();
        $this->assertDatabaseCount('users', 1);
    }
}

<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Illuminate\View\View;

class SessionController extends Controller
{
    public function create(): View
    {
        return view('admin.login');
    }

    public function store(Request $request): RedirectResponse
    {
        $credentials = $request->validate([
            'email' => ['required', 'string', 'email', 'max:254'],
            'password' => ['required', 'string', 'max:128'],
        ], [
            'email.required' => __('admin.email_required'),
            'email.email' => __('admin.email_invalid'),
            'email.string' => __('admin.email_invalid'),
            'email.max' => __('admin.email_invalid'),
            'password.required' => __('admin.password_required'),
            'password.string' => __('admin.failed'),
            'password.max' => __('admin.failed'),
        ]);
        $credentials['email'] = Str::lower($credentials['email']);
        $key = 'admin-login:'.hash('sha256', $credentials['email'].'|'.$request->ip());
        if (RateLimiter::tooManyAttempts($key, 5)) {
            throw ValidationException::withMessages(['email' => __('admin.throttled', ['seconds' => RateLimiter::availableIn($key)])]);
        }
        if (strlen($credentials['password']) > 72 || ! Auth::attempt([...$credentials, 'is_admin' => true])) {
            RateLimiter::hit($key, 60);
            throw ValidationException::withMessages(['email' => __('admin.failed')]);
        }
        RateLimiter::clear($key);
        $request->session()->regenerate();

        return redirect()->route('admin.dashboard');
    }

    public function destroy(Request $request): RedirectResponse
    {
        Auth::logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return redirect()->route('admin.login');
    }
}

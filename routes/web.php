<?php

use App\Http\Controllers\Admin\DashboardController;
use App\Http\Controllers\Admin\SessionController;
use App\Http\Controllers\HomeController;
use App\Http\Middleware\EnsureAdministrator;
use App\Http\Middleware\PreventAdminCaching;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Route;
use Illuminate\View\Middleware\ShareErrorsFromSession;

Route::get('/', HomeController::class)
    // Read-only preview: no session or CSRF cookie. Mutating routes must keep web protection.
    ->withoutMiddleware([StartSession::class, ShareErrorsFromSession::class, PreventRequestForgery::class])
    ->name('home');

Route::prefix('admin')->name('admin.')->middleware(PreventAdminCaching::class)->group(function () {
    Route::middleware('guest')->group(function () {
        Route::get('/login', [SessionController::class, 'create'])->name('login');
        Route::post('/login', [SessionController::class, 'store'])->middleware('throttle:admin-login')->name('login.store');
    });
    Route::post('/logout', [SessionController::class, 'destroy'])->middleware('auth')->name('logout');
    Route::get('/', DashboardController::class)->middleware(['auth', EnsureAdministrator::class])->name('dashboard');
});

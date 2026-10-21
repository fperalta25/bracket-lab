<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class CreateAdministrator extends Command
{
    protected $signature = 'admin:create {email?} {--name=}';

    protected $description = 'Create an administrator using a hidden password prompt';

    public function handle(): int
    {
        $email = Str::lower(trim($this->argument('email') ?? $this->ask('Email') ?? ''));
        $name = $this->option('name') ?? $this->ask('Name');
        $identity = Validator::make(['email' => $email, 'name' => $name], [
            'email' => ['required', 'email', 'max:254', 'unique:users,email'],
            'name' => ['required', 'string', 'max:255'],
        ]);
        if ($identity->fails()) {
            $this->error('Use a valid, unused email and a name of up to 255 characters.');

            return self::FAILURE;
        }
        $password = $this->secret('Password (12+ characters, up to 72 bytes)', false);
        $confirmation = $this->secret('Confirm password', false);
        if (! is_string($password) || mb_strlen($password) < 12 || strlen($password) > 72 || $password !== $confirmation) {
            $this->error('Passwords must match, have at least 12 characters and fit within 72 bytes.');

            return self::FAILURE;
        }
        $user = new User(['email' => $email, 'name' => $name, 'password' => $password]);
        $user->is_admin = true;
        $user->save();
        $this->info('Administrator created. Sign in at /admin/login.');

        return self::SUCCESS;
    }
}

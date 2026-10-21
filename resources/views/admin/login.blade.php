<x-admin-layout :title="__('admin.login')">
    <form class="admin-login" method="post" action="{{ route('admin.login.store') }}">
        @csrf
        <label for="email">{{ __('admin.email') }}</label>
        <input id="email" name="email" type="email" required maxlength="254" autocomplete="username" inputmode="email" value="{{ old('email') }}" @error('email') aria-invalid="true" aria-describedby="email-error" @enderror>
        @error('email')<p id="email-error" class="form-error" role="alert">{{ $message }}</p>@enderror
        <label for="password">{{ __('admin.password') }}</label>
        <input id="password" name="password" type="password" required maxlength="128" autocomplete="current-password" @error('password') aria-invalid="true" aria-describedby="password-error" @enderror>
        @error('password')<p id="password-error" class="form-error" role="alert">{{ $message }}</p>@enderror
        <button class="primary-button" type="submit">{{ __('admin.sign_in') }}</button>
    </form>
</x-admin-layout>

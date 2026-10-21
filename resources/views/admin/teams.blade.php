<x-admin-layout :title="__('draft.title')">
    <div class="section-heading">
        <h2>{{ $tournament->name }}</h2>
        <span class="calibration">{{ __('draft.version', ['version' => $draft?->version ?? 0]) }}</span>
    </div>
    @if ($outdated)<p class="notice" role="alert">{{ __('draft.outdated') }}</p>@endif
    <form class="team-draft-form" data-draft-key="{{ auth()->id() }}:{{ $tournament->id }}" action="{{ route('admin.teams.update') }}" method="post">
        @csrf
        @method('PUT')
        <input type="hidden" name="version" value="{{ old('version', $draft?->version ?? 0) }}">
        <input type="hidden" name="source_hash" value="{{ old('source_hash', $sourceHash) }}">
        <div class="draft-actions">
            <button class="primary-button" type="submit" @disabled($outdated)>{{ __('draft.save') }}</button>
            <a href="{{ route('admin.dashboard') }}">{{ __('draft.official') }}</a>
        </div>
        @if ($errors->any())
            <div class="notice form-error" role="alert">
                <p>{{ __('draft.check_fields') }}</p>
                @foreach (['draft', 'teams', 'version', 'source_hash'] as $errorKey)
                    @foreach ($errors->get($errorKey) as $message)<p>{{ $message }}</p>@endforeach
                @endforeach
                @if ($errors->has('draft'))<a class="home-link" href="{{ route('admin.teams.edit') }}">{{ __('draft.reload') }}</a>@endif
            </div>
        @endif
        <div class="team-draft-grid">
            @foreach ($teams as $index => $team)
                <fieldset class="team-draft-card">
                    <legend>{{ $team['acronym'] }}</legend>
                    <input type="hidden" name="teams[{{ $index }}][id]" value="{{ $team['id'] }}">
                    @foreach (['name' => 'draft.name', 'acronym' => 'draft.acronym', 'region' => 'simulation.region', 'regional_seed' => 'admin.seed', 'pool' => 'admin.pool'] as $field => $label)
                        <div class="draft-field">
                            <label for="team-{{ $index }}-{{ $field }}">{{ __($label) }}</label>
                            @if (in_array($field, ['region', 'pool'], true))
                                <select id="team-{{ $index }}-{{ $field }}" name="teams[{{ $index }}][{{ $field }}]" required @error('teams.'.$index.'.'.$field) aria-invalid="true" aria-describedby="error-{{ $index }}-{{ $field }}" @enderror>
                                    @foreach ($field === 'region' ? ['LCK', 'LPL', 'LEC', 'LCS', 'LCP', 'CBLOL'] : [1, 2, 3, 4] as $option)
                                        <option value="{{ $option }}" @selected((string) old('teams.'.$index.'.'.$field, $team[$field]) === (string) $option)>{{ $option }}</option>
                                    @endforeach
                                </select>
                            @else
                                <input id="team-{{ $index }}-{{ $field }}" name="teams[{{ $index }}][{{ $field }}]" type="{{ $field === 'regional_seed' ? 'number' : 'text' }}" value="{{ old('teams.'.$index.'.'.$field, $team[$field]) }}" required @if ($field === 'regional_seed') min="1" max="16" step="1" @else maxlength="{{ $field === 'acronym' ? 12 : 120 }}" @endif @error('teams.'.$index.'.'.$field) aria-invalid="true" aria-describedby="error-{{ $index }}-{{ $field }}" @enderror>
                            @endif
                            @error('teams.'.$index.'.'.$field)<p class="form-error" id="error-{{ $index }}-{{ $field }}">{{ $message }}</p>@enderror
                        </div>
                    @endforeach
                </fieldset>
            @endforeach
        </div>
    </form>
</x-admin-layout>

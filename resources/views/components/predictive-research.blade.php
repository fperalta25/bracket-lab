@props(['research'])
@php
    $number = fn (int|float $value, int $decimals = 4) => number_format($value, $decimals, app()->getLocale() === 'es' ? ',' : '.', app()->getLocale() === 'es' ? '.' : ',');
@endphp
<details id="validacion" class="section starting-fixtures predictive-research">
    <summary>{{ __('research.title') }}</summary>
    <p class="calibration">{{ __('research.status') }}</p>
    <p class="calibration">{{ __('research.models', ['slope' => $number($research['slope'], 2), 'days' => $number($research['delay_days'], 0)]) }}</p>
    @foreach (['global', 'international'] as $scope)
        <h3>{{ __('research.'.$scope) }}</h3>
        <div class="table-scroll" tabindex="0" role="region" aria-label="{{ __('research.title') }} · {{ __('research.'.$scope) }}">
            <table>
                <caption class="sr-only">{{ __('research.title') }} · {{ __('research.'.$scope) }}</caption>
                <thead>
                    <tr>
                        <th scope="col">{{ __('research.period') }}</th>
                        <th scope="col">{{ __('research.games') }}</th>
                        <th scope="col">{{ __('research.reference') }}<br>{{ __('research.log_loss') }}</th>
                        <th scope="col">{{ __('research.adjusted') }}<br>{{ __('research.log_loss') }}</th>
                        <th scope="col">{{ __('research.reference') }}<br>{{ __('research.brier') }}</th>
                        <th scope="col">{{ __('research.adjusted') }}<br>{{ __('research.brier') }}</th>
                        <th scope="col">{{ __('research.interval') }}</th>
                    </tr>
                </thead>
                <tbody>
                    @foreach ($research['rows'] as $row)
                        @if ($row['scope'] === $scope)
                            <tr>
                                <th scope="row">{{ __('research.'.$row['period']) }}</th>
                                <td>{{ $number($row['games'], 0) }}</td>
                                <td>{{ $number($row['reference_log_loss']) }}</td>
                                <td>{{ $number($row['adjusted_log_loss']) }}</td>
                                <td>{{ $number($row['reference_brier']) }}</td>
                                <td>{{ $number($row['adjusted_brier']) }}</td>
                                <td>
                                    @if ($row['log_loss_advantage_95'])
                                        {{ $number($row['log_loss_advantage_95'][0]) }} … {{ $number($row['log_loss_advantage_95'][1]) }}
                                    @else
                                        {{ __('research.no_interval') }}
                                    @endif
                                </td>
                            </tr>
                        @endif
                    @endforeach
                </tbody>
            </table>
        </div>
    @endforeach
    <p class="calibration">{{ __('research.limits') }}</p>
    <p class="calibration">{{ __('research.uncertainty') }}</p>
    <p class="calibration">{{ __('research.international_note') }} {{ __('research.dates') }}</p>
</details>

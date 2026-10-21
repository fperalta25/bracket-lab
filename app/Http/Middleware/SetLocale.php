<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class SetLocale
{
    public function handle(Request $request, Closure $next): Response
    {
        $selection = $request->query('lang');
        $preference = $selection ?? $request->cookie('locale');
        $browserLanguage = strtolower($request->getLanguages()[0] ?? 'en');
        $locale = $preference === null
            ? (str_starts_with($browserLanguage, 'es') ? 'es' : 'en')
            : (in_array($preference, ['es', 'en'], true) ? $preference : 'en');

        app()->setLocale($locale);

        $response = $next($request);
        // Only a deliberate supported choice creates a preference; no session is needed.
        if (in_array($selection, ['es', 'en'], true)) {
            $response->headers->setCookie(cookie(
                'locale', $locale, 60 * 24 * 365, '/', null, $request->isSecure(), true, false, 'lax',
            ));
        }

        // Browser language and the technical cookie affect the rendered representation.
        $response->setVary(['Accept-Language', 'Cookie'], false);

        return $response;
    }
}

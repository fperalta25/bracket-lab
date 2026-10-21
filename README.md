# Bracket Lab

Simulador independiente de torneos. Primera edición: Worlds 2026 de League of Legends.
La [especificación principal](docs/WORLDS_2026_SIMULATOR_SPEC.md) guía el desarrollo por fases.
El [anexo de UX sin metatexto](docs/WORLDS_2026_ANEXO_UX_SIN_METATEXTO.md) es un requisito
permanente para todas las pantallas públicas y de administración, existentes y futuras.
Antes de completar cada pantalla, revisar el texto según sus criterios de aceptación:
títulos literales, contenido directo y ayuda solo cuando sea necesaria, conservando
accesibilidad y avisos legales o metodológicos pertinentes.

## Estado

Fase 0: Laravel 13, PHP 8.4, SQLite, Blade, Alpine, Tailwind 4 y TypeScript con Vite.
PHPUnit y Vitest preparados. El motor, los escenarios y la administración se implementarán
en las siguientes fases. Sin despliegue ni CI/CD.

La portada muestra los 16 equipos por pool y los ocho cruces de R1 pendientes, en español
y con diseño oscuro adaptable. Se identifica como vista previa, sin revisión publicada
ni resultados calculados. Los datos siguen la especificación, sin consultar fuentes en vivo.

El seeder usa UUID estables y una transacción. Se puede repetir con `php artisan db:seed`:
crea registros que falten y conserva los existentes, incluidas potencias y marcadores
editados. No crea usuarios ni contraseñas predeterminadas. Los pools se asignan explícitamente,
sin derivarlos del seed regional; las puntuaciones iniciales son 50 y no están calibradas.
No ejecutar `migrate:fresh` sobre datos que se quieran conservar.

## Arranque local con Fedora y Podman

Requiere Podman y un proveedor Compose (`podman-compose`). No requiere PHP, Composer ni Node
en el anfitrión. Ejecutar desde la raíz del repositorio:

```bash
cp .env.example .env
```

En `.env`, ajustar `LOCAL_UID` y `LOCAL_GID` a `id -u` e `id -g`, y establecer
`CONTAINER_USERNS=keep-id` para Podman rootless. Los montajes usan `:z` para compartir
el código entre contenedores con SELinux activo. No ejecutar Podman con sudo.

```bash
podman compose build app
podman compose run --rm app composer install
podman compose run --rm app php artisan key:generate
podman compose run --rm app php artisan migrate --seed
podman compose run --rm node npm ci
podman compose run --rm node npm run build
podman compose up -d app web
```

Abrir <http://localhost:8000>. Nginx solo escucha en la interfaz local.
El código, SQLite (`database/database.sqlite`) y `storage/` persisten en el anfitrión
al detener o recrear los contenedores. No se versionan `.env`, SQLite, dependencias ni builds.

Para desarrollo con recarga, mantener `podman compose run --rm --service-ports node`
en otra terminal. Al terminar, detenerlo con Ctrl+C y borrar `public/hot` si persistiera;
`npm run build` vuelve a generar los assets estáticos. Para parar PHP/Nginx:
`podman compose down`.

Si el puerto 8000 está ocupado, ajustar `APP_PORT` y `APP_URL`. El servidor Vite usa
5173; mantener `VITE_PORT=5173` en esta configuración local.

## Docker Compose

El mismo `compose.yaml` sirve para desarrollo local con Docker Compose en Linux:
mantener `CONTAINER_USERNS=host`, ajustar UID/GID y sustituir `podman compose` por
`docker compose` en los comandos anteriores. En macOS/Windows puede mantenerse UID/GID 1000.
La verificación de esta fase se realiza con Podman; Docker requiere validación en su anfitrión.

La configuración actual es exclusivamente de desarrollo. El futuro VPS Ubuntu usará
Docker Compose, pero los servicios de producción, proxy/TLS, backups y pipelines
quedan para la fase de despliegue.

## Comprobaciones

```bash
podman compose run --rm app composer test
podman compose run --rm app vendor/bin/pint --test
podman compose run --rm node npm test
podman compose run --rm node npm run typecheck
podman compose run --rm node npm run build
```

PHPUnit usa SQLite en memoria, sin modificar la base local. También se pueden ejecutar
los comandos npm en el anfitrión con Node >=22.12 y `npm ci`.

Las pruebas cubren persistencia e idempotencia del seeder, cruces exactos, pools/regiones,
ausencia de resultados inventados, portada sin sesión, estado vacío y escape de nombres.
Vitest comprueba la coherencia del conjunto de datos inicial; las pruebas del motor
se incorporarán al implementarlo en la Fase 1.

Validación manual: abrir la portada, comprobar ocho cruces pendientes y cuatro pools
con cuatro equipos, navegar con Tab y probar 360 px, tablet y escritorio. El sitio no
debe desplazar horizontalmente toda la página. Antes de ejecutar una simulación en futuras
fases, el motor deberá superar las invariantes de la especificación.

Fase 0 verificada en Fedora/Podman: 7 pruebas PHP (86 aserciones), 3 pruebas Vitest,
Pint, TypeScript y build. Comprobación en Firefox a 360, 768 y 1440 px: sin desbordamiento
horizontal, cookies ni errores JavaScript; enlace de salto accesible con teclado.

Siguiente paso: Fase 1, dominio y motor TypeScript puro con semilla, series, sorteos
completos válidos y pruebas de invariantes. Las probabilidades y el worker llegarán después.

## Organización

- `app/Domain/Tournament/`: futura validación y publicación del torneo.
- `resources/ts/simulator/`: futuro motor puro, sin DOM ni Laravel.
- `resources/ts/scenarios/`: futuros escenarios locales.
- `resources/ts/ui/`: futura integración de worker y resultados.
- `tests/Feature/`, `tests/ts/`: pruebas de aplicación y TypeScript.
- `database/data/`: datos iniciales versionados, no configuración de producción.

## Git

`development` es la rama de integración. Trabajar en ramas cortas `feat/*`, `fix/*`
o `chore/*`, con commits concretos y pruebas locales antes de integrar mediante merge
revisable. Agrupar y espaciar pushes; no usar bucles de push. `main` se reservará para
versiones publicables si hace falta. No configurar CI/CD hasta decidir el despliegue.

## Identidad y privacidad

Proyecto gratuito, independiente y no oficial, sin respaldo ni patrocinio de Riot Games.
Worlds y League of Legends se mencionan como referencias informativas. No se incluyen
logos de Riot, escudos de clubes, fuentes externas ni seguimiento. Las futuras
probabilidades serán estimaciones del modelo y las simulaciones se ejecutarán en el navegador.

# Bracket Lab

Simulador independiente de torneos. Primera edición: Worlds 2026 de League of Legends.
La [especificación principal](docs/WORLDS_2026_SIMULATOR_SPEC.md) guía el desarrollo por fases.
El [anexo de UX sin metatexto](docs/WORLDS_2026_ANEXO_UX_SIN_METATEXTO.md) es un requisito
permanente para todas las pantallas públicas y de administración, existentes y futuras.
Antes de completar cada pantalla, revisar el texto según sus criterios de aceptación:
títulos literales, contenido directo y ayuda solo cuando sea necesaria, conservando
accesibilidad y avisos legales o metodológicos pertinentes.
El [anexo ES/EN](docs/WORLDS_2026_ANEXO_I18N_EN_ES.md) exige ambos idiomas en todas las
vistas, incluidas las futuras pantallas de administración y sus validaciones. Prevalece
sobre cualquier indicación anterior de un MVP solo en español.

## Estado

Fases 0 y 1: base Laravel 13, PHP 8.4, SQLite, Blade, Alpine, Tailwind 4 y TypeScript
con Vite; motor de torneo probado sin interfaz de simulación. Los controles públicos,
el worker, los escenarios guardados y la administración se implementarán en las siguientes
fases. Sin despliegue ni CI/CD.

La portada muestra los 16 equipos por pool y los ocho cruces de R1 pendientes, en español e inglés
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
Vitest comprueba los datos iniciales, la internacionalización y las invariantes del motor.
`npm run typecheck` también compila el motor con solo ES2022, sin tipos DOM ni Node.

Validación manual: abrir la portada, comprobar ocho cruces pendientes y cuatro pools
con cuatro equipos, navegar con Tab y probar 360 px, tablet y escritorio. El sitio no
debe desplazar horizontalmente toda la página. Antes de ejecutar una simulación en futuras
fases, el motor deberá superar las invariantes de la especificación.

Fase 0 verificada en Fedora/Podman: 7 pruebas PHP (86 aserciones), 3 pruebas Vitest,
Pint, TypeScript y build. Comprobación en Firefox a 360, 768 y 1440 px: sin desbordamiento
horizontal, cookies ni errores JavaScript; enlace de salto accesible con teclado.

Siguiente paso: Fase 2, controles públicos bilingües, Web Worker con progreso/cancelación,
tablas de probabilidades y recorrido de ejemplo. Mantener las reglas de UX sin metatexto.

## Motor de torneo · Fase 1

`resources/ts/simulator/` contiene el motor puro: no depende de Laravel, DOM, idioma,
almacenamiento, red ni `Math.random()`. No hay equipos ni año codificados en el algoritmo.
El perfil `SWISS_16_RULES` configura los pools y el formato soportado (16 equipos,
tres victorias/derrotas, cinco rondas); otras reglas requieren una versión de motor compatible.

El contrato `SimulationRequest` incluye snapshot, escenario, potencias opcionales,
varianza, iteraciones y semilla entera sin signo de 32 bits. Los IDs y los estados
son independientes del idioma. Por ahora se admiten de 1 a 50.000 iteraciones por lote;
el límite de la interfaz se revisará al medir el worker en navegador.

- `from_scratch`: ignora los fixtures oficiales y vuelve a sortear R1 en cada torneo.
- `official_state`: conserva sorteos, posiciones, marcadores y partidas conocidas.
- `custom`: recibe una copia completa de las restricciones locales; no mezcla silenciosamente
  modificaciones con fixtures antiguos del snapshot. No modifica los datos oficiales.

`prepareSimulation` valida antes de ejecutar. Los enfrentamientos de rondas posteriores
solo pueden fijarse con participantes determinados por resultados anteriores conocidos.
Los cuartos necesitan los ocho clasificados; semifinales y final, sus ganadores previos.
Los errores son `SimulationError` con `code` y contexto (fixture, ronda, record o motivo),
para traducirlos en UI. No se reintentan ni descartan recorridos imposibles en silencio.

`runSimulations` devuelve contadores enteros, metadatos y el primer torneo completo como
ejemplo reproducible. No conserva los miles de recorridos en memoria. Para el futuro worker
se exponen `prepareSimulation`, `simulateTournament`, `createAggregates` y `accumulate`;
el generador se crea una vez por ejecución y se inyecta en cada torneo.

Cada equipo tiene un único record suizo y puesto final. `matchesPlayed`/`gamesPlayed`
incluyen encuentros oficiales conocidos; `simulatedMatches`/`simulatedGames` separan
los realmente simulados. Un marcador oficial sin orden de partidas permanece sin ese orden.
Los prefijos de partidas conocidas se respetan y solo se simulan las partidas restantes.

Decisiones estadísticas:

- PRNG Mulberry32, con secuencia de referencia probada y selección entera sin sesgo por módulo.
- Probabilidad logística por partida, con escalas 9/15/24 para varianza baja/normal/alta.
  Sin calibración empírica ni bonificaciones automáticas. No se aplica un recorte adicional
  de probabilidades: los scores válidos 0–100 ya producen valores estrictamente entre 0 y 1.
- Sorteo uniforme entre emparejamientos completos válidos, mediante DP por máscara de bits.
  Con bloqueos, se muestrean las soluciones que los respetan. Solo cuando no queda ninguna
  sin rematch se minimiza el número total de repeticiones y se muestrean las soluciones óptimas.
  Nunca se relajan pools/regiones de R1, records ni participantes. No se reproduce la distribución
  del procedimiento físico de Riot ni se atribuye a Riot la elección de minimizar rematches.
- Cada recorrido registra las excepciones por ronda/record. Los agregados cuentan torneos
  afectados y series repetidas, sin excluirlos del denominador.
- Los cuartos se muestrean entre los 288 cuadros válidos con posiciones específicas;
  los invictos van a mitades opuestas. Las semifinales y final siguen esas posiciones.

Validación local de desarrollo (sin endpoint ni producto CLI público):

```bash
npm run simulate -- 1000
npm run simulate -- 10000 2026
# Sin Node en el anfitrión:
podman compose run --rm node npm run simulate -- 10000 2026
```

El script usa el seeder de demostración mediante un adaptador externo al núcleo. Comprueba
los totales exactos de records y puestos y muestra tiempo, semilla y excepciones. Medición
orientativa local en Node 22: 1.000 torneos en 268 ms y 10.000 en 1.388 ms, con potencias
neutras y semilla 2026. No es una medición del navegador ni un compromiso de latencia.

La batería incluye pruebas estadísticas con semilla fija del muestreo uniforme, backtracking,
mínimo global de rematches, bloqueos parciales, correcciones incompatibles, replay oficial
completo, límites, inmutabilidad y sumas exactas. La independencia del idioma se verifica
también con el mismo escenario y semilla en ES/EN.

## Internacionalización

- `lang/es.json` y `lang/en.json` son los únicos catálogos de interfaz. Cada cadena nueva
  debe incluir ambas traducciones con las mismas claves y parámetros (`:slot`, `:date`).
- Blade usa `__('clave', ['parametro' => valor])`. TypeScript importa el helper tipado
  `t(key, params?)` de `resources/ts/i18n/`; devuelve texto plano para `textContent` o
  `x-text`, nunca HTML. El fallback es inglés y no expone claves internas.
- El middleware global aplica el idioma también a las futuras rutas admin. La primera
  visita usa el idioma preferido del navegador: español si empieza por `es`, inglés
  en los demás casos. La elección manual prevalece.
- El componente `<x-language-switch />` muestra ES/EN y se debe incluir también en toda
  nueva vista pública o admin. `?lang=es` / `?lang=en` transmite la elección y conserva
  los demás parámetros de la URL. Solo se persiste en la cookie técnica `locale`,
  limitada a esos valores, HttpOnly, SameSite=Lax, Secure bajo HTTPS y de un año.
  No se crea una sesión ni una copia de la preferencia en localStorage.
- El selector actual recarga la página. Cuando existan escenarios o resultados en UI,
  conservar/restaurar el estado de trabajo al cambiar idioma será obligatorio; no
  reiniciar simulaciones. No traducir IDs, equipos, regiones ni valores del dominio.
- Para presentación frontend, usar `formatNumber`, `formatPercent` (fracciones 0..1)
  y `formatDate` con `Intl`. En Blade, las fechas usan Carbon localizado; la fecha
  inicial es un dato de calendario en UTC. Indicar la zona del dato cuando importe.
  Conservar siempre los números originales para cálculo y ordenación.
- Usar frases completas parametrizadas y variantes singular/plural cuando hagan falta.
  Las futuras validaciones, errores de escenarios, worker y gráficos deben traducirse
  en UI mediante códigos estables, sin llevar textos al motor ni al JSON funcional.

Las pruebas comprueban detección/persistencia, fallback, páginas de error y estado vacío,
fechas, paridad de catálogos y parámetros, claves usadas en Blade/TypeScript y textos
literales visibles en las plantillas. La revisión de copy y la comprobación móvil
en ambos idiomas siguen siendo obligatorias en cada pantalla nueva.

## Organización

- `app/Domain/Tournament/`: futura validación y publicación del torneo en backend.
- `resources/ts/simulator/`: motor puro, sin DOM ni Laravel.
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

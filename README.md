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
El [anexo estadístico v2](docs/WORLDS_2026_ANEXO_MODELO_ESTADISTICO_V2.md) rige el modelo
GPR y prevalece sobre la receta histórica de scores 0–100. La [guía v3](docs/WORLDS_2026_LEEME_CODEX_V3.md)
y el [anexo predictivo v3](docs/WORLDS_2026_ANEXO_MODELO_PREDICTIVO_V3.md) rigen el contrato
predictivo y la futura validación entrenada; V3-A está implementada, sin modelo entrenado.

## Estado

Fases 0 y 1 y primer bloque de Fase 2: Laravel 13, PHP 8.4, SQLite, Blade, Alpine,
Tailwind 4 y TypeScript con Vite; motor de torneo GPR/contextual experimental y simulador
público funcional en ES/EN. Sin despliegue ni CI/CD.

En [localhost:8000](http://localhost:8000), elegir origen, modelo e iteraciones y pulsar
**Simular torneo**. La ejecución usa un Web Worker con progreso y cancelación. Las dos tablas
permiten ordenar por cifras, buscar equipos y filtrar por región; el detalle muestra un torneo
de ejemplo completo, metodología, semilla y ratings usados. No requiere cuenta y no envía
las simulaciones al servidor.

La configuración y el último resultado completo se conservan en `sessionStorage` durante
la pestaña, incluido al cambiar de idioma. Si se solicita otro idioma durante una ejecución,
primero termina el cálculo y después se cambia de idioma con los mismos resultados.
Cancelar interrumpe el worker y conserva el último resultado completo. El primer bloque
de Fase 3 añade escenarios locales en IndexedDB y exportación/importación JSON, separados
de esta sesión temporal. Los datos iniciales siguen sin revisión publicada; no se consultan
fuentes en vivo.

El seeder usa UUID estables y una transacción. Se puede repetir con `php artisan db:seed`:
crea registros que falten y conserva los existentes, incluidos scores heredados y marcadores
editados. No crea usuarios ni contraseñas predeterminadas. Los pools se asignan explícitamente,
sin derivarlos del seed regional. Los valores 50 históricos pertenecen exclusivamente a
`legacy-score-v1`: no se convierten en GPR. Los perfiles GPR se guardan en una revisión separada.
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

Fase 1B: forma contextual prospectiva y base de verosimilitud/ESS implementadas; posterior
y confirmación de ajustes de plantilla pendientes. Fase 2: controles, worker, tablas y
ejemplo disponibles. Fase 3: escenarios locales y cuadro suizo R1–R5 interactivo, con ganadores por clic
y sorteos automáticos por grupo; eliminatorias interactivas hasta el campeón y resorteo por grupo. Fase 4 en progreso: acceso protegido, consulta y borrador de equipos; resultados oficiales y publicación pendientes.

## Base GPR v2

El preset ejecutable de referencia es **`gpr_baseline`**, con el snapshot proporcionado
del 19-10-2026. La fórmula es `1 / (1 + 10^((R_B - R_A) / D))`, calculada por su rama
numéricamente estable, sin suelo arbitrario de 5 %. `D=400` es **provisional**, no una
calibración del GPR de Riot. Una diferencia de 400 produce **10/11 ≈90,91 %**, no 90 %;
se ha corregido ese criterio contradictorio de los documentos sin cambiar la fórmula.

Cambios respecto a la base anterior:

| Aspecto | GPR v2 | Compatibilidad heredada |
|---|---|---|
| Entrada | `modelVersion: 'gpr-context-v2'`, `preset`, `strengths` | `modelVersion: 'legacy-score-v1'` obligatorio |
| Fortaleza | GPR original, separado de `Team` | `LegacyTeam.powerScore` 0–100 |
| Probabilidad | Elo base 10, D provisional 400 | Logística histórica, escalas 9/15/24 |
| Azar | Subflujos por índice de torneo, familia y evento | Secuencia Mulberry32 anterior intacta |
| Perfiles | Snapshot fechado y revisión completa | Sin conversión automática de scores |

`database/data/worlds-2026-strengths-v2.json` es el conjunto congelado para ejecución,
normalizado desde el JSON de `docs/` mediante acrónimo, región e IDs reales del torneo,
nunca por posición de fila. Una prueba contrasta los 16 ratings y parámetros con el documento
fuente. No hay consulta al ranking en vivo ni actualización automática durante Worlds.
`strength_profile_sets` guarda la revisión como JSON separado del equipo. El seeder es
idempotente y las revisiones no se actualizan en el mismo registro; las futuras correcciones
necesitarán una nueva revisión/ID, no sobrescribir snapshots usados por escenarios.

Para actualizar una instalación local existente sin eliminar sus datos:

```bash
podman compose run --rm app php artisan migrate --seed
```

La entrada GPR exige un perfil por cada participante, IDs únicos y correspondientes,
procedencia y fecha válidas, valores finitos y rangos técnicos documentados en los tipos y
validadores. GPR base/overrides: 0–5.000; D: 200–800; sigmas: 0–300; ajustes: ±100 puntos.
Estos límites son guardas técnicas, no rangos estimados empíricamente. Las modificaciones
explícitas de GPR o D quedan identificadas como hipótesis sin alterar el snapshot original.

`contextual_v1` se ejecuta como **experimento previo a los resultados**, con activación
explícita de las cuatro familias mediante `contextualTerms`:

```ts
const request = {
    ...gprRequest,
    preset: 'contextual_v1',
    contextualTerms: { tournamentForm: true, seriesForm: true, pressure: true, sequence: true },
} as const;
```

- Forma normal con media cero: una extracción por equipo/torneo y una por equipo/serie.
  Box–Muller coseno versionado usa uniformes de 32 bits centrados en cada celda para
  evitar `log(0)`. Sin recortes adicionales de colas; la resolución finita del PRNG
  limita el soporte representable, como en cualquier muestreo computacional.
- Subflujos separados `tournament_form` y `series_form`, con IDs estables. La misma
  serie recupera su forma; cambiar idioma o el orden de perfiles no altera el resultado.
- Presión estructural: suizo Bo1 → 0; suizo Bo3 → 0,5 y 1 en 1–1; knockout Bo5 → 0,5
  y 1 en 2–2. Transiciones: solo el ganador del game anterior de esa serie determina
  `afterWinElo`/`afterLossElo`, sin acumular rachas. Los coeficientes iniciales siguen en 0.
- Con todas las familias desactivadas, o todos los coeficientes/sigmas neutrales,
  el resultado es exactamente igual a GPR bajo los mismos subflujos.
- **Cualquier resultado completado o prefijo de games en el escenario contextual se
  rechaza** con `unsupported_model` y motivo `contextual_posterior_required`. Los fixtures
  pendientes sí se admiten. `from_scratch` ignora la historia oficial. Todavía no hay
  posterior ni ESS; usar GPR para simular desde partidas conocidas. No se ofrece una
  alternativa prospectiva implícita desde ese estado.
- Los ajustes de plantilla activos continúan rechazándose hasta disponer de confirmación
  y vigencia verificables. TES conserva GPR 1364 y ajuste −25 inactivo en ambos presets.

GPR sigue siendo el preset predeterminado. El contextual siempre registra `hypothetical: true`,
`status: experimental`, `conditioning: prior_without_observed_games`, versión de motor,
muestreador normal, intensidad de presión, transiciones y familias habilitadas. Sus sigmas
no cambian al variar D. No se han ajustado coeficientes con datos históricos; no son calibrados.
El selector público activa las cuatro familias contextuales conjuntamente; los ajustes
individuales y de administración se incorporarán en sus fases.

### Base del condicionamiento · verosimilitud y ESS

`likelihood.ts` aporta `seriesLogLikelihood(fixture, logProbabilities)`:

- Con orden conocido, multiplica las probabilidades de los games observados en el estado
  previo de cada uno. Un prefijo pendiente no añade evidencia de games futuros.
- Con solo marcador final, suma **todos los órdenes legales**, terminando en cuanto se
  alcanza la victoria. La DP usa `(winsA, winsB, previousWinner)`; su callback debe ser
  una función pura de ese estado, con las fortalezas latentes fijadas para la evaluación.
- Todo se calcula en logaritmos, con `gprGameLogProbabilities` y log-sum-exp. Así no se
  pierde evidencia improbable por calcular `log(1 - p)` después de redondear p a 1.
  No se modifica el cálculo de probabilidades ni el PRNG de los motores existentes.
- La evaluación es condicional a los participantes observados; no incluye la probabilidad
  del sorteo. Tampoco genera orden de games, cambia fixtures o consume azar.

`importance.ts` aporta `normalizeLogWeights(logWeights, minEss)`. Devuelve pesos normalizados,
ESS absoluto y relativo, peso máximo, logaritmo del peso medio y el estado
`sufficient_ess`, `insufficient_ess` o `zero_sample_support`. El umbral ESS es explícito:
una guarda numérica elegida por el llamador, **no** un parámetro calibrado. La ausencia de
soporte en las muestras no demuestra que el resultado sea imposible en todo el modelo;
no se sustituye por una distribución uniforme ni por un pronóstico de éxito.

Estos son módulos matemáticos preparatorios: **todavía no muestrean la posterior ni habilitan
el contextual con resultados conocidos**. ESS por sí solo no certifica convergencia ni
precisión. El siguiente bloque debe muestrear o marginalizar conjuntamente las formas de
torneo y serie, conservar la forma de series parcialmente observadas y aplicar una política
comprobada ante degeneración antes de conectarse al motor. El prior no se presentará como
posterior ni se volverán a aprender games ya incluidos en un rating actualizado.

Pruebas: fórmulas cerradas para todos los marcadores Bo1/Bo3/Bo5, enumeración independiente
de órdenes legales con transiciones, prefijos, ceros de soporte, probabilidades extremas,
pesos y ESS exactos, y un ejemplo bayesiano de dos estados con solución analítica. Este
último comprueba la mecánica del condicionamiento, no valida la posterior gaussiana completa.
Validación del bloque: 82 pruebas Vitest, 20 PHP (284 aserciones), tipos, build y Pint.

Cada resultado contiene versión de motor/modelo, snapshot y revisión de perfiles, D,
estado provisional, términos habilitados, semilla, iteraciones, revisión del torneo y
receta PRNG/hash. `metadata.request` conserva la configuración completa por valor para
reproducir el resultado, incluidos fixtures, restricciones y perfiles; no se transmite al servidor.
Las entradas sin versión o que mezclan GPR con scores antiguos se rechazan con
`incompatible_model`. El importador público acepta exclusivamente documentos GPR v2;
rechaza archivos legacy sin convertirlos. El motor conserva el modo legacy explícito.

El núcleo de sorteos, records, BoX, puestos y rematches se conserva. La regresión legacy
compara una huella de agregados y recorrido capturada antes del cambio; los nuevos tests
comprueban Elo, series analíticas, manifiestos, perfiles ausentes/incorrectos e independencia
de idioma, etiquetas y orden de equipos.

## Motor de torneo · Fase 1

`resources/ts/simulator/` contiene el motor puro: no depende de Laravel, DOM, idioma,
almacenamiento, red ni `Math.random()`. No hay equipos ni año codificados en el algoritmo.
El perfil `SWISS_16_RULES` configura los pools y el formato soportado (16 equipos,
tres victorias/derrotas, cinco rondas); otras reglas requieren una versión de motor compatible.

El contrato `SimulationRequest` distingue GPR y legacy por versión explícita. Incluye
snapshot, escenario, configuración del modelo, iteraciones y semilla entera sin signo de 32 bits. Los IDs y los estados
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
se exponen `prepareSimulation`, `simulateTournament`, `createAggregates` y `accumulate`.
En GPR se inyecta `createTournamentRandom(seed, simulationIndex)` en cada torneo; cualquier
lote o ejecución en otro orden conserva los resultados por índice. En legacy se mantiene
un único `createRandom(seed)` avanzando en el orden original.
Compartir semilla permite compartir azar por evento; si el cuadro diverge no garantiza
un pareamiento perfecto entre experimentos ni permite atribuir causalidad a sus diferencias.

Cada equipo tiene un único record suizo y puesto final. `matchesPlayed`/`gamesPlayed`
incluyen encuentros oficiales conocidos; `simulatedMatches`/`simulatedGames` separan
los realmente simulados. Un marcador oficial sin orden de partidas permanece sin ese orden.
Los prefijos de partidas conocidas se respetan y solo se simulan las partidas restantes.

Decisiones estadísticas:

- PRNG Mulberry32 versionado y selección entera sin sesgo por módulo. En GPR, FNV-1a sobre
  bytes UTF-16LE de tuplas JSON deriva subflujos por índice y evento. Sorteos y games tienen
  familias distintas; las formas de torneo/serie tienen sus propias familias, y la del
  posterior queda reservada.
  Los vectores incluyen caracteres Unicode y se contrastan con una implementación independiente.
- GPR usa la transformación Elo provisional descrita arriba. Solo legacy conserva las escalas
  antiguas 9/15/24. No se aplican bonificaciones regionales ni recortes de probabilidad.
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
npm run simulate -- 10000 2026 contextual_v1
# Sin Node en el anfitrión:
podman compose run --rm node npm run simulate -- 10000 2026
```

El script usa ahora GPR baseline y el snapshot congelado mediante un adaptador externo
al núcleo. Comprueba los totales exactos de records y puestos y muestra modelo, estado de
calibración, PRNG, tiempo, semilla y excepciones. Medición orientativa local en Node 22:
1.000 torneos en 313 ms y 10.000 en 1.947 ms, con GPR y semilla 2026. No es una medición
del navegador ni un compromiso de latencia. En el bloque contextual, 10.000 torneos con
las cuatro familias activas y semilla 2026 tardaron 3.326 ms, conservando los totales exactos.
Validación del bloque: 68 pruebas Vitest, 20 PHP (284 aserciones), tipos, build y Pint.

La batería incluye pruebas estadísticas con semilla fija del muestreo uniforme, backtracking,
mínimo global de rematches, bloqueos parciales, correcciones incompatibles, replay oficial
completo, límites, inmutabilidad y sumas exactas. La independencia del idioma se verifica
también con el mismo escenario y semilla en ES/EN.

Validación del bloque web: 88 pruebas Vitest y 21 PHP (296 aserciones), tipos, build y Pint.
Firefox en ES/EN a 360, 768 y 1440 px: ejecución real en worker, 32 filas, ejemplo de 40
series, filtros, orden numérico, cancelación, preservación al cambiar idioma (también durante
el cálculo), sin desbordamiento de página ni errores JavaScript ni POST de simulación.
Las tablas tienen desplazamiento local y primera columna fija en pantallas estrechas.

## Cuadro interactivo y escenarios locales

El **cuadro suizo** es la vista de edición: cinco columnas en escritorio y pestañas de ronda
en móvil. Pulsar un equipo elige el ganador; volver a pulsarlo retira la elección. El ganador
y el perdedor aparecen inmediatamente en su grupo siguiente. Cuando un grupo completa sus
participantes, sus cruces se sortean automáticamente, aunque otro grupo anterior siga
pendiente. No hay selector manual de rivales ni es necesario introducir marcadores o JSON.
El sorteo reutiliza el muestreador completo reglamentario: pools/regiones en R1, records en
R2–R5, mínimo global de rematches cuando corresponda. Los grupos ya sorteados se conservan
al resolver nuevos partidos independientes.

**Estado oficial** conserva los cruces publicados y muestra sus resultados conocidos.
**Desde cero** permite sortear también R1 al iniciar el cuadro. La primera elección crea
una copia local «Mi escenario», sin modificar el snapshot original. Clasificados y eliminados
se actualizan al alcanzar tres victorias o derrotas, hasta ocho equipos por lista.
Los datos de partida siguen consultables en una sección plegada para diferenciarlos del cuadro.

Cambiar o retirar un ganador ya elegido reinicia las rondas posteriores; si se pierden
otras elecciones, aparece un aviso. **Deshacer** restaura el estado completo anterior,
con sus cruces, elecciones y contador de sorteo. **Restaurar estado oficial** vuelve al
snapshot de partida y también puede deshacerse. En móvil se avanza a la siguiente ronda
al completar la actual; pestañas y elecciones se conservan al cambiar ES/EN.

Una elección de ganador se guarda como `status: decided, winner: teamId`, **sin marcador ni
orden de games inventados**. Para Monte Carlo, el modelo GPR sortea cada game condicionado
a ese ganador mediante probabilidades de continuación en logaritmos (`stationary-log-doob-v1`).
Así, elegir un ganador Bo3 no impone un 2–0: pueden aparecer marcadores 2–0 o 2–1 según su
distribución condicional. Los resultados del ejemplo llevan `origin: constrained` y la etiqueta
«Ganador elegido · marcador simulado». Los marcadores oficiales `completed` siguen intactos.
El manifiesto distingue `swiss16-gpr-winner-constraints-v1`; los requests sin elecciones
conservan sus versiones y regresiones anteriores. Contextual con elecciones continúa bloqueado
hasta implementar su condicionamiento; la UI selecciona GPR de forma explícita.

En **Escenarios**, dar nombre y guardar. Volver a guardar el escenario abierto permite
renombrarlo/actualizarlo; cambiar la selección de la biblioteca no sobrescribe otro escenario.
Se puede abrir, duplicar, eliminar, exportar e importar. IndexedDB guarda hasta 50 escenarios
con ID estable, nombre y fechas. Son locales al navegador; exportar los importantes, porque
su almacenamiento puede borrarse. No se envían las elecciones ni los escenarios al servidor.

La exportación usa `kind: bracket-lab-scenario`, `schemaVersion: 2` para admitir elecciones
sin marcador. El importador sigue leyendo archivos v1 con restricciones anteriores, sin
convertir sus resultados en elecciones ni cambiar su modelo. **La versión del fichero es
independiente de la versión del modelo predictivo**: no activa ni migra al modelo entrenado v3.
El JSON conserva la solicitud completa, snapshots, perfiles, overrides, familias contextuales,
semilla, N y restricciones; no incluye resultados agregados ni idioma. La importación está
limitada a 1 MiB, valida torneo/IDs y estructura antes de cambiar el trabajo y se abre como
copia. Un archivo con grupos listos aún sin sortear se conserva tal cual hasta una acción
explícita en el cuadro, para no modificar su distribución de simulación al cargarlo.

Validación del cuadro: 112 pruebas Vitest y 21 PHP, tipos, build y Pint; fórmulas exactas de
marcadores condicionados Bo3/Bo5, ganadores muy improbables en logaritmos, regresiones
legacy/GPR, grupos independientes, 33 elecciones y ocho clasificados/eliminados.
Firefox en ES/EN a 360, 768 y 1440 px: clics directos, sorteos por grupo, ausencia de selector
de rivales, cambio de idioma sin alterar resultados, reinicio de dependencias y deshacer.
Recorrido móvil completo: una ronda visible, avance automático, inicio desde cero,
guardado local, exportación/importación v2 y recarga sin perder las 33 elecciones.
### Eliminatorias

Al determinar los ocho clasificados, se sortean automáticamente los cuatro cuartos con
el mismo muestreador del motor. Los dos `3-0` se enfrentan a distintos `3-2` y quedan en
mitades opuestas; los cuatro equipos restantes completan el cuadro sin restricciones
adicionales. La semilla y el contador local hacen reproducible el sorteo y los cruces
quedan guardados en el escenario. Un sorteo oficial parcial conserva sus posiciones,
resultados y partidas conocidas al completarse. Los archivos importados siguen intactos:
si tienen ocho clasificados y cuartos sin completar, se ofrece «Sortear cruces».

Cada ganador de cuartos avanza a su semifinal según la posición del cuadro. La semifinal
aparece cuando se conocen sus dos participantes, sin esperar a la otra mitad. La final
sigue el mismo recorrido y el campeón se destaca al elegir su ganador. Todas las series
son Bo5 y las elecciones siguen sin imponer marcadores. El motor GPR existente sortea
marcadores condicionados al ganador, también en estas siete series.

Cambiar o retirar una elección elimina únicamente sus descendientes: se conservan los
otros cuartos y la semifinal de la otra mitad. Deshacer recupera las elecciones, los
cruces y las rondas visibles; cambiar un resultado suizo sigue reiniciando las rondas
posteriores y las eliminatorias. En móvil hay pestañas de cuartos, semifinales y final,
con avance y foco al completar una ronda. Participantes aún desconocidos quedan como
huecos deshabilitados; los marcadores oficiales se muestran sin transformarlos.

Se mantiene el JSON v2 y la compatibilidad de importación v1, sin cambiar modelos,
parámetros ni datos oficiales. La adopción del contrato v3 se describe en V3-A más abajo.

Validación de esta ampliación: **118 pruebas Vitest, 21 PHP**, TypeScript, build y Pint.
Incluye sorteo legal reproducible e idempotente, sorteo publicado parcial, avance de
mitades independientes, cambios y retiradas de ganadores y las 40 series hasta el campeón.
Firefox en ES/EN: recorrido completo en escritorio y móvil, teclado, simulación con las
40 elecciones, deshacer, biblioteca local, exportación ES/importación EN y recarga.
Comprobado también a 768 px, con importación de marcadores v1 y sorteo parcial importado:
se muestran los marcadores originales y se conservan los cuartos ya fijados.


## Resorteos y ceros determinados

El botón ↻ de cada grupo suizo resortea solo ese record: por ejemplo, `2-1` mantiene
los cruces y las elecciones de `1-2`. Se retiran los resultados del grupo y sus
fixtures dependientes; sobreviven los cruces posteriores independientes. El knockout
se retira porque depende de la clasificación/sorteo suizos. Deshacer restaura el cuadro
y el contador de sorteo completos. Se conserva el muestreo de emparejamientos completos
con el mínimo número de rematches, y las reglas de pools/regiones para R1. Un nuevo
sorteo puede coincidir con el anterior; no se fuerza un cambio sesgando la distribución.

Las tablas muestran **0 %** si un resultado es imposible por los marcadores oficiales
o ganadores elegidos: records incompatibles con las victorias/derrotas conocidas,
clasificación descartada y puestos finales incompatibles con el avance o eliminación.
La comprobación es conservadora y se basa en el request de los resultados mostrados,
no en cambios posteriores al cuadro. Si un caso aún posible no aparece en la muestra,
se conserva el límite aproximado `3/N`. No se infiere imposibilidad de un recuento cero
ni se cambian los agregados, el motor o los JSON existentes.

## Administración · primer bloque de Fase 4

Acceso en [/admin/login](http://localhost:8000/admin/login), también enlazado al pie
de la página. Sesiones Laravel y permiso `is_admin` explícito, sin registro público,
usuarios predeterminados ni promoción automática de cuentas existentes. La migración
marca como no administradores a los usuarios anteriores.

Para crear una cuenta local:

```bash
podman compose run --rm app php artisan migrate
podman compose run --rm app php artisan admin:create tu-correo@example.com --name="Tu nombre"
```

El comando solicita y confirma la contraseña de forma oculta, sin argumentos ni variables
con contraseñas. Exige al menos 12 caracteres y como máximo 72 bytes por bcrypt;
rechaza correos duplicados y no sobrescribe usuarios. Ejecutarlo en una terminal interactiva.
No se crea una cuenta real durante las comprobaciones del proyecto.

El panel consulta los 16 equipos, pools, seeds, GPR fechado, cruces y marcadores existentes.
Login, validación, datos, estados vacíos y cierre de sesión están disponibles en ES/EN.
La sesión se regenera al entrar y se invalida al salir; login/logout conservan CSRF,
hay límites por cuenta/IP y por IP, y las páginas admin usan `no-store`. El simulador
público continúa sin requerir sesión ni cuenta.

Los datos públicos siguen sin modificarse desde el panel. La edición de equipos usa
el borrador descrito abajo; quedan pendientes resultados, validación completa del
torneo, publicación atómica e historial de revisiones. El modelo entrenado continúa
inhabilitado; V3-A conserva los escenarios y cálculos existentes.

Validación conjunta: **125 pruebas Vitest y 32 PHP**, tipos, build y Pint. Incluye ceros
determinados, conservación de casos no observados, resorteos y dependencias; autenticación,
autorización, sesiones, CSRF, límites de acceso y creación segura de cuentas. Firefox:
resorteo `2-1`, conservación de `1-2`, deshacer, tablas ES/EN y persistencia en 360/1440 px;
login, errores, consulta y logout ES/EN en 360/768/1440 px con base de pruebas aislada.

### Borrador de equipos

Desde **Administración → Editar borrador**, o `/admin/teams`, se pueden modificar nombre,
acrónimo, región, seed regional y pool de los 16 equipos. El pool se asigna de forma
explícita. El formulario exige IDs originales sin duplicados, acrónimos únicos sin
distinguir mayúsculas/minúsculas, regiones admitidas, seeds 1–16 y cuatro equipos en cada
uno de los cuatro pools. No permite añadir campos de rating ni reinterpretar GPR.

«Guardar borrador» persiste el conjunto completo en `tournament_drafts`, separado de
`teams`, fixtures y perfiles congelados. Conserva una copia de los equipos de partida,
la revisión base, una huella de los datos oficiales, versión incremental y autor de la
última edición. Leer el formulario no crea un borrador. El JSON público y los escenarios
existentes permanecen idénticos después de guardar.

La escritura es transaccional y comprueba la versión: una pestaña antigua no sobrescribe
cambios de otra. El conflicto conserva sus campos y ofrece abrir el borrador actualizado.
Si cambian la revisión oficial o los equipos de origen, se bloquea el guardado; no se
reinterpreta ni se rebasa el borrador automáticamente. La recuperación/revisión frente a
una publicación nueva se completará con el flujo de publicación.

Interfaz ES/EN, controles táctiles y errores asociados a sus campos. Los valores sin
guardar se transfieren una sola vez al cambiar de idioma mediante `sessionStorage`,
con clave de usuario/torneo; se excluyen credenciales y CSRF y se retira la copia al
restaurarla. La versión original también se conserva para que el cambio de idioma no
eluda la protección frente a pestañas antiguas. Funciona como formulario normal sin JS.

Las instalaciones existentes necesitan `podman compose run --rm app php artisan migrate`.
No se han creado administradores ni borradores de ejemplo en la base local real.

Validación de este bloque: **42 pruebas PHP, 125 Vitest**, tipos, build y Pint. Diez pruebas
PHP nuevas cubren guardado aislado, IDs y campos, pools, duplicados, versiones, origen
obsoleto, escape de texto, autorización y CSRF. Firefox en 360/1440 px, ES/EN: guardado y
recarga, campos sin guardar al cambiar idioma, dos pestañas en conflicto, pools inválidos
y JSON público idéntico antes/después. Comprobado también el cuadro público con resorteos,
deshacer y porcentajes en ambos idiomas.

## V3-A · contrato de predicción

La auditoría detectó fórmulas GPR/contextuales directamente dentro de `tournament.ts`,
dos presets con el contextual identificado mediante el antiguo `contextual_v1`, y
escenarios JSON v1/v2 que deben seguir siendo reproducibles. No había artefacto entrenado,
datos históricos auditados ni calibración que permitieran habilitar v3.

`PredictionModel` separa predicción de reglas: crea un estado propio por torneo,
`predictGame(context, state)` calcula cada probabilidad y `onGameResolved` recibe los
games simulados. `PreGameContext` solo incluye hechos anteriores a ese game, sin el
marcador final ni un ganador futuro; su índice es 1-based. Fechas y rosters desconocidos
se omiten. La frontera de series valida probabilidades finitas en [0,1].

La factoría reutiliza las funciones GPR, la forma y las claves PRNG existentes, incluidos
los scores legacy 0–100 en su versión explícita. El estado experimental se recrea por
iteración; no se añaden bonos por ganar. Los resultados fijados no se predicen de nuevo
ni generan cronologías o callbacks ficticios. Los prefijos conocidos se conservan y los
callbacks corresponden solo a games nuevos. El condicionamiento a ganadores requiere
una capacidad estacionaria explícita y conserva el muestreador logarítmico anterior.

| Preset | Estado |
|---|---|
| `gpr_baseline` | Predeterminado, D=400 provisional |
| `contextual_experimental_v2` | Experimental v2 existente, sin nuevos factores |
| `contextual_trained_v3` | No disponible; se rechaza antes de ejecutar |
| `contextual_v1` | Alias de lectura del experimental v2, nunca del entrenado |

Se mantienen el envelope `modelVersion: gpr-context-v2`, los archivos de escenario v1/v2
y los manifiestos de requests anteriores. El número v3 del proyecto no reinterpreta ese
formato como un artefacto entrenado. Los seis casos de regresión fijan SHA-256 del resultado
completo anterior, incluido el manifiesto: legacy, GPR oficial, desde cero, resultados
fijados, ganadores elegidos y contextual antiguo. Los metadatos de un ID canónico nuevo
lo identifican como experimental, con el mismo engine y las mismas distribuciones.

La importación, IndexedDB y restauración de sesión no migran documentos. Para un escenario
antiguo guardado aparece **Copiar con preset actual**: crea otro ID, mantiene el original,
usa `contextual_experimental_v2`, conserva snapshot, perfiles, opciones, semilla y N, e
informa del preset de la copia. La función de copia admite ambos formatos de fichero sin
cambiar su versión. Guardar/exportar desde la UI sigue usando el formato v2 existente.
El entrenado se muestra deshabilitado y tampoco puede activarse mediante JSON o CLI.
No hay carga de artefactos, fallbacks silenciosos a coeficientes ficticios ni dependencias
Python/red en runtime. El GPR permanece disponible con todos los datos congelados locales.

**Resortear cuartos** conserva los 33 cruces/resultados suizos y
sortea los cuatro cuartos con el muestreador legal existente. Retira las siete elecciones
de eliminatorias si existían. Conserva la semilla y avanza el contador; Deshacer recupera
todo el cuadro y su contador. El sorteo es reproducible y puede coincidir con el anterior.

Validación: **142 Vitest, 42 PHP**, tipos, build y Pint. Se comprueban inyección del
predictor, estados aislados, Bo1/3/5, prefijos, callbacks condicionados, probabilidades
inválidas, bloqueo del entrenado, copias y regresiones completas. Firefox ES/EN, escritorio
1440 px y viewport móvil 360 px: importación antigua, selección del alias, copia intacta,
igualdad de resultados experimentales, JSON entrenado rechazado, resorteo de cuartos,
conservación del suizo, deshacer y recarga sin errores JavaScript.

Medición del harness local con Node 22: 10.000 torneos GPR, semilla 42, en 2.122 ms;
1.000 experimentales canónicos en 463 ms. Son medidas del entorno de desarrollo,
no tiempos garantizados en otros dispositivos ni métricas de calidad predictiva.
Firefox headless: 10.000 torneos GPR en el Web Worker, con entrega del resultado, en
3.374 ms; cancelación de una ejecución posterior conserva el resultado completo y
las tablas no muestran NaN.

**V3-B, tres bloques:** auditoría offline de ChainCC 2024–2026, importación/descarga,
canonicalización y trazabilidad por SHA-256. 28.791 games canónicos; 1.212 excluidos
por IDs ausentes y dos por resultados inconsistentes. La auditoría fechada de identidades
aísla además ocho registros simultáneos con IDs distintos: 28.783 partidas en el
registro derivado, 728 IDs y 4.081 alineaciones observadas. No se fusionan nombres
ambiguos ni se extrapolan plantillas futuras. Infraestructura y límites en
[analysis/README.md](analysis/README.md); [informe conjunto](models/reports/chaincc-2024-2026-v3b/audit.json).
47 pruebas Python, 142 Vitest, 42 Laravel y typecheck. La zona horaria, disponibilidad,
series e identidades estables requieren verificación; el corpus no está habilitado
para entrenamiento. Pendiente resolver esas limitaciones antes de construir las
features temporales de V3-C.

## V3-C · contrato temporal e importación revisada

Historial y plantillas inmutables con corte anterior al game, evidencia de
resultados disponible antes del corte y exclusión del objetivo/cuarentena. Las
noticias y plantillas futuras no modifican observaciones anteriores; los faltantes
siguen siendo `missing`, sin imputación a cero. No se han construido ni entrenado
los predictores de forma/continuidad. Contratos y comandos en
[analysis/README.md](analysis/README.md); [cobertura temporal real](models/reports/chaincc-temporal-contract-v3c/coverage.json).

Importación offline de evidencias con hashes y fechas, validación contra el corpus
congelado, rechazo de cuarentena/conflictos y recarga al historial temporal.
Los datos enriquecidos se conservan aparte; no se promueven a modelo entrenado.
92 pruebas Python, 142 Vitest, 42 Laravel (528 aserciones) y typecheck. El corpus
actual no acredita disponibilidad temporal ni snapshots pre-game con IDs estables;
el modelo entrenado sigue deshabilitado. No cambia la web ni el formato de escenarios.

## Referencia histórica Elo · primer backtest

El corpus existente permite investigación retrospectiva con supuestos declarados,
sin exigir fechas de publicación verificadas para cada game. Elo propio secuencial
con parámetros fijos provisionales, retrasos supuestos de 1/3/7 días y separación
temporal. No reutiliza GPR actual para el pasado ni cambia el preset público.

Con retraso de un día, 7.839 games de evaluación de 2026 dan log loss 0,64442 y Brier
0,22578, frente a 0,69315 / 0,25 del 50/50. El tramo final de 1.180 games da 0,65654 /
0,23132; el intervalo agrupado aproximado de su mejora incluye cero. Sigue siendo
una referencia exploratoria, sin promoción de modelo ni afirmación de calibración.

[Protocolo](analysis/config/internal-elo-v1.json),
[informe real](models/reports/internal-elo-v1/metrics.json) y
[comandos/supuestos](analysis/README.md). 108 pruebas Python, 142 Vitest,
42 Laravel (528 aserciones) y typecheck; informe y predicciones reproducibles byte
a byte. Siguiente bloque: contrastar forma residual contra esta referencia con
selección de parámetros limitada a desarrollo.

## Forma residual · ablation sobre la referencia Elo

Ventanas 14/30/60 días y nueve variantes, con selección limitada a 2025. Se agrupan
innovaciones del Elo por equipo/día y solo tras su disponibilidad supuesta. La
opción elegida (14 días, beta 1) mejora el log loss global de evaluación 2026 de
0,64442 a 0,64165, pero empeora el tramo final de 0,65654 a 0,65776 y no mejora el
subconjunto internacional principal. **Se conserva Elo sin forma como referencia**;
no se añade el factor al predictor público ni se presenta como calibrado.

[Protocolo](analysis/config/residual-form-v1.json),
[informe](models/reports/residual-form-v1/metrics.json) y
[definición, comandos y límites](analysis/README.md). 126 pruebas Python, 142 Vitest,
42 Laravel (528 aserciones) y typecheck; resultados reproducibles byte a byte.
Siguiente hipótesis: estabilidad de alineaciones observadas, sin usar datos del
roster del game objetivo ni incorporar automáticamente la forma al baseline.

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

# Worlds Simulator — Especificación funcional y técnica para Codex

> **Estado:** especificación viva · **Revisión:** 2 (modelo GPR contextual) · **Fecha:** 21-10-2026 · **Idiomas del MVP:** español e inglés · **Rama principal de desarrollo:** `development`
>
> **Objetivo para Codex:** implementar progresivamente una aplicación web pública, rápida e intuitiva para simular Worlds 2026 de League of Legends miles de veces, respetando el formato del torneo, y consultar probabilidades de clasificación y de resultado final. Solo la administración requiere autenticación.

## 1. Principios de producto

1. **La exactitud de las reglas es prioritaria.** Nunca simplificar un sorteo de forma que produzca enfrentamientos inválidos. Distinguir claramente reglas oficiales, supuestos estadísticos y escenarios hipotéticos.
2. **UX primero.** Interfaz limpia, compacta, legible, oscura y elegante, con un toque e-sports moderado. Nada de paneles sobrecargados, efectos gratuitos ni textos redundantes.
3. **Uso inmediato sin cuenta.** Entrar, elegir un escenario, configurar las pocas opciones importantes y pulsar «Simular». No solicitar registro, correo ni permisos al público.
4. **Bajo coste.** Las simulaciones corren en el navegador, sin trabajos de cómputo de invitados en el VPS; el servidor solo publica la configuración oficial y permite administrarla.
5. **Fiabilidad y transparencia.** Resultados reproducibles con semilla, validaciones estrictas, pruebas automatizadas y aclaración visible de que las probabilidades **son estimaciones del modelo**, no probabilidades oficiales.
6. **Modelo auditable.** El GPR fechado es fortaleza base; consistencia, presión, racha y cambios de plantilla se versionan y se distinguen claramente de resultados observados. El preset GPR es la referencia neutral.
7. **Desarrollo incremental.** Completar y verificar cada etapa antes de abordar la siguiente. Evitar arquitecturas excesivas, abstracciones prematuras y dependencias grandes.
8. **Portfolio profesional.** Código y commits profesionales, documentación útil, historial limpio y diseño original; sin marcas de asistentes de IA en nombres de ramas o mensajes de commit.

### Alcance del MVP

- 16 equipos que participan en el **suizo** de Worlds 2026 (no simular el Play-In; su ganador ya está determinado).
- Datos oficiales, configuración de equipos y actualización manual de sorteos/resultados desde panel admin.
- Simulación completa del suizo y las eliminatorias con **partidas individuales** en Bo1, Bo3 y Bo5.
- Tres formas de empezar: desde cero, desde la situación oficial actual y desde un escenario personalizado.
- GPR oficial fechado, presets GPR puro/contextual, perfiles individuales, imprevisibilidad exploratoria y número de iteraciones. Las cifras contextuales iniciales son hipótesis no calibradas.
- Tabla de probabilidad por puesto final; tabla de resultado suizo; estadísticas adicionales útiles.
- Escenarios del visitante guardados localmente, sin cuentas.
- Diseño responsive y accesible.

### Fuera del MVP

- Simular la fase de Play-In o los puestos 17.º–19.º.
- Integraciones en tiempo real, scraping, API obligatoria de Riot, automatización de noticias.
- Simular draft, campeones, jugadores, lados azul/rojo o efecto del Fearless Draft: se modela una partida completa con una probabilidad simple.
- Predicciones basadas en apuestas, monetización, ranking algorítmico de equipos o recomendaciones de juego.
- Cuentas públicas, compartición en servidor de escenarios, colas, Redis, websockets, microservicios.
- Reproducción exacta del procedimiento físico secuencial de extracción de bolas de Riot: el método probabilístico del MVP será un **muestreo uniforme entre sorteos completos válidos**, explicado en la UI como una aproximación del sorteo real.

## 2. Stack y arquitectura

**Elección recomendada:** Laravel estable soportado + PHP, Blade, Alpine.js, Tailwind CSS, TypeScript con Vite, Chart.js solo cuando aporte valor real y SQLite. Se puede usar PostgreSQL en el futuro sin rediseñar el dominio.

- **Backend Laravel:** páginas públicas, JSON de torneo publicado, formulario/panel de administración, validación, publicación versionada y subida segura de logotipos.
- **Frontend ligero:** Blade para estructura; Alpine.js para interacciones sencillas; módulos TypeScript para escenarios, resultados y motor. Evitar añadir React/Next.js sin justificación.
- **Motor independiente (`resources/ts/simulator/`):** código TypeScript puro, sin depender de Laravel, Alpine, DOM ni base de datos. Usa `Web Worker` para ejecutar lotes y no bloquear la interfaz.
- **Persistencia:** SQLite en un volumen persistente del servidor para torneos, equipos, fixture oficial y admin; `localStorage` solo para preferencias pequeñas e `IndexedDB` para escenarios y resultados locales que merezca conservar.
- **API pública mínima:** JSON de la **versión publicada**, cacheable con versión/ETag si encaja; ninguna ejecución de simulación se envía al servidor.
- **Autenticación:** sesiones Laravel, acceso de administrador únicamente, sin registro público.
- **Despliegue posterior:** Podman/Compose en Fedora; Docker Compose en VPS Ubuntu de Manairu. Mantener en desarrollo un entorno reproducible con PHP-FPM + Nginx y SQLite persistente; no introducir servicios innecesarios.
- **Pruebas:** Vitest para el motor, pruebas de aplicación Laravel (Pest/PHPUnit) y algunas verificaciones end-to-end de flujos prioritarios.

Organización orientativa, ajustable si Laravel ofrece una opción más idiomática:

```text
app/Domain/Tournament/       # validación y publicación del estado oficial
app/Http/Controllers/         # público/admin
app/Models/                  # torneos, equipos, fixtures, resultados, versiones
resources/views/             # Blade, páginas y componentes
resources/ts/simulator/      # motor puro, emparejamientos, PRNG, agregación
resources/ts/scenarios/      # estado local, validación, import/export
resources/ts/ui/             # worker, tablas, gráficos
resources/css/
tests/                       # pruebas PHP
tests/ts/                    # pruebas de simulación
compose.yaml
.env.example
README.md
```

## 3. Modelo de datos y estados

### 3.1. Torneo

Un torneo tiene `id`, `year`, `slug`, `name`, `format_version`, `status` y `published_revision`. Aunque la primera edición sea Worlds 2026, **no codificar equipos, pools ni año en el algoritmo**. El formato 2026 se define mediante configuración validada (16 participantes, 4 pools, reglas de avance, BoX). La reutilización en años posteriores podrá requerir nuevas versiones de reglas, no una generalización total en el MVP.

### 3.2. Equipo

- Identificador estable, nombre, acrónimo único dentro del torneo, región, *seed regional* (informativo para el MVP), **pool asignado explícitamente** y logo opcional. La fortaleza queda en un **perfil de fuerza versionado** asociado al equipo, no en un `power_score` anónimo de 0–100.
- El pool **nunca se deriva automáticamente** del seed; el administrador lo asigna. Validar cuatro equipos por pool en el formato 2026.
- Regiones 2026: `LCK`, `LPL`, `LEC`, `LCS`, `LCP` (Asia-Pacífico; no confundir con un identificador `APAC`) y `CBLOL`.
- **Cargar GPR de Riot 19-10-2026 en puntos originales**, para los 16 participantes; conservar `rating_snapshot_id`, fecha y enlace de origen. No actualizar silenciosamente mientras avanza Worlds.
- Cada perfil define GPR, categoría de consistencia (alta/normal/baja), sigmas de torneo/serie, presión, después de ganar/perder, ajuste de contexto, procedencia, confianza y revisión. Los parámetros *distintos del GPR* son experimentales hasta calibración.
- El visitante podrá modificar **perfiles localmente**, sin alterar datos oficiales; un GPR no es un porcentaje ni se convierte arbitrariamente desde 0–100.
- Escenarios creados durante el desarrollo con `power_score` 0–100 requieren versión `legacy-score-v1`, conversión explícita verificada o reset consentido. **Nunca** reinterpretar 50 como rating GPR.

### 3.3. Partido frente a serie

Usar conceptos distintos:

- **Game / partida:** victoria de A o B en una partida individual.
- **Match / enfrentamiento / serie:** Bo1, Bo3 o Bo5, vencedor cuando un equipo alcanza 1, 2 o 3 victorias de partida. Se almacena marcador de la serie, no solo ganador.
- **Swiss record:** victorias y derrotas de **series**, no de games. Un 2-1 en una Bo3 es **una** victoria suiza.
- **Knockout slot:** cuarto específico del cuadro para que las semifinales y la final se deriven de las posiciones del bracket sin volver a sortear.

Cada enfrentamiento oficial/hypotético tiene `id`, `stage`, `round`, `slot`, participantes, formato, estado (`scheduled`, `completed`), resultados de partidas si son conocidos y ganador calculado. Si únicamente conocemos el marcador final oficial, almacenar el marcador de serie sin inventar el orden de victorias por partida.

### 3.4. Estado oficial publicado vs borrador

El admin trabaja sobre un **borrador** y pulsa «Publicar cambios» cuando todo es válido. Cada publicación genera una **revisión inmutable** del estado oficial (snapshot JSON o tablas versionadas simples; escoger la solución más barata de mantener) con fecha, y publica de modo atómico. Conservar al menos historial recuperable de revisiones anteriores.

- *Partido oficial pendiente:* emparejamiento confirmado pero resultado desconocido.
- *Resultado oficial:* encuentro ya disputado con resultado fijado.
- *Sorteo futuro desconocido:* **no crear emparejamientos inventados** en los datos oficiales.
- Antes de publicar, recalcular records desde los enfrentamientos ya completados y detectar contradicciones (p. ej., sorteo incompatible tras corregir un resultado antiguo). Mostrar el conflicto y pedir corregirlo; no borrar datos o reordenar brackets automáticamente.
- Los escenarios locales guardan `base_revision`, una copia/snapshot necesario y sus propias modificaciones. Si el admin publica una revisión nueva, avisar con elección **«Actualizar escenario»** / **«Conservar versión anterior»**, sin alterar silenciosamente una simulación ya guardada.

### 3.5. Escenario local

Un escenario del visitante es una copia editable del torneo publicado, con:

- ID local, nombre, fecha, revisión base, parámetros de simulación, perfiles/GPR sobrescritos y valores de sorteos/resultados fijados.
- `source_mode`: `from_scratch`, `official_state` o `custom`.
- Semilla PRNG y número de simulaciones usado en la última ejecución.
- Estadísticas agregadas opcionales en IndexedDB para reabrirlas; validar versión de formato al importar.

**Inmutabilidad del dato real:** «oficial» significa una condición fijada en la publicación, nunca un valor editable bajo esa etiqueta. El visitante que cambie un resultado pasa a un escenario etiquetado claramente **«Hipotético»**.

## 4. Datos de inicio: Worlds 2026

Incluir un seeder **idempotente** de 16 equipos suizos, pools manuales, seeds y sorteo inicial oficial de 18 de octubre. **A 21 de octubre, sus ocho enfrentamientos todavía están pendientes; no precargar vencedores del suizo.** El Play-In ya terminó y **Karmine Corp** ocupa el puesto del ganador.

| Pool | Equipo | Acrónimo | Región | Seed |
|---|---|---|---|---:|
| 1 | Gen.G | GEN | LCK | 1 |
| 1 | Anyone's Legend | AL | LPL | 1 |
| 1 | Team Liquid Alienware | TLAW | LCS | 1 |
| 1 | G2 Esports | G2 | LEC | 1 |
| 2 | LOS | LOS | CBLOL | 1 |
| 2 | Team Secret Whales | TSW | LCP | 1 |
| 2 | Hanwha Life Esports | HLE | LCK | 2 |
| 2 | Bilibili Gaming | BLG | LPL | 2 |
| 3 | LYON | LYON | LCS | 2 |
| 3 | Movistar KOI | MKOI | LEC | 2 |
| 3 | T1 | T1 | LCK | 3 |
| 3 | TOP Esports | TES | LPL | 3 |
| 4 | CTBC Flying Oyster | CFO | LCP | 2 |
| 4 | Invictus Gaming | IG | LPL | 4 |
| 4 | Dplus Kia | DK | LCK | 4 |
| 4 | Karmine Corp | KC | LEC | 3 |

**Sorteo oficial R1 (todos Bo1, pendiente de disputarse):**

1. GEN — IG
2. HLE — TES
3. BLG — MKOI
4. AL — KC
5. G2 — DK
6. TLAW — CFO
7. LOS — T1
8. TSW — LYON

No es indispensable conservar este orden en el algoritmo, pero sí los emparejamientos y las posiciones oficiales publicadas cuando corresponda. Usar IDs estables, no acrónimos como claves de negocio.

## 5. Reglas del torneo — **criterios obligatorios de aceptación**

### 5.1. Fase suiza: 16 equipos

- Al empezar todos van `0-0`. Se juega como máximo cinco rondas.
- Tras alcanzar **3 victorias de serie**, el equipo queda clasificado y deja de participar en sorteos suizos.
- Tras alcanzar **3 derrotas de serie**, queda eliminado y deja de participar.
- Los emparejamientos de R2–R5 se forman **entre equipos con idéntico record** antes de jugar esa ronda.
- A partir de R2 se permiten regiones iguales.
- No repetir rival en suizo **si existe un sorteo completo válido sin repeticiones**. Si no existe, aplicar únicamente la excepción reglamentaria descrita en §5.3, sin relajar el resto de restricciones. El historial es de series jugadas, independientemente de si eran Bo1/Bo3.
- R1 y R2: ocho Bo1 cada una.
- R3: `2-0` y `0-2` juegan Bo3; `1-1` juega Bo1. Total R3: cuatro Bo3 y cuatro Bo1.
- R4: seis Bo3; R5: tres Bo3.
- En general, si **cualquier participante** puede alcanzar en el enfrentamiento su 3.ª victoria o su 3.ª derrota, la serie es Bo3. La decisión es del *record previo*, no del resultado eventual.
- Sorteos parciales futuros publicados se respetan exactamente; los desconocidos se simulan.

### 5.2. Sorteo de R1 desde cero

- Cuatro pools de cuatro: Pool 1 frente a Pool 4 y Pool 2 frente a Pool 3, cada equipo exactamente una vez.
- **Prohibidos enfrentamientos entre equipos de la misma región en R1**.
- Validar que la configuración permite un emparejamiento completo antes de comenzar.
- Cuando el usuario pide «Desde cero», el motor genera el R1 válido en cada iteración; cuando pide «Situación oficial», conserva el sorteo publicado. Una edición manual de R1 se trata como escenario hipotético.

### 5.3. Sorteos de R2–R5

- No elegir o eliminar un rival de forma codiciosa y quedarse luego sin completar la ronda.
- Implementar **emparejamiento completo con backtracking o programación dinámica por máscara de bits**, partiendo de los equipos elegibles y las restricciones, con posibilidad de pares bloqueados válidos.
- **Elegir uniformemente entre emparejamientos completos válidos** en cada grupo de record (no uniformemente entre elecciones locales sin ponderar; eso sesgaría los cuadros). Implementación simple: escoger un primer equipo determinista, enumerar rivales válidos, contar recursivamente terminaciones posibles para cada candidato con memoización y sortear con pesos proporcionales a esas cantidades. En R1 aplicar la variante bipartita pool A–B.
- Esta distribución es una **hipótesis estadística transparente**; Riot usa un procedimiento secuencial con ajustes de posición de extracción. No afirmar que se reproduce exactamente la distribución del sorteo físico.
- **Excepción reglamentaria de rivales repetidos (incluida en el MVP):** primero calcular los emparejamientos completos que cumplen todas las restricciones, incluida la prohibición de rematch. **Solo si no existe ninguno**, el simulador permitirá excepcionalmente rematches dentro del mismo grupo de record, manteniendo todas las demás reglas. Como hipótesis de simulación —no una decisión oficial de Riot— escoger los cuadros que **minimicen el número total de parejas repetidas**; si hay varios, muestrearlos uniformemente entre esas soluciones óptimas. Implementar búsqueda/DP que optimice primero el número de rematches y luego cuente/muestree las soluciones, sin decisiones codiciosas locales. No usar la excepción en R1 ni cuando ya existe un sorteo reglamentario sin repetición. La autoridad organizadora puede decidir cómo aplicarla en la realidad: explicar esta aproximación en la documentación.
- La excepción es **automática y transparente** en la simulación estándar: registrar por recorrido las rondas afectadas y el número de rematches excepcionales, incorporar una métrica agregada de frecuencia y marcarlo en el recorrido de ejemplo. No exigir al usuario un ajuste técnico ni interrumpir miles de simulaciones por este caso. Un modo estricto de diagnóstico puede existir solo en pruebas/desarrollo. No descartar o reintentar trayectorias en silencio porque sesgaría las probabilidades.
- Si un bloqueo impuesto manualmente provoca un grupo imposible **incluso aplicando únicamente la excepción de rematch**, impedir ejecutar el escenario e indicar el conflicto concreto. La excepción no autoriza a modificar sorteos o resultados bloqueados, emparejar distintos records, reutilizar equipos ni infringir restricciones de R1.

### 5.4. Resultados del suizo

Al finalizar la fase, cada una de las 16 escuadras tiene **exactamente uno** de los siguientes records:

| Record | Equipos exactos por torneo | Destino |
|---|---:|---|
| 3-0 | 2 | Clasifica a cuartos |
| 3-1 | 3 | Clasifica a cuartos |
| 3-2 | 3 | Clasifica a cuartos |
| 2-3 | 3 | Eliminado; puesto 9.º–11.º |
| 1-3 | 3 | Eliminado; puesto 12.º–14.º |
| 0-3 | 2 | Eliminado; puesto 15.º–16.º |

Los puestos de cada rango son **compartidos**, no inventar desempates ni asignar individualmente un 9.º, 10.º u 11.º.

### 5.5. Sorteo del knockout

- Ocho clasificados: dos `3-0`, tres `3-1`, tres `3-2`.
- Cada `3-0` se enfrenta en cuartos a un `3-2` distinto, y **cada emparejamiento `3-0`/`3-2` se coloca en una mitad distinta del cuadro**. Por tanto, los dos `3-0` no pueden encontrarse antes de la final.
- Los **cuatro restantes** (tres `3-1` y el `3-2` restante) se distribuyen aleatoriamente en los otros dos cuartos. No imponer ninguna otra restricción no escrita; sí puede haber rematches suizo–knockout.
- Permitir usar el sorteo de cuartos oficial cuando se publique. Si el resultado del suizo sigue condicionado, solo se puede fijar un cuadro cuando ya estén determinados los ocho clasificados.
- Los cuatro cuartos, dos semifinales y final son **Bo5, game a game**. No hay partido por el tercer puesto.
- Conservar ubicación en el bracket: las semifinales derivan de ganadores de cuartos de cada mitad, no de un nuevo sorteo.

### 5.6. Puestos finales

Son siete categorías exclusivas:

| Puesto/categoría | Número de equipos por simulación |
|---|---:|
| Campeón — 1.º | 1 |
| Subcampeón — 2.º | 1 |
| Semifinalistas — 3.º–4.º | 2 |
| Cuartofinalistas — 5.º–8.º | 4 |
| 9.º–11.º | 3 |
| 12.º–14.º | 3 |
| 15.º–16.º | 2 |

La suma de todos los equipos de cada simulación es siempre 16.

## 6. Modelo probabilístico — GPR de Riot + perfiles contextuales

**Fuente técnica normativa para Codex:** `WORLDS_2026_ANEXO_MODELO_ESTADISTICO_V2.md`. Leerlo íntegramente antes de modificar el algoritmo de simulación. En caso de discrepancia sobre ratings, calibración, consistencia, presión, momentum, posterior, versiones, datos y validaciones, **prevalece el anexo v2** sobre esta sección y cualquier implementación antigua 0–100. Las reglas del torneo de §5 siguen vigentes sin cambios.

### 6.1. Ratings y probabilidades por game

- Utilizar los **Global Power Rankings (GPR) de Riot**, con snapshot oficial fechado **19 de octubre de 2026** (16 equipos; ver anexo). No codificar las posiciones ordinales como distancia de fuerza.
- Por partida, dadas las fortalezas efectivas `R_A*` y `R_B*`:

```text
P(A gana) = 1 / (1 + 10 ^ ((R_B* - R_A*) / D))
```

- `D = 400` inicial es **provisional**, no una calibración garantizada para el GPR de Riot. Ajustarlo solo tras comparar predicciones con resultados históricos previos a la fecha prevista. No aplicar probabilidades mínimas arbitrarias de 5% ni multiplicadores regionales que duplican la información GPR.
- Sortear **cada game individualmente** con PRNG determinista; las Bo3 y Bo5 se resuelven por acumulación de victorias de games, no por una única tirada de serie.

### 6.2. Presets

| Preset | Fuerza efectiva | Estado |
|---|---|---|
| `gpr_baseline` | `GPR` solamente | **Predeterminado** hasta validación; referencia neutral |
| `contextual_v1` | `GPR + ajuste de contexto + forma del torneo + forma de serie + presión + transiciones` | Experimental, configurable, con procedencia visible |

**Forma estocástica**: `T_i~Normal(0, sigma_t_i²)` sorteado una vez por torneo y `S_i~Normal(0, sigma_s_i²)` una vez por serie. Ambos son por equipo, con media cero. Consistencia alta 20/10; normal 40/20; baja 65/30 puntos de rating (hipótesis sujetas a calibración). No volver a sortearlos en cada game. La clasificación de cada uno de los 16 equipos y todos sus parámetros están en el anexo y en `WORLDS_2026_STRENGTH_PROFILES_V2.json`.

**Presión:** ajuste Elo temporal proporcional a una intensidad de 0, 0.5 o 1, definida por estado decisivo del encuentro, no por una etiqueta psicológica. **Momentum y recuperación:** ajustes separados después de victoria o derrota *del game anterior de la misma serie*, todos inicialmente a 0. **Contexto:** TES -25 es hipótesis no activa hasta verificar el estado de la plantilla; no sumarlo al preset GPR. No añadir automáticamente «Worlds buff» encima de presión para justificar dos veces las mismas finales de T1.

**Imprevisibilidad:** control opcional para experimentar con `D=320/400/520`, etiquetando la variante como hipotética; **no** modificar al mismo tiempo las sigmas. Nunca presentar parámetros arbitrarios como mediciones oficiales de Riot.

### 6.3. Resultados reales y forma latente

- Las partidas oficiales completadas son **condiciones inmutables**: no se vuelven a jugar y no se reconstruye el orden de games desde un simple marcador.
- Con forma de torneo persistente, un resultado real también aporta evidencia sobre dicha forma. El modelo contextual que quiera representar un **pronóstico condicionado a partidas oficiales previas** debe muestrear la forma latente de una distribución **posterior** compatible con los resultados, con diagnóstico de convergencia/ESS y likelihood correcto, como describe el anexo v2. Si ese módulo no está implementado, usar GPR puro para el resultado oficial o identificar inequívocamente la alternativa contextual como *escenario prospectivo sin actualización de forma por el pasado*; no llamarla estimación posterior.
- Mantener el snapshot **pre-suizo** para evitar incorporar dos veces resultados del Mundial (una vez en el nuevo GPR y otra al condicionarlos en el simulador).

### 6.4. Fiabilidad, iteraciones y evidencia

- Semillas reproducibles y algoritmos versionados, parámetros completos y revisión de perfiles en cada informe. Más iteraciones reducen error Monte Carlo, **no** eliminan incertidumbre de parámetros o del modelo.
- Comparar siempre baseline frente a contextual mediante log loss/Brier, calibración, separación temporal y torneos posteriores fuera de muestra antes de promover coeficientes experimentales a predeterminados.
- Presiones, sigmas y ajustes iniciales de equipos son **propuestas con confianza limitada** derivadas de `WORLDS_2026_TEAM_CONTEXT_RESEARCH.md`; no hay un ajuste estadístico completo realizado a 21-10-2026. No vender resultados como probabilidades respaldadas por Riot.

## 7. Flujos públicos y experiencia de usuario

### 7.1. Página principal — entrada directa

Una sola página principal puede cubrir el uso habitual, con navegación mínima: **Simulador**, **Resultados**, **Equipos** (si es necesaria), y un enlace discreto «Admin». Priorizar la experiencia sobre el número exacto de páginas.

Cabecera concisa: nombre propio de producto, «Worlds 2026», y etiqueta «Simulador independiente». Debajo, selector claro:

1. **Estado oficial actual** — selección por defecto: respeta fixtures y resultados publicados; sortea y simula lo que falte.
2. **Desde cero** — sortea R1 y el resto del torneo, aunque exista sorteo oficial.
3. **Mi escenario** — crear una copia y personalizar restricciones, emparejamientos, ganadores y perfiles de fuerza.

Selector de modelo GPR/Contextual, ajustes avanzados opcionales de imprevisibilidad y selector de iteraciones: `1.000`, `10.000` por defecto, `50.000`, más una opción avanzada hasta el máximo seguro que permita el dispositivo. Acción principal **«Simular torneo»**. Mostrar progreso, opción cancelar y datos suficientes para saber qué se está calculando.

### 7.2. «Mi escenario» sin complejidad innecesaria

- Partir de **estado oficial**, **desde cero** o **duplicar escenario**.
- Tablas/tarjetas de emparejamientos por ronda con acción «Cambiar emparejamientos», «Fijar ganador», «Fijar marcador» y «Volver a sorteo aleatorio» donde tenga sentido.
- Mostrar badges textuales: **Oficial confirmado**, **Oficial pendiente**, **Fijado por ti**, **Simulado** y **Sin sortear**. Los estados deben seguir distinguiéndose sin color.
- Mostrar antes de ejecutar un resumen: «8 emparejamientos oficiales fijados · 0 resultados conocidos · el resto se sorteará».
- **Restricción deliberada del MVP:** solo permitir bloquear fixtures de una ronda posterior cuando todos sus participantes están determinados por resultados anteriores ya fijados. No introducir fixtures futuros imposibles en algunas iteraciones ni descartar escenarios que no los cumplan.
- El usuario puede mantener parcialmente fijados encuentros del **grupo actual**, dejando que el motor empareje el resto aleatoriamente.
- Si una restricción impide completar un sorteo, explicar qué ronda/record está afectado y qué bloqueo hay que retirar. No provocar errores crípticos.
- Guardar escenarios locales con nombre y fecha, renombrar/duplicar/eliminar, y exportar/importar JSON versionado. El navegador puede borrar ese almacenamiento: informar discretamente y recomendar exportación de los importantes.

### 7.3. Visualización de cuadro

**Suizo:** vista de cinco rondas en columnas o bandas visuales con grupos `0-0`, `1-0`, `0-1`, `2-0`, `1-1`, `0-2`, etc. Referencia de lectura: [Swiss Bracket — LoL Esports](https://lolesports.com/en-AU/tournament/115660540725177488/overview), sin copiar literalmente su diseño. Distinguir «situación real publicada» de «un ejemplo simulado». Poder inspeccionar en un torneo simulado los enfrentamientos, resultados de serie y games.

**Knockout:** cuadro clásico de cuartos → semifinales → final, con las dos mitades separadas, marcadores Bo5 y un ganador destacado. En pantallas estrechas, scroll horizontal accesible o vista por rondas; **no encoger todo hasta hacerlo ilegible**.

### 7.4. Tablas de probabilidades — contenido principal

**Tabla A — puesto final**, una fila por equipo, logo pequeño + acrónimo + región; columnas en este orden:

`1.º | 2.º | 3.º–4.º | 5.º–8.º | 9.º–11.º | 12.º–14.º | 15.º–16.º`

**Tabla B — suizo**, una fila por equipo:

`Clasifica | 3-0 | 3-1 | 3-2 | 2-3 | 1-3 | 0-3`

- Orden inicial: mayor probabilidad de **ser campeón** en A; mayor probabilidad de **clasificar** en B. Todas las columnas numéricas ordenables, con indicadores de dirección y filas estables.
- Filtrar por región, buscar equipo por nombre/acrónimo, mantener cabeceras claras. Resaltar moderadamente el equipo seleccionado y permitir ver su ficha ampliada.
- En móvil usar tabla desplazable con primera columna de equipo anclada **solo si funciona correctamente**, o filas/tarjetas detalladas por equipo. Evitar interfaces rotas y letras diminutas.
- Porcentajes con precisión sensata (p. ej. 1 decimal), manejo correcto de valores menores que el umbral visual y estado «Sin datos» antes de ejecutar.
- Encima de los resultados: escenario, revisión oficial de partida, preset/modelo, snapshot GPR, revisión de perfiles, iteraciones, fecha/hora y ratings usados. Las estimaciones nunca se etiquetan como «probabilidades oficiales».

**Estadísticas adicionales útiles del MVP, si no complican:** probabilidad de llegar a cuartos/semis/final, veces que queda 3-0, rivales más frecuentes en suizo, frecuencia de enfrentamientos y win rate de games/series **entre encuentros realmente simulados**, con denominador mostrado. **Registrar siempre la frecuencia de excepciones de rematch en el suizo** (simulaciones afectadas y número de series repetidas); presentar este indicador discretamente en la información de metodología. Permitir detalle por equipo. Métricas más sofisticadas y gráficos decorativos quedan para después.

**Vista de una simulación concreta:** con la misma semilla, ofrecer «Ver un torneo de ejemplo» para recorrer un cuadro completo. **No** confundir su recorrido con la moda o media de los miles de resultados.

### 7.5. Comparación (fase posterior opcional)

Comparar **GPR vs Contextual** o escenario **«Desde cero»** vs **«Sorteo oficial»**, o escenarios A/B: diferencia en puntos porcentuales de clasificación y campeonato por equipo. Es una funcionalidad interesante para el producto, pero no debe bloquear el MVP. Mostrar contexto de modelo/semillas e incertidumbre por muestreo; evitar afirmar causalidad fuerte o atribuir toda diferencia al sorteo si también varían GPR o parámetros contextuales.

### 7.6. Estilo visual

- Oscuro por defecto; fondo antracita/casi negro y superficies de contraste contenido; tipografía legible, tarjetas sobrias y separación generosa.
- Paleta de acento original y moderada (p. ej. cian/azul profundo o dorado suave). Evitar efectos de brillo excesivos, neones, degradados intensos y estética genérica de «landing de IA».
- Logos pequeños si existen y están autorizados, con fallback elegante de iniciales. Nunca depender de imágenes para entender resultados.
- Animaciones mínimas; buen feedback de loading y progresos, accesible por teclado y respetuoso con reducción de movimiento.
- **Internacionalización obligatoria desde el inicio:** español e inglés en toda la interfaz, incluido el panel admin, mediante el anexo `WORLDS_2026_ANEXO_I18N_EN_ES.md`. Sus reglas prevalecen sobre cualquier mención anterior a un único idioma.

## 8. Panel privado de administración

Solo accesible tras login de admin. No existe registro ni perfil público.

1. **Equipos:** alta/edición/orden, región, seed, pool **manual**, acrónimo, logo y **perfil de fuerza GPR/contextual versionado** (fecha/fuente, consistencia, presión, transiciones, ajuste, confianza). Importación/exportación de valores por JSON/CSV opcional. Mostrar inconsistencias entre la configuración 2026 y los requisitos del sorteo antes de publicar.
2. **Torneo y R1:** vista clara de pools y sorteo oficial. Crear/editar fixtures validados.
3. **Resultados y sorteos posteriores:** introducir emparejamientos recién sorteados, y después resultado/marcador por serie (Bo1, Bo3 o Bo5). Se conoce el formato por estado previo; no permitir resultados incompatibles. Puede haber fixtures pendientes mezclados con completados, si la ronda y estado lo permiten.
4. **Cuadro eliminatorio:** introducir sorteo real de cuartos cuando exista, luego resultados de cuartos, semifinales y final.
5. **Publicación:** previsualizar diferencias, validar invariantes y publicar una revisión completa. Exponer revisión y fecha en interfaz pública.
6. **Historial:** recuperar/inspeccionar revisión anterior, al menos como copia para corregir una publicación errónea; no alterar revisiones publicadas ya existentes.

El admin debe poder gestionar resultados sin tocar PHP, seeders, JSON de producción ni consola del VPS.

## 9. Motor Monte Carlo: entradas, ejecución y agregación

### Contrato conceptual

```ts
interface SimulationRequest {
  modelVersion: 'gpr-context-v2';
  snapshot: TournamentSnapshot; // versión y reglas
  scenario: ScenarioConstraints; // resultados/fixtures bloqueados
  strengths: StrengthProfileSet; // snapshot GPR, perfiles y procedencia congelados
  preset: 'gpr_baseline'; // contextual_v1 se incorpora en el hito contextual
  denominator?: number; // sensibilidad explícita; 400 provisional por defecto
  gprOverrides?: Readonly<Record<TeamId, number>>; // puntos GPR, sin normalizar
  iterations: number;
  seed: number;
}

interface TeamAggregates {
  swissRecordCounts: Record<SwissFinalRecord, number>;
  finishCounts: Record<FinalBucket, number>;
  matchesPlayed: number;
  gamesPlayed: number;
  // Datos de rivales/encuentros solo si resulta barato agregarlos.
}
```

Los tipos reales deben ser estrictos y no permitir estados incoherentes. En el núcleo **no usar estado mutable global entre iteraciones**; cada torneo se inicia a partir del snapshot y escenario fijo. La aleatoriedad debe venir del generador inyectado.

### Flujo por iteración

```text
validar snapshot y locks
para cada iteración:
  crear estado fresco de 16 equipos
  cargar resultados oficiales/hipotéticos fijados y fixtures conocidos
  si R1 no está fijada: sortear emparejamientos válidos por pools/región
  por ronda suiza:
    usar fixtures bloqueados válidos y completar los que falten por sorteo
    simular games hasta completar la serie (salvo resultados fijados)
    actualizar W-L de series e historial de rivales
    retirar clasificados y eliminados
  validar 2x3-0, 3x3-1, 3x3-2 y 3x2-3, 3x1-3, 2x0-3
  sortear cuartos con 3-0 vs 3-2 opuestos o respetar cuadro fijado
  simular cuatro cuartos, dos semis y final (Bo5)
  contar UN puesto final y UN record suizo por equipo
  acumular estadísticas sin conservar todas las iteraciones en RAM
mostrar agregados, metadatos y torneo de ejemplo reproducible
```

**Imprescindible:** al partir de la situación oficial, no tratar un marcador conocido como aleatorio ni recomputar su ganancia; sí contar su existencia al calcular records y posibles rivales. Si los datos oficiales incluyen enfrentamientos de rondas anteriores, reconstruir correctamente la secuencia.

**Rendimiento:** Web Worker, lotes con progreso y cancelación, no enviar miles de trayectorias al hilo principal. Objetivo orientativo de UX: poder ejecutar 10.000 iteraciones de forma cómoda en portátil normal; medir antes de imponer un límite preciso. Controlar máximo de iteraciones por ejecución y tamaño de resultados guardados. Optimizar primero la agregación y el sorteo, no introducir WASM/Python/servicios externos sin una necesidad medida.

### Agregación y probabilidades

- Probabilidad estimada `100 * contador / iteraciones_completadas`.
- Clasificación suiza = suma de `3-0`, `3-1`, `3-2` para cada equipo.
- Cada fila de puestos finales suma 100 % sin redondear; cada fila de records suizos también.
- Los totales de **puestos** sumados entre los 16 equipos deben equivaler a `1,1,2,4,3,3,2` plazas por simulación; los de **records** a `2,3,3,3,3,2`.
- Para estadísticas cara a cara, separar `frecuencia de emparejamiento` de `win rate **condicionado a que se enfrentaron**`; acompañar de número de series/games observados. No calcular win rate con enfrentamientos inexistentes en el denominador.
- Mostrar número de iteraciones y, idealmente, incertidumbre del muestreo para eventos destacados (intervalo binomial Wilson 95 %; no confundir con incertidumbre del modelo). No vender falsas décimas de precisión.

## 10. Seguridad, privacidad y consideraciones de marca

- **Login admin solamente:** Laravel session + CSRF, throttle de intentos, cookies seguras, hash de contraseñas, auth middleware y autorización server-side en **cada** ruta mutadora. Cuenta admin creada mediante comando local seguro o variable temporal de bootstrap, sin credenciales por defecto ni secret en el repo.
- **Subida de logos:** aceptar solo tipos y tamaños limitados tras validación real; normalizar nombre; almacenar fuera de rutas ejecutables; preferir PNG/JPEG/WebP y evitar SVG subido sin saneado riguroso. Límite de tamaño, placeholders.
- **Entrada local:** esquema JSON estricto con validación de límites/tamaños; ninguna interpolación insegura de HTML; no usar JSON importado para peticiones administrativas.
- Cabeceras de seguridad razonables, escapes Blade, `APP_DEBUG=false` en producción, TLS tras reverse proxy, no exponer `.env`, base SQLite ni backups.
- **Sin seguimiento por defecto** y sin transmisión de escenarios personales: simulaciones y preferencias quedan en el navegador. No cookies no esenciales ni analíticas sin una decisión explícita.
- Endpoints públicos de lectura con políticas de caché/versionado; rutas admin no cacheables por proxy.
- **Identidad de producto 100 % propia:** nombre, dominio, favicon, logotipo, tipografía, paleta, ilustraciones y composición originales, inspirados en e-sports de manera genérica. No llamar al producto con un nombre que parezca oficial o utilice marcas de Riot como identidad comercial; los nombres *League of Legends* y *Worlds* podrán aparecer **solo como referencias informativas al torneo analizado**, con el debido contexto, no como logotipo ni identidad de producto. No copiar layouts característicos de LoL Esports.
- **Activos visuales conservadores para el MVP:** nada de logotipos de Riot/Worlds/League of Legends, ilustraciones de campeones, splash arts, capturas del juego, vídeos ni recursos de Riot obtenidos de forma no autorizada. Equipos representados por nombre/acrónimo y un monograma original neutro de respaldo. No descargar ni redistribuir automáticamente escudos/logos de los equipos; activar cada logo solo tras comprobar permiso/licencia aplicable (los derechos de los clubes son independientes de Riot). Un upload de admin no acredita por sí mismo derechos de publicación.
- **Aviso y política aplicable:** hacer visible en footer y pantalla «Acerca de» que es un simulador **independiente y no oficial, sin respaldo ni patrocinio de Riot Games**. Antes de publicar, contrastar el texto de aviso requerido y las condiciones vigentes en la [política de proyectos de fans de Riot](https://www.riotgames.com/es/legal) y, si procede, las [políticas generales para productos de desarrolladores](https://developer.riotgames.com/policies/general). Riot establece restricciones sobre el uso de sus marcas e identidad; el aviso no sustituye una licencia ni concede derechos. Proyecto gratuito, sin apuestas, premios ni monetización en el MVP. Si se decide usar su API o recursos en el futuro, revisar registro, permisos y reglas específicas **antes** de integrarlos. No asumir que hace falta una API o un registro para el prototipo puramente local.
- **Sin funcionalidad de apuestas** ni consejos relacionados con ellas.

## 11. Pruebas obligatorias e invariantes

### Unitarias del motor

- Ratings efectivos iguales => probabilidad de game 50/50; p(A,B)+p(B,A)=1; al subir GPR de A nunca disminuye su probabilidad. Diferencia de 400 con D=400 => 10/11 (≈90,91 %) de game, conforme a la fórmula Elo.
- Con mismos inputs/semilla **y versión del motor**, resultados bit a bit equivalentes; distinta semilla habitualmente da recorridos diferentes. GPR baseline ≡ contextual con todos los términos desactivados.
- Una Bo1/Bo3/Bo5 termina respectivamente al alcanzar 1/2/3 victorias, sin partidas extra; la serie reporta ganador y marcador coherente.
- Primer sorteo: cada equipo aparece una vez, parejas 1↔4 y 2↔3, sin misma región. Miles de draws para detectar infracciones.
- R2–R5: solo records idénticos, sin rematches cuando existe un sorteo completo sin ellos, ninguna plaza duplicada; fixture parcial respetado. Si una ronda es estrictamente imposible, fallback que **minimiza** rematches; comprobar que nunca aplica un rematch si hay cualquier matching sin repetición.
- Casos fabricados con rival aparentemente válido que impide completar la ronda: backtracking encuentra alternativa o reporta imposibilidad (no fallo aleatorio silencioso).
- Sampler pequeño con posibles matching desiguales: prueba estadística de uniformidad, con tolerancias razonables y semilla fija para reproducirla (además de tests deterministas de recuentos combinatorios).
- Escenarios sin solución ni siquiera con la excepción: error explícito; nunca generar trayectorias incompletas ni incluirlas en el denominador. Contar la frecuencia de excepciones y comprobar su reproducibilidad con la semilla.
- Conteos exactos de records al acabar suizo: `2/3/3/3/3/2`.
- Cuartos: ambos `3-0` ante `3-2` y en mitades distintas; resto cuatro distribuidos correctamente; knockout sin rematches prohibidos solo por haber existido antes (aquí sí están permitidos).
- Finales: siete buckets con conteos `1/1/2/4/3/3/2`, sin tercer puesto separado.
- Si se fijan fixtures y resultados oficiales de todo el torneo: todas las simulaciones dan el mismo resultado final **independientemente de GPR, modelo, consistencia o semilla**.
- Escenario oficial parcial: nunca sobrescribe un resultado fijo; escenario hipotético cambia solo copia local.
- Acumuladores agregados suman correctamente después de N simulaciones; suma exacta y sin NaN/Infinity.

### Backend y UX

- Admin no autenticado no puede crear/modificar/publicar; usuario invitado puede acceder y simular sin sesión. El resultado publicado lleva versión de GPR/modelo/perfil.
- Un logo inválido, resultados incoherentes o un sorteo imposible no se publican.
- Las correcciones de resultados que invaliden sorteos posteriores generan errores claros antes de publicar.
- Escenario guardado sobrevive a recargar página, se puede duplicar/exportar/importar, y señala revisión antigua.
- Cancelación del worker no deja resultados etiquetados falsamente como ejecución completa.
- Responsive en móvil de 360 px aprox., tablet y escritorio; foco visible, controles táctiles cómodos, tablas entendibles y sin scroll horizontal de toda la página.

## 12. Plan de trabajo incremental — **seguir en este orden**

### Fase 0 — Bootstrap verificable

- Crear Laravel, Vite/TypeScript, Tailwind, Alpine, configuración Podman/Docker Compose y README de arranque local.
- Estructura de módulos, tests funcionando y seeder con 16 equipos/8 fixtures; primera vista pública simple y legible.
- No desarrollar todo el simulador en el primer commit.

### Fase 1 — Dominio y motor de torneo (prioridad absoluta)

- Tipos, states, función de probabilidad por game **GPR Elo (D=400 provisional)**, series BoX, fixtures y records.
- Sorteo de R1 y sorteos posteriores con matching completo válido; knockouts y posiciones finales.
- Tests exhaustivos sin UI. Exponer una CLI de test o script Node local pequeño para 1.000/10.000 simulaciones (útil para validar rápidamente el motor, **sin añadir producto CLI público**).
- No empezar gráficos/estilos sofisticados hasta que las invariantes se cumplan.

### Fase 1B — Modelo contextual, sin romper el trabajo existente

- Revisar campos `power_score` heredados y migración explícita; importar snapshot GPR 19-10-2026; definir `StrengthProfile` y presets.
- Aplicar el **anexo estadístico v2**: forma de torneo/serie, presión, después de ganar/perder, ajuste documentado, tests de equivalencia con baseline. Mantener ajustes subjetivos separados, reproducibles y desactivables.
- Si hay resultados oficiales conocidos y el posterior contextual todavía no está desarrollado, el pronóstico oficial predeterminado permanece en GPR puro y el contextual se etiqueta como escenario prospectivo. Implementar el posterior y calibración offline por pasos, sin bloquear el uso neutral.

### Fase 2 — Simulador público funcional

- Selector de origen, modelo GPR/Contextual, ajustes de perfil si corresponde, N, botón ejecutar, worker, progreso y cancelación.
- Agregados y dos tablas principales, muestra de un recorrido completo.
- Diseño oscuro, limpio y responsive. UI realmente utilizable sin admin.

### Fase 3 — Escenarios personalizados

- Copiar/editar R1, fijar fixtures/resultados de rondas determinables, respetar reglas, guardar local, duplicar y exportar/importar.
- Validaciones y mensajes claros; evitar que el usuario vea estados imposibles.

### Fase 4 — Administración y actualización oficial

- Autenticación admin, CRUD de equipos, gestión de emparejamientos y resultados, revisión/publicación atómica, historial.
- Publicación de nuevos sorteos reales, refresco de visitantes y notificación de escenarios basados en revisión anterior.

### Fase 5 — Pulido de portfolio y preparación de despliegue

- Verificar accesibilidad, móviles, rendimiento, métricas adicionales, README profesional, ejemplos y disclaimer legal.
- Contenedores y configuración de VPS de Manairu, backups SQLite y de logos, configuración de proxy/TLS, CI/CD **cuando se decida desplegar**, no anticiparlo con servicios complejos.
- Dejar «Factor Worlds» y comparador como mejoras opcionales si todo lo esencial está consolidado.

**Para cada fase:** implementar un cambio pequeño, escribir/actualizar pruebas, ejecutarlas y documentar lo conseguido, lo pendiente y cómo validarlo manualmente. No solicitar decisiones al usuario por detalles triviales: elegir la solución más usable y simple y explicar desviaciones relevantes.

## 13. Git, calidad de repositorio y CI/CD

- Crear `development` como rama principal de integración. Trabajar en ramas `feat/*`, `fix/*` y `chore/*` cortas, con merges revisables; `main` reservada para versiones listas de publicar si se necesita.
- Mensajes de commit naturales y concretos, p. ej. `feat: implement Swiss pairing validation`, `test: cover knockout draw constraints`; sin menciones a Codex, OpenAI ni generación automática en ramas, títulos o commits. No atribuir autoría falsa ni falsificar metadatos.
- No dejar secretos, tokens, dumps, assets sin licencia, archivos temporales ni documentación propia del asistente en el historial.
- Evitar pushes innecesariamente frecuentes: **agrupar cambios relacionados y espaciar los pushes** para no disparar pipelines y evitar errores por límites de solicitudes en CI/CD. Nunca crear bucles automáticos de push; preferir correr tests localmente antes de cada push.
- La rama y forma de trabajo deben estar documentadas en README con pasos de Fedora/Podman y VPS/Docker. No implementar CI/CD hasta que la base sea estable y se decida el despliegue.

## 14. Definición de terminado del MVP

Un invitado abre la web sin login, elige **estado oficial** (los ocho fixtures R1 conocidos), modelo GPR base y 10.000 simulaciones; obtiene estadísticas coherentes sin bloquear la pantalla, con progreso y sin errores de reglas. Puede comparar mentalmente el resultado con **desde cero**, donde cada iteración realiza un sorteo R1 nuevo. Puede crear un **escenario hipotético**, cambiar un enfrentamiento válido, fijar un ganador, volver a simular y guardar localmente el escenario. Puede inspeccionar un recorrido de ejemplo y las tablas de probabilidades.

El admin accede a un panel protegido, registra un sorteo real y sus resultados, publica una revisión válida y desde ese momento las simulaciones públicas **respetan lo sucedido sin volver a simularlo**. Tests verifican cantidades, emparejamientos, series y resultados finales. La interfaz es agradable en móvil/escritorio y el proyecto funciona localmente en Fedora con Podman.

## 15. Fuentes reglamentarias y referencias

1. [2026 World Championship Event Specific Ruleset — Riot Games (PDF oficial, v1.01)](https://cdn.sanity.io/files/dsfx7636/news_live/faa5ce974e58615911fbee931c6123e2785a8b46.pdf): especialmente secciones 4.1 (fases/puestos), 4.3 (sorteos y excepciones), Appendix A.
2. [Worlds 2026 Primer — LoL Esports](https://lolesports.com/en-GB/news/worlds-2026-primer): participantes, pools, reglas generales y calendario.
3. [Calendario y R1 — LoL Esports](https://lolesports.com/en-US/leagues/lcs,lec,lck,lpl,worlds): partidos publicados y final del Play-In.
4. [Worlds Standings / Swiss Bracket — LoL Esports](https://lolesports.com/en-AU/tournament/115660540725177488/overview): referencia de lectura del cuadro, **no una orden de copiar su diseño**.
5. [Riot Games Developer Portal — League of Legends](https://developer.riotgames.com/docs/lol) y [Política de proyectos de fans](https://www.riotgames.com/es/legal): revisar identidad, logos, aviso de no afiliación y obligaciones del producto antes de publicar.

**Nota reglamentaria importante:** El documento oficial contempla la posibilidad de que los organizadores levanten la prohibición de rematches en un caso excepcional sin sorteo posible. El simulador **aplicará automáticamente y de forma transparente** una aproximación conservadora (mínimo número de rematches necesarios) y la registrará en las métricas; esta elección estadística **no equivale a una decisión oficial de Riot**. Igualmente, el muestreo uniforme de cuadros válidos es una decisión del modelo matemático, no una reproducción exacta del sorteo televisado. En materia de imagen, la opción segura por defecto es una identidad independiente **sin recursos visuales de Riot** y sin escudos de terceros de licencia no verificada.

## 16. Anexos obligatorios y precedencia documental

El modelo y la UX se detallan en los siguientes documentos del repositorio (mantener juntos dentro de `docs/`):

1. `WORLDS_2026_ANEXO_MODELO_ESTADISTICO_V2.md` — fuente normativa del motor probabilístico, perfiles, incertidumbre, condicionamiento por resultados reales y plan de calibración. **Reemplaza enteramente cualquier receta anterior de ratings 0–100.**
2. `WORLDS_2026_STRENGTH_PROFILES_V2.json` — datos semilla GPR + atributos de los 16 equipos, marcados explícitamente como experimentales; asociar por acrónimo/ID verificando correspondencia, no por orden de filas.
3. `WORLDS_2026_TEAM_CONTEXT_RESEARCH.md` — antecedentes y enlaces de investigación; referencia cualitativa, **no validación estadística**.
4. `WORLDS_2026_ANEXO_UX_SIN_METATEXTO.md` — UX sin subtítulos redundantes.
5. `WORLDS_2026_ANEXO_I18N_EN_ES.md` — internacionalización ES/EN en todas las pantallas.

Orden de decisión: **normativa oficial del torneo y reglas §5** para sorteos; **anexo estadístico v2** para ratings y simulaciones; **anexos UX/i18n** para presentación. No rehacer pantallas correctas, no introducir servicios externos solo para calcular probabilidades y no cambiar arbitrariamente decisiones previas sin verificar su impacto en tests y datos locales.

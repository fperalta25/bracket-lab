# Worlds Simulator — Anexo técnico v3: predicción contextual basada en datos

> **Revisión:** 3 · **Fecha de corte de producto:** 21-10-2026 (antes del suizo del 23-10-2026).  
> **Estado:** especificación para Codex; **el modelo v3 NO está entrenado ni validado todavía**.  
> **Ámbito:** datos históricos, estimación de fuerza, forma reciente, plantilla, historial internacional, metajuego, efectos de serie, condicionamiento por resultados conocidos, validación y despliegue de parámetros ligeros.  
> **Precedencia:** sustituye los criterios de estimación y promoción del modelo contextual v2. Conserva el anexo estadístico v2 como contrato de reglas Monte Carlo, GPR baseline, PRNG, simulación game-by-game, tratamiento de resultados oficiales, perfiles experimentales y pruebas **donde no contradiga explícitamente este documento**. Los anexos UX/i18n y las reglas oficiales del torneo siguen vigentes.

## 0. Resultado buscado

Una simulación debe estimar probabilidades realistas **antes de los encuentros** sin confundir «interesante» con «predictivo» ni asignar al equipo una personalidad inventada. GPR es la referencia; el contextual aprende qué información adicional es útil. El usuario público no necesita entender coeficientes; el admin ve origen y calidad, puede congelar snapshots, cargar un artefacto validado y configurar ajustes evidenciados.

**Se mantienen tres presets con roles distintos:**

| `preset_id` | Qué significa | Estado inicial / publicación |
|---|---|---|
| `gpr_baseline` | GPR fechado + transformación Elo; sin modificadores, forma ni datos futuros | **Predeterminado**; `D=400` provisional hasta calibrar |
| `contextual_experimental_v2` | GPR + sigmas/bonos hipotéticos de `STRENGTH_PROFILES_V2.json` | Opcional, **experimental**; nunca llamarlo calibrado |
| `contextual_trained_v3` | GPR + características contextuales + proceso latente + coeficientes aprendidos y auditados | **No disponible** hasta superar validación temporal y compatibilidad del artefacto |

- No publicar un preset entrenado simplemente por haber ejecutado un notebook. Si no supera controles, conservar la referencia. No hacer que la etiqueta `contextual_v1` antigua se interprete silenciosamente como v3.
- Los coeficientes experimentales v2 de presión y ajustes de TES **NO** se suman a coeficientes v3 aprendidos. Son modelos alternativos. Buffs manuales del usuario pueden aplicarse en modo escenario hipotético, **aislados**, con trazabilidad.
- No sustituir la arquitectura Blade/Laravel/Alpine/TS ni la web pública por un backend de ML. Mantener la UX sin metatextos y traducciones ES/EN completas.

## 1. Problema estadístico y diseño de predicción

La variable objetivo primaria es **ganar una partida profesional** (game), no el ganador de la serie. Los torneos y las series Bo1/Bo3/Bo5 se derivan simulando cada game con el motor de torneo existente. Cada ejemplo debe representar **solo información disponible antes de que ese game empiece**.

### 1.1. Score probabilístico

Para equipos A y B en instante previo `t`:

```text
logit[P(A gana game)] =
    log(10) * (GPR_A(t) - GPR_B(t)) / D
  + beta_form   * (FORM_A(t) - FORM_B(t))
  + beta_roster * (ROSTER_A(t) - ROSTER_B(t))
  + beta_history* (HISTORY_A(t) - HISTORY_B(t))
  + beta_patch  * (PATCH_FIT_A(t) - PATCH_FIT_B(t))
  + beta_series * SERIES_CONTEXT(A,B,t)
  + PAIR_INTERACTION(A,B,t)
  + (LATENT_A(t) - LATENT_B(t))
```

**Es una familia de modelos, no la obligación de incluir todos los términos.** Empezar por GPR y añadir bloques solo si aportan predicción fuera de muestra. Para no contar dos veces el pasado ya absorbido por GPR, los predictores de forma/historia son **innovaciones residuales o covariables incrementalmente validadas frente al GPR contemporáneo**. Regularizar los coeficientes y registrar su incertidumbre. Los datos no demuestran por sí solos causalidad psicológica.

- Usar función logística numéricamente estable, diferencias antisimétricas y probabilidades complementarias. No incluir un intercepto que dependa arbitrariamente del orden A/B.
- `D` se estima para la base GPR cuando existan GPR históricos fechados; 400 sigue provisional. No ajustar `D` sobre el test final.
- No equiparar el 80/20 Elo equipo/región que describe Riot con una conversión oficial a probabilidades: el divisor del producto es nuestro parámetro.
- Si falta GPR histórico fiable, **no** usar el valor de octubre de 2026 para entrenar/validar encuentros antiguos. Construir una referencia Elo propia calculada secuencialmente usando solo partidos pasados; registrarla como `internal_elo_baseline`, **no** mezclar sus unidades con GPR ni presentar una comparación como si los datos fueran idénticos.
- No sumar efectos de «LCK > LEC» si el GPR ya representa región; un término regional adicional solo tras una mejora demostrada fuera de muestra, priorizando regularización fuerte.

### 1.2. Cuatro horizontes de rendimiento: evitar conceptos mezclados

| Horizonte | Naturaleza | Uso |
|---|---|---|
| Estructural (semanas/meses) | GPR / fuerza dinámica histórica | Priorización principal |
| Reciente (semanas) | Desviación respecto a lo esperado, condicionada a rival, roster, parche y fecha | Covariable estimada pre-game |
| Estado de torneo (días) | Forma latente persistente, incertidumbre compartida entre partidas | Muestrear al iniciar la simulación y actualizar por resultados conocidos |
| Estado de serie (horas) | Forma de ese BoX, marcadores, rachas y draft acumulado | Cambio antes de cada game de la misma serie |

No introducir una quinta variación aleatoria independiente por game además del sorteo Bernoulli. Si se usa un proceso de estado latente y también las sigmas v2, deben estar integrados en un **único** modelo calibrado, nunca sumarse sin control. La consistencia es varianza residual condicional, no «lo bueno o malo que es un equipo».

## 2. Fuentes, corte y auditoría de datos

**Fuentes candidatas, comprobadas el 21-10-2026**:

- `https://chaincc.lol/free/data/`: dataset ChainCC bajo **CC BY 4.0**, CSV `.gz` por temporada, dos filas por partida en el archivo de equipos y diez por partida en el de jugadores. Contiene, según la fuente, fecha, liga, split, parche, equipo, side, picks/bans y estadísticas por jugador. Atribuir proveedor en el producto/documentación si se usan sus datos.
- Riot GPR: `https://lolesports.com/es-MX/gpr/2026/current`, snapshot **19-10-2026**, más instantáneas históricas **únicamente si son recuperables y verificables por fecha**. El diario de desarrollo del 24-09-2024 describe el diseño histórico, no una calibración de este simulador.
- Riot Worlds 2026 primer/rules: calendario y reglamento como fuente superior del formato.
- Oracle's Elixir / Games of Legends / Liquipedia: fuentes auxiliares **con licencia, calidad y términos revisados**. No asumir que todo lo visible se puede redistribuir o scrapear masivamente.

**Limitación de esta entrega:** no se ha descargado ni inspeccionado localmente el CSV completo; la estructura exacta debe comprobarse en el primer paso del pipeline. No codificar nombres de columnas supuestos hasta inspeccionarlos. El archivo más reciente puede cambiar con nuevos partidos de Worlds: fijar **hash SHA-256 de descarga, fecha UTC, fuente y filtro `event_time < cutoff`**. Nunca confiar únicamente en la fecha del archivo.

### 2.1. Contrato canónico mínimo

Cada game completado produce **una sola fila de matchup**, no dos ejemplos de equipo que dupliquen el resultado. Mantener orden canónico de `team_a_id` y `team_b_id`; `win_a ∈ {0,1}`. Campos recomendados:

```text
GameRecord:
  game_id, series_id, event_start_utc, league_id, event_id, event_stage,
  patch_id, roster_a_id, roster_b_id, team_a_id, team_b_id,
  game_number, best_of, score_a_before, score_b_before,
  is_international, win_a,
  [blue_side_team_id], [picks/bans], [roster/player IDs], source_provenance
```

- Conocer `game_number` y orden es obligatorio para analizar efectos dentro de una serie; si no está disponible, **no** inventarlo ni usar esa observación en la submuestra de momentum.
- Equipos: mapa de alias por fechas, fusiones/renombres y región vigentes a la fecha. Jugadores: identificadores estables/aliases, alineación efectiva de cada game, no la plantilla actual extrapolada al pasado.
- Emparejar ChainCC equipos **por `game_id` con dos lados distintos** y jugadores con `game_id + side`; verificar dos equipos, diez jugadores para juegos completos y ausencia de duplicados. Si falta cobertura, registrar y aislar.
- Guardar `recorded_at` y `available_at` cuando importe la disponibilidad de un dato; resultados de una partida solo están disponibles para predicciones posteriores.
- Game y serie son entidades distintas: agrupar cada BoX y fijar su outcome a posteriori, no usar el marcador final como feature de games anteriores.
- Estadísticas `kills/gold/dragons/GD15` del **game objetivo** son post-resultados: **PROHIBIDAS** como features pregame; solo pueden agregarse en ventanas de partidas anteriores con fecha y roster adecuados.
- Cambios de roster, meta, parches y declaraciones públicas: almacenar fecha de anuncio y fecha efectiva; no usar hechos comunicados posteriormente como explicación previa.

### 2.2. Corte y archivos

```text
data/raw/<provider>/<season>/<retrieval_hash>.csv.gz   # solo procesamiento local, no commitear datasets grandes
 data/curated/games.parquet                            # salida reproducible, local/ignorada por Git
 models/reports/<run_id>/metrics.json                  # guardar resultados de evaluación
 models/artifacts/<model_id>.json                      # artefacto pequeño, validado y publicable
```

Crear comandos CLI idempotentes `download --as-of`, `audit`, `build-features`, `train`, `evaluate`, `export`. Si la descarga en ese entorno falla, reportar el bloqueo y permitir importar un archivo local; **no inventar análisis numéricos**. `sources.lock.json` referencia fuente, licencia, versión, corte, conteos, hash y regla de uso. No cron ni scraping en producción.

## 3. Ingeniería de características: orden de investigación

Cada bloque debe contar con `as_of_utc`, cobertura por equipo y un estado `missing/observed/estimated`. Faltantes no significan 0; imputación y disponibilidad se aprenden **solo con train** y se incluyen como indicadores si procede. Promover bloques únicamente con calidad y mejora verificadas.

### 3.1. Fortaleza y forma reciente

1. Base GPR con snapshot anterior al encuentro (si existe); como alternativa explícita, Elo propio pre-game basado en histórico.
2. Para forma reciente usar predicciones pasadas de una referencia **out-of-fold temporal**: residuo `y - p_pre_game`, agregado por equipo en 14/30/60 días o EWMA con vida media aprendida. Distinguir series frente a games para que un Bo5 no multiplique injustificadamente el peso de un evento; experimentar con ponderación por torneo y correlación de games.
3. Controlar fortaleza del rival, forma/tipo de torneo, parche y estabilidad de plantilla. Medir también inercia de estadísticas de games **anteriores** (early game, dominio), solo si mejoran OOT.
4. Reducir hacia 0 (`shrinkage`) el indicador de equipos con pocas partidas recientes; no declarar a un equipo de región menor «volátil» solo por tener menos encuentros internacionales.
5. Evitar derivar una forma residual a partir de un GPR de fecha posterior al game. Si el proveedor no ofrece histórico, entrenar sobre el Elo temporal propio y conservar GPR 19-10 como punto de partida del pronóstico de Worlds; verificar la compatibilidad de escalas.

### 3.2. Plantilla y circunstancias

- Una entidad `RosterSnapshot` identifica los cinco jugadores activos, suplentes efectivos si aplica, staff solo si hay evidencia y fecha de vigencia. `roster_continuity`: proporción de **jugadores actuales que compartieron realmente los games históricos**, preferiblemente ponderada por rol y recencia. No es sinónimo de fuerza.
- `roster_change_recent`: cambio en últimas X semanas, desglosado en ausencia, sustitución confirmada, regreso; separar cambios planificados de cambios forzosos **siempre con fecha y fuente**.
- Para TES, conservar el caso de 369 como ajuste manual **experimental condicionado**; al entrenar el v3, no convertir automáticamente `−25` en verdad ni duplicarlo con las variables de roster.
- Calidad del sustituto: solo comparar historial observable pre-cutoff, con prior amplio. Ausencia de partidas recientes genera **más incertidumbre**, no penalización numérica arbitraria.
- Priorizar datos del jugador/plantilla actual frente a resultados de una organización con jugadores diferentes.

### 3.3. Historial internacional y presión

- Contexto objetivo: internacional vs regional, fase, partida de eliminación/clasificación, match point, final, marcador previo de la serie, mejor de X.
- `international_residual`: rendimiento observado menos esperado en grandes eventos, **con regularización fuerte**, peso decreciente por años y ponderación de continuidad de jugadores. Al ser escasas estas observaciones, probar un efecto global antes de coeficientes individuales.
- Presión/clutch: estimar interacción equipo × situación decisiva **solo con muestra suficiente**, intervalo de incertidumbre y regularización jerárquica hacia 0. Resultado aislado en una final no prueba clutch/choking. No clasificar públicamente a un equipo como «choker».
- No contar dos veces `history_bonus` y `pressure_bonus` apoyados en las mismas finales. El efecto de un hipotético «Worlds buff» pasa a ser **hipótesis contrastable** (desviación de lo esperado en Worlds dado roster/forma/rivales), no parámetro especial fijado para T1.
- Si no hay evidencia suficiente, `HISTORY=0` y `PRESSURE=0` en v3; conservar solo la documentación cualitativa para el admin.

### 3.4. Efecto de serie, momentum y recuperación

Comparar, en este orden: modelo sin secuencia; indicador de resultado del game anterior; marcador antes del game; interacción por tipo de serie/game index; efecto por equipo con regularización.

- Distinguir **efecto observable de secuencia** de causalidad psicológica. Una racha puede emerger de distinta fuerza, cambios de lado/draft, sesgo de selección (los game 5 solo ocurren en series igualadas) o de la forma latente compartida.
- `after_win` y `after_loss` deben probarse por separado y en **diferencias entre equipos**. Un equipo que se recupera de perder no tiene por qué ser el que más encadena wins. No inferir `after_loss` a partir de un reverse sweep sin controlar rivales.
- Usar datos de juegos en orden conocido; incluir `score_before_game`, `game_index`, `best_of`, parches y primera elección si se verifica su efecto. Comparar fuera de muestra por **series completas** (nunca dividir games de una misma serie entre train/test).
- En `contextual_trained_v3` cualquier efecto que no supere validación queda en 0; el modelo v2 de racha sigue como juego experimental alternativo.

### 3.5. Meta, draft y compatibilidad de estilos

Sin simular picks ni bans en el navegador, investigar predictores **conocidos antes de la partida**:

- `patch_familiarity`: número de games recientes en el parche/familia cercana;
- `champion_pool_diversity` de jugadores actuales estimado **en games anteriores**; tamaño efectivo y cobertura por rol con intervalos;
- `style_profile`: tendencias tempranas y objetivos calculadas solo con partidas anteriores, condicionadas por rivales;
- `matchup_style`: interacción entre dos perfiles recientes, muy regularizada, no tabla arbitraria de counters;
- posible efecto en game 3–5 de Fearless Draft a nivel de serie, **solo si el histórico confirma modo de draft y orden**, evitando usar campeones elegidos en el game futuro.

No diseñar todavía un simulador completo de draft. Si no hay información de lado/elección o es futura e incierta, marginalizarla o dejarla fuera. Prohibido usar como predictor picks/bans del mismo game cuando no eran conocidos en la hora de pronosticarlo.

## 4. Estado latente e inferencia al avanzar Worlds

### 4.1. Modelo generativo ligero

La forma actual no es un premio determinista por ganar. Ejemplo de evolución temporal, a implementar **solo tras validar**:

```text
latent_i(day_next) = rho(delta_days) * latent_i(day_prev)
                   + Normal(0, sigma_drift_i(delta_days)^2)
series_form_i      ~ Normal(0, sigma_series_i^2)

P(game A wins) = sigmoid(predictor_pre_game(A,B,features)
                         + latent_A - latent_B
                         + series_form_A - series_form_B)
```

- `rho(delta)` entre 0 y 1; a mayor distancia temporal, menor persistencia de un estado extraordinario; entrenar/ajustar con validación temporal. Si `rho=1`, se reduce a forma de torneo fija tipo v2.
- Las sigmas de torneo, drift y serie constituyen incertidumbre residual **condicional al resto de covariables**. Estimarlas mediante máxima verosimilitud marginal / aproximación bayesiana / validación, con **pooling** por equipo y límites robustos; no mantener manualmente `20/40/65` como si fueran estimaciones medidas.
- En el recorrido simulado, muestrear un estado latente por equipo, evolucionarlo cronológicamente, mantener forma de serie dentro de un BoX y resolver games individualmente. No re-entrenar pesos en cada simulación ni incrementar permanentemente la fuerza por ganar.

### 4.2. Partidos reales ya disputados

El escenario `official_state` debe fijar fixtures y resultados. Para modelo con estado latente persistente, utilizar **posterior condicionado** a games/series oficiales ya observados y disponibles antes del corte de la simulación; no volver a crear una forma inicial completamente independiente.

- Si se conoce el ganador de cada game en orden: likelihood secuencial, integrando forma de serie.
- Si solo se conoce el 2-1 o 3-2: marginalizar los órdenes **legales** de games consistentes con el marcador; no fabricar una cronología.
- Inferencia implementable: partículas / importance sampling con remuestreo y rejuvenecimiento; añadir ESS, número de partículas, degeneración y tests de juguete. El partido oficial es dato de observación, no una partida sintética que genere una recompensa Elo adicional. Respetar tiempos: posterior después de R2 usa R1/R2, no futuras eliminatorias.
- Mantener GPR **pre-Worlds** (19-10-2026) si se condiciona con games de Worlds. No usar un GPR posterior que ya los haya incorporado.
- Si este componente no está listo o ESS es insuficiente: **usar el baseline para las predicciones oficiales o marcar el escenario contextual como no condicionado**, sin números presentados como posteriores fiables.

### 4.3. Snapshot y reproducibilidad

Cada predicción debe incluir: `tournament_revision`, `rating_snapshot_id`, `source_cutoff_utc`, `model_id`, `artifact_hash`, `train_cutoff_utc`, `engine_version`, `rng_version`, `seed`, `N`, `scenario_hash`, `features_schema_version`, `conditional_inference_mode` y `posterior_diagnostics` si aplica. Cambiar el idioma no altera ningún valor. Los resultados quedan ligados al snapshot inmutable, nunca a «latest».

## 5. Entrenamiento y validación (obligatorio antes de promover v3)

### 5.1. Herramienta offline

Usar Python (pandas/NumPy/scikit-learn y librerías estadísticas pequeñas si ayudan) **solo en desarrollo**. Exportar coeficientes y parámetros como JSON pequeño; TypeScript ejecuta predicciones y Monte Carlo. No lanzar Python desde Laravel y no cargar CSV completos en el navegador/VPS.

Posible organización (adaptar a código existente):

```text
analysis/
  README.md
  requirements.txt                  # versiones fijadas / entorno reproducible
  src/ingest.py                     # fuente, hash, normalización, deduplicación
  src/features.py                   # cortes pre-game y rolling history
  src/baseline.py                   # GPR histórico O Elo secuencial propio
  src/train.py                      # calibración penalizada, pooling
  src/evaluate.py                   # folds temporales, bootstrap por series/evento
  src/export_artifact.py            # JSON tipado, sin datos personales
  tests/test_leakage.py
  tests/test_series_order.py
  tests/test_feature_cutoff.py
  tests/test_roster_asof.py
models/
  artifacts/
  reports/
```

Proteger privacidad/licencias: no subir datasets completos a Git por defecto; documentar fuente y atribución. Pin de dependencias y corpus hash si se usa un dataset externo. La descarga y el entrenamiento no forman parte del flujo público.

### 5.2. Diseño experimental de ablación

**Orden de bloques**: M0 = GPR calibrado (si hay GPR histórico) o Elo propio; M1 = fuerza dinámica + forma residual; M2 = M1 + roster; M3 = M2 + historial internacional; M4 = M3 + efectos de serie/presión; M5 = M4 + meta/estilos. Agregar bloque por bloque y detenerse si no hay mejora reproducible.

- Separación **cronológica**: train en periodos previos (p. ej., 2024–25), validación rolling en 2026 y un holdout temporal de las últimas semanas **anterior a 21-10-2026**. Son ejemplos de cortes, adaptarlos a cobertura real. Nunca usar juegos del mismo BoX/evento de forma cruzada entre train y test si se entrenan efectos a nivel serie.
- `feature_as_of < game_start`: cada vista de historial se calcula solo con juegos anteriores; calibradores, normalizaciones, hiperparámetros y pesos de imputación aprenden solo de train en cada fold.
- Reportar global e **internacionalmente** métricas: número de juegos, series y rivales, log loss, Brier, curvas de calibración, accuracy secundaria, bucket de favoritos/underdogs y desempeño por etapa y región. Reportar muestras pequeñas, no inferir categorías con 2 observaciones.
- **Bootstrapping por serie/evento** para incertidumbre de la mejora en métricas; no asumir independencia game a game dentro de una serie. Registrar diferencias pareadas del mismo conjunto de juegos y costes de complejidad.
- Penalización L2/ridge como primera opción; efectos de equipo al borde de cero con poca evidencia. No introducir red neuronal porque el requisito sea parecer avanzado.
- **Regla de promoción:** solo activar el nuevo preset como recomendado cuando haya mejora temporal robusta vs baseline, calibración aceptable y cobertura suficiente. Si hay empate o empeora, elegir el más simple. Documentar las razones sin fabricar un umbral mágico universal; fijar tolerancias/criterios explícitos **antes de mirar el holdout**.
- Distinguir error predictivo, error de Monte Carlo (menos iteraciones) y incertidumbre por parámetros/datos: 100k simulaciones no arreglan un modelo mal ajustado.

### 5.3. Lo que no se puede afirmar

No publicar «T1 clutch +17 medidos» o «GEN 90 % consistente» sin coeficiente estimado y cobertura. Tampoco derivar estimaciones actuales de la investigación cualitativa v2. Los rankings GPR son oficiales; **las probabilidades, ajustes y calibraciones del producto no lo son**. Los modelos con solo datos de 2025/2026 pueden sufrir cambios de meta y plantillas; mostrar fecha y limitaciones en metodología discreta, no un muro de copy.

## 6. Artefacto publicable y TypeScript

El entrenamiento produce un **objeto JSON inmutable** más reporte de validación. El worker recibe un contrato completo al lanzar un lote; ninguna llamada de red durante las iteraciones.

```json
{
  "schema_version": 3,
  "model_id": "contextual-trained-v3-example-NOT-TRAINED",
  "status": "example_not_trained",
  "trained_through_utc": null,
  "features_schema_version": "pregame-v1",
  "base": {"kind": "gpr_snapshot", "snapshot_id": "riot-gpr-2026-10-19", "D": null},
  "coefficients": null,
  "state_process": null,
  "calibration_report_id": null,
  "source_manifest_hash": null,
  "validation_approved": false
}
```

**Esto es un ejemplo deliberadamente no ejecutable como modelo entrenado.** El build debe rechazar `status != trained_validated`, coeficientes incompletos, fuentes temporales incompatibles o hash incorrecto; no rellenar `null` con cifras ficticias.

Contratos TS a implementar progresivamente:

```typescript
type Preset = 'gpr_baseline' | 'contextual_experimental_v2' | 'contextual_trained_v3';

type PreGameContext = {
  atUtc: string; patchId?: string; bestOf: 1 | 3 | 5;
  gameIndex: number; winsA: number; winsB: number;
  teamAId: string; teamBId: string;
  rosterAId?: string; rosterBId?: string;
  stage: 'swiss' | 'knockout';
};

type Prediction = { pWinA: number; contributions?: Record<string, number> };

interface PredictionModel {
  predictGame(context: PreGameContext, state: SimulatedWorldState): Prediction;
  onGameResolved(state: SimulatedWorldState, result: GameResult): void;
}
```

- `gpr_baseline`: no cambia estado estadístico al resolver (solo torneo); el contextual puede actualizar estado de serie y transición de forma del **modelo generativo**, no aplicar automáticamente Elo +10.
- Mantener interfaz de motor de torneo separada de `PredictionModel`. Inyectar el modelo para que ningún detalle estadístico altere pools, sorteos ni reglas oficiales.
- Los predictores de equipo/estilo deben ser **precalculados para el corte del escenario** (si se conocen); en una simulación desde cero no habrá picks/rosters nuevos por ficción. Variables de juego que no existen en el mundo simulado deben marginalizarse, no leerse del resultado simulado para fabricar un draft favorable.
- Explicabilidad: contributions en **log-odds** o rating-equivalente claramente etiquetado; se suman al predictor lineal. No atribuir causalidad al cambio de probabilidades. En fase pública mostrar solamente valores que aporten decisión.
- Escenarios v2 guardados permanecen v2, jamás mutarlos silenciosamente a v3. Migración voluntaria con duplicación del escenario y aviso de cambio de modelo.

## 7. UX y administración — mínima fricción

- Inicio sin login, simulación inmediata, solo 1–2 controles evidentes. El contexto puede consultarse en detalle de equipo, no ocupar la cabecera con explicaciones.
- En panel admin, vista compacta de equipo: `GPR`, `Forma reciente`, `Plantilla`, `Internacional`, `Consistencia`, `Presión` y `Última actualización`. Cada valor puede ser **Estimado / Experimental / Sin datos** con origen inspeccionable; no inventar numeritos para completar la ficha.
- Publicar un modelo entrenado distinto de publicar resultados del torneo; exigir verificación de artefacto, fecha, fuente y reporte de validación. Deshabilitar “recomendado” para modelos sin validación aprobada.
- Ajustes locales de usuario: controles pequeños para crear hipótesis (`Más forma actual`, `Cambio de plantilla`, `Alta volatilidad`) solo si especificación define exactamente qué modifican y cómo se restablecen. De inicio, conservar controles v2, sin nuevas perillas decorativas.
- En pantalla de resultados: modelo, snapshot, corte, N y comparación si existe; aviso discreto de que las probabilidades son estimaciones. **Sin metatexto promocional**. ES/EN en toda la UI, con valores numéricos localizados sin modificar RNG.
- Marca original ajena a Riot; no usar logos ni arte sin licencia por defecto. Incluir atribución CC BY 4.0 a ChainCC cuando corresponda, en una sección pertinente.

## 8. Criterios de aceptación y tests

**Datos y entrenamiento**

1. Canonicalización: exactamente un GameRecord por game; dos filas equipo/10 jugador donde hay datos íntegros, ninguna duplicación por join de lados; IDs estables por fecha.
2. Pruebas sintéticas de fuga: modificar una partida futura **no cambia ninguna feature ni predicción anterior**. Retirar un jugador del roster futuro no afecta el pasado. Estadísticas del game objetivo nunca entran al predictor de ese game.
3. Si GPR histórico falta, se devuelve `unavailable` o baseline Elo propio declarado: nunca reutilizar GPR del 19-10 para entrenamiento retrospectivo.
4. Respetar `event_start_utc < cutoff`, series completas y train/test por tiempo, sin exposición posterior; hashes, versiones y procedencia reproducibles.
5. Pipeline local repetido con mismos datos/configuración/semilla devuelve mismas métricas y mismo JSON (salvo metadatos deliberadamente variables y excluidos del hash).
6. Los informes contienen recuentos y fallos de calidad, comparativa por ablaciones, logloss/Brier, calibración, particiones, atribución de fuentes e incertidumbre agrupada por serie.

**Motor**

7. Probabilidades finitas [0,1], antisimetría A/B y monotonicidad del componente GPR; escenarios neutrales equivalentes al baseline en tests controlados.
8. Resolver games Bo1/3/5 con predictor inyectado, sin cambiar sorteos ni resultados fijados; consistencia de estados entre games, rondas y series.
9. Resultados oficiales fijados en cualquier fecha; posterior condicionado sin doble contar el mismo game ni usar futura información; fallbacks inequívocos cuando ESS es pobre.
10. Sin artefacto `trained_validated`, `contextual_trained_v3` no aparece como modelo disponible ni se ejecuta como si estuviera calibrado.
11. Pruebas de regresión para escenarios guardados v2, i18n ES/EN, seed determinista, manifest completo, ausencia de llamadas a red en el loop.
12. Comparaciones entre dos modelos con igualdad de condiciones de calendario, fixtures, snapshots y N; reportar diferencias con error Monte Carlo y sin afirmación causal.

**Publicación**

13. Un admin no puede publicar un artefacto que no tiene métricas, fecha de corte, fuente y validación; no hacer que una publicación cambie escenarios locales antiguos.
14. La web funciona con el **solo preset GPR** aunque fallen datasets externos o el pipeline offline: ninguna dependencia externa requerida en tiempo de ejecución.
15. Rendimiento de 10k runs en Web Worker medido en dispositivo representativo; UI responde, cancela y no almacena N recorridos completos cuando bastan agregados.

## 9. Orden de trabajo específico para Codex (proyecto ya en curso)

**No implementar seis atributos nuevos y toda la web a la vez.** Auditar primero cómo está el repositorio. Trabajar en `development`, ramas `feat/*`, commits pequeños, tests locales y pushes espaciados. No implementar CI/CD antes de decidir despliegue.

| Entrega | Alcance acotado | Evidencia de terminado |
|---|---|---|
| **V3-A** `feat/model-contract-v3` | Interfaz `PredictionModel`, separación del motor del torneo, nuevos IDs de presets, migración no destructiva y fallbacks | Tests actuales verdes, v2 no cambia, baseline idempotente |
| **V3-B** `feat/historical-data-audit` | Descarga/importación manual, auditoría ChainCC real, map de game/series/roster, hashes y licencia | Informe con cobertura, exclusiones y schema real; ningún supuesto de columnas |
| **V3-C** `feat/pre-game-features` | Pipeline temporal y features de forma + roster, datos sin leakage | Pruebas temporales y fixtures de ejemplo con cortes estrictos |
| **V3-D** `feat/model-backtesting` | D y baseline con GPR histórico disponible; alternativa Elo propia; ablación, reporte, incertidumbre | Informe OOT honesto; sin coeficientes ficticios |
| **V3-E** `feat/contextual-trained` | Entrenar/validar versión mínima que mejora baseline; exportar JSON, verificarlo e integrarlo en worker | Artefacto solo se habilita si cumple gates |
| **V3-F** `feat/conditional-context` | Forma latente y posterior sobre games oficiales, diagnóstico ESS y reglas de fallback | Tests de toy cases y cortes temporales; clasificación condicionada coherente |
| **V3-G** `feat/model-insights` | Ficha compacta por equipo, fuentes/estado y comparación GPR/contextual | Responsive ES/EN, sin sobreexplicación |

**Prioridad inmediata: V3-A y V3-B** en incrementos separados. No iniciar entrenamiento avanzado mientras no se haya auditado la fuente y los cortes. Si no se consigue GPR histórico verificable, reportar la limitación y usar baseline Elo propio para aprender forma residual, sin bloqueo del simulador GPR actual.

## 10. Fuentes y alcance de verificación

1. Riot Games, diario de GPR (2024): https://lolesports.com/es-MX/news/dev-diary-unveiling-the-global-power-rankings
2. Tabla GPR con fecha 19-10-2026: https://lolesports.com/es-MX/gpr/2026/current
3. Riot, Worlds 2026 primer y reglas: https://lolesports.com/en-GB/news/worlds-2026-primer
4. ChainCC, Open LoL Esports Dataset (consultado 21-10-2026): https://chaincc.lol/free/data/
5. Oracle's Elixir, Match Data Downloads (licencia a comprobar para cada uso): https://master.d36liwrx5rvjnc.amplifyapp.com/tools/downloads
6. Investigación y perfiles cualitativos existentes: `WORLDS_2026_TEAM_CONTEXT_RESEARCH.md` y `WORLDS_2026_STRENGTH_PROFILES_V2.json`; ilustrativos, no resultados de entrenamiento.

**Aviso de alcance:** esta v3 es un diseño técnico concreto basado en fuentes disponibles. No se afirma haber descargado ChainCC, reconstruido toda la historia, ajustado los coeficientes ni validado una mejora. El archivo de ejemplo v3 no contiene una estimación real: Codex debe producirla con su pipeline y pruebas antes de activar el nuevo preset.

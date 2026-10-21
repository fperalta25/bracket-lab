# Worlds Simulator — Anexo técnico: modelo estadístico v2

> **Fecha de corte:** 21-10-2026 · **Estado:** especificación para implementación incremental, no validación empírica final.  
> **Ámbito:** fortalezas de los 16 equipos del suizo de Worlds 2026, Monte Carlo, atributos contextuales, calibración, reproducción y mantenimiento de resultados oficiales.  
> **Precedencia:** este anexo reemplaza el modelo estadístico anterior basado en `power_score` de 0–100 y cualquier fórmula incompatible. **No altera las reglas reglamentarias ni las excepciones de sorteo** de la especificación principal. También siguen vigentes los anexos UX sin metatexto e i18n español/inglés.

## 1. Decisiones cerradas

1. **GPR oficial como rating base** en puntos originales, no índice ordinal ni normalización de 0–100. Snapshot fechado, inmutable e identificable. Nunca inferir la fuerza únicamente de la posición del ranking.
2. **Dos presets comparables:** `gpr_baseline` (sin ajustes subjetivos ni variaciones latentes; referencia reproducible) y `contextual_v1` (GPR + forma estocástica de torneo/serie + ajustes documentados). El neutral es el valor inicial público mientras el contextual no se haya calibrado. Un escenario del visitante puede editar ambos.
3. **Cada game se sortea individualmente.** Bo1/Bo3/Bo5 se resuelven en games, con probabilidad recalculada cuando cambia el estado de la serie.
4. **Consistencia ≠ fuerza**. La media de la forma estocástica de un equipo es 0, no una penalización a equipos «inconsistentes». No asignar sesgos regionales adicionales: los GPR ya incorporan fuerza regional.
5. **Presión, rachas y recuperación son efectos distintos**, con coeficientes neutrales por defecto salvo hipótesis etiquetadas como experimentales. Una remontada no demuestra causalidad psicológica ni «momentum». No atribuir choking a personas/equipos por anécdotas.
6. **No sumar dos veces la misma evidencia.** Ej.: no activar a la vez un «Worlds buff de T1» por sus finales y un ajuste clutch apoyado únicamente en esas mismas finales; usar etiquetas de evidencia y avisar de superposición.
7. **Parámetros e inferencias versionados.** Todas las salidas guardan `rating_snapshot_id`, `model_version`, `profile_revision`, `preset`, parámetros, semilla, `simulation_count`, revisión del torneo y modo de sorteo.
8. **Nada de probabilidades “oficiales”.** El GPR es oficial; nuestra transformación del GPR en probabilidades y los atributos contextuales NO lo son.
9. **No usar datos futuros al validar el pasado.** Cada partida histórica se evalúa usando la información que existía *antes* de ella. Si no existe rating histórico fiable, no improvisarlo con el GPR de octubre.
10. **Prioridad del motor:** reglas y corrección → GPR base → series → forma contextual → posterior de resultados conocidos → evidencia y calibración. No introducir sistemas complejos de IA en runtime.

## 2. Datos originales: snapshot GPR del 19-10-2026

Fuente: https://lolesports.com/es-MX/gpr/2026/current (consulta 21-10-2026; indica actualización 19/10/26). Tratar esta captura como baseline **pre-suizo**, conservarla incluso después de nuevas actualizaciones. El ranking muestra KC tras el Play-In; esos resultados ya están recogidos en la fotografía de puntuaciones. **No actualizar automáticamente por cambios durante Worlds** ni cargar resultados posteriores al corte para predecir partidos previos.

| Equipo | GPR | Consistencia hipotética | Presión experimental (Elo máx.) | Ajuste contextual experimental |
|---|---:|---|---:|---:|
| HLE | 1540 | Normal | +10 | 0 |
| GEN | 1519 | Alta | 0 | 0 |
| BLG | 1513 | Alta | 0 | 0 |
| G2 | 1480 | Normal | +8 | 0 |
| T1 | 1471 | Normal | +10 | 0 |
| LYON | 1424 | Normal | +5 | 0 |
| KC | 1409 | Normal | +3 | 0 |
| DK | 1409 | Baja | +8 | 0 |
| AL | 1409 | Normal | +5 | 0 |
| TLAW | 1369 | Normal | 0 | 0 |
| TSW | 1368 | Normal | 0 | 0 |
| TES | 1364 | Baja | 0 | −25* |
| IG | 1348 | Baja | 0 | 0 |
| MKOI | 1322 | Baja | 0 | 0 |
| CFO | 1314 | Normal | 0 | 0 |
| LOS | 1183 | Normal | 0 | 0 |

*TES −25 es una **hipótesis subjetiva de sensibilidad**, condicionada a que se mantenga el reemplazo de top por 369, **no una pérdida objetiva medida**. No actúa en el preset GPR. El admin confirma la composición de la plantilla y vigencia antes de publicar un perfil contextual. Ante duda, mantener ajuste 0.

**Confianza:** los valores GPR son fuente oficial fechada; todas las asignaciones de consistencia, presión y magnitud de TES son **no calibradas**. La investigación justificativa por equipo permanece en `WORLDS_2026_TEAM_CONTEXT_RESEARCH.md`; no confundir evidencia de victorias con identificación causal de clutch o momentum. No asignar valores negativos de presión a equipos sin resultados empíricos convincentes. **Rachas tras victoria y recuperación tras derrota: 0 para TODOS los equipos** en la semilla inicial.

## 3. Contrato matemático de simulación

### 3.1. Escala y game probability

Para equipo `i`, `G_i` es el GPR congelado y `A_i` el ajuste de contexto. Antes de cada game `g` de la serie `s` del torneo simulado `t`:

```text
R_i*(t,s,g) = G_i + A_i
            + T_i(t) + S_i(t,s)
            + Pressure_i(t,s,g) + Sequence_i(t,s,g)

P(i gana game a j) = 1 / (1 + 10^((R_j* - R_i*) / D))
```

- `D` es un **parámetro de calibración**, *no* el divisor oficial publicado por Riot. Arranque provisional `D=400` (clásico Elo); rango interno validado sugerido `200..800`. Hacer backtesting antes de considerarlo fiable; Riot describe un rating ponderado de equipo y región, no garantiza que 400 traduzca su Power Score a win probabilities.
- Nunca utilizar diferencia de **posiciones** de ranking en la fórmula. No recortar por defecto las probabilidades a 5–95 %: eso distorsionaría sistemáticamente las grandes diferencias. Calcular logísticamente de forma numéricamente estable, con parámetros finitos y `0 <= p <= 1`.
- En `gpr_baseline`: `A=T=S=Pressure=Sequence=0` para todos, `D=400` provisional.
- En `contextual_v1`: los términos se activan **solo si están habilitados** y se exponen en metadatos. En ambos, el resultado de cada game se obtiene comparando `u~Uniforme(0,1)` con `p`. Una serie no se resuelve con una moneda única.
- El cambio del parámetro global de *imprevisibilidad* puede ofrecerse en tres posiciones (`pocas sorpresas`, `normal`, `muchas sorpresas`) alterando **solo D** (valores exploratorios 320/400/520). Este control no debe reasignar ni multiplicar las `sigma` individuales. Es un **escenario hipotético**, no otro estado de calibración del modelo. La configuración de referencia siempre usa D calibrado o 400 provisional.

### 3.2. Dos escalas de variación, con media cero

```text
T_i(t)   ~ Normal(0, sigma_tournament_i²)  # 1 por equipo y ejecución COMPLETA
S_i(t,s) ~ Normal(0, sigma_series_i²)      # 1 por equipo y nueva SERIE
```

Independientes entre sí y entre equipos en v1. `T` persiste entre rondas del mismo torneo simulado; `S` persiste entre games de la misma serie, desaparece al terminar esa serie. No re-sortear `T` en cada ronda ni `S` en cada game. Si una misma serie se simuló ya, recuperar su estado, no reiniciar su fuerza.

| Consistencia visible | `sigma_tournament` | `sigma_series` |
|---|---:|---:|
| Alta | 20 | 10 |
| Normal | 40 | 20 |
| Baja | 65 | 30 |

Son **hipótesis iniciales** y no estadísticas observadas. La distribución normal NO significa que 65 sea un rango máximo ±65; `sigma` es una desviación estándar, con colas. Implementar Box–Muller o PRNG normal probado, sin truncar el soporte por conveniencia. En casos extremos el cálculo logístico seguirá siendo estable.

Con forma latente, los games de un torneo **no son independientes marginalmente** entre sí: están correlacionados por `T` y `S`. Esta correlación es parte del comportamiento deseado. No confundir «consistencia» con la aleatoriedad básica del game, que existe incluso con todas las sigmas = 0.

### 3.3. Presión: intensidad definida por la situación, no narrativa

`Pressure_i = pressure_rating_i × intensity(state, i)` y `intensity∈[0,1]`. Definir una función pura y comprobable a partir del **estado previo** al game. Propuesta v1:

- Game Bo1 del suizo sin clasificación/eliminación: intensidad 0.
- Games de Bo3 del suizo que ya deciden clasificación o eliminación: intensidad 0.5 para los primeros games, **1** en el tercer game (1-1). En rondas suizas decisivas, puede aplicarse la misma intensidad a ambos equipos, distinguiendo que uno puede jugar por clasificar y el otro por no quedar eliminado según record (normalmente tendrán el mismo record).
- Bo5 de knockout: 0.5 en los games 1–4; **1** en el game 5 (2-2). En cada etapa, la intensidad se establece por importancia estructural del game, **no porque un equipo vaya perdiendo y merezca un bonus automático**.
- No extender por defecto un bonus por presión al resto del torneo. Un bonus de T1 en semifinal/final no equivale a +10 durante todos los juegos de Worlds.
- Para un futuro modelo verdaderamente estimado, se puede separar `clutch_on_match_point` (cerrar serie) y `survival_under_match_point` (evitar eliminación), pero no introducirlos con cifras inventadas ahora.

Estas intensidades son **elecciones de diseño**, no una escala científicamente validada de presión. Al calibrar, considerar además el playoff/bo, el marcador de la serie y el rival; nunca «demostrar» mentalidad de los jugadores a partir de un signo del coeficiente.

### 3.4. Momentum y recuperación: transiciones separadas

`Sequence_i` depende **solamente del game inmediatamente anterior de esa misma serie**:

```text
if game_index == 1:                      sequence_elo = 0
else if previous_game_winner == i:        sequence_elo = after_win_elo_i
else:                                     sequence_elo = after_loss_elo_i
```

- `after_win_elo >0` significa rendimiento mejor tras ganar; `after_loss_elo >0` significa *recuperación* tras perder. Ninguno presupone que el otro tiene que ser negativo.
- No heredar estado de una serie a otra ni acumular una racha de cinco +10 sucesivamente.
- Todas las transiciones **0 por defecto**; experimentos pueden probar ±10 con etiqueta hipotética. No habilitar un efecto causal porque alguien haya completado un reverse sweep.
- Con ambos coeficientes 0, una serie con fuerza fija debe tener la distribución BoX analítica conocida. Con transiciones/ presión activas, simular *game a game* es obligatorio.

### 3.5. Buffs/nerfs, vigencia y evidencia

- `context_adjustment_elo`: ajuste de fuerza estructural por un acontecimiento verificable (roster, ausencia, sustituto), aplicado solo cuando la condición sigue vigente; guardar explicación, origen, `valid_from`/`valid_until` si existen y responsable de confirmarlo.
- `pressure_rating_elo`: efecto dinámico en situaciones decisivas, **no** sinónimo de reputación histórica de Worlds.
- No introducir `worlds_buff` como tercera bonificación sobre los mismos títulos hasta haber estimado independientemente un efecto residual de Worlds después de controlar fuerza base y presión. Si se ofrece como modo lúdico, por defecto 0, aislado del modelo predictivo y claramente etiquetado.
- Evitar incluir automáticamente cambios en regiones, forma histórica o rankings que el GPR ya codifica.

## 4. Algoritmo mínimo independiente del framework

El módulo `resources/ts/simulator/` es TS puro; función pública `simulateTournament(config, rng): TournamentResult`. Toda configuración congelada al iniciar el worker; no consultas externas durante el bucle Monte Carlo.

```text
for simulationIndex in 0..N-1:
    scenario = deepValidatedCopy(officialOrCustomState)
    rngSim = keyedDeterministicRng(seed, simulationIndex)
    for team in tournament.teams:
        T[team] = contextual ? normal(rng keyed by 'tournament-form', team.id) * sigmaT[team] : 0

    for each unresolved Swiss or knockout series, following official tournament structure:
        for each participant team:
            S[team, currentSeries] = contextual ? normal(rng keyed by 'series-form', seriesKey, team.id) * sigmaS[team] : 0
        while nobody has achieved required game wins:
            calculate structural pressureIntensity(seriesState)
            calculate Sequence for both teams from previous game in THIS series
            calculate R_A*, R_B*, p(A wins) and draw game from distinct game RNG
            record game winner; update only series state + previousGameWinner
        advance winner; discard S and Sequence for that series

    accumulate standings, placement buckets, per-team Swiss records and diagnostics
```

Si existen series oficiales completadas y fixtures fijados: **no sortear nuevamente sus partidas**, do not invent missing game order and do not add synthetic momentum from a final score alone. Son condiciones históricas; ver el condicionamiento estadístico en §5. For one illustrative tournament, store a complete progression and RNG metadata. For N simulations, aggregate counts, not N copies of all games.

### 4.1. Determinismo útil para comparaciones A/B

- Use a named and versioned integer PRNG (e.g., `sfc32`/`xoshiro128**`) and stable hash-derived substreams for `simulationIndex`, `teamId`, `seriesKey`, `gameIndex`, draw type; no ambient `Math.random()`.
- Preserve independent random families for pairings, latent form, series game outcomes and eventual posterior inference; sorting by **stable team IDs**, not array order/visible acronyms. Be explicit when scenario changes the bracket: matched samples are not perfectly paired if the path changes.
- Scenario A vs B: same master seed and indices (common random numbers) to reduce Monte Carlo variance; still compute **variance of the per-run differences** or use repeated paired batches. Never state that equal seeds make all results comparable one-to-one after branches diverge.
- Store PRNG algorithm + hash version, not just a human seed. Add reproducibility regression vectors after each engine change.

## 5. Problema sutil: cómo condicionar al Mundial real

En `official_state`, los resultados completados **no se vuelven a sortear**. Sin embargo, la forma latente persistente `T_i` influye tanto en partidas completadas como futuras. Si tras conocer resultados reales volvemos a generar `T_i` de su distribución inicial sin condicionamiento, descartamos información (por ejemplo, un equipo inferior que ya ganó varias veces a rivales superiores). Presentarlo como un pronóstico contextual posterior sería incoherente.

**Requisito:** separar dos modos válidos y no confundirlos:

1. **GPR baseline**: deterministic strength, freeze known results, simulate remaining games. Correct *conditional-on-fixture-and-fixed-results* scenario forecast within this static model; no additional inferred latent form.
2. **Contextual with results already played:** draw `T` from its **posterior conditioned on official observed games/scores**, then simulate the unplayed matches. The model must account for *which actual teams played*, the series result and available game sequence. It **must not** treat the fact that a fixture was randomly selected as evidence of strength; only the outcomes provide evidence once the draw mechanism is respected.

Implementación acotada sugerida (sin servicio de IA): importance sampling / particle filter or MCMC for the 16 tournament latent forms, with prior Gaussian and likelihood of confirmed games given the actual opponents; sample/rejuvenate when weights degenerate. With `S` random per series, integrate/marginalize or sample these latent forms consistently. Maintain tests against analytically solvable toy examples. Monitor **effective sample size** (ESS) and numerical weights; use log-likelihood normalization. Do not ship a biased estimator that collapses when several unlikely real upsets have occurred.

**Orden de games conocido:** la verosimilitud es el producto de probabilidades secuenciales por game, con presión/racha cuando estén activos. **Solo marcador final conocido:** sumar la verosimilitud de todos los órdenes legales que llevan al marcador (DP sobre `(winsA,winsB,previousGameWinner)`); **no inventar un orden** y tratarlo como observado. Sin módulo posterior, limitar el pronóstico oficial a GPR puro O etiquetar el contextual como *escenario prospectivo sin actualización por resultados previos*, entendiendo `T` como nueva forma desde ese instante. Para considerar la predicción contextual desde rondas ya disputadas plenamente condicionada, **el posterior es criterio de aceptación**.

**Evitar doble contabilización:** si un GPR actualizado ya incluye partidas de Worlds, o bien regresar al snapshot pre-Worlds y condicionarse con esas partidas, o bien usar el GPR actualizado **sin volver a aprender de los mismos games**. Opción predeterminada: snapshot congelado del 19 de octubre durante Worlds.

## 6. Ratings, profiles and migrations

Keep the structural `Team` separate from a **dated `StrengthProfile`** (and potentially from `RatingSnapshot`). A revision of strengths must not mutate previously published scenario revisions.

### Suggested public JSON schema (versioned)

```json
{
  "model_version": "gpr-context-v2",
  "rating_snapshot": {"id": "riot-gpr-2026-10-19", "as_of": "2026-10-19", "source": "https://lolesports.com/es-MX/gpr/2026/current"},
  "calibration": {"elo_denominator": 400, "status": "provisional", "calibration_id": null},
  "presets": {"default": "gpr_baseline", "available": ["gpr_baseline", "contextual_v1"]},
  "profiles": [
    {"team_id": "hle", "gpr": 1540, "consistency": "normal", "sigma_tournament": 40, "sigma_series": 20, "pressure_elo": 10, "after_win_elo": 0, "after_loss_elo": 0, "context_adjustment_elo": 0, "confidence": "experimental", "evidence_keys": ["MSI-2026-final"]},
    {"team_id": "tes", "gpr": 1364, "consistency": "low", "sigma_tournament": 65, "sigma_series": 30, "pressure_elo": 0, "after_win_elo": 0, "after_loss_elo": 0, "context_adjustment_elo": -25, "confidence": "experimental", "context_condition": "369-confirmed-for-worlds"}
  ]
}
```

This is an **illustrative partial payload**, not a replaceable complete tournament seed. Real exports must contain all 16 profiles and required fields; tournament team IDs must be matched to the actual DB identifiers, not these illustrative strings.

- Importer: map existing `power_score 0..100` users to **explicit `legacy-score-v1` scenarios** (run with legacy engine or request conversion) or mark them **incompatible** and offer the visitor a controlled reset to GPR. **Never convert 0–100 to GPR by arbitrary multiplication**, nor silently reinterpret 50 as 1350. This is crucial because development has already started.
- Admin: new fields for `rating_source`, `rating_as_of`, `rating_snapshot_id`, `gpr_rating`, `consistency`, `sigma_t`, `sigma_s`, `pressure_elo`, `after_win_elo`, `after_loss_elo`, `context_adjustment_elo`, confidence/evidence, active flag and profile revision. Prefer defaults + small override JSON over many tables if maintainability is better. Validate finite values, enum tiers, small bounded custom adjustments and source/condition where required.
- A profile may specify custom sigma values internally even if public UI shows only Alta/Normal/Baja. Admin can reset an experimental attribute to neutral without editing official team data. Use separate public and admin edit scopes.
- Scenario import/export includes full reproducibility manifest: IDs, ratings, strengths, revision and optional calibrated coefficient set. Do not depend on fetching “latest” during reproduction.
- Store only necessary source metadata; cite ChainCC if its dataset or derived estimates are actually used in the product, per CC BY 4.0.

## 7. Data science plan: from anecdotes to validated parameters

**What we have now:** dated GPR, a per-team evidence dossier and explicit experimental profiles. **What we do NOT have:** calibrated team-specific sigma, clutch or momentum and an objective -25 for TES. No claim of empirical fit has been made.

### 7.1. Dataset collection (offline only, not in frontend)

Possible feeds: https://chaincc.lol/free/data/ (downloadable 2025/2026 per-game team records, CC BY 4.0); https://gol.gg/ ; https://lol.timsevenhuysen.com/ ; Riot historical GPR snapshots and tournament/roster records. Download, normalize and retain **source links and retrieval dates**. Verify license for every dataset. *No* public scraping cron or live dependency for MVP.

Create canonical game/series observations:

```text
game_id, series_id, game_number, event, event_stage, patch, played_at_utc,
team_a_id, team_b_id, blue_team_id, winner_team_id,
series_bo, series_score_before_game, match_winner,
roster_fingerprint_a, roster_fingerprint_b,
GPR_a_as_known_before_game, GPR_b_as_known_before_game,
rating_snapshot_date, quality_flags, source
```

Validate no game is counted twice (data with **two team rows per game**, one per side). Avoid malformed series reconstruction: game number and score must be observed or verified, not inferred by arbitrary sort. If a ranking snapshot is weeks old, record the gap and run a sensitivity analysis; avoid projecting the **19 October 2026** snapshot back to a match played earlier.

### 7.2. Sequential estimation steps

1. **Baseline calibration first**: fit `D` or a monotonic logistic temperature on pre-match GPR differences via time-split walk-forward evaluation, comparing `D=400` with a fitted value; score **log loss**, **Brier** and calibration bins, not just winner accuracy. Account for rating sparsity and game/series correlation. Where historical GPR snapshots are absent, limit scope honestly to matches/dates supported; do not invent complete historic ratings.
2. **Residual team variance**: fit global/hierarchical tournament- and series-level variability with shrinkage. Then estimate individual deviations only where sample size and roster stability allow. Team-level raw win-rate spread is **not** consistency; control relative opponent, patch and event. Constrain parameters using held-out predictive value.
3. **Pressure effect**: specify objective trigger before looking at outcomes, compare residual performance in decisive states and non-decisive states; account for opponent and team quality. Use partial pooling toward zero, report uncertainty. *Do not* attribute psychological cause from observational estimates.
4. **After-win / after-loss**: test within-series transitions conditional on prior predicted p, game index, side selection, patch and participant (side selection may respond to previous results and induce spurious momentum). Estimate win and loss transitions separately; if credible effects are not present, keep zeros.
5. **Roster/context**: for TES with 369, try comparable historic roster changes or model as **scenario range** (e.g. 0 / −15 / −25 / −40 Elo) rather than asserting a point estimate. Do not estimate team-specific changes solely from 1–2 short series; update after verified evidence.
6. **Generalization**: hold out **later calendar time and entire tournaments**, compare log loss, Brier, coverage and calibration by event/region/GPR gap, using a bootstrap clustered by *series*, not naïvely by game. Record whether adding each family beats GPR alone. If not, do not activate it in reference mode.
7. **Model cards**: store `calibration_id`, date cutoff, coverage, number of games/series, validation windows, estimated coefficients/uncertainty, failures and decision to activate/deactivate. Distinguish empirical coefficients vs expert-prior knobs.

**Suggested offline repo paths:** `analysis/README.md`, `analysis/data_manifest.json`, `analysis/prepare_games.py`, `analysis/calibrate_baseline.py`, `analysis/evaluate_models.py`, `analysis/profiles_report.md`. Prefer isolated Python scripts (pandas/scikit-learn/statsmodels as needed) to any online inference service. Generated raw licensed datasets should not be bundled in public repo unless license terms and size permit; store instructions and hashes instead.

### 7.3. Prioritization rule

Only ship a fitted attribute as a predictive default if it improves out-of-time calibration/log loss compared with a simpler alternative, without obvious subgroup regressions. If evidence is insufficient, leave as experimental/0. Model complexity is not an end in itself.

## 8. Output metrics and confidence

Every team: `P(3-0)`, `P(3-1)`, `P(3-2)`, `P(2-3)`, `P(1-3)`, `P(0-3)`, `P(qualify)`, `P(champion)`, `P(runner-up)`, `P(semifinal 3-4)`, `P(quarterfinal 5-8)` and rest of seven exclusive position bins. All are **unconditional over *all completed tournament simulations* consistent with fixed official results and the selected model**.

Useful optional metrics:
- Most frequent matchups by round, with *frequency of occurrence* `appearances/N` **separate** from `game win rate conditional on that matchup happening`; show correct denominator.
- Probability of upset conditional on initial relative base GPR, Bo1 vs Bo3 vs Bo5; show its reference denominator.
- Probability of reverse sweep in Bo5/Bo3 and sequences of game wins (only if fully simulated or exact official game order known). Do not infer game order from a final score.
- Number and share of tournament runs requiring the Swiss rematch exception; no discarded attempts because of hard draws.
- `P(matchup A-B reaches quarterfinal)` and `P(A beats B | they meet)` may differ; avoid multiplying conditional probabilities incorrectly.
- Conditional distributions and model deltas across presets without overclaiming causal mechanisms.

For a Monte Carlo estimate `p_hat=k/N`, approximate standard error `SE=sqrt(p_hat*(1-p_hat)/N)`. At 50% and `N=10,000`, a 95% interval due only to simulation noise is about **±0.98 percentage points**; at 100,000 about **±0.31 pp**. Distinguish **Monte Carlo sampling error**, **historical parameter uncertainty**, and **model-specification error**; more simulations only improve the first. Zero observations do NOT mean truly 0%: show `<0.01%` or bounds depending on N/precision; avoid implying a precise zero.

Comparison A/B: estimate delta per team and, if sharing randomness, its **paired SE**; rank differences by magnitude with uncertainty. If comparing different rating snapshots, do not ascribe delta exclusively to bracket or team buffs.

## 9. UX, admin, security and internationalization

- Public: simple `Modelo: GPR | Contextual` control (may live inside advanced options). Default GPR until contextual calibrated. Team detail sheet/table for GPR, consistency, pressure, context adjustment and evidence indicator; no wall of exposition or decorative subtitles. For profile editing use plain language and sensible labels: `Fortaleza`, `Consistencia`, `Presión`, `Tras ganar`, `Tras perder`, `Ajuste de plantilla`.
- Admin: edit profile and provenance alongside team but **publish atomically** and separately revision it. Show exactly what changed and whether it is evidence-backed/experimental. Do not mix publishing a result with an automatic rating update.
- Public visitors may override profile **locally only** and compare with base; preserve private custom scenarios in IndexedDB; no user signup. Reset per-team overrides and reset all. Scenarios should never send private content to server as part of simulation.
- Respect no-metatext UX rule: no explanatory subheadings that repeat obvious contents. Keep concise explanations only for methodology, uncertain values, unusual controls and errors; optional in a discreet help section.
- All ES/EN labels, dynamic game state text, number formatting, charts and error messages must come from translation keys; do not localize stable machine IDs or change simulated state by changing language. `1.234,5` vs `1,234.5` is presentation only.
- Security: no remote image by default for third-party logos, no arbitrary SVG/HTML uploaded by admin, validate JSON schemas & sizes for local imports, protect admin publication, no user-chosen executable formulas/eval. Independent identity; no unlicensed Riot/team art in portfolio.

## 10. Required correctness and statistical tests

### Numeric and game logic

- For both presets, equal effective ratings → 0.5; `p(A,B)+p(B,A)=1`, finite within [0,1], monotone in GPR diff; no forced 5% floor.
- With `D=400`, a rating difference of 400 → 10/11 (≈90.91%) game win expectation; 0 → 50% (numeric tolerance).
- Contextual with **all modifiers and sigmas zero** is exactly the baseline, bit-for-bit under aligned game RNG streams.
- Tournament form drawn ONCE/team/tournament; series form ONCE/team/series; no leaking a previous series’ momentum, pressure or roster conditions.
- Variance sampler: empirical mean near zero and variance near configured value across fixed-seed synthetic samples; no spurious fixed-range uniform.
- `after_win` applies only to the winner of the previous game, `after_loss` only to its opponent; game 1 both 0; no compounding of game-to-game +10.
- Pressure states: Bo1→0; Swiss Bo3 initial→0.5, final 1 if 1-1; knockout Bo5 games 1–4→0.5, game5→1; no extra games played after a series ends.
- In stationary Bo3/Bo5 compare simulation frequencies to exact binomial-series formulas across p=0.2/0.5/0.8 with statistically justified tolerance.
- Backwards compatibility and versions: 0–100 legacy scenario NEVER silently reinterpreted as GPR; old scenario handled by explicit migration path; translation ES↔EN does not modify RNG or results.

### Conditioning and aggregates

- Known official series are never replayed; no fictional game order for a known aggregate score.
- Posterior context: in a toy matchup, a surprising known win increases posterior mass on the winning team’s positive latent form relative to prior (when other things equal); observed score-only likelihood equals sum over all legal per-game paths, and ESS alarms/fallback are tested.
- For a scenario with all fixtures and results fixed, N runs agree identically regardless of ranking/config/seed. All prior Swiss/knockout constraints remain true.
- Each team's six Swiss outcome percentages sum to 100% (up to display rounding), seven final buckets sum to 100%; for entire field expected bucket counts always 1/1/2/4/3/3/2 and Swiss 2/3/3/3/3/2.
- The global rematch-exception rule and uniform selection of full valid draws are unchanged and retested under v2.
- No NaN, invalid stored schema, absent profile, unverified roster adjustment or hidden default triggers a “successful” public run.

### Calibration gates

- Running the historical pipeline must produce per-period sample sizes, base vs context log loss/Brier, calibration graph/data, test splits, profile uncertainty and out-of-time baseline comparison; do not claim model accuracy merely from same-sample fit.
- Tests for data leakage with a fabricated future rating; tests for duplicated team-side rows and missing match ordering.
- Benchmark batches on target browser/worker, report throughput and memory before advertising a particular 100k simulation speed.

## 11. Implementation plan for a project already under development

**Do not restart Laravel, rewrite working screens, or introduce a new framework.** Audit current state and implement only gaps; one feature branch per coherent change. Update/refactor tests before replacement where practical. Do not ask the user to decide small technical details.

1. **Audit and compatibility (`feat/gpr-foundation`)**: locate `power_score`, win formula, scenario persistence and seed data; add a v2 typed profile contract + test fixtures. Decide explicit treatment for existing 0–100 drafts. Introduce snapshot GPR 19-10-2026, idempotent seed and neutral preset. Keep public UX working.
2. **Calibratable baseline (`feat/elo-game-model`)**: implement Elo logistic with configurable D, full PRNG and game-by-game series tests. Verify invariants in 1k/10k local CLI/worker runs. Defer hyperparameter fitting but record `status: provisional`.
3. **Contextual form (`feat/contextual-profiles`)**: add team consistency and tournament/series Gaussian effects, context/pressure from frozen profiles, transitions (zeros), clean admin/local controls and bilingual compact display. Run baseline equivalence and determinism checks.
4. **Official-state inference (`feat/conditional-form`)**: implement posterior conditioning with observed games/scores and effective sample diagnostics **before** presenting contextual predictions from already-played rounds as posterior estimates. If deferred, keep baseline as the safe default and visibly label contextual forward-only mode.
5. **Research/calibration (`feat/model-validation`)**: offline historical dataset and frozen snapshots, leakage-safe calibration, out-of-time comparisons; promote only validated coefficients. Not a public backend feature and no live dependency.
6. **Comparison + polish (`feat/model-comparison`)**: GPR vs contextual; sensitivity by TES roster/pressure/volatility; paired Monte Carlo uncertainty, inspectable experiment manifest. Maintain the clean dark UX and ES/EN.

Per milestone: small commits, tests, local validation, spaced pushes to avoid unnecessary CI requests; publish only complete compatible changes. Never identify AI tools in commit metadata; do not falsify ownership.

## 12. Source documents and reference caveats

1. Riot GPR listing, 19 October 2026: https://lolesports.com/es-MX/gpr/2026/current
2. Riot developer diary on GPR model (2024): https://lolesports.com/es-MX/news/dev-diary-unveiling-the-global-power-rankings — explains team/league 80:20, K factors and historical evaluation ~65% **for the 2024 system**, not measured predictive accuracy of our 2026 simulator.
3. Riot Worlds 2026 primer: https://lolesports.com/en-GB/news/worlds-2026-primer — tournament structure and pools.
4. ChainCC data: https://chaincc.lol/free/data/ — free 2025/2026 CSV per game, CC BY 4.0; check data quality and attribute when used.
5. Existing research: `WORLDS_2026_TEAM_CONTEXT_RESEARCH.md` and `WORLDS_2026_TEAM_PROFILES.csv` — team narratives/provisional hypotheses. The new v2 model formally specifies how these can and cannot be used.

**Not accomplished yet:** we have **not** downloaded and statistically fit the complete 2025/2026 game dataset or historical per-date GPR values. The numerical sigmas, pressure effects, TES adjustment and `D=400` are seeds for testing/sensitivity only. The goal is *better* calibrated predictions, not invented confidence.

# Auditoría histórica offline — V3-B

Los dos primeros bloques inspeccionan ChainCC 2024, 2025 y 2026. La auditoría no entrena ni modifica el simulador; el backtest Elo
retrospectivo con supuestos explícitos se documenta al final. Python 3.11+ con biblioteca estándar; comprobado con
Python 3.14.8. No hay dependencias Python en Laravel ni en el navegador.

## Fuente y procedencia

[ChainCC — Open dataset](https://chaincc.lol/free/data/) declara CC BY 4.0 para
sus CSV. Atribución: ChainCC. League of Legends esports match dataset.
Consulta: 21-10-2026. [Licencia](https://creativecommons.org/licenses/by/4.0/).
La [metodología](https://chaincc.lol/about/methodology) identifica Oracle’s Elixir
como origen del histórico; esta auditoría registra la declaración del proveedor,
no certifica independientemente los derechos de toda la cadena de fuentes.

`sources.lock.json` conserva URL, licencia declarada, SHA-256 de los **bytes gzip**,
columnas, filas, tamaño, corte y fecha UTC de descarga o importación. Una importación
no demuestra la hora original de descarga: `retrieved_at_utc` queda en `null`.
La primera adquisición de bytes/configuración idénticos conserva su procedencia.

## Descargar o importar

Desde la raíz del repositorio, repetir para `--kind players`:

```bash
python3 analysis/src/ingest.py download --season 2025 --kind teams --as-of 2026-10-21T00:00:00Z
```

Si el proveedor rechaza el cliente HTTP, descargar los CSV desde su página e importar:

```bash
curl -fLsS https://chaincc.lol/data/chaincc-teams-2025.csv.gz -o /tmp/chaincc-teams-2025.csv.gz
curl -fLsS https://chaincc.lol/data/chaincc-players-2025.csv.gz -o /tmp/chaincc-players-2025.csv.gz
python3 analysis/src/ingest.py import --season 2025 --kind teams --as-of 2026-10-21T00:00:00Z --file /tmp/chaincc-teams-2025.csv.gz
python3 analysis/src/ingest.py import --season 2025 --kind players --as-of 2026-10-21T00:00:00Z --file /tmp/chaincc-players-2025.csv.gz
```

En esta ejecución urllib devolvió HTTP 403; curl permitió obtener los archivos y
se verificó la importación local. La descarga urllib se prueba con transporte
simulado; no se presenta como verificada contra el proveedor en este entorno.
El lock registra `local_import` y su hora, sin inventar una hora de descarga.

## Auditar

Sustituir las rutas por los valores `path` del lock:

```bash
python3 analysis/src/ingest.py audit \
  --teams data/raw/chaincc/2025/teams-6cf310b5a6b58ffb8bf0fb00c43b6251ce8227ba9e1dc403967ebe131d87d015.csv.gz \
  --players data/raw/chaincc/2025/players-48a47fc574fcbe7295133266d6a3a8c0d04d02b2e96a66972fb283ed14a3437a.csv.gz \
  --as-of 2026-10-21T00:00:00Z --source-timezone UTC \
  --output data/curated/chaincc-2025
python3 -m unittest discover -s analysis/tests -v
```

Las descargas futuras pueden cambiar de hash. Comparar con el lock antes de
atribuirles el informe versionado. El auditor calcula los hashes de sus entradas
reales y los incluye tanto en el informe como en cada registro canónico.

Salidas locales, ignoradas por Git:

- `games.jsonl`: una fila por game, equipos ordenados por ID de origen y target
  `win_a` binario. JSONL evita dependencias de Parquet en esta fase.
- `quarantine.json`: identificadores y motivos de rechazo; los registros raw se
  conservan para inspección. Los fallos de alineación aíslan ambos rosters y
  conservan el matchup válido.
- `audit.json`: esquema observado, faltantes, cobertura por liga, nombres de equipo
  observados, exclusiones y hash del corpus canónico.

Mismos bytes, zona, corte y versión producen exactamente las mismas salidas.
No se incluyen horas de ejecución variables en estos tres archivos.
Solo se versionan el lock y los informes pequeños de `models/reports/`.
Los CSV completos y el corpus nunca se cargan en la web.

## Resultado y límites observados

| Comprobación 2025 | Resultado |
| --- | ---: |
| Filas equipo | 20.106 |
| Filas jugador | 100.530 |
| Games de origen | 10.053 |
| Games canónicos con dos alineaciones completas | 9.573 |
| Games excluidos por ID de equipo ausente | 480 |
| Games con serie verificada / elegibles para momentum | 0 |

Los campos `bo_format`, `match_in_series` y `game_in_match` están vacíos en todas
las filas equipo. Existe `game_number`, pero no identifica una serie; se conserva
como observación y no se reconstruyen series por proximidad temporal. `series_id`,
`best_of`, marcador previo e índice verificado permanecen en `null`.

Los jugadores tienen `playername`, sin ID estable. Se conservan cinco nombres/roles
por lado como **alineación observada**, con hash de contenido ligado al equipo;
no se afirma continuidad de identidad ante aliases ni vigencia de plantillas.
Los nombres de equipo por ID también son observaciones, sin mapa de renombres
verificado por fecha. Los IDs del proveedor no se confunden con los IDs del torneo.

`date` carece de zona horaria. `--source-timezone UTC` es una **suposición explícita**,
no un dato confirmado. `timezone_verified=false` y `training_ready=false` en el
informe. El filtro es estricto (`event_start_utc < cutoff`), bajo esa suposición.
No se conoce la hora de publicación del resultado (`available_at_utc=null`).
El corpus no prueba disponibilidad pre-game ni habilita entrenamiento temporal.
No se incluyen estadísticas postgame ni picks/bans en el esquema canónico.

Falta verificar zonas/horas de disponibilidad, enlazar series y resolver identidades
por fecha. La ampliación a 2024/2026 se detalla a continuación. No se ha obtenido GPR histórico ni se
ha usado el snapshot de 2026 para encuentros antiguos. La construcción de features
(V3-C) queda para un bloque independiente, con estas restricciones explícitas.

## Comprobación de este bloque

22 pruebas Python: canonicalización y join por lado, cortes estrictos, zona explícita,
contextos incompatibles, duplicados, IDs/resultados inválidos, alineaciones incompletas,
esquema malformado, aislamiento de datos futuros, hashes e importación idempotente;
transporte de descarga simulado, fallo sin lock parcial y caché corrupta.
Regresión: 142 pruebas Vitest, 42 pruebas Laravel (528 aserciones) y typecheck.
La repetición de la auditoría real conserva byte a byte las tres salidas.


## Corpus 2024–2026: segundo bloque V3-B

Importar también `teams` y `players` de 2024/2026 con el comando anterior cambiando
`--season` y el archivo. El lock contiene seis archivos gzip íntegros. Los cortes
de conexión iniciales no se registraron como adquisiciones correctas; se repitió
la descarga y solo se importaron archivos que pudieron descomprimirse y leerse.

```bash
python3 analysis/src/corpus.py --seasons 2024 2025 2026 \
  --as-of 2026-10-21T00:00:00Z --source-timezone UTC \
  --output data/curated/chaincc-2024-2026
```

La selección usa **el corte exacto del lock** y exige un único archivo de cada tipo
por temporada. Si hay varias versiones del mismo origen/corte, revisar y seleccionar
explícitamente las entradas del lock; nunca se elige «latest» por orden de lectura.
Antes de auditar se comprueban SHA-256, tamaño, columnas, número de filas y temporada
declarada (`year`). Un path fuera del repositorio o un game ID repetido entre
archivos de distintas temporadas causa un error y no escribe salidas del corpus.
La deduplicación no puede ocultar conflictos de procedencia.

El resultado se ordena cronológicamente. El informe incluye el hash de las fuentes
seleccionadas del manifiesto, fuentes individuales, cobertura por mes/liga y
exclusiones por temporada/liga. Los meses son diagnóstico de cobertura, no folds
de entrenamiento. No se han contado los mismos games dos veces.

| Temporada | Games de origen | Canónicos | Sin ID de equipo | Resultado inválido |
| --- | ---: | ---: | ---: | ---: |
| 2024 | 10.199 | 9.905 | 292 | 2 |
| 2025 | 10.053 | 9.573 | 480 | 0 |
| 2026 | 9.753 | 9.313 | 440 | 0 |
| Total | 30.005 | 28.791 | 1.212 | 2 |

Las 28.791 partidas canónicas tienen ambas alineaciones observadas completas;
hay 728 IDs de equipo distintos. Esto no significa 728 organizaciones históricas
resueltas. Por ejemplo, la cobertura excluida de 2025 incluye 252 partidas de LJL:
las pérdidas no se distribuyen uniformemente entre ligas. El informe desglosa las
exclusiones para evitar tratar la muestra restante como representativa sin comprobarlo.

La fecha máxima aceptada en 2026 es `2026-10-18T19:48:36+00:00`, bajo la suposición
UTC indicada. Ningún game de estos archivos superó el corte, por lo que el límite
exacto se verifica también con fixtures sintéticos. No se confirma la zona horaria
ni la disponibilidad pública histórica por observar fechas compatibles.

`bo_format`, `match_in_series` y `game_in_match` también están vacíos en las otras
dos temporadas. No hay series verificadas ni corpus de momentum. No se ha encontrado
evidencia suficiente para retirar los límites de zona, disponibilidad o identidad:
`training_ready` continúa en `false`. Ningún dato del corpus se publica en la app.

Informe: `models/reports/chaincc-2024-2026-v3b/audit.json`. El informe anterior de
2025 conserva su versión `chaincc-audit-v1`; el auditor actual usa `chaincc-audit-v2`
por el desglose adicional de exclusiones. El hash canónico de 2025 sigue siendo
idéntico al del primer bloque. La repetición real con temporadas en orden distinto
conservó los tres archivos de salida byte a byte.

Validación: **35 pruebas Python**, 142 Vitest, 42 Laravel (528 aserciones) y typecheck.
Los casos nuevos cubren selección inequívoca, cutoff, integridad del lock,
temporadas mal etiquetadas, colisiones de games, orden reproducible y cambios en
alineaciones futuras que no modifican registros anteriores.

Siguiente bloque: completar el contrato temporal/identidades con evidencia fechada
antes de habilitar features de forma y continuidad de plantilla de V3-C. Sin series
verificadas no se entrenarán efectos de secuencia. El predictor público sigue usando
los presets existentes; no se ha ajustado ni calibrado ningún parámetro.

## Identidades fechadas: tercer bloque V3-B

```bash
python3 analysis/src/identities.py \
  --games data/curated/chaincc-2024-2026/games.jsonl \
  --audit models/reports/chaincc-2024-2026-v3b/audit.json \
  --as-of 2026-10-21T00:00:00Z --output data/curated/chaincc-identities
```

Antes de producir salidas se comprueban el hash y el número de registros del corpus.
El corte solicitado puede ser anterior al del corpus, nunca posterior. Se filtran
los games **antes** de agrupar nombres y jugadores, evitando que un renombre o una
sustitución futura aparezca en un registro retrospectivo anterior. Este filtro no
acredita por sí mismo la disponibilidad pública de esas observaciones en aquel momento.

`identities.json`, local e ignorado por Git, agrupa por ID de origen los nombres y
las alineaciones observadas. Cada grupo incluye primera/última observación, IDs de
los games de ambos extremos y número de observaciones. No son fechas de vigencia:
no se rellenan intervalos sin datos ni se declara una alineación como plantilla
oficial o conocida pre-game. Los nombres de jugadores siguen sin ser identidades
estables; se comprueba el hash de cada alineación antes de usarla.

El informe pequeño versionado está en
`models/reports/chaincc-identities-v3b/audit.json`. Conserva hashes del corpus,
informe de origen y registro de identidades, corte, ambigüedades y bloqueos temporales.

Resultados del corpus real:

- Dos IDs con varios nombres observados: Los Heretics / Team Heretics Academy y
  Dplus Kia Youth / Dplus Kia Academy. Se conserva cada observación fechada, sin
  asumir que un cambio de nombre representa continuidad de organización o plantilla.
- Dos nombres con varios IDs: Los Heretics y ZEN Esports. No se fusionan historiales.
- Ocho registros presentan a los mismos equipos a la misma hora bajo IDs de game
  distintos. Se aíslan **todos** los implicados en el registro derivado, sin escoger
  un duplicado «correcto» ni modificar el corpus congelado del bloque anterior.
- El registro resultante contiene **28.783 partidas**, 728 IDs y 4.081 alineaciones
  distintas observadas. `identity_eligible_games` se refiere solo a este registro,
  no a elegibilidad para entrenamiento o a disponibilidad pre-game.

Los ocho registros son cuatro pares de posibles duplicados, de LDL y LIT en 2024.
Los IDs y sus coincidencias temporales quedan en el informe. Coinciden también
rival, resultado y alineaciones en los casos inspeccionados. La causa no está
verificada: no se declara una deduplicación histórica resuelta. El corpus fuente
sigue conteniendo 28.791 games canónicos por ID; este hallazgo precisa la garantía
anterior: la unicidad de ID no demuestra unicidad del encuentro real.

Las 28.791 observaciones carecen de `available_at_utc` y de serie verificada.
Cuando se aporte una hora de disponibilidad, debe ser posterior al inicio y anterior
al corte para no quedar bloqueada por disponibilidad. No se sustituye por el inicio
del game, la fecha del archivo o la fecha de importación.

La revisión del [diccionario histórico de Oracle’s Elixir](https://lol.timsevenhuysen.com/matchdata/match-data-dictionary/)
y de las páginas de ChainCC no aporta confirmación suficiente de zona horaria y
publicación para estos CSV modernos. El diccionario describe una estructura antigua;
no se extrapola automáticamente al esquema actual. Las fuentes consultadas y la
fecha de revisión se conservan aquí; no se ha importado un segundo dataset.

**47 pruebas Python**: se añaden cortes antes de alias/roster, nombres compartidos
sin fusión, nuevos jugadores sin modificar el pasado, orden determinista, aislamiento
de coincidencias temporales, disponibilidad de resultados, integridad y rechazo de
cortes posteriores al corpus. El registro y su informe reales son reproducibles byte
a byte. Regresión: 142 Vitest, 42 Laravel (528 aserciones) y typecheck.

La auditoría V3-B deja documentados datos observables y carencias concretas. Para
V3-C, el contrato temporal debe mantener como faltantes los resultados/alineaciones
sin evidencia de disponibilidad; no aprender forma o continuidad usando estos
registros como si todos fueran conocidos antes de jugar. Los efectos de serie se
mantienen fuera hasta disponer de un vínculo verificado.

## V3-C · primer bloque: contrato temporal pre-game

`analysis/src/temporal.py` prepara el acceso a resultados y plantillas con evidencia
fechada. No calcula forma residual, Elo, probabilidades, continuidad ni coeficientes.
No se ejecuta en Laravel ni en la web.

Contratos inmutables:

- `Evidence`: referencia y SHA-256 de bytes de una fuente revisada. Su presencia es
  una declaración del llamador; un hash no acredita por sí solo veracidad, zona
  horaria o fecha histórica de publicación. El importador futuro deberá revisarlos.
- `HistoricalResult`: game, equipos de origen, target binario, inicio, disponibilidad
  y evidencia separada de hora/resultado. No admite estadísticas postgame ni GPR
  actual como campos del contrato. Sin evidencia o disponibilidad queda fuera del
  historial consultable. Disponibilidad debe ser posterior al inicio.
- `RosterSnapshot`: cinco IDs estables, equipo, disponibilidad, inicio de vigencia
  y final opcional. No se convierten los nombres de ChainCC en IDs estables.
- `PreGameQuery`: game objetivo, equipos, inicio y `as_of_utc < game_start_utc`.
  Todos los timestamps requieren zona explícita y se normalizan a UTC.

`TemporalHistory.results_before(team_id, query, window_days=30)` devuelve resultados
iniciados en `[as_of - ventana, as_of)`, con disponibilidad **estrictamente anterior**
al corte y ambas evidencias. Excluye el game objetivo y los IDs en cuarentena.
La ventana es una opción de consulta, no un hiperparámetro calibrado. No se realiza
ponderación por series ni entrenamiento cuando falta su vínculo. La entrada se
indexa por equipo y el orden de salida es determinista.

La vista devuelve estado `observed` cuando hay resultados elegibles y `missing`
cuando no los hay. Una vista vacía no acredita cero partidas históricas, cero forma
ni cobertura completa; no se imputan valores. La falta de GPR histórico tampoco
activa un fallback al snapshot actual.

`roster_before` utiliza solo snapshots disponibles antes del corte y ya efectivos.
Una noticia tardía con fecha efectiva retroactiva no modifica consultas anteriores.
Una plantilla anunciada antes pero aún no efectiva tampoco se utiliza. Se elige el
snapshot con fecha efectiva más reciente; una revisión conocida posterior resuelve
la misma fecha efectiva. Conflictos en la misma fecha efectiva y de disponibilidad
producen error, sin decidir por orden de entrada. Si la última plantilla conocida
ha caducado, se devuelve `None`; no se recupera silenciosamente una plantilla antigua.
Los IDs de jugadores se copian a una tupla ordenada para evitar cambios posteriores
por mutaciones de una lista del llamador. Este bloque no modela roles ponderados.

### Cobertura real, sin generar features ficticias

```bash
python3 analysis/src/temporal_audit.py \
  --games data/curated/chaincc-2024-2026/games.jsonl \
  --corpus-audit models/reports/chaincc-2024-2026-v3b/audit.json \
  --identity-audit models/reports/chaincc-identities-v3b/audit.json \
  --output data/curated/chaincc-temporal/coverage.json
python3 -m unittest discover -s analysis/tests -v
```

La auditoría exige hashes compatibles del corpus y ambos informes, el mismo corte
y una cuarentena que solo contenga IDs del corpus. Registra 28.791 games fuente,
ocho en cuarentena y **28.783 candidatos**. El esquema canónico actual no contiene
referencias revisadas de disponibilidad/hora ni snapshots pre-game con IDs de jugador
estables; los resultados con evidencia temporal revisada y snapshots pre-game
utilizables son **cero**. No se presentan como cero los valores de los predictores:
forma reciente, continuidad y GPR histórico figuran como `status: missing, value: null`.
No se imputan evidencias ni se fabrican forecasts históricos para generar cifras.

Informe versionado: `models/reports/chaincc-temporal-contract-v3c/coverage.json`.
Modo `coverage_only`, `training_ready=false`. Este auditor describe únicamente el
esquema canónico actual; no es un importador de nuevas evidencias ni un entrenamiento.
Mismos archivos de entrada producen el mismo informe byte a byte.

Validación del bloque: **67 pruebas Python** en total, 142 Vitest, 42 Laravel
(528 aserciones) y typecheck. Las 20 nuevas pruebas cubren corte pre-game estricto,
ventana temporal, disponibilidad, cuarentena, resultado objetivo excluido, cambios
futuros de outcomes/jugadores sin efectos anteriores, plantillas tardías/futuras/
caducadas/ambiguas, datos inmutables e integridad de los informes de origen.
Los fixtures sintéticos prueban el contrato; no son evidencia histórica real.

Pendiente de V3-C: importar evidencia temporal e identidades revisadas, obtener una
referencia pre-game histórica y entonces construir forma residual y continuidad
con cobertura trazable. Se mantiene la necesidad de separar series en la validación.
No se ha entrenado, calibrado o habilitado ningún preset adicional y no ha cambiado
el formato de escenarios, la interfaz ni las probabilidades públicas.

## V3-C · segundo bloque: importar evidencia revisada

`analysis/src/reviewed.py` conecta archivos de evidencia locales con `TemporalHistory`.
No cambia los CSV, el corpus canónico ni los informes congelados. No descarga fuentes
ni deduce fechas o IDs: importa anotaciones explícitas ya revisadas contra sus fuentes.
Esta revisión de contenido no es una aprobación de modelo ni habilita el preset v3.

```bash
python3 analysis/src/reviewed.py \
  --bundle data/raw/evidence/mi-revision/bundle.json \
  --games data/curated/chaincc-2024-2026/games.jsonl \
  --corpus-audit models/reports/chaincc-2024-2026-v3b/audit.json \
  --identity-audit models/reports/chaincc-identities-v3b/audit.json \
  --output data/curated/mi-revision
```

El bundle es un objeto JSON con estas claves, sin campos adicionales:

| Nivel | Campos |
| --- | --- |
| Raíz | `schema_version: 1`, `source_canonical_sha256`, `source_corpus_audit_sha256`, `source_identity_audit_sha256`, arrays `sources`, `results`, `rosters` |
| Cada fuente | `id`, `path`, `reference`, `sha256`, `retrieved_at_utc`, `reviewed_at_utc`, `review_note`, `license` |
| Cada resultado | `game_id`, `team_a_id`, `team_b_id`, `win_a`, `event_start_utc`, `available_at_utc`, `time_source_id`, `result_source_id` |
| Cada plantilla | `snapshot_id`, `team_id`, `player_ids`, `effective_from_utc`, `available_at_utc`, `source_id`; opcional `effective_until_utc` |

Los tres hashes raíz identifican los bytes exactos del corpus y sus dos informes
(`sha256sum archivo`). Los IDs de equipo/outcome de cada anotación deben coincidir
con el game canónico; se rechazan IDs desconocidos y todos los de la cuarentena.
`player_ids` debe contener cinco IDs estables revisados, no nombres convertidos por
el programa. Los IDs de snapshot y game deben ser únicos en el bundle. No se aceptan
estadísticas postgame, ratings actuales ni columnas adicionales como features.

Guardar las fuentes referenciadas dentro del directorio del bundle (`path` resuelto
sin salir de él); se comprueba el SHA-256 real de cada archivo. `reference` identifica
su origen y `license` registra los términos revisados. `review_note` debe explicar
la evidencia concreta para fecha, resultado o identidades y sus limitaciones, con
localizadores de los registros cuando proceda. Un texto genérico o un hash correcto
**no demuestra** que la interpretación histórica sea cierta: el importador valida
estructura y coherencia, no autentica el contenido del proveedor.

Todos los timestamps requieren zona explícita. La revisión no puede preceder a la
captura de los bytes revisados, y una disponibilidad afirmada no puede ser posterior
a la captura que la respalda. Esto no convierte la captura en fecha de publicación:
para afirmar una disponibilidad anterior hay que justificarla con el contenido o un
archivo fechado. Games y disponibilidades importados deben preceder al corte global;
una plantilla puede estar anunciada y ser efectiva después, pero `roster_before`
no la aplicará anticipadamente.

Las correcciones de zona/hora son posibles solo como anotaciones separadas con
evidencia: `reviewed_start_corrections` muestra el valor original y el revisado.
No se sobrescribe silenciosamente la fecha canónica. Las plantillas incompatibles
para el mismo equipo, fecha efectiva y disponibilidad se rechazan antes de escribir.

Las salidas locales son `dataset.json` y `audit.json`, con hashes de fuentes/bundle,
entradas congeladas, conteos importados y correcciones. No incluyen parámetros de
modelo. `training_ready` permanece en `false`, incluso con anotaciones válidas:
faltan cobertura, features y validación temporal/predictiva. No se versionan en Git
corpus enriquecidos ni evidencias grandes; las rutas de ejemplo ya están ignoradas.

Para consumirlos offline:

```python
from pathlib import Path
from reviewed import load_imported_history

history = load_imported_history(
    Path('data/curated/mi-revision/dataset.json'),
    Path('data/curated/mi-revision/audit.json'),
)
# Usar results_before / roster_before con PreGameQuery, nunca el dataset completo
# como historial de todos los games sin respetar disponibilidad.
```

El cargador comprueba versión, hash y recuentos antes de construir el historial.
Se mantiene el filtro temporal del bloque anterior. Los ejemplos sintéticos completos
están en `analysis/tests/test_reviewed.py`; no representan datos históricos acreditados.

**Resultado comprobado:** 92 pruebas Python (25 nuevas), 142 Vitest, 42 Laravel
(528 aserciones) y typecheck. Se prueba importación/serialización/recarga/consulta,
integridad, anotaciones incompatibles, cuarentena, fechas, duplicados, conflictos y
error de CLI sin salidas. Mismos inputs producen bytes idénticos. Sobre el corpus
real se verificó además un bundle vacío: sigue vacío, no fabrica evidencias y no
modifica el hash fuente. No se versiona ese artefacto de prueba vacío como si fuese
un nuevo corpus científico.

La revisión de las páginas de [datos](https://chaincc.lol/free/data/) y
[metodología](https://chaincc.lol/about/methodology), el 21-10-2026, no aporta las
fechas históricas de disponibilidad por game ni IDs estables de jugador para los
CSV inspeccionados. Se conserva la cobertura pendiente: **no se han incorporado
nuevos hechos históricos acreditados** en este bloque. El siguiente paso de datos
es obtener y revisar esas evidencias; el siguiente de features las consumirá sin
imputar una forma residual ni reutilizar GPR de 2026 para ejemplos antiguos.

## Referencia histórica Elo — primer backtest con el corpus existente

La investigación retrospectiva puede avanzar con los datos disponibles. Se mantienen
dos rutas: el contrato temporal estricto para evidencia acreditada y este experimento
con **supuestos declarados de disponibilidad**. Este último no rellena `available_at_utc`
en el corpus, no crea referencias `Evidence` ficticias ni rebaja los controles del
modelo público. La falta de timestamps de publicación no bloquea este benchmark.

`analysis/config/internal-elo-v1.json` se versionó antes de ejecutar las métricas
reales. Define `internal_elo_baseline`: rating inicial 1500, K=32 y divisor=400,
fijos y provisionales. Son unidades propias, sin equivalencia al GPR de Riot.
Los ratings se aprenden secuencialmente; no se han ajustado hiperparámetros,
calibradores, bonos o factores contextuales con el test.

```bash
python3 analysis/src/backtest.py \
  --games data/curated/chaincc-2024-2026/games.jsonl \
  --corpus-audit models/reports/chaincc-2024-2026-v3b/audit.json \
  --identity-audit models/reports/chaincc-identities-v3b/audit.json \
  --protocol analysis/config/internal-elo-v1.json \
  --output data/curated/internal-elo-v1
python3 -m unittest discover -s analysis/tests -v
```

### Protocolo temporal y cálculo

- Calentamiento: 2024. Desarrollo: 08-01-2025 hasta 01-01-2026 (excluido).
  Evaluación: 08-01-2026 hasta 01-09-2026 (excluido).
  Tramo final reservado del experimento: 08-09-2026 hasta 21-10-2026 (excluido).
- Hay siete días de separación antes de cada nuevo periodo puntuado. Los 294 games
  en huecos se excluyen tanto de métricas como de actualizaciones. Los 9.897 games
  de 2024 restantes tras la cuarentena solo calientan el estado.
- Se interpreta la fecha fuente como UTC y se **supone** que cada resultado pasa a
  estar disponible uno, tres o siete días después del inicio. Un día es el escenario
  principal predefinido; los otros dos miden sensibilidad y no seleccionan un ganador.
  Estos retrasos no se presentan como fechas verificadas de publicación.
- Antes de cada game se procesan solo resultados con disponibilidad supuesta
  estrictamente anterior. Se guarda la probabilidad pre-game. Al llegar el resultado,
  `delta = K * (win_a - p_pre_game)` se suma a A y se resta a B. No se recalcula la
  predicción antigua con ratings que ya contengan resultados posteriores.
- El estado sigue actualizándose durante los periodos puntuados, después del retraso
  supuesto: es evaluación secuencial con feedback, no evaluación de ratings congelados.
  Los hiperparámetros permanecen iguales en todos los periodos.
- Se usan IDs de equipo de origen, sin fusionar nombres ni proyectar rosters actuales
  hacia atrás. No se usan kills/gold/draft del objetivo, GPR actual, región inventada
  ni efectos de serie. Los ocho registros ambiguos siguen excluidos.

`baseline.py` calcula log-probabilidades de forma estable. La actualización conserva
la suma de ratings. Nuevos equipos parten del mismo prior, y los cold starts se
cuentan según resultados ya disponibles, sin contar partidas aún pendientes.

### Métricas observadas

Informe: `models/reports/internal-elo-v1/metrics.json`. Escenario principal, retraso
supuesto de un día; menor log loss/Brier es mejor:

| Periodo | Games | Log loss | Brier | Accuracy |
| --- | ---: | ---: | ---: | ---: |
| Desarrollo 2025 | 9.573 | 0,65338 | 0,23048 | 61,14 % |
| Evaluación 2026 | 7.839 | 0,64442 | 0,22578 | 63,02 % |
| Tramo final 2026 | 1.180 | 0,65654 | 0,23132 | 61,36 % |
| Referencia 50/50 | — | 0,69315 | 0,25000 | 50 % esperado |

Accuracy asigna medio acierto a empates exactos de probabilidad, evitando favorecer
el orden arbitrario A/B. El informe incluye bins de calibración, buckets de favoritos,
ligas, cold starts, equipos/rivales distintos y métricas internacionales según los
labels fuente predeclarados `MSI`, `WLDs`, `FST`, `EWC`. Este subconjunto no acredita
etapas/regiones ni cobertura internacional completa. El tramo final contiene solo
34 games de ese subconjunto; no se extraen conclusiones fuertes de ellos.

La mejora puntual de log loss frente al 50/50 en el tramo final es 0,03661. Su
intervalo agrupado aproximado al 95 % es **[-0,01333; 0,06608]**, e incluye cero.
El bootstrap pareado usa 1.000 réplicas, semilla 42 y grupos `league/year/split`,
como aproximación amplia a eventos. No se remuestrean games como si fueran
independientes. Sin IDs verificados no se afirma un bootstrap real por series ni
que ninguna serie/evento largo cruce las particiones. Con menos de dos grupos no
se publica intervalo. Las bandas son exploratorias y dependen de esa agrupación.

Sensibilidad en el tramo final: log loss **0,65654 / 0,66081 / 0,66270** para retrasos
supuestos de 1/3/7 días. Sus intervalos agrupados de mejora incluyen cero en los tres
casos. No se ha elegido un retraso ni ajustado K después de comparar estas cifras.
La comparación es frente a 50/50, **no frente a GPR histórico**, del que no se dispone.

### Reproducción y siguiente bloque

Se guardan localmente las predicciones pre-game de cada retraso con ratings previos,
probabilidad y disponibilidad supuesta. Los hashes de esos JSONL, protocolo, código,
corpus e informes quedan en el reporte, junto con Python 3.14.8. Las predicciones
completas siguen ignoradas por Git; solo se versiona el reporte agregado. Dos
repeticiones reales produjeron exactamente los mismos bytes en todos los archivos.

Validación: **108 pruebas Python**, 142 Vitest, 42 Laravel (528 aserciones) y typecheck.
Los 16 casos nuevos verifican Elo, log loss extremo, suma constante, feedback
retrasado con la probabilidad guardada, ausencia de fuga del objetivo/futuro,
embargo, determinismo, métricas/agrupación e integridad de archivos. Los tests de
contratos temporales anteriores también siguen pasando.

Esta es una referencia inicial útil, **no un modelo contextual calibrado**. No se
exportan ratings/coeficientes a la web ni se habilita un preset. El tramo final ya
ha sido consultado: no deberá reutilizarse como test ciego independiente para
seleccionar nuevas variantes. El siguiente bloque comparará forma residual frente
a este Elo mediante un protocolo temporal fijado antes de evaluar la variante,
con la selección de parámetros limitada a desarrollo y sus límites explicitados.
No es necesario conseguir más datos para iniciar esa comparación.

## Forma residual — comparación incremental frente al Elo

`analysis/config/residual-form-v1.json` se fijó antes de evaluar las variantes.
Referencia: el informe y las predicciones congeladas de `internal-elo-v1`, ligados
por SHA-256. No se recalculan ratings con la forma ni se alteran sus innovaciones.

```bash
python3 analysis/src/form_backtest.py \
  --baseline-report models/reports/internal-elo-v1/metrics.json \
  --predictions-dir data/curated/internal-elo-v1 \
  --protocol analysis/config/residual-form-v1.json \
  --output data/curated/residual-form-v1
```

Si faltan las predicciones locales, ejecutar antes el backtest Elo descrito arriba.
Los hashes deben coincidir con el experimento congelado. Un cambio de entorno o
protocolo que cambie esos bytes requiere una nueva revisión, sin sustituir los
archivos del experimento anterior bajo el mismo identificador.

### Definición y selección

Para cada game previo, la innovación de A es `win_a - p_baseline_pre_game`; la de B
es su opuesta. Solo entra en el historial cuando su disponibilidad **supuesta** es
anterior al game objetivo. El resultado del objetivo nunca participa en su feature.
Las innovaciones proceden de predicciones secuenciales anteriores al resultado,
no de un ajuste retrospectivo que ya conozca ese resultado.

En una ventana de 14, 30 o 60 días se calcula la media de innovaciones por equipo
y día fuente. Después se suman las medias diarias y se dividen por `días + 3`:
los tres días de prior reducen hacia cero las muestras pequeñas. Así una Bo5 no
aporta cinco veces el peso de una Bo1 del mismo día. Es una aproximación por día,
no agrupación por series verificadas. La ventana se refiere a fecha de inicio y
solo contiene resultados ya disponibles bajo el retraso supuesto del escenario.

```text
form_team = sum(mean_innovation_by_day) / (observed_days + 3)
logit(p_candidate_A) = logit(p_baseline_A) + beta * (form_A - form_B)
```

Se contrastan nueve variantes: ventanas 14/30/60 × beta 0,5/1/2, más la referencia
sin ajuste. Los valores de ventana, shrinkage y rejilla son decisiones de investigación,
no parámetros calibrados. La selección minimiza log loss **solo en 2025** y con el
retraso principal de un día. En empate numérico se conserva la opción previa más
simple, empezando por Elo sin forma. El mismo resultado de selección se utiliza
para los retrasos de 3 y 7 días; no se elige de nuevo mirando esos resultados.

Sin historial elegible se conserva `status: missing, value: null`. El equipo no
aporta ajuste al predictor, como prior neutral explícito; eso no acredita una forma
observada igual a cero ni cobertura completa. Con historial, la feature se marca
`estimated` por los supuestos de fechas/disponibilidad. Se conservan juegos y días
de soporte. Con beta cero o diferencia cero se reutilizan exactamente los valores
originales de p, log loss y Brier, sin introducir redondeos por conversiones extra.

### Resultados reales y decisión

Selección en desarrollo: **14 días, beta 1**, con shrinkage fijo de tres días.
No se ha cambiado tras observar 2026. Informe agregado:
`models/reports/residual-form-v1/metrics.json`.

Escenario principal de disponibilidad supuesta al día siguiente:

| Periodo | Games | Log loss Elo | Log loss con forma | Brier Elo | Brier con forma |
| --- | ---: | ---: | ---: | ---: | ---: |
| Desarrollo 2025 | 9.573 | 0,65338 | 0,65087 | 0,23048 | 0,22939 |
| Evaluación 2026 | 7.839 | 0,64442 | 0,64165 | 0,22578 | 0,22450 |
| Tramo final 2026 | 1.180 | 0,65654 | 0,65776 | 0,23132 | 0,23185 |

La mejora de log loss sobre Elo en evaluación es 0,00278, con intervalo agrupado
aproximado `[0,00079; 0,00483]`. En el tramo final es **−0,00122**, con intervalo
`[−0,00582; 0,00331]`, que incluye cero. El bootstrap es pareado por los mismos games,
con el proxy `league/year/split`, 1.000 réplicas y semilla 42. Hereda las limitaciones
del experimento Elo: no prueba independencia por serie ni estabilidad general.
Las métricas/intervalos de desarrollo son posteriores a selección entre candidatos;
no son una validación independiente ajustada por esa selección.

En las 348 partidas internacionales de evaluación, la forma empeora el log loss
unos 0,00532 con el retraso principal. El tramo final internacional solo tiene 34
games. La mejora global no se presenta como una mejora demostrada para Worlds.
El tramo final empeora también con retrasos supuestos de tres y siete días, con
intervalos que incluyen cero. No se adapta la ventana, el signo o el coeficiente
para corregir estas observaciones de 2026.

Se conserva **Elo sin forma como referencia para los próximos experimentos**.
La forma reciente queda como hipótesis investigada, sin incorporarse al preset
público ni tratar su coeficiente como calibrado. Ningún preset entrenado se habilita.
La evidencia no justifica añadir complejidad pública en este bloque.

La disponibilidad de forma para ambos equipos en evaluación es de 6.448/7.839 games;
en el tramo final, 869/1.180. El resto puede tener historial solo para uno o ninguno.
El informe registra esa cobertura, variantes de desarrollo, sensibilidad, calibración,
ligas, comparaciones pareadas globales/internacionales y hashes. Las predicciones
completas permanecen locales e ignoradas. Dos ejecuciones reales produjeron idénticos
bytes en todos los archivos. La base congelada no se ha modificado.

### Validación y siguiente bloque

**126 pruebas Python**, 142 Vitest, 42 Laravel (528 aserciones) y typecheck. Los 18
casos nuevos comprueban retrasos, expiración, agregación por día, faltantes frente
a cero observado, antisimetría, equivalencia exacta sin efecto, residual del baseline,
exclusión de objetivo/futuro, selección insensible a outcomes de 2026, bootstrap
pareado frente a Elo, integridad y protección de los archivos fuente.

Los resultados de 2026 son comparaciones diagnósticas: el tramo final ya se había
consultado al evaluar Elo, y no se anuncia como test ciego nuevo. No se usarán estos
resultados para presentar una variante retocada como si no hubiera visto 2026.
El siguiente bloque puede contrastar estabilidad de alineaciones **observadas en
partidas anteriores**, con proxies explícitos y sin usar la alineación del game
objetivo como si se conociera pre-game. No necesita descargar otro dataset ni
incorporar la forma descartada al modelo de referencia.

## Estabilidad de alineaciones observadas — comparación frente al Elo

Protocolo previo a métricas: `analysis/config/lineup-stability-v1.json`.
Se usa Elo **sin forma residual** y el mismo corpus, sin descargar nuevas fuentes.
Las alineaciones se enlazan por game ID, equipos, fecha y resultado, comprobando
los hashes del corpus y las predicciones congeladas. No se usa la alineación del
game objetivo como predictor ni se exportan sus nombres en las features.

```bash
python3 analysis/src/stability_backtest.py \
  --baseline-report models/reports/internal-elo-v1/metrics.json \
  --predictions-dir data/curated/internal-elo-v1 \
  --games data/curated/chaincc-2024-2026/games.jsonl \
  --protocol analysis/config/lineup-stability-v1.json \
  --output data/curated/lineup-stability-v1
```

### Indicador y límites de identidad

En cada predicción se toma la última alineación de cada equipo cuyo game ya está
disponible bajo el retraso supuesto de 1/3/7 días. «Última» se refiere a fecha del
game: una observación antigua que llegue tarde no sustituye a otra más reciente.
La alineación del objetivo se añade al historial solo después de emitir sus features
y tras su futura disponibilidad supuesta. Si la última observación no tiene lineup,
no se recupera una anterior como si fuese la última plantilla conocida.

Se compara esa referencia con alineaciones observadas en **días anteriores al de
la referencia**, dentro de una ventana de 30 o 60 días. El solapamiento es número
de nombres compartidos dividido por cinco; se promedia primero por día para reducir
el peso de varias partidas de una serie. Se excluye todo el día de la referencia,
para evitar que una misma serie aporte simultáneamente referencia y evidencia de estabilidad.

```text
stability = (sum(mean_overlap_by_day) + 3 * 0.5) / (comparison_days + 3)
logit(p_candidate_A) = logit(p_elo_A) + beta * (stability_A - stability_B)
```

Tres días de prior hacia 0,5 reducen el efecto de muestras pequeñas. Ventana, prior
y shrinkage son hipótesis predefinidas, no magnitudes calibradas. La identidad usa
**nombres exactos dentro del mismo ID de equipo**, sin unir jugadores entre equipos,
normalizar aliases o afirmar IDs estables. No se conoce la plantilla confirmada
para el objetivo: se mide estabilidad del historial disponible, no calidad individual,
ausencias, continuidad causal o estado oficial del roster actual.

Sin referencia, sin días previos de comparación, con última alineación ausente o
con referencias simultáneas contradictorias, se devuelve `missing/null`. Si falta
el indicador para cualquiera de los dos equipos no hay ajuste: p, log loss y Brier
se mantienen idénticos al Elo. No se atribuye cero estabilidad a los faltantes.
Con datos válidos se registra `estimated`, días/games de soporte y game de referencia.

### Selección y resultados

Ocho alternativas: ventanas 30/60 × coeficientes −0,5/+0,5/−1/+1, más Elo sin ajuste.
La dirección del efecto se investiga; no se presupone que estabilidad implique fuerza.
Se elige por log loss de **2025 y retraso principal de un día**, prefiriendo Elo en
empate numérico. Esa selección queda fija para 2026 y los otros retrasos.

Opción seleccionada: **60 días, beta +0,5**. Informe:
`models/reports/lineup-stability-v1/metrics.json`.

| Periodo | Games | Log loss Elo | Log loss con estabilidad | Brier Elo | Brier con estabilidad |
| --- | ---: | ---: | ---: | ---: | ---: |
| Desarrollo 2025 | 9.573 | 0,65338 | 0,65292 | 0,23048 | 0,23028 |
| Evaluación 2026 | 7.839 | 0,64442 | 0,64405 | 0,22578 | 0,22557 |
| Tramo final 2026 | 1.180 | 0,65654 | 0,65603 | 0,23132 | 0,23111 |

La mejora puntual de log loss en evaluación es 0,00037; su intervalo agrupado
aproximado es **[−0,00022; 0,00097]**. En el tramo final la mejora es 0,00051,
con intervalo **[−0,00129; 0,00177]**. Ambos incluyen cero. También incluyen cero
los intervalos globales de los tres periodos en los retrasos de 1/3/7 días.
El bootstrap es pareado contra Elo, 1.000 réplicas, semilla 42 y proxy
`league/year/split`; no acredita independencia real por serie ni causalidad.
Las métricas de desarrollo se consultan tras seleccionar entre alternativas.

Hay indicador para ambos equipos en 6.600/7.839 games de evaluación y 1.050/1.180
del tramo final. En el subconjunto internacional de evaluación (348 games), la
mejora puntual principal es 0,00079; en los 34 games internacionales finales empeora
unos 0,00584. Son muestras/efectos que no justifican presentar una mejora para Worlds.
2026 sigue siendo diagnóstico, no un test ciego nuevo tras los experimentos anteriores.

**Decisión:** mantener Elo sin modificadores como referencia. No se activa estabilidad,
no se acumula con la forma residual y no se declara calibrado el coeficiente elegido.
La web y los escenarios mantienen su comportamiento. Esto no demuestra que las
plantillas no importen: esta aproximación concreta no aporta evidencia suficiente.

### Comprobación y siguiente paso

**147 pruebas Python**, 142 Vitest, 42 Laravel (528 aserciones) y typecheck. Los 21
casos nuevos verifican exclusión de plantilla/resultado objetivo y futuro, retraso
estricto, ventana, día de referencia excluido, ponderación diaria, referencias
antiguas tardías, faltantes/ambigüedades, antisimetría, equivalencia exacta sin efecto,
selección sin 2026, vinculación/integridad y protección de entradas. La ejecución
real y las predicciones se reprodujeron byte a byte. Solo se versionan protocolo e
informe agregado; el corpus y las predicciones completos siguen ignorados por Git.

Siguiente bloque: revisar los parámetros provisionales del **Elo propio** con
selección temporal en desarrollo y evaluación diagnóstica de estabilidad. No se
trasladarán esos parámetros a la escala GPR, ni se retocarán factores contextuales
para hacerlos ganar después de observar 2026.

## Parámetro de actualización del Elo propio — selección en desarrollo

El experimento `analysis/config/internal-elo-tuning-v1.json` fija una rejilla de
**K=8/16/32/64** antes de calcular sus métricas. Solo 2025 y el retraso principal de
un día seleccionan K. Se recalcula el calentamiento de 2024 para cada alternativa,
sin utilizar ningún game de 2026 en esa selección. Los empates numéricos conservan
K=32, la referencia existente. No se incorporan forma, alineaciones o bonos.

```bash
python3 analysis/src/elo_tuning.py \
  --games data/curated/chaincc-2024-2026/games.jsonl \
  --corpus-audit models/reports/chaincc-2024-2026-v3b/audit.json \
  --identity-audit models/reports/chaincc-identities-v3b/audit.json \
  --baseline-report models/reports/internal-elo-v1/metrics.json \
  --predictions-dir data/curated/internal-elo-v1 \
  --protocol analysis/config/internal-elo-tuning-v1.json \
  --output data/curated/internal-elo-tuning-v1
```

### Qué se ajusta y qué no

K controla la velocidad de actualización con el error de predicción pasado. Se
mantienen divisor 400 y rating inicial 1500 como convenciones de escala. Para Elo
interno, escalar todos los ratings, K y divisor por el mismo factor, o desplazar
el origen de ratings, conserva las probabilidades. Por eso no se buscan K y divisor
independientemente: lo identificable de la actualización es su relación K/divisor.
No se estima el divisor de probabilidades **GPR** con resultados y ratings propios.

El K elegido queda fijo para los tres retrasos y todos los periodos de evaluación.
Los ratings continúan aprendiendo secuencialmente tras cada disponibilidad supuesta,
como en el primer benchmark; no se vuelven a seleccionar hiperparámetros en 2026.
El calentamiento, los siete días de separación, la cuarentena, las hipótesis de
fechas/disponibilidad y el bootstrap agrupado se conservan.

### Resultado

Log loss en las **9.573 partidas de desarrollo de 2025**, menor es mejor:

| K | Log loss |
| --- | ---: |
| 8 | 0,66135 |
| 16 | 0,65471 |
| **32** | **0,65338** |
| 64 | 0,66779 |

La selección devuelve **K=32**. No se amplía la rejilla después de ver 2026 ni se
presenta este mínimo entre cuatro candidatos como un óptimo universal o una prueba
de significación entre ellos. No hay un nuevo parámetro que incorporar a la web.

La evaluación principal se mantiene: 7.839 games de 2026, log loss 0,64442 y Brier
0,22578; tramo final de 1.180 games, 0,65654 y 0,23132. Las predicciones seleccionadas
son idénticas byte a byte a las de la referencia original para retrasos de 1/3/7 días.
Sus diferencias pareadas e intervalos `[0, 0]` reflejan **identidad de predicciones**,
no certeza estadística sobre el rendimiento futuro del modelo.

Informe agregado: `models/reports/internal-elo-tuning-v1/metrics.json`, con candidatos
de desarrollo, protocolo de replay seleccionado, calibración, ligas, internacionales,
comparaciones pareadas y hashes. Conserva estado `development_selected_not_publicly_validated`;
no afirma calibración probabilística, estabilidad por región o mejora sobre GPR.
2026 sigue siendo diagnóstico por la inspección de esos periodos en experimentos
anteriores. Las métricas de desarrollo se consultan tras la selección.

### Comprobación y siguiente paso

**159 pruebas Python**, 142 Vitest, 42 Laravel (528 aserciones) y typecheck. Los doce
casos nuevos cubren equivalencia de escala/origen, selección sin outcomes de 2026,
empates, exclusión de cambios de divisor/retraso, rejillas inválidas, ausencia de datos
de desarrollo, entradas inmutables, pipeline reproducible, compatibilidad exacta
con K=32, integridad y protección de archivos. Dos ejecuciones reales produjeron
exactamente los mismos bytes de informe y predicciones. Se verificaron recuentos
y hashes contra la referencia congelada. Solo el informe agregado se versiona.

Se mantiene Elo K=32 como referencia de investigación y GPR como modelo público
predeterminado. No se habilita un artefacto entrenado ni se transfieren estas unidades
al GPR. El siguiente bloque puede contrastar calibración global de confianza de las
predicciones, con selección en desarrollo, sin retocar estos parámetros por 2026.

## Confianza global del Elo histórico

`analysis/config/elo-confidence-v1.json` se congeló antes de ejecutar el contraste.
Compara pendientes de log-odds `[1, 0.5, 0.75, 1.25, 1.5]`; selecciona únicamente
con log loss de 2025 y retraso primario de un día. Los empates conservan 1.
No añade intercepto ni modifica los ratings, K=32 o su feedback: transforma solo
la salida del replay congelado. Intercambiar equipos complementa la probabilidad;
ratings iguales siguen en 50 %. La pendiente 1 conserva exactamente los bytes.

```bash
PYTHONPATH=analysis/src python3 analysis/src/confidence_backtest.py \
  --baseline-report models/reports/internal-elo-v1/metrics.json \
  --predictions-dir data/curated/internal-elo-v1 \
  --protocol analysis/config/elo-confidence-v1.json \
  --output data/curated/elo-confidence-v1
```

Se elige **0,75** en 2025. Comparación principal (menor es mejor):

| Periodo | Games | Log loss referencia | Log loss ajustado | Brier referencia | Brier ajustado |
| --- | ---: | ---: | ---: | ---: | ---: |
| Desarrollo 2025 | 9.573 | 0,65338 | 0,65000 | 0,23048 | 0,22933 |
| Ene–ago 2026 | 7.839 | 0,64442 | 0,64170 | 0,22578 | 0,22516 |
| Sep–oct 2026 | 1.180 | 0,65654 | 0,65210 | 0,23132 | 0,23004 |

Los intervalos pareados de ventaja en log loss de 2026 son
`[-0,00095; 0,00626]` y `[-0,00220; 0,01411]`: incluyen cero. En el subconjunto
internacional de 348 games el intervalo también incluye cero; los 34 games finales
pertenecen a un único cluster y no permiten estimar ese intervalo. Se conservan
las sensibilidades de 3/7 días sin volver a seleccionar. 2026 sigue siendo diagnóstico,
no un nuevo holdout ciego. No hay validación suficiente para activar el preset entrenado;
la pendiente del Elo propio **no calibra el divisor GPR**.

Informe agregado: `models/reports/elo-confidence-v1/metrics.json`. Predicciones locales
ignoradas; no se requiere ninguna descarga adicional. Once pruebas nuevas verifican
simetría, neutralidad, saturación, independencia de outcomes/feedback, selección solo
con desarrollo, empates, protocolos inválidos, hashes, no sobrescritura y reproducción.

La portada añade **Validación histórica**, desplegable ES/EN con log loss, Brier,
recuentos e intervalos globales/internacionales. Consume únicamente el resumen local
`resources/data/predictive-research.json`; no requiere Python ni datasets en ejecución.
Los tests PHP contrastan todas sus cifras y hashes con los informes congelados.
Para regenerarlo después de reproducir y versionar el informe:

```bash
PYTHONPATH=analysis/src python3 - <<'PY'
from pathlib import Path
from confidence_backtest import web_summary
from ingest import write_json
write_json(Path('resources/data/predictive-research.json'), web_summary(
    Path('models/reports/elo-confidence-v1/metrics.json'),
    Path('models/reports/internal-elo-v1/metrics.json')))
PY
```

Se mantiene GPR público predeterminado y el contextual v2 opcional experimental.
Sin cambios de formato en escenarios, contratos del worker o reglas del torneo.

Validación de este bloque: **170 pruebas Python, 142 Vitest y 44 Laravel (586
aserciones)**; typecheck, build y Pint correctos. Firefox a 1440/360 px en ES/EN:
sin desbordamiento general ni errores JavaScript, seis filas de métricas, preset
entrenado deshabilitado y simulación real de 1.000 torneos sin NaN; los resultados
se conservan al cambiar de idioma. Los assets locales están reconstruidos.

## Exportación del M0 aprendido para uso experimental

La decisión `docs/WORLDS_2026_DECISION_ELO_APRENDIDO_EXPERIMENTAL.md` permite probar el
modelo aprendido con las muestras disponibles sin exigir una mejora significativa
para esa opción. No convierte la evaluación exploratoria en validación aprobada ni
cambia el modelo recomendado. El contextual v3 permanece separado.

```bash
PYTHONPATH=analysis/src python3 analysis/src/export_elo.py \
  --games data/curated/chaincc-2024-2026/games.jsonl \
  --corpus-audit models/reports/chaincc-2024-2026-v3b/audit.json \
  --identity-audit models/reports/chaincc-identities-v3b/audit.json \
  --baseline-report models/reports/internal-elo-v1/metrics.json \
  --confidence-report models/reports/elo-confidence-v1/metrics.json \
  --tuning-report models/reports/internal-elo-tuning-v1/metrics.json \
  --mapping analysis/config/worlds-2026-elo-mapping-v1.json \
  --cutoff 2026-10-21T00:00:00Z \
  --output models/artifacts/internal-elo-trained-2026-10-21-v1.json
```

Exportación determinista sin nueva selección de parámetros: K=32 y pendiente 0,75
proceden de los informes seleccionados con 2025. Se reconstruyen ratings con el
feedback estimado y las innovaciones pre-game guardadas, solo disponibles antes del
cutoff. Los 34 registros WLDs de 2026 se excluyen antes del replay, además de la
cuarentena y embargos originales. No se entrena con GPR actual ni con jugadores
inferidos. Las métricas adjuntas se etiquetan como backtest histórico previamente
inspeccionado, no validación nueva de este snapshot final.

Se enlazan los 16 equipos; LOS/Los Grandes usa 89 partidas y su último registro es
2025-09-02. La identidad aparece explícita en los perfiles del proyecto: no se
completa su temporada 2026 con LOUD ni otra entidad. La interfaz muestra recuentos y
última fecha. El exporter conserva el prior para identidades sin enlace, con cero
partidas en lugar de ratings GPR convertidos; esta salida se prueba con fixtures.

El payload serializado viaja con su SHA-256. El build Node verifica el hash, cobertura,
fuentes versionadas y parámetros sin acceder a CSV ni ejecutar Python. El runtime
solo permite la versión registrada exacta. La actualización de un artefacto debe
crear otra versión y mantener disponible la anterior para escenarios guardados.

Se añaden seis pruebas Python de replay final, cutoff estricto, reproducción,
cuarentena/integridad, exclusión del torneo, identidad/prior y no sobrescritura;
nueve Vitest de integridad de build/runtime, cálculo, regresión, controles, fuentes,
resultados fijados y JSON/comparación. Totales: **176 Python, 170 Vitest, 44 Laravel**,
typecheck y build correctos; prueba real del worker y ES/EN móvil/escritorio.

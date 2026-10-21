# Auditoría histórica offline — V3-B

Los dos primeros bloques inspeccionan ChainCC 2024, 2025 y 2026. No entrena, no genera features ni
modifica el simulador. Python 3.11+ con biblioteca estándar; comprobado con
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

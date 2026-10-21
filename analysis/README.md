# Auditoría histórica offline — V3-B

Este primer bloque inspecciona ChainCC 2025. No entrena, no genera features ni
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
Solo se versionan el lock y el informe pequeño de `models/reports/chaincc-2025-v3b/`.
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

Falta verificar zonas/horas de disponibilidad, enlazar series, resolver identidades
por fecha y ampliar la auditoría a 2024/2026. No se ha obtenido GPR histórico ni se
ha usado el snapshot de 2026 para encuentros antiguos. La construcción de features
(V3-C) queda para un bloque independiente, con estas restricciones explícitas.

## Comprobación de este bloque

22 pruebas Python: canonicalización y join por lado, cortes estrictos, zona explícita,
contextos incompatibles, duplicados, IDs/resultados inválidos, alineaciones incompletas,
esquema malformado, aislamiento de datos futuros, hashes e importación idempotente;
transporte de descarga simulado, fallo sin lock parcial y caché corrupta.
Regresión: 142 pruebas Vitest, 42 pruebas Laravel (528 aserciones) y typecheck.
La repetición de la auditoría real conserva byte a byte las tres salidas.

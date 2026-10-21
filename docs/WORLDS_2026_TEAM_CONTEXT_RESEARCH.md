# Worlds 2026 — Perfiles contextuales de los equipos

**Fecha de corte:** 21 de octubre de 2026. **GPR:** versión del 19 de octubre de 2026. **Estado:** hipótesis de modelado, no parámetros calibrados empíricamente.

## Principio

La fuerza base es siempre el **GPR de Riot**. Los demás parámetros no son hechos psicológicos sobre jugadores; son hipótesis débiles y editables basadas en actuaciones observadas. Una serie decisiva por sí sola no demuestra clutch, choking, ni momentum causal. No duplicar un efecto ya recogido en el GPR.

## Parámetros del primer prototipo

- Consistencia alta: σ torneo 20 y σ serie 10 puntos de Elo efectivo.
- Consistencia normal: σ torneo 40 y σ serie 20.
- Consistencia baja: σ torneo 65 y σ serie 30.
- Rendimiento bajo presión: Elo temporal **solo** en partidas de alta importancia, multiplicado por intensidad entre 0 y 1. Los valores de esta tabla son un escenario experimental, no la versión neutral.
- Momentum predeterminado: **0 en los 16 equipos**. No se puede inferir causalidad de una secuencia de victorias con los ejemplos existentes; investigar por separado recuperación tras derrota y efecto de victoria anterior.
- Contexto: TES −25 de Elo como ejemplo revisable si realmente juega con 369; el modelo neutral no incluye ese ajuste.
- Para impedir doble contabilización del historial de T1, no sumar al mismo tiempo un `Worlds buff` y un `pressure buff` basados en los mismos títulos.

## Tabla de parámetros

| Equipo | GPR | Consistencia | Presión* | Momentum | Contexto* | Confianza |
|---|---:|---|---:|---:|---:|---|
| HLE | 1540 | normal | +10 | +0 | +0 | media |
| GEN | 1519 | alta | +0 | +0 | +0 | media |
| BLG | 1513 | alta | +0 | +0 | +0 | media |
| G2 | 1480 | normal | +8 | +0 | +0 | media |
| T1 | 1471 | normal | +10 | +0 | +0 | media-baja |
| LYON | 1424 | normal | +5 | +0 | +0 | baja |
| KC | 1409 | normal | +3 | +0 | +0 | baja |
| DK | 1409 | baja | +8 | +0 | +0 | media-baja |
| AL | 1409 | normal | +5 | +0 | +0 | media-baja |
| TLAW | 1369 | normal | +0 | +0 | +0 | baja |
| TSW | 1368 | normal | +0 | +0 | +0 | baja |
| TES | 1364 | baja | +0 | +0 | -25 | media (contexto), baja (magnitud) |
| IG | 1348 | baja | +0 | +0 | +0 | baja |
| MKOI | 1322 | baja | +0 | +0 | +0 | media-baja |
| CFO | 1314 | normal | +0 | +0 | +0 | baja |
| LOS | 1183 | normal | +0 | +0 | +0 | baja |

*Presión y contexto: escenarios experimentales. El preset neutral utiliza 0 para ambos y se compara con el contextual.

## Evidencia y lectura por equipo

### HLE — Hanwha Life Esports

**Lectura:** Campeón MSI 2026 tras remontar el 1-2 de la final contra BLG; subcampeón LCK, donde GEN lo derrotó dos veces 3-1. Buena evidencia de rendimiento en decisivos, no de momentum causal.

**Propuesta:** consistencia normal; presión experimental +10; momentum 0; ajuste de contexto +0. **Confianza:** media.

Fuente principal: https://liquipedia.net/leagueoflegends/Mid-Season_Invitational/2026/Bracket_Stage

### GEN — Gen.G

**Lectura:** Campeón LCK 2026 y de LCK Cup. Dominó JDG y LYON 3-0, pero perdió 0-3 con G2 en First Stand; desaconsejado etiquetar como choker.

**Propuesta:** consistencia alta; presión experimental +0; momentum 0; ajuste de contexto +0. **Confianza:** media.

Fuente principal: https://gol.gg/tournament/tournament-matchlist/LCK%202026%20Season%20Playoffs/

### BLG — Bilibili Gaming

**Lectura:** Ganó First Stand, fue finalista del MSI (2-3 ante HLE) y registró 48-11 en la tabla GPR. Derrotas decisivas aisladas no prueban problemas de presión.

**Propuesta:** consistencia alta; presión experimental +0; momentum 0; ajuste de contexto +0. **Confianza:** media.

Fuente principal: https://liquipedia.net/leagueoflegends/First_Stand_Tournament/2026

### G2 — G2 Esports

**Lectura:** Ganó 3-0 a GEN en First Stand; ganó el LEC de primavera y verano; remontó un 0-2 a MKOI en primavera. Perdió 0-3 ante LYON en MSI.

**Propuesta:** consistencia normal; presión experimental +8; momentum 0; ajuste de contexto +0. **Confianza:** media.

Fuente principal: https://liquipedia.net/leagueoflegends/G2_Esports/Results

### T1 — T1

**Lectura:** Ganó Worlds 2024 y 2025, ambas finales 3-2, pero el ADC de 2026 es Peyz, no Gumayusi. Evitar sumar además un Worlds buff que replique este historial.

**Propuesta:** consistencia normal; presión experimental +10; momentum 0; ajuste de contexto +0. **Confianza:** media-baja.

Fuente principal: https://liquipedia.net/leagueoflegends/T1/Results

### LYON — LYON

**Lectura:** Fue tercero en MSI: venció 3-0 a G2 y TSW, perdió 2-3 contra HLE; subcampeón LCS tras perder 1-3 ante TL. Señal sorprendente, muestra todavía reducida.

**Propuesta:** consistencia normal; presión experimental +5; momentum 0; ajuste de contexto +0. **Confianza:** baja.

Fuente principal: https://liquipedia.net/leagueoflegends/Mid-Season_Invitational/2026/Bracket_Stage

### KC — Karmine Corp

**Lectura:** Subcampeón del EWC 2026; ganó 3-2 a Cloud9 y dos veces 3-0 a MVK en Play-In; cayó 0-3 contra DK en la final del EWC y ante MKOI en LEC.

**Propuesta:** consistencia normal; presión experimental +3; momentum 0; ajuste de contexto +0. **Confianza:** baja.

Fuente principal: https://liquipedia.net/leagueoflegends/World_Championship/2026/Match_Schedule

### DK — Dplus KIA

**Lectura:** Cuarto de LCK pero campeón EWC 2026 desde el cuadro inferior, superando a GEN y ganando 3-0 a KC. Variación de nivel entre competiciones.

**Propuesta:** consistencia baja; presión experimental +8; momentum 0; ajuste de contexto +0. **Confianza:** media-baja.

Fuente principal: https://ewc-web.prod.esf-systems.com/en/competitions/2026/league-of-legends

### AL — Anyone's Legend

**Lectura:** Campeón de LPL 2026 al ganar 3-1 a BLG tras caer 0-3 con BLG en una serie anterior; cuartofinalista en Worlds 2025 (2-3 frente a T1).

**Propuesta:** consistencia normal; presión experimental +5; momentum 0; ajuste de contexto +0. **Confianza:** media-baja.

Fuente principal: https://liquipedia.net/leagueoflegends/Anyone%27s_Legend/Results

### TLAW — Team Liquid Alienware

**Lectura:** Campeón LCS 2026 (3-1 LYON); en MSI ganó 3-0 a KC, pero cayó ante T1 0-3 dos veces. No hay evidencia firme de un plus de presión.

**Propuesta:** consistencia normal; presión experimental +0; momentum 0; ajuste de contexto +0. **Confianza:** baja.

Fuente principal: https://pem.lol/lcs/2026/summer/matches

### TSW — Team Secret Whales

**Lectura:** Ganó los tres splits LCP de 2026, eliminó a TES 3-1 del MSI, pero cayó 0-3 ante LYON; separar fortaleza regional de rendimiento internacional.

**Propuesta:** consistencia normal; presión experimental +0; momentum 0; ajuste de contexto +0. **Confianza:** baja.

Fuente principal: https://liquipedia.net/leagueoflegends/Secret_Whales/Results

### TES — Top Esports

**Lectura:** En MSI cayó 2-3 ante G2 y 1-3 ante TSW. El top ZUIAN sufrió problemas de visado y 369 volvió tras meses sin competir. -25 es hipótesis, no medida objetiva.

**Propuesta:** consistencia baja; presión experimental +0; momentum 0; ajuste de contexto -25. **Confianza:** media (contexto), baja (magnitud).

Fuente principal: https://www.sheepesports.com/en/articles/zuian-unable-to-start-for-top-esports-at-worlds-due-to-visa-issues-369-returns/en

### IG — Invictus Gaming

**Lectura:** Terminó 18-25 en GPR, pero en la fase final llegó a derrotar a TES 3-2 y se clasificó ganando a JDG 3-1; su evolución reciente no basta para afirmar clutch.

**Propuesta:** consistencia baja; presión experimental +0; momentum 0; ajuste de contexto +0. **Confianza:** baja.

Fuente principal: https://liquipedia.net/leagueoflegends/LPL/2026/Regional_Finals

### MKOI — Movistar KOI

**Lectura:** Pasó 2-3 en Worlds 2025, remontó por el cuadro inferior en LEC verano 2026 (3-0 KC), pero perdió la final 0-3 con G2. Buen ejemplo de variación, no de choking persistente.

**Propuesta:** consistencia baja; presión experimental +0; momentum 0; ajuste de contexto +0. **Confianza:** media-baja.

Fuente principal: https://liquipedia.net/leagueoflegends/Movistar_KOI/Results

### CFO — CTBC Flying Oyster

**Lectura:** En Worlds 2025 venció en Bo1 a T1 y avanzó a cuartos, pero su roster de 2026 cambió y perdió 0-3 la final LCP ante TSW. Heredar el clutch de 2025 sería dudoso.

**Propuesta:** consistencia normal; presión experimental +0; momentum 0; ajuste de contexto +0. **Confianza:** baja.

Fuente principal: https://www.sheepesports.com/en/all/teams/CTBC%20Flying%20Oyster

### LOS — Los Grandes

**Lectura:** Campeón brasileño en una final 3-2 con LOUD; EWC 2026: ganó 2-0 a LYON, pero cayó frente a rivales fuertes. Pocos datos internacionales justifican parámetros extremos.

**Propuesta:** consistencia normal; presión experimental +0; momentum 0; ajuste de contexto +0. **Confianza:** baja.

Fuente principal: https://gol.gg/teams/team-matchlist/2895/split-ALL/tournament-/

## Limitaciones y método de mejora

1. Confirmar que el dataset histórico utiliza **la misma plantilla** o ajustar según cambios de jugadores. Por ejemplo T1 con Peyz, CFO con cambios de roster, TES con 369.
2. Construir un histórico **por partida** y por serie con fecha, parche, rivales, lado azul/rojo, posición en la serie, score al entrar en cada partida, fase y alineación.
3. Ajustar un modelo base de probabilidad con ratings **disponibles antes** de cada encuentro. No usar GPR de octubre para “predecir” series anteriores a octubre (fuga temporal).
4. Estimar consistencia como dispersión de los residuos frente a la expectativa; estimar presión como residuo en partidas decisivas, controlando por fortaleza rival, localización de lado, torneo y fase.
5. Estimar momentum de forma causal aproximada con transiciones tras victorias/derrotas, control de fortaleza y secuencias, sin contar las mejores rachas como prueba suficiente. Una remontada tras 0-2 puede ser recuperación ante derrota, no momentum positivo.
6. Aplicar regularización fuerte o modelo jerárquico: muestras pequeñas vuelven a 0 (presión/momentum) o a consistencia normal. Reportar intervalos de incertidumbre y evaluar con log loss/Brier fuera de muestra.
7. Publicar al menos dos presets: **Neutral GPR** y **Contextual experimental**; mostrar exactamente los modificadores activos en los resultados, sin metatextos decorativos.

## Fuentes de datos de utilidad

- GPR oficial (19/10/2026): https://lolesports.com/es-MX/gpr/2026/current
- Explicación GPR de Riot: https://lolesports.com/es-MX/news/dev-diary-unveiling-the-global-power-rankings
- Dataset de partidas ChainCC (CC BY 4.0, atribución necesaria): https://chaincc.lol/free/data/
- Oracle’s Elixir: https://lol.timsevenhuysen.com/
- Games of Legends: https://gol.gg/
- Historiales por torneo y roster: Liquipedia y Leaguepedia. Ver enlaces específicos por equipo.

# Uso experimental del Elo aprendido

La instrucción del usuario de avanzar con las muestras existentes permite **uso
opcional experimental** aunque la incertidumbre estadística no acredite superioridad.
Esto modifica el bloqueo de publicación experimental de los documentos v3; no
modifica la exigencia de validación para recomendar un modelo o sustituir GPR.

Se añade `historical_elo_trained_v1`, M0: ratings Elo propios aprendidos de resultados,
K elegido en 2025 y pendiente de confianza elegida en 2025. No es el contextual v3:
no incorpora bonos manuales v2 ni efectos contextuales descartados por las pruebas.
`contextual_trained_v3` conserva su identidad y permanece no disponible. Los escenarios
existentes conservan su modelo; GPR sigue siendo el predeterminado.

El artefacto congelado incluye fuentes, hashes, cutoff, selección de parámetros,
cobertura por equipo y métricas diagnósticas. Los datos 2026 ya fueron inspeccionados:
no son un nuevo test ciego ni prueba de superioridad robusta. No se exige otra descarga
ni una cantidad imposible de partidas. Disponibilidad estimada y UTC supuesto siguen
siendo hipótesis explícitas, no hechos verificados.

Para el snapshot del torneo se excluyen los registros `WLDs` de 2026. Las identidades
se enlazan mediante nombres exactos y los alias explícitos documentados en
`analysis/config/worlds-2026-elo-mapping-v1.json`. LOS se enlaza a Los Grandes conforme a la identidad explícita de los perfiles del
proyecto: son 89 partidas y el último dato es de 2025, no cobertura inventada de 2026.
Una identidad sin enlace en futuros artefactos debe usar el prior con cero partidas.
Los ratings entre regiones dependen de los cruces observados: no se inventan bonos
regionales para corregir resultados incómodos.

El predictor es estático durante cada torneo simulado: no vuelve a aprender de games
fijados o sintéticos ni necesita posterior latente. Las series se resuelven por game,
con el mismo motor, RNG y reglas. El artefacto viaja íntegro en el escenario; hashes
incorrectos o versiones desconocidas se rechazan. No requiere Python en runtime.


## Variante M1 optativa

El mismo preset puede seleccionar explícitamente un segundo artefacto, M1 de últimas
partidas disponibles. M0 conserva su artefacto y su condición de versión inicial;
los escenarios existentes no se actualizan. La selección de coeficiente/historial
usa 2025; 2026 sigue siendo diagnóstico ya inspeccionado. M1 empeora en el tramo final
y en internacionales, por lo que se etiqueta como experimento no recomendado. Su
historial puede ser antiguo: se muestran fechas y recuentos, no «forma de hoy» inventada.

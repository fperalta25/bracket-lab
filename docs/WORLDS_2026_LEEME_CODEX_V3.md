# Worlds Simulator — Guía de integración v3

## Situación

La aplicación ya está en desarrollo. **No empezar desde cero**. La revisión 3 especifica cómo pasar de un motor GPR/contextual experimental a un predictor contextual **entrenado y comprobable**. La revisión no representa un entrenamiento realizado.

## Qué leer para cada tarea

1. `WORLDS_2026_SIMULATOR_SPEC.md`: requisitos globales, reglas y plan de trabajo.
2. `WORLDS_2026_ANEXO_MODELO_PREDICTIVO_V3.md`: contrato predictivo y pipeline histórico.
3. `WORLDS_2026_ANEXO_MODELO_ESTADISTICO_V2.md`: reglas del motor de probabilidades, GPR base, series, RNG y compatibilidad experimental; subordinado a v3 cuando haya contradicción en predicción entrenada.
4. `WORLDS_2026_STRENGTH_PROFILES_V2.json`: semilla fechada de 16 equipos **no calibrada**; no es artefacto de entrenamiento.
5. Anexos i18n/UX solo al modificar vistas; investigación de perfiles solo para auditar hipótesis y trazabilidad.

## Primer encargo recomendado

Auditar la implementación actual y crear únicamente **V3-A** (`feat/model-contract-v3`): separación `PredictionModel`/torneo, nombres inequívocos de los tres presets, y migración no destructiva de escenarios v2. El modelo v3 entrenado permanece deshabilitado. No iniciar todavía la implementación de todos los factores nuevos.

Después, de forma independiente, **V3-B** (`feat/historical-data-audit`): inspeccionar los archivos de datos históricos reales, canonizar por game/serie con cutoff y hashes, registrar calidad y cobertura. Si no pueden descargarse los datos, documentar cómo importar un archivo local y cerrar únicamente las partes comprobables, sin inventar métricas.

## Prohibiciones operativas

- No sustituir el modelo predeterminado con coeficientes provisionales o subjetivos.
- No usar GPR del 19-10-2026 para entrenar ejemplos de 2024/2025 como si fuera su rating histórico.
- No usar información posterior al game para predecir el game anterior.
- No sumar efectos entrenados sobre los bonos experimentales v2 sin eliminar los solapamientos.
- No simular series con una sola moneda, saltarse reglas de sorteo ni perder resultados oficiales fijados.
- No añadir microservicio ni Python al servidor público para esta función.
- No romper los escenarios locales, ni las traducciones ES/EN, ni la regla de cero metatexto decorativo.
- No hacer pushes uno por commit; agrupar y espaciar para evitar solicitudes CI/CD excesivas.

## Criterio de entrega

Por cada rama: tests de regresión, resumen de cambios concretos, cambios de formato de escenario (si los hay), comandos de comprobación ejecutados y cuestiones pendientes. El avance del pipeline debe producir **datos y métricas verificables**, no tablas decorativas de probabilidades.

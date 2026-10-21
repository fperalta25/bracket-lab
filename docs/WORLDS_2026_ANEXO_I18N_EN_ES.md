# Anexo técnico y UX — Internacionalización desde el inicio (ES / EN)

**Prioridad:** obligatoria, desde la primera fase de interfaz. **Idiomas del MVP:** español (`es`) e inglés (`en`). Complementa `WORLDS_2026_SIMULATOR_SPEC.md` y `WORLDS_2026_ANEXO_UX_SIN_METATEXTO.md`. **En caso de contradicción con la mención anterior a un MVP solo en español, prevalece este anexo.**

## 1. Objetivo y alcance

Toda la web debe poder utilizarse íntegramente en español e inglés **desde el principio**, no como trabajo pendiente para el final. Incluye tanto las páginas públicas como el panel de administración, y todas las vistas nuevas.

Traducciones requeridas: navegación, encabezados, botones, etiquetas, filtros, opciones de varianza, estados de torneo y emparejamientos, nombres de fases, clasificación, cuadros, resultados, tablas, títulos y leyendas de gráficos, tooltips, ayudas imprescindibles, diálogos de confirmación, mensajes de error/validación, progreso, estados vacíos, accesibilidad (incluidos `aria-label` y alternativas textuales), importación/exportación cuando se exponga texto al usuario y avisos legales/metodológicos.

**No traducir** identidades de equipos, acrónimos, nombres propios, IDs internos, nombres de archivos JSON ni valores de datos utilizados por el motor. Los códigos de región (`LCK`, `LPL`, `LEC`, etc.) se mantienen estables. Las etiquetas descriptivas de una región sí pueden traducirse si existe una razón para mostrarlas.

La internacionalización es de **interfaz y presentación**, no del modelo Monte Carlo: ejecutar con el mismo escenario, parámetros y semilla debe producir exactamente los mismos resultados sin importar el idioma.

## 2. Selección y persistencia del idioma

- Selector **ES / EN** accesible y discreto, visible tanto en público como en administración, también en móvil. Sin banderas (no son idiomas) ni textos de introducción decorativos.
- Primera visita: usar preferencia del navegador (idiomas que empiecen por `es` → español; resto → inglés). Si no se reconoce, inglés. La preferencia elegida manualmente siempre prevalece sobre la detección automática.
- Persistir la elección en una preferencia local ligera; **no** exigir login, cuenta ni consentimiento para la funcionalidad básica. Elegir la solución más simple que permita al backend renderizar correctamente Blade en visitas posteriores (p. ej., cookie técnica con valores permitidos `es`/`en`). No crear dos fuentes de verdad contradictorias entre cookie, sesión y `localStorage`.
- Actualizar el atributo `<html lang="es">` o `<html lang="en">`. Mantener lenguaje consistente al navegar entre pantallas.
- Cambiar de idioma **no debe modificar el escenario, la revisión oficial, la semilla, los resultados calculados ni las preferencias de simulación**. Puede recargar la página si se guarda/restaura correctamente el estado de trabajo; preferir actualización sin recarga si se consigue sin añadir complejidad injustificada.
- Un idioma no soportado debe usar inglés como fallback de forma segura. Nunca mostrar las claves internas como texto visible en producción.

## 3. Implementación proporcionada al stack actual

**Stack previsto: Laravel + Blade + Alpine.js + TypeScript + Vite.** No instalar i18next, React, Vue ni un framework complejo solo por traducir dos idiomas.

- Definir un **catálogo centralizado por idioma**, preferentemente `lang/es.json` y `lang/en.json`, con las **mismas claves estables** (`nav.results`, `simulation.run`, `swiss.qualified`, `errors.invalid_pairing`, etc.). Verificar que Laravel puede resolver las claves elegidas desde sus JSON en la versión instalada; si no, utilizar el mecanismo nativo equivalente, sin duplicar arbitrariamente los textos.
- En Blade usar la traducción integrada de Laravel, nunca literales visibles repetidos por las plantillas. En TypeScript/Alpine, cargar los mismos catálogos con Vite y usar un helper `t(key, params?)` pequeño, tipado cuando resulte sencillo, que maneje interpolación segura y fallback. Si alguna librería o integración hiciera inevitable un segundo catálogo, automatizar una prueba de paridad.
- Para interpolaciones como `"{count} simulations"`, traducir **frases completas** con parámetros. No concatenar palabras o fragmentos traducidos, pues el orden gramatical cambia entre idiomas.
- Contemplar singular/plural cuando el texto lo requiera (`1 simulación` / `2 simulaciones`, `1 simulation` / `2 simulations`), con variantes explícitas o `Intl.PluralRules`; no introducir una dependencia pesada para ello.
- Usar identificadores **neutros de idioma** en dominio, API, IndexedDB y JSON exportado: por ejemplo, `variance: 'normal'`, `stage: 'quarterfinal'`, `status: 'official'`. Convertirlos a etiquetas solo en presentación. No almacenar cadenas traducidas como valores funcionales.
- Evitar traducir textos dentro del Web Worker o del motor puro. La capa de UI traduce estados, errores codificados y métricas recibidas. Así los tests de simulación no dependen del idioma.
- Centralizar las cadenas visibles para evitar inconsistencias y facilitar futuros idiomas. Si aparece una cadena nueva, el mismo cambio debe incluir **ES y EN**.

## 4. Presentación localizada

- Formatear números, porcentajes, decimales, fechas y horas con `Intl.NumberFormat` / `Intl.DateTimeFormat` de acuerdo con el idioma activo. Ejemplos: `12,5 %` (español) frente a `12.5%` (inglés); usar la precisión apropiada según métrica.
- Conservar valores numéricos puros para cálculos, ordenación de tablas, filtros, estadísticas y generación de CSV/JSON. **Nunca** convertir porcentajes formateados en entradas del motor ni ordenar números por su representación textual.
- Las posiciones de torneo (`1.º`, `3.º–4.º`, etc.) pueden presentarse con formatos apropiados para cada idioma, pero sus claves internas son categorías invariantes (campeón, subcampeón, semifinalista...).
- Gráficos y tooltips deben responder al idioma activo; nombres de fases, ejes, series, leyendas y mensajes sin resultados también.
- El archivo JSON de escenario exportado debe ser **independiente del idioma** y poder importarse en ambas interfaces sin transformaciones. Si se exporta un informe legible para humanos, sus textos sí se localizan.
- Mostrar fechas sin ambigüedad y no suponer que el idioma determina la zona horaria. Respetar la zona horaria real del dato y etiquetarla cuando importe.

## 5. UX, coherencia y accesibilidad

El requisito de **cero metatexto redundante** es idéntico en ambos idiomas. No agregar subtítulos explicativos ni frases promocionales al traducir. Preferir inglés natural de producto y español natural de España, no traducciones literales o artificiosas.

Ejemplos de microcopy:

| Clave conceptual | Español | Inglés |
|---|---|---|
| Navegación | `Simulación` | `Simulation` |
| Navegación | `Resultados` | `Results` |
| Acción | `Simular` | `Simulate` |
| Campo | `Iteraciones` | `Simulations` |
| Ajuste | `Varianza` | `Variance` |
| Opción | `Estado oficial` | `Official state` |
| Opción | `Desde cero` | `From scratch` |
| Estado | `Sin datos` | `No data` |
| Resultado | `Clasifica` | `Qualifies` |
| Fase | `Cuartos de final` | `Quarterfinals` |

Son ejemplos, no una obligación de reproducir estas etiquetas si una alternativa más clara encaja mejor con los controles. Usar el vocabulario oficial del competitivo cuando ayude a reconocer conceptos (p. ej., *Swiss Stage*), sin traducciones confusas.

El selector debe funcionar con teclado y lector de pantalla y anunciar el idioma seleccionado sin recurrir solo al color. Verificar cortes de palabras, anchuras y desbordamientos en español, inglés y móvil. No ocultar información útil para hacer caber el texto.

## 6. Pruebas y criterios de aceptación

Antes de considerar terminada **cada pantalla nueva**:

1. Se puede recorrer completamente en español y en inglés, incluido el panel admin y sus validaciones.
2. Todas las claves usadas existen en ambos catálogos (prueba automática de paridad y detección de cadenas visibles sin traducir en lo razonablemente automatizable).
3. Persistencia y detección inicial correctas; idioma no soportado tiene fallback seguro y `html[lang]` es correcto.
4. Los números, porcentajes, fechas y etiquetas de gráficos cambian de formato, pero los valores, el orden numérico de tablas y las simulaciones permanecen idénticos.
5. Cambiar idioma con un escenario configurado o resultados ya obtenidos no pierde datos ni dispara simulaciones nuevas involuntarias.
6. Importar en inglés un escenario exportado en español (y viceversa) da los mismos datos funcionales.
7. Se verifican estados vacíos, errores, confirmaciones, títulos accesibles, navegación por teclado y anchos móviles en ambos idiomas.
8. Ninguna traducción introduce subtítulos/metatextos redundantes.

## 7. Integración en el desarrollo que ya ha empezado

- Aplicar **ahora**, antes de ampliar más pantallas; no esperar al pulido final. La implementación puede ser incremental, pero una pantalla no está completa hasta tener ambas traducciones.
- Primero: infraestructura ligera de locales, selector y persistencia; segundo: traducir las vistas existentes; tercero: exigir ES y EN en toda vista/función nueva.
- **No reescribir el motor, el modelo de datos ni la arquitectura existente** por este cambio. Refactorizar solo textos visibles y puntos en los que se hubieran usado cadenas localizadas como estados funcionales.
- Mantener commits reducidos, pruebas correspondientes y la política de ramas del proyecto. El anexo tiene prioridad sobre las frases desactualizadas de la especificación original relativas al idioma único.

**Resultado esperado:** una herramienta íntegramente bilingüe, con español e inglés de primera clase, sin coste arquitectónico innecesario y sin convertir la UI en una colección de textos explicativos.

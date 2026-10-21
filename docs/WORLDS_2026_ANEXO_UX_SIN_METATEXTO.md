# Anexo UX — Contenido sin metatexto ni sobreexplicaciones

**Prioridad:** alta. Este anexo complementa `WORLDS_2026_SIMULATOR_SPEC.md` y se aplica a toda la interfaz, tanto pública como de administración, incluidas las pantallas que ya estén implementadas.

## Principio rector

**Que el contenido hable por sí solo.** No incluir texto que describa la propia página, anuncie obviedades, explique lo que el usuario ya ve o intente adornar la interfaz. No confundir una aplicación útil con una landing page de marketing.

El objetivo no es eliminar todo el texto: es que **cada palabra tenga una función**. Si al retirar una frase no se pierde información necesaria ni claridad, debe retirarse.

## Reglas obligatorias

1. **Títulos breves y literales.** «Simulación», «Resultados», «Equipos», «Escenarios», «Configuración». Evitar títulos promocionales o narrativos.
2. **Nada de subtítulos automáticos.** No colocar sistemáticamente un párrafo debajo de cada H1, tarjeta, pestaña, modal o sección para explicar qué se puede hacer en ella. Un título claro y los controles correspondientes suelen ser suficientes.
3. **Sin metatexto ni frases de relleno.** Prohibidas fórmulas del tipo «En esta sección podrás…», «Explora las posibilidades…», «Personaliza tu experiencia…», «Descubre las estadísticas…», «Todo lo que necesitas para…», «Aquí puedes gestionar…» o «Bienvenido al simulador…» cuando no aportan información real.
4. **No repetir conceptos.** Evitar que navegación, título, subtítulo, tarjeta y botón comuniquen lo mismo con palabras distintas. No repetir valores o estados ya visibles en una tabla o control, salvo que cumplan una función práctica distinta.
5. **No inventar tarjetas de presentación.** No añadir bloques como «Simulaciones inteligentes», «Análisis avanzado», «Datos en tiempo real» o resúmenes genéricos para llenar espacio. Priorizar los controles, el cuadro y los resultados reales.
6. **Etiquetas precisas en controles.** Usar nombres cortos, con unidades o contexto si hace falta: «Iteraciones», «Varianza», «Desde», «Simular», «Guardar escenario». Preferir ejemplos o valores predeterminados a explicaciones largas.
7. **Texto de ayuda solo cuando resuelva una duda real.** Para conceptos no evidentes (power score, varianza, restricciones de sorteos, interpretaciones estadísticas), mostrar una explicación concreta y breve, preferentemente contextual o bajo demanda. No obligar a leerla cada vez.
8. **Estados y mensajes útiles.** Errores: indicar qué falla y cómo resolverlo. Vacíos: indicar la siguiente acción si no es evidente. Progreso: decir qué está pasando de forma concreta. Evitar felicitaciones, mensajes de éxito ceremoniales y notificaciones por acciones que ya resultan evidentes.
9. **Datos antes que discurso.** En resultados, priorizar porcentajes, nombres, tablas, filtros y gráficos legibles. Mostrar información metodológica solo donde evita malinterpretaciones: número de simulaciones, carácter estimado de las probabilidades, estado del sorteo oficial y excepciones aplicadas.
10. **No sacrificar la accesibilidad ni las obligaciones legales.** Mantener encabezados semánticos, nombres accesibles, mensajes de validación y los avisos necesarios, incluido el carácter no oficial del proyecto. Presentarlos de forma discreta, clara y sin repetición innecesaria.
11. **Coherencia en móvil y escritorio.** En móvil, no sustituir contenido útil por textos de introducción. Ningún espacio vacío debe rellenarse con párrafos decorativos.
12. **Aplicación retroactiva.** Revisar las vistas existentes y eliminar texto sobrante sin cambiar su comportamiento. Aplicar estas reglas también a toda pantalla nueva.

## Ejemplos concretos

| Evitar | Preferir |
|---|---|
| «Simulación de Worlds — Descubre cómo podrían desarrollarse los enfrentamientos y explora miles de escenarios posibles» | «Simulación» |
| «Resultados — Consulta las probabilidades de cada equipo de avanzar a las distintas fases del torneo» | «Resultados» y directamente la tabla |
| «Configura tu simulación — Ajusta las opciones para disfrutar de una experiencia personalizada» | «Varianza», «Iteraciones», «Escenario» y los controles |
| «Escenarios — Gestiona los escenarios personalizados que has creado a lo largo del tiempo» | «Escenarios» y la lista |
| «¡Tus resultados están listos! Ahora puedes explorar todas las estadísticas generadas» | Mostrar directamente los resultados |
| «No hay datos disponibles en esta sección todavía. Puedes comenzar creando un escenario nuevo» | «Sin escenarios» + «Crear escenario» (solo cuando haga falta) |

## Criterio de aceptación para Codex

Antes de dar una pantalla por terminada, realizar una **revisión de copy**:

- ¿Hay algún subtítulo que solo parafrasea el título? Eliminarlo.
- ¿Hay un texto que explica una funcionalidad evidente por sus controles? Eliminarlo.
- ¿Existe algún bloque cuyo único objetivo sea hacer que la pantalla parezca más completa? Eliminarlo.
- ¿Puede el usuario entender qué hacer y qué significan los datos sin esos textos? Si no, mejorar primero la jerarquía visual, las etiquetas y el diseño; añadir ayuda textual solo si sigue siendo necesaria.
- ¿Se conservan los avisos metodológicos, errores y requisitos de accesibilidad realmente necesarios? Verificarlo.

**Instrucción de implementación:** no rediseñar la aplicación entera por este anexo. Auditar y corregir el contenido textual de las vistas existentes con cambios pequeños y comprobables. En adelante, considerar estas reglas un requisito de UX de toda nueva funcionalidad.

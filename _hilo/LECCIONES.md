# Lecciones Aprendidas del Proyecto

> **INSTRUCCIONES PARA CLAUDE**: Este archivo documenta patrones, errores y particularidades
> descubiertos durante el desarrollo. Consulta este archivo al inicio de cada sesion para
> evitar repetir errores y aprovechar lo que ya funciona. Actualiza con `/hv:pausar --rapido` al final
> de cada sesion si hay nuevas lecciones.
>
> **Categoria (dashboard Ovillo)**: el PREFIJO del codigo categoriza la leccion en el hub:
> `PAT-` patron, `ERR-` error, `TEC-` tecnica, `PREF-` preferencia (lo infiere `/hub-client`).
> Para forzar otra categoria, anade `**Categoria**: <valor>` en el cuerpo de la entrada.

---

## Resumen Rapido (Top 5)

> Las 5 lecciones mas importantes del proyecto. Actualizar cuando cambien las prioridades.

| # | Leccion | Categoria |
|---|---------|-----------|
| 1 | [Leccion mas critica] | [Patron/Error/Tecnica/Preferencia] |
| 2 | [Segunda leccion] | [Patron/Error/Tecnica/Preferencia] |
| 3 | [Tercera leccion] | [Patron/Error/Tecnica/Preferencia] |
| 4 | [Cuarta leccion] | [Patron/Error/Tecnica/Preferencia] |
| 5 | [Quinta leccion] | [Patron/Error/Tecnica/Preferencia] |

---

## 1. Patrones del Proyecto

> Patrones que funcionan bien en este proyecto y que Claude debe reutilizar.

### PAT-001: [Nombre del patron]

**Contexto**: [Donde y cuando aplicar este patron]
**Patron**: [Descripcion concisa del patron]
**Ejemplo**: [Referencia a archivo o codigo]
**Fecha**: [YYYY-MM-DD]

<!--
Ejemplos de patrones:
- "Para validaciones, siempre usamos FluentValidation con mensajes en castellano"
- "Los DTOs de respuesta siempre incluyen campo 'Id' y 'FechaModificacion'"
- "Los endpoints de listado siempre devuelven PaginatedResult<T>"
-->

---

## 2. Errores Corregidos

> Errores que ya ocurrieron y como se solucionaron. Claude debe evitar reintroducirlos.

### ERR-001: [Descripcion breve del error]

**Sintoma**: [Como se manifesto el error]
**Causa raiz**: [Que lo provoco]
**Solucion**: [Como se corrigio]
**Prevencion**: [Que hacer para que no vuelva a ocurrir]
**Fecha**: [YYYY-MM-DD]

<!--
Ejemplos de errores:
- "Connection string sin TrustServerCertificate=True falla en SQL Server 2022"
- "Usar .Result en metodo async provoca deadlock en controllers"
- "Faltaba AsNoTracking en queries de solo lectura, causando lentitud"
-->

---

## 3. Particularidades Tecnicas

> Caracteristicas especificas de este proyecto que no son evidentes del codigo.

### TEC-001: [Particularidad]

**Descripcion**: [Que hace especial o diferente a este proyecto]
**Impacto**: [Como afecta al desarrollo]
**Referencia**: [Archivo o documentacion relacionada]
**Fecha**: [YYYY-MM-DD]

<!--
Ejemplos de particularidades:
- "La BD usa intercalacion SQL_Latin1_General_CP1250_CI_AS (no la default)"
- "El servidor de produccion no tiene acceso a internet (sin NuGet restore)"
- "Hay un trigger en tabla Estudiante que actualiza FechaModificacion automaticamente"
- "La autenticacion Azure AD usa tenant multi-organizacion"
-->

---

## 4. Preferencias del Equipo

> Preferencias explicitas del equipo que Claude debe respetar.

### PREF-001: [Preferencia]

**Descripcion**: [Que prefiere el equipo]
**Motivo**: [Por que se prefiere asi]
**Fecha**: [YYYY-MM-DD]

<!--
Ejemplos de preferencias:
- "Preferimos mensajes de error en castellano para el usuario final"
- "Los logs deben ser en ingles para compatibilidad con herramientas"
- "No usar operador ternario en condiciones complejas (preferir if/else)"
- "Los commits siempre en castellano con formato Conventional Commits"
-->

---

## Relacion con Otros Archivos

| Archivo | Relacion con LECCIONES.md |
|---------|--------------------------|
| `DECISIONES.md` | Decisiones arquitectonicas formales (ADRs). LECCIONES es mas operativo |
| `DEUDA_TECNICA.md` | Issues conocidos pendientes. LECCIONES documenta lo ya resuelto |
| `DEPENDENCIAS.md` | Stack tecnico. LECCIONES documenta particularidades de uso |
| `SESION_ACTUAL.md` | Contexto de sesion. `/hv:pausar --rapido` actualiza ambos archivos |
| `CLAUDE.md` | Reglas generales. LECCIONES son especificas de este proyecto |

---

## Como Actualizar Este Archivo

### Automaticamente
- Al ejecutar `/hv:pausar --rapido`, Claude revisa si hay nuevas lecciones de la sesion actual

### Manualmente
- Cuando se descubre un patron util: anadir en seccion 1
- Cuando se corrige un bug no trivial: anadir en seccion 2
- Cuando se descubre una particularidad: anadir en seccion 3
- Cuando el equipo expresa una preferencia: anadir en seccion 4

### Mantenimiento
- Revisar periodicamente que las lecciones sigan siendo relevantes
- Mover lecciones obsoletas a un bloque de comentario HTML
- Mantener el Top 5 actualizado con las lecciones mas impactantes

---

*Archivo de lecciones aprendidas - Ovillo*

---

## L-001 · Que una subpagina no mencione una restriccion no significa que no exista

**Fecha** 2026-09-14 · **Contexto** Verificacion de la via oficial de Alexa+ antes de M3

Las paginas del **Alexa+ MCP Toolkit** describen un camino completo y self-service: CLI `alexa-ai`,
`alexa-ai deploy`, simulador web, un *add-on Agent Skill*. Ninguna menciona restriccion de acceso.
De ahi se concluyo —mal— que el riesgo MEDIO del runbook («el registro esta cerrado») podia estar
obsoleto, y se reescribio el riesgo en ambos runbooks.

La pagina **principal** del programa lo decia sin ambiguedad: «Alexa+ for Builders is currently
available to **select partners working directly with our team**». La documentacion tecnica describe
*como* funciona el producto; la pagina de programa dice *quien* puede usarlo. Son cosas distintas y
viven en sitios distintos.

**Que hacer la proxima vez**: antes de contradecir un riesgo del runbook, leer la pagina de entrada
del programa, no solo la referencia tecnica. Y cuando se contradiga, decirlo como hipotesis a
confirmar —que fue lo unico que salvo esto— en lugar de darlo por hecho.

**Coste**: un commit que hubo que revertir. Ninguna decision de arquitectura llego a tomarse sobre la
premisa equivocada.

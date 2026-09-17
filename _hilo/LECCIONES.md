# Lecciones aprendidas

Dos, y las dos son la misma forma: **una comprobación que no puede fallar no es una comprobación.**
Se escriben cuando duelen, no al final.

| | Lección | Qué costó |
|---|---|---|
| L-001 | Que una subpágina no mencione una restricción no significa que no exista | una vía de entrega descartada tarde |
| L-002 | Un test que usa otro transporte que producción no está probando producción | dos funcionalidades entregadas rotas (ADR-011, ADR-012) |

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


---

## L-002 · Un test que usa otro transporte que produccion no esta probando produccion

**Cuando** — 16-09-2026, montando el demostrador web.

**Que paso** — Dos entregables de M3, las tarjetas visuales y la confirmacion de UC-05, no
funcionaban en el despliegue real. Los 287 tests estaban en verde. Ninguno de los dos fallos era
sutil: las tarjetas no se adjuntaban nunca y la confirmacion devolvia un error del SDK.

**Por que no se vio** — Todos los tests de herramientas y tarjetas usan `InMemoryTransport`, que es
**un servidor vivo con una sesion recordada**. Streamable HTTP no es eso: se construye un servidor
por peticion, no hay sesion que recuerde el `initialize` y no hay canal del servidor al cliente. Lo
que probabamos era una forma de ejecutar el codigo que no existe en ningun contenedor.

**La leccion** — El transporte es parte del sistema, no un detalle de conexion. Al menos un test por
entregable tiene que recorrer el transporte de produccion, aunque sea mas lento y mas aparatoso.
`src/cards/transport.test.ts` es ese test para las tarjetas, y se comprobo que falla contra el
codigo anterior antes de darlo por bueno.

**Lo general** — El mismo patron que la L-001 y que el fallo de los dos `main.ts` que "funcionaron"
sin `assert`: una comprobacion que no puede fallar no es una comprobacion. Un test que no recorre
el camino real tampoco.

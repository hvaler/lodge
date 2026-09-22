# Lecciones aprendidas

Tres, y las tres son la misma forma: **una comprobación que no puede fallar no es una comprobación.**
Se escriben cuando duelen, no al final.

| | Lección | Qué costó |
|---|---|---|
| L-001 | Que una subpágina no mencione una restricción no significa que no exista | una vía de entrega descartada tarde |
| L-002 | Un test que usa otro transporte que producción no está probando producción | dos funcionalidades entregadas rotas (ADR-011, ADR-012) |
| L-003 | Un test que afirma la misma cadena que el código no prueba la cadena | un despliegue caído y su vuelta atrás |

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

---

## L-003 · Un test que afirma la misma cadena que el codigo no prueba la cadena

**Cuando** — 22-09-2026, desplegando el puente al altavoz fisico.

**Que paso** — `cdk deploy` fallo a mitad con *«The provided principal was invalid»* y la pila hizo
vuelta atras. El permiso que deja a Alexa invocar la funcion nombraba
`alexa-appkit.smapi.amazon.com`. El principal bueno es `alexa-appkit.amazon.com`, a secas: SMAPI es
la API de **gestion** de skills, otro servicio, que no invoca nada.

**Por que no se vio** — Los veinte tests de la pila estaban en verde, y uno de ellos afirmaba
exactamente `Principal: 'alexa-appkit.smapi.amazon.com'`. Es decir, repetia la misma cadena que el
codigo. Una plantilla sintetizada se puede comparar consigo misma indefinidamente sin enterarse de
que el valor no existe en ninguna parte. El `cdk diff` tampoco lo vio, y no podia: la plantilla era
correcta; lo que no existia era el servicio.

**La leccion** — Hay valores que **solo el proveedor puede validar**: nombres de servicio, ARN de
modelos, identificadores de region, nombres de runtime. Para esos, el unico test es el despliegue, y
por eso hay que desplegar pronto y no al final. Cuando un valor asi entra en el codigo, o se copia
de la documentacion del proveedor con el enlace al lado, o se asume que esta mal hasta que un
despliegue diga lo contrario.

**Lo general** — La misma familia que L-001 y L-002. Alli el test usaba un transporte que no era el
de produccion; aqui el test no usaba nada, se miraba al espejo. Una comprobacion que no puede fallar
no es una comprobacion.

**Coste** — Un despliegue fallido, una vuelta atras limpia (no se perdio nada de lo ya desplegado) y
unos veinte minutos. El comentario que lo explica vive ahora en `infra/lib/lodge-stack.ts`, al lado
del principal.

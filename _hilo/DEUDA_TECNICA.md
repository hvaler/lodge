# Deuda Tecnica y Riesgos

> **INSTRUCCIONES PARA CLAUDE**: registro de riesgos, deuda y asuntos abiertos. Consultalo antes de
> proponer trabajo nuevo y anade aqui lo que aparezca.
>
> Estado a **14-09-2026** (cierre del onboarding). El codigo aun no existe: M0 arranca el 15 de
> septiembre. Por eso no hay deuda de implementacion todavia — lo que hay son **riesgos con fecha**.

---

## Riesgos

### 🔴 ALTO · Dos candidaturas, un equipo

Lodge y **LREA** compiten por el mismo tiempo. Llevar dos proyectos en paralelo es la forma mas
fiable de entregar dos cosas a medias.

**Mitigacion** — Las reglas de corte, con fecha concreta y sin reunion de por medio. Lodge tiene
prioridad. **El 14 de octubre es el punto de no retorno**: si ese dia no hay demostracion de punta a
punta, se abandona LREA. Una candidatura terminada vale mas que dos a medias.

### 🔴 ALTO · La abstraccion se come el calendario

Disenar "para cualquier institucion" es donde se pierde una semana sin darse cuenta.

**Mitigacion** — Dos adaptadores, ni uno mas. **La interfaz de proveedor se congela al cerrar M1** y
a partir de ahi solo se implementa.

### 🟡 MEDIO · Lo generico demuestra peor

Un video sobre algo configurable emociona menos que uno sobre un sitio con nombre propio.

**Mitigacion** — San Telmo con detalle suficiente, y UC-07 (el estudiante de intercambio)
convirtiendo la genericidad en el momento espectacular en lugar de en una nota al pie.

### 🟡 MEDIO · El registro de complementos de Alexa+ esta cerrado

Limitado a socios seleccionados y a un solo pais (EE. UU.). No se puede publicar un complemento
oficial.

**Mitigacion** — Las reglas admiten un servidor MCP autoalojado con la experiencia simulada en
aplicacion web propia. Ese orquestador se construye una vez, **se publica**, y suma en el mini-reto
de codigo abierto.

### 🟢 BAJO · Datos y privacidad

El proyecto no toca ningun sistema real ni ninguna institucion existente.

**Mitigacion** — Datos generados, **no anonimizados**; comprobacion de secretos en integracion
continua; ninguna credencial institucional en el repositorio.

---

## Reglas de corte

Aplicables **sin convocar una reunion**. Tienen fecha, no criterio.

| # | Disparador | Recorte |
|---|---|---|
| 1 | M2 se pasa del **4 de octubre** | El adaptador de estandares se recorta a calendarios e inventario; el directorio LDAP queda fuera |
| 2 | M3 se pasa del **11 de octubre** | Caen las tarjetas visuales. La voz sola cumple el track |
| 3 | El **14 de octubre** no hay demostracion de punta a punta | Se abandona LREA y todo el equipo pasa a Lodge |

Transversal a las tres: los casos `essential` de `docs/use-cases.md` sobreviven a cualquier recorte;
los `improvement` (hoy solo UC-06) caen primero.

---

## Abierto ahora mismo (todo M0, 15-17 sep)

| Asunto | Estado | Fecha limite |
|---|---|---|
| Repositorio publico en GitHub sin crear | `proyecto.repositorio` esta en `null` a proposito, no se ha inventado | 17 sep |
| `LICENSE` Apache-2.0 | Debe entrar **en el primer commit**, no despues | 17 sep |
| Cuenta AWS con acceso a Bedrock en `us-east-1` | Sin verificar | 17 sep |
| Universidad de San Telmo | Definida en el runbook, sin generar el dataset | 17 sep |

---

## Deuda asumida a proposito

| Decision | Por que se asume | Cuando se paga |
|---|---|---|
| Solo dos adaptadores | Tres son orfebreria y se comen el calendario | Despues del hackathon: conectores a plataformas docentes |
| Sin conectores a plataformas docentes | Fuera de alcance explicito | Primer anadido natural post-hackathon |
| Interfaz congelada tras M1 | Sin congelacion no hay fecha de entrega creible | No se paga: es la pieza reutilizable del proyecto |
| `soluciones: []` y sin pipelines R25 en el Hilo | El modelo del ecosistema hv es .NET y aqui no aplica | No se paga |

---

## Fricciones del ecosistema

El ecosistema hv/Ovillo asume .NET (estandares C#, `dotnet build`, `.sln`, integracion con Visual
Studio, enum SQL en la configuracion). Lodge es TypeScript/Node sobre AWS. Lo adaptado durante el
onboarding queda anotado en `FEEDBACK_ECOSISTEMA.md`; no es deuda del proyecto, es cobertura del
ecosistema.

> **Registro de friccion del hackathon**: es un entregable aparte (hasta un 10 % de bonificacion) y
> se escribe **mientras duele, no al final** — arranca en M4. No confundirlo con este fichero.

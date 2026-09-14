# Catalogo de Funcionalidades

> **INSTRUCCIONES PARA CLAUDE**: este archivo documenta que hace Lodge. Leelo antes de modificar
> una funcionalidad y actualizalo despues de implementar una nueva.
>
> **Fuente de verdad**: [`RUNBOOK.md`](../RUNBOOK.md) (EN, canonico) y
> [`RUNBOOK.es.md`](../RUNBOOK.es.md) son el documento vivo del proyecto. Este fichero resume lo que
> hace falta para trabajar; ante discrepancia, manda el runbook.

---

## Proposito

Lo que sabe el conserje no esta en ningun sistema: esta repartido entre un horario colgado, un correo
de secretaria, el calendario academico y veinte anos de memoria. Y solo es accesible mientras la
garita esta abierta.

Lodge expone ese conocimiento como **servidor MCP** para que Alexa+ lo responda a cualquier hora.
La decision que lo define: **no se construye para una universidad concreta**. Se construye contra los
estandares que todas usan ya —calendarios iCalendar, directorio LDAP, inventario de espacios en
tabla— de modo que una institucion lo despliega en una tarde en vez de encargar una integracion.

**Por que MCP y no un chatbot mas**: los asistentes de campus viven dentro de un widget, no se pueden
componer y mueren con el contrato. Un servidor MCP es lo contrario: cualquier agente puede
consumirlo. La institucion publica sus capacidades una vez y deja de elegir cliente.

---

## Modulos (los cuatro frentes)

| Frente | Alcance | Hito critico |
|---|---|---|
| **Nucleo MCP** | Servidor, interfaz de proveedor, contratos, latencia | M1 (ruta critica) |
| **Adaptadores** | `synthetic` y `standards`, negociacion de capacidades, datos de San Telmo | M2 |
| **Superficie y AWS** | Orquestador, tarjetas visuales, CDK, contenedor | M3-M4 (dueno del mini-reto AWS) |
| **Adopcion y entrega** | Guia de instalacion, documentacion, registro de friccion, video | M5 |

---

## Las seis herramientas MCP

Se publican **segun capacidades**: ninguna aparece si el adaptador no la soporta. Una institucion sin
gestor de incidencias no publica las de incidencias, y el agente nunca ofrece lo que no existe.

Las de escritura confirman antes de actuar por **peticion multivuelta**: la herramienta devuelve
`input_required` y el cliente reintenta con la respuesta.

| Herramienta | Pregunta que resuelve | Nivel |
|---|---|---|
| `campus.find_room` | "¿Donde puedo estudiar ahora mismo?" | lectura |
| `campus.timetable` | "¿Que tengo manana a primera hora?" | lectura |
| `campus.deadlines` | "¿Cuando acaba el plazo de matricula?" | lectura |
| `campus.wayfind` | "¿Como llego al aula del examen?" | lectura |
| `campus.report_issue` | "El proyector del aula 203 no enciende" | **escritura** |
| `campus.issue_status` | "¿Como va el aviso de ayer?" | lectura |

---

## Casos de uso

> ⚠️ **Los criterios de aceptacion viven en [`docs/use-cases.md`](../docs/use-cases.md), no aqui.**
> Ese fichero esta en ingles a proposito porque acompana a los tests de contrato que se escriben en
> M1. Duplicarlos traducidos en este documento garantizaria que los dos diverjan en cuanto cambie
> uno. Aqui solo va el indice.

| ID | Caso | Herramientas | Prioridad |
|---|---|---|---|
| UC-01 | Un aula libre ahora mismo | `campus.find_room` | essential |
| UC-02 | Que tengo manana | `campus.timetable` | essential |
| UC-03 | Un plazo administrativo | `campus.deadlines` | essential |
| UC-04 | Llegar al aula | `campus.wayfind` | essential |
| UC-05 | Reportar una averia | `campus.report_issue` | essential |
| UC-06 | Seguimiento del aviso | `campus.issue_status` | **improvement** |
| UC-07 | El estudiante de intercambio | las seis, dos adaptadores | essential |

**UC-07 justifica la arquitectura entera.** Un estudiante matriculado en dos instituciones pregunta
lo mismo sobre la otra: se conmuta el adaptador activo y las mismas seis herramientas resuelven
contra otro origen de datos y otro idioma, sin reiniciar ni recompilar. Si deja de funcionar, esto es
un servidor de campus mas y no una implementacion de referencia.

**Prioridad y recortes**: los casos `essential` sobreviven a cualquier regla de corte; los
`improvement` —hoy solo UC-06— caen primero.

---

## Los dos adaptadores

Generalizar es el agujero de alcance clasico. La disciplina es numerica: uno finge la costura, tres
son orfebreria, **dos la obligan a ser real**.

| Adaptador | Origen | Para que |
|---|---|---|
| `synthetic` | Generador determinista | Referencia, demostracion, reproducibilidad. Es la Universidad de San Telmo |
| `standards` | iCalendar · LDAP · CSV | Lo que cualquier institucion ya tiene, sin desarrollar nada |

**Fuera de alcance, explicitamente**: conectores para plataformas docentes concretas. Son el primer
anadido natural *despues* del hackathon.

**Negociacion de capacidades**: cada adaptador declara que sabe hacer y en que idioma, y el catalogo
de herramientas se deriva de esa declaracion. Es lo que hace que "generico" signifique algo en tiempo
de ejecucion en lugar de ser una promesa del README.

---

## La institucion de demostracion

**Universidad de San Telmo** — ficticia, completa, **generada (no anonimizada)**.

- Tres edificios: Mendizabal, Santa Clara y El Faro, con plantas, aulas, aforos y equipamiento.
- Seis titulaciones con cursos, grupos y solapamientos realistas.
- Calendario academico: matricula, examenes, festivos.
- **Cero datos reales**: ninguna persona, ninguna institucion existente, ningun sistema en produccion.

Lo generico se demuestra mal: "aulas libres en el edificio configurable" es un video peor que un
sitio con nombre. Por eso el adaptador de referencia no contiene datos vagos.

---

## Actores

| Actor | Que hace | Que necesita |
|---|---|---|
| Estudiante | El grueso del volumen: aulas libres, horario, plazos, como llegar | Respuesta en segundos, sin sesion ni contexto previo |
| Docente | Aula asignada, tutorias, avisar de un equipo averiado | Fiabilidad: fallar cinco minutos antes de una clase es un problema real |
| Conserjeria y mantenimiento | No hablan con el agente: *reciben* las incidencias | Que los avisos entren en la cola que ya miran |
| Responsable de TI | Despliega, integra y mantiene | Directorio, contenedor, actualizaciones. La guia es para el |
| Proteccion de datos | No usa nada. Puede vetar | Minimizacion por diseno, despliegue propio |
| Desarrollador tercero | Escribe el adaptador de su institucion | Interfaz estable y documentacion |

Dos consecuencias gobiernan el proyecto:

1. **El video le habla al estudiante y la documentacion al responsable de TI.** Confundirlos pierde a uno de los dos.
2. **Una herramienta que abre incidencias solo sirve si escribe en la cola que mantenimiento ya revisa.** Generar avisos que nadie procesa es fracasar con el codigo impecable.

---

## Entregables (cierre en M6)

- [ ] Proyecto creado o actualizado sustancialmente despues del 31-08-2026
- [ ] Repositorio publico, licencia abierta, instrucciones verificadas
- [ ] Servidor MCP autoalojado, Streamable HTTP, spec 2026-07-28
- [ ] Tecnologia del track importada e invocada en tiempo de ejecucion
- [ ] Demostracion funcional accesible para el jurado
- [ ] Video publico de menos de 3 minutos
- [ ] Feedback de producto sobre todas las APIs utilizadas
- [ ] Track declarado y ambos mini-retos seleccionados
- [ ] Registro de friccion (hasta un 10 % de bonificacion)
- [ ] Guia de adopcion validada por alguien ajeno al desarrollo

---

## Nota de alcance

Este proyecto no contiene datos, marcas, sistemas ni nomenclatura de ninguna institucion concreta, y
no requiere autorizacion de ninguna. La Universidad de San Telmo es ficticia y sus datos estan
generados.

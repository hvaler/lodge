# ESTADO_PROYECTO.schema.md — Documentacion de campos

> **Proposito**: documentacion extendida, ejemplos y opciones de `_hilo/ESTADO_PROYECTO.json`.
> Este archivo **NO se importa en CLAUDE.md** (no consume contexto en cada sesion). Claude lo
> consulta bajo demanda cuando necesita rellenar o interpretar una seccion del JSON
> (tipicamente durante `/hv:onboarding`, `/hv:cicd-init`, `/issue-tracker-sync` o `/hv:analizar`).
>
> Regla de mantenimiento: si anades un campo nuevo al JSON, documentalo AQUI (no inline en el
> JSON) y deja como mucho una linea `_doc` de puntero.

---

## equipo

Miembros del equipo. Configurar manualmente o via `/hv:onboarding` (paso `equipo`).

| Campo | Regla |
|---|---|
| `usuario` | DEBE coincidir con el usuario Git (`git config user.name` o alias corto). Es la clave de matching para `/hv:tomar`, `/hv:equipo`, `asignadoA`. |
| `nombre` | DEBE coincidir **EXACTAMENTE** con el displayName de Active Directory (no email, no alias). Se usa como `System.AssignedTo` en Azure DevOps on-premises — Azure DevOps **no resuelve** email/UPN (HTTP 400 `unknown identity`). Verificar con: `curl --negotiate -u : '{URL}/_apis/identities?searchFilter=General&filterValue={alias}&api-version=6.0'` |
| `email` | Email corporativo de la organizacion. |
| `roles` | **Array** de roles (un miembro puede ser JP y developer a la vez). Si un JSON legacy tiene `rol` (string), se trata como array de un elemento. `/issue-tracker-sync` considera developer a quien tenga `desarrollador` en `roles`. Valores: `jefe_proyecto`, `desarrollador`, `analista`, `tester`, `arquitecto`, `lider_tecnico`. |
| `git_author_name` | Opcional. Solo si el nombre que figura en los commits (`git log --format=%an`) difiere de `nombre`. Ej.: `git config user.name='Ana P.'` pero el directorio dice `Ana Perez Gomez`. Si no se especifica, se usa `nombre` para el matching en git log. |
| `githubLogin` | Opcional (proyectos GitHub). Login de GitHub del miembro; es lo que acepta `--assignee`. Sin el, `/issue-tracker-sync` prueba `usuario` como login si es colaborador del repo y, si no, deja el issue sin asignar. |

```json
"miembros": [
  {
    "usuario": "jgarcia",
    "nombre": "Juan García López",
    "email": "jgarcia@example.com",
    "roles": ["desarrollador"],
    "git_author_name": null,
    "githubLogin": "jgarcia-dev"
  },
  {
    "usuario": "mmartinez",
    "nombre": "Maria Martinez Ruiz",
    "email": "mmartinez@example.com",
    "roles": ["jefe_proyecto", "desarrollador"],
    "git_author_name": "Maria Martinez"
  }
]
```

---

## configuracion

### nivelIntegracionGit

| Valor | Comportamiento de Claude |
|---|---|
| `basico` | Solo sugiere comandos Git, no ejecuta nada |
| `medio` | Pregunta confirmacion antes de ejecutar comandos Git |
| `alto` | Ejecuta comandos Git automaticamente (excepto destructivos) |

### branching

Estrategia de ramificacion. Se configura en `/hv:onboarding` y la leen `/hv:commit`,
`/hv:git-sync`, `/hv:liberar`, la regla `devops-awareness` y `/hv:cicd-init` (R21 trigger + R24
branch-gated). Es el **unico** sitio del Hilo para `estrategia`, `ramaBase` y `convencionRamas`: las claves planas
`configuracion.ramaBase` y `configuracion.convencionRamas` estan deprecadas (ADR-023; `resolve()` las lee como fallback con
aviso hasta 2.0.0 y `config-check.js --migrate` las retira). El default de organizacion es `vcs.*` de
`ecosystem.config.json`; ver `.claude/CONFIGURACION.md`. Los arrays `_estrategias_disponibles` (copia del enum
`vcs.branchingStrategy` del schema, 13 estrategias), `_mergeStrategies` y `_convencionRamas_opciones` **permanecen en el
JSON** porque los validan programaticamente `/git-best-practices` y `/hv:analizar` — no moverlos aqui.

- `tiposTarea`: solo aplica con nomenclatura temporal o combinada (que contenga `{tipo}`);
  `null` = no aplica. Ejemplo:

```json
"tiposTarea": {
  "DT": "Deuda técnica",
  "HV": "Evolutivo",
  "BUG": "Corrección",
  "REF": "Refactoring"
}
```

---

## stack

Stack tecnologico del proyecto. Lo rellena `/hv:onboarding` (Fase 2). **No existe en el JSON
scaffolded**: se anade en el onboarding porque su forma depende del tipo de proyecto.

Los defaults del ecosistema asumen .NET (`framework`, `orm`, `tipo_proyecto` tipo WebAPI/MVC). Un
proyecto que no es .NET usa las mismas claves con sus valores propios y anade las que necesite; lo
que no aplica se deja en `null` en vez de inventarlo. Ejemplo real (Lodge, servidor MCP sobre Node):

| Campo | Contenido |
|---|---|
| `runtime` | Motor de ejecucion y su version de soporte (`Node 24 LTS`, `.NET 10`) |
| `lenguaje` | `TypeScript`, `C#`... |
| `tipo_proyecto` | Que es el entregable (`Servidor MCP (Streamable HTTP, sin estado)`) |
| `sdk` · `protocolo` | SDK y revision de protocolo cuando el proyecto implementa uno |
| `frontend` · `modelo` | Superficie de usuario y modelo de IA, si los hay |
| `base_datos` · `orm` | `null` cuando no hay ORM o la BD solo aplica a un destino de despliegue |
| `identidad` · `observabilidad` | Esquema de autenticacion y stack de telemetria |
| `infraestructura_como_codigo` · `contenedor` | IaC e imagen base |
| `gestor_paquetes` | `npm`, `nuget`... — lo lee quien audita dependencias |
| `politica_versiones` | Cuando se fijan, revalidan y congelan las versiones |

> El motor de BD **no** se duplica en `ecosystem.config.json` si no encaja: el enum de
> `database.engine` solo admite `sqlserver|postgres|mysql|sqlite`. Un proyecto sobre DynamoDB,
> Cosmos o sin BD omite ese bloque entero (solo `configVersion` es obligatorio) y describe el
> almacenamiento aqui.

---

## soluciones

Soporte multi-solucion. Se auto-detecta al ejecutar `/hv:onboarding` o
`integracion-vs.ps1`. Estructura de cada entrada de `soluciones[]`:

```json
{
  "nombre": "MyCompany.MiApp.sln",
  "ruta": "src/MyCompany.MiApp.sln",
  "framework": ".NET 10",
  "descripcion": "API principal",
  "esActiva": true
}
```

Notas:
- Si `multiSolucion=true`, `/testing-patterns` y `/hv:analizar` preguntaran que solucion usar.
- Para `/hv:onboarding` se procesan TODAS las soluciones automaticamente.
- `solucionActiva` guarda la ultima solucion seleccionada para comandos, y es el **override** del objetivo
  de compilacion: si apunta a un fichero que existe, gana a lo que se encuentre en disco.
- `soluciones: []` significa **sin solucion detectada**, no un estado a medias: el objetivo de compilacion se
  resuelve del disco con `hooks/build-target.js` (ADR-037), y un repositorio de un solo `.csproj` es un caso
  soportado. Aqui no hay ninguna clave que apunte a un proyecto.
- Usar `integracion-vs.ps1 -All` para aplicar a todas sin preguntar.

---

## jira

Integracion con Jira. Se auto-configura al detectar un ticket Jira por primera vez.

- `url` ejemplo: `https://miorg.atlassian.net` · `proyectoKey` ejemplo: `PROJ`.
- Cuando `habilitado=true`, evolutivos `PROYECTOKEY-XXX` muestran recordatorios de Jira.
  Evolutivos `EV-XX` o texto libre NO se vinculan a Jira.
- Fase 0: solo recordatorios manuales. Fase 2: automatizacion con MCP/API.

---

## acceso_bd

Claude puede conectarse a BD de desarrollo con enmascaramiento dinamico de datos personales.

- `connection_string_key`: nombre de la variable/secreto con la cadena de conexion (nunca la cadena en si).
- `usuario_claude`: usuario SQL especifico para Claude con enmascaramiento dinamico aplicado.
- `permisos`: por defecto solo `select`. Ampliar requiere decision explicita del equipo.

---

## infraestructura

Topologia de despliegue del proyecto. Se configura en `/hv:onboarding` Fase 5b.
Cada entorno tiene servidor de **Aplicaciones** y de **Servicios**;
el routing se decide por `tipo`+`publico` del entrypoint (R25).

### entornos[] — ejemplo completo

```json
"entornos": [
  {
    "nombre": "Dev", "tipo": "desarrollo",
    "servidor_app": "dev01", "servidor_servicios": "svc01",
    "url_app": "dev.example.org", "url_servicios": "dev-svc.example.org",
    "deploy_automatico": true, "balanceo": false
  },
  {
    "nombre": "Pre", "tipo": "staging",
    "servidor_app": "pre.example.org", "servidor_servicios": "pre-svc.example.org",
    "url_app": "pre.example.org", "url_servicios": "pre-svc.example.org",
    "deploy_automatico": false, "balanceo": false
  },
  {
    "nombre": "Pro", "tipo": "produccion",
    "servidores_app": ["APP01.example.org", "APP02.example.org"],
    "servidores_servicios": ["SVCNODE01.example.org", "SVCNODE02.example.org"],
    "url_app": "www.example.org", "url_servicios": "svc.example.org",
    "deploy_automatico": false, "balanceo": true, "estrategia_deploy": "rolling"
  }
]
```

Nota Pro/servicios: SVCNODE02 apagado por ahora — el deploy va solo al nodo online; se declara
para cuando se encienda.

### cicd

- `plataforma`: `azure-pipelines` | `github-actions` | `manual` | `null`.
- **R25**: un pipeline por **ENTRYPOINT** de la solucion (Web/API con CD; Console
  con CD por tarea programada, `schtasks` lanzado desde el agente de build). `/hv:cicd-init` rellena `pipelines[]`;
  `/hv:cicd-deploy` y `/hv:cicd-status` lo leen.

#### pipelines[] — campos por entrada

| Campo | Significado |
|---|---|
| `entrypoint` | Proyecto entrypoint (ej. `MyCompany.X.Api`) |
| `slug` | Sufijo corto del YAML/definicion (`api`, `web`, `worker`) |
| `tipo` | `web` \| `api` \| `console` |
| `publico` | Solo APIs: `true` → servidores de Aplicaciones (default `false` → Servicios) |
| `serverType` | `app` = Aplicaciones (web / API publica) · `svc` = Servicios (API privada) · `batch` = Console/Worker (sin tipo fijo; DeployTarget derivado del pool real, FB-002). Derivado de `tipo`+`publico` (R25); determina `DeployTarget=<env>-<serverType>` |
| `yaml` | Nombre del fichero pipeline (`azure-pipelines.<slug>.yml`) |
| `pipelineId` | ID de la definicion Azure DevOps |
| `fase` | Fase de adopcion CI/CD (0/1/2) |
| `stack` | `dotnet` \| `netfx` \| `spa` \| `console` |
| `deployConfirm` | Por entorno: `true` = `/hv:cicd-deploy` pide confirmacion (default solo `pro`) |
| `ultimoBuildStatus` | Cache del ultimo estado de build |

Campos adicionales **solo Console/Worker** (CD via Tarea Programada):
`mecanismo` (`tarea-programada` | `windows-service`), `taskName`, `taskScheduleArgs`
(ej. `/SC HOURLY`), `taskRunAccount` (`NT AUTHORITY\SYSTEM`), `deployFolder`, `consoleExe`.

#### Ejemplos

```json
{ "entrypoint": "MyCompany.X.Api", "slug": "api", "tipo": "api", "publico": false,
  "serverType": "svc", "yaml": "azure-pipelines.api.yml", "pipelineId": 0, "fase": 2,
  "stack": "dotnet", "deployConfirm": { "dev": false, "pre": false, "pro": true },
  "ultimoBuildStatus": null }
```

```json
{ "entrypoint": "MyCompany.X.Worker", "slug": "worker", "tipo": "console", "publico": false,
  "serverType": "batch", "yaml": "azure-pipelines.worker.yml", "pipelineId": 0, "fase": 2,
  "stack": "console", "mecanismo": "tarea-programada", "taskName": "MyCompany.X.Sync",
  "taskScheduleArgs": "/SC HOURLY", "taskRunAccount": "NT AUTHORITY\\SYSTEM",
  "deployFolder": "D:\\Apps\\MyCompany.X", "consoleExe": "MyCompany.X.Worker.exe",
  "deployConfirm": { "dev": false, "pre": false, "pro": true }, "ultimoBuildStatus": null }
```

### aprobadores

Quien aprueba deploy a cada entorno (arrays de usuarios). Configurable por proyecto.

### azureDevOps (opcional, creado por /issue-tracker-sync en proyectos Azure DevOps)

Estructura completa en `.claude/skills/issue-tracker-sync/references/azure-devops-rest-playbook.md`: `url`, `teamName`,
`epicId`, `features{}`, `proceso` (`Scrum`|`Basic`|`Agile`|`CMMI`), `autoSync`, `pendingOps`. La regla
`devops-awareness` lee `autoSync`.

### github (opcional, creado por /issue-tracker-sync en proyectos GitHub)

Estructura completa en `.claude/skills/issue-tracker-sync/references/github-playbook.md`: `owner`, `repo`, `epicIssue`
(numero del issue `type:epic`), `features{}` (numero del issue `type:feature` por area; `{}` en `modoPlano`),
`milestones{}`, `project{ owner, number, id, statusFieldId, statusOptions{todo,inProgress,done} }`, `docsEnLugarDeWiki`,
`autoSync`, `ultimaSync`, `pendingOps`. Solo uno de `azureDevOps`/`github` por proyecto.

---

## criticidad · calendario

- `criticidad.sla` ejemplo: `99.9%` · `horario_mantenimiento` ejemplo: `Sabados 02:00-06:00`.
- `dependencias_inter_proyecto` ejemplo: `["Proyecto X depende de nuestra API", "Consumimos datos de Proyecto Y"]`.
- `calendario.freeze_periods` ejemplo: `"2026-03-01 a 2026-03-15 (cierre fiscal)"`.

---

## mcpSync

Sincronizacion con el Hub Ovillo.

**Modelo de identidad — tres archivos, NO mezclar** (detalle en `.claude/skills/mcp-config/SKILL.md`):

| Archivo | Scope | Commiteable | Contenido |
|---|---|---|---|
| `_hilo/.mcp-project.json` | per-PROYECTO | ✅ | `projectId`, `serverUrl` (para que otros devs se unan via `/v2/join`) |
| `ESTADO_PROYECTO.json.mcpSync` | per-PROYECTO | ✅ | `habilitado`, `categorias`, `projectId`, `ultimaSync` |
| `_hilo/.mcp-credentials.json` | per-DEV | ❌ gitignored | `apiKey`, `devAlias`, `devEmail`, `telemetryOptIn` |

Reglas:
- `habilitado=true` lo activa `/hv:mcp-register` (o el instalador si la organizacion fijo `hub.registerOnInstall=true`). Si esta en `false`, `/hub-client` rechaza.
- `projectId` se asigna al registrar el proyecto y se commitea.
- `enviarNombreCompleto` (opcional, default `false`): la categoria `equipo` envia solo el alias; con `true` incluye tambien
  el nombre completo de cada miembro (dato personal, ADR-024). Politica de datos: pagina «Datos y privacidad» del portal.
- Cada categoria es un toggle independiente; si el Hub anade categorias nuevas, el script las activa por defecto (forward-compat). `feedbackEcosistema` sube `_hilo/FEEDBACK_ECOSISTEMA.md`.
- **`telemetryOptIn` NO existe aqui** — es per-dev; si aparece (residual de versiones anteriores), eliminarlo y usar `/hv:mcp-register`.

---

## evolutivos

Gestion de evolutivos con soporte para trabajo colaborativo. Estructura de cada evolutivo
(en `pendientes[]`, `enProgreso[]` o `completados[]`):

```json
{
  "codigo": "EV-XX",
  "titulo": "Descripción breve",
  "estado": "pendiente|en_progreso|pausado|completado|cancelado",
  "asignadoA": "usuario_git o null si no asignado",
  "rama": "feature/EV-XX o null",
  "prioridad": "alta|media|baja",
  "fechaCreacion": "YYYY-MM-DD",
  "fechaInicio": "YYYY-MM-DD o null",
  "fechaEstimada": "YYYY-MM-DD o null",
  "fechaCompletado": "YYYY-MM-DD o null",
  "creadoPor": "usuario_git",
  "notas": "Notas adicionales"
}
```

`evolutivoActivo` (raiz del JSON) = codigo del evolutivo actualmente en trabajo; se actualiza
con `/hv:continuar`.

---

## dominiosExternos (opcional)

Mapeo de integraciones externas → Context7 (regla `domain-api-docs.md`). Ver esa regla para
la estructura (`nombre`, `carpetaPattern`, `context7Library`, `anchorTopics`, `skipPaths`).

---

*Schema de ESTADO_PROYECTO.json — Ovillo.*

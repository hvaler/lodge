# `src/` — el servidor

TypeScript sobre Node 24, sin paso de compilación para leerlo: cada carpeta es una capa del diagrama
del [README](../README.md), en el mismo orden en que una pregunta las atraviesa.

| Carpeta | Qué hay | Empieza por |
|---|---|---|
| `server/` | el servidor MCP sobre Streamable HTTP, sin estado; el fichero de configuración; OAuth 2.1 | `main.ts`, `config.ts` |
| `provider/` | **la interfaz de proveedor, congelada** (ADR-006): capacidades, métodos y qué herramienta publica cada una | `provider.ts`, `frozen.ts` |
| `adapters/synthetic/` | la Universidad de San Telmo, generada y determinista | `index.ts` |
| `adapters/standards/` | iCalendar, LDAP, inventario en tabla y los tres destinos de un parte de avería | `config.ts`, `inventory.ts` |
| `tools/` | las seis herramientas `campus.*`, registradas según lo que el adaptador declare | `index.ts` |
| `cards/` | las tarjetas visuales (extensión MCP Apps) que acompañan a una respuesta hablada | `index.ts` |
| `orchestrator/` | el cliente: Bedrock, la vuelta de llamadas a herramienta y el *prompt caching* | `index.ts`, `model.ts` |
| `web/` | el demostrador con voz y la página pública, que hablan con el servidor por HTTP como cualquier cliente | `main.ts` |
| `lambda/` | los dos puntos de entrada de AWS, sobre el mismo servidor | `handler.ts` |
| `shared/`, `telemetry/` | zonas horarias e idioma; OpenTelemetry con el contexto de traza del cliente | `time.ts` |

Los tests viven **junto al código** que prueban, como `<modulo>.test.ts`; no hay carpeta de tests.
Cada criterio de aceptación de [`docs/use-cases.md`](../docs/use-cases.md) tiene el suyo.

```bash
npm test          # toda la suite
npm run build     # incluye la comprobación de la interfaz congelada
npm start         # el servidor, contra LODGE_CONFIG
npm run demo      # el demostrador: Lodge en :3000 y la simulación de Alexa+ en :8080
```

> **La interfaz de `provider/` está congelada.** Se implementa, no se edita. Si algo obliga a
> moverla, el compilador lo dirá en cada `npm run build`: el procedimiento está en ADR-006, y en
> ADR-017 y ADR-019 hay dos ejemplos de haberlo seguido.

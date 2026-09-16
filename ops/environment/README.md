# ops/environment/ — el despliegue autónomo

Lo que una institución necesita para levantar Lodge en su propia infraestructura: un contenedor, un
fichero de configuración y sus credenciales. Sin nube.

| Fichero | Para qué |
|---|---|
| `docker-compose.yml` | Lodge + un OpenLDAP con el directorio de Carrigmore, para probar el adaptador `standards` contra un directorio de verdad |
| `carrigmore.json` | Una institución: el caso normal, servida en `/mcp` |
| `demo.json` | Dos instituciones: UC-07, servidas en `/mcp/{slug}` |

```bash
docker compose up -d          # desde esta carpeta
curl localhost:3000/health    # qué está sirviendo y con cuántas herramientas
```

Los ficheros de Carrigmore (`rooms.csv`, `timetable.ics`, `deadlines.ics`, `directory.ldif`) viven
en `fixtures/carrigmore/` y se montan **de solo lectura**: Lodge responde preguntas, no tiene nada
que escribir en los datos de una institución.

---

## El fichero de configuración

Qué adaptador, dónde están sus fuentes y quién avala a sus personas. Se lee una vez al arrancar y se
valida en voz alta: una URL mal escrita debe hacer que el contenedor se niegue a arrancar, no que
falle la primera pregunta de un estudiante.

```json
{
  "adapter": "standards",
  "standards": {
    "institution": "Carrigmore College",
    "locale": "en-IE",
    "timeZone": "Europe/Dublin",
    "inventory": { "location": "/srv/carrigmore/rooms.csv" },
    "calendars": {
      "timetable": "/srv/carrigmore/timetable.ics",
      "deadlines": "/srv/carrigmore/deadlines.ics"
    },
    "directory": { "url": "ldap://directory:1389", "...": "..." }
  },
  "auth": {
    "issuer": "https://login.carrigmore.ie",
    "jwksUri": "https://login.carrigmore.ie/.well-known/jwks.json",
    "scopes": ["lodge.read"]
  }
}
```

**El catálogo sale de lo que configures.** Sin `directory` no se publica `campus.timetable`, porque
sin saber quién pregunta no hay horario que dar. Sin `inventory` no se publica `campus.find_room`.
Nada se ofrece a medias.

---

## OAuth 2.1

Lodge **verifica** tokens; no los emite (ADR-013). El bloque `auth` nombra el proveedor de identidad
que ya tiene la institución, y hacen falta dos cosas más:

```bash
LODGE_PUBLIC_URL=https://lodge.carrigmore.ie   # la URL por la que llegan los clientes
```

Sin ella no se comprueba ningún token, y el servidor lo dice al arrancar. La razón es que un token
se liga al **URI canónico** de este servidor (RFC 8707): sin saber cuál es, no hay a qué ligarlo, y
aceptar un token emitido para el servidor de otro es peor que no tener OAuth, porque lo parece.

Con eso, Lodge publica dónde mirar:

```
GET /.well-known/oauth-protected-resource/mcp
{
  "resource": "https://lodge.carrigmore.ie/mcp",
  "authorization_servers": ["https://login.carrigmore.ie"],
  "bearer_methods_supported": ["header"],
  "scopes_supported": ["lodge.read"]
}
```

Un cliente sin token recibe `401` con la cabecera `WWW-Authenticate` apuntando a ese documento, va a
buscar uno y vuelve. El PKCE ocurre entre el cliente y el proveedor de identidad; Lodge no lo ve.

Si el `sub` de vuestro IdP es un identificador opaco y el directorio indexa por otra cosa —el mismo
`uid` del LDAP, por ejemplo—, `"subjectClaim": "uid"` dice cuál de los dos seguir.

> **`LODGE_DEV_IDENTITY=1`** deja que cualquiera diga quién es mediante una cabecera. Es un bypass de
> autenticación, existe para el demostrador y para desarrollo, y no tiene ningún caso de uso en un
> despliegue. El servidor avisa cuando está encendido.

---

## Trazas

Apagadas mientras no digas dónde mandarlas:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318
```

Sin esa variable, Lodge no carga el SDK, no abre conexión y no exporta nada. Con ella, cada petición
MCP produce un tramo, y debajo aparecen los que de verdad van a algún sitio: una consulta al
directorio o la lectura de un calendario.

Lo que hace esto útil y no mera higiene es que **la traza continúa la del cliente**. Si vuestro
agente propaga contexto W3C —por la cabecera `traceparent` o por el `_meta` de la petición—, veréis
un solo dibujo desde la pregunta del estudiante hasta la consulta LDAP que provocó, en vez de dos
inconexos.

Un detalle del directorio: el tramo envuelve la consulta real, no la caché. Si una traza no lleva
tramo de directorio, esa respuesta salió de memoria.

Si preferís el camino estándar de OpenTelemetry —arrancar Node con `--import` y vuestro propio
arranque de SDK—, funciona igual: los tramos encuentran vuestro proveedor y esta variable sobra.

## Varias instituciones

`demo.json` sirve dos a la vez, cada una en su ruta y con su catálogo, su idioma y su zona horaria.
Cada una lleva también su propio `auth`: el proveedor de identidad es de la institución, no del
despliegue, y un token emitido para una **no vale en la otra** aunque las sirva el mismo proceso.

Es UC-07, y es lo que justifica que la interfaz de proveedor exista.

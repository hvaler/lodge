# `ops/` — lo que se ejecuta

| Fichero | Para qué |
|---|---|
| `environment/docker-compose.yml` | Lodge y un LDAP de pruebas, que es como se verificó UC-07: un servidor, dos instituciones, catálogos distintos |
| `environment/carrigmore.json` | configuración de ejemplo del adaptador `standards`, contra ficheros del repositorio |
| `environment/demo.json` | la de la demostración pública |
| `environment/README.md` | **la referencia del fichero de configuración**: cada bloque, qué publica y qué pasa si falta |

La infraestructura de AWS no está aquí sino en [`infra/`](../infra), que es CDK v2 y por tanto
código. El pipeline está en `.github/workflows/ci.yml`: comprueba tipos, pasa los tests, compila,
construye la imagen del contenedor y le hace una pregunta.

Para desplegar o para adoptarlo, el camino es [`docs/adopting.md`](../docs/adopting.md).

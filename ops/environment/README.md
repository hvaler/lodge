# ops/environment/ — Entorno local

| Fichero | Para qué |
|---|---|
| `docker-compose.yml` | servicios de desarrollo: SQL Server, Redis, Azurite, Mailhog |
| `.env.example` | variables de entorno; copiar a `.env` y rellenar. `.env` no se versiona |

Uso: `cp .env.example .env`, editar, y `docker compose up -d` desde esta carpeta. Lo mantiene el equipo;
ningún workflow lo regenera.

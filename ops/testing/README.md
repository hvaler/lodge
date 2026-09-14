# ops/testing/ — Configuración de pruebas para el pipeline

| Fichero | Para qué |
|---|---|
| `coverlet.runsettings` | umbrales y formato de cobertura que aplica el gate de calidad |
| `.security-exceptions.yml` | excepciones justificadas del escaneo de seguridad (`scripts/security-scan.ps1`) |

Los genera `/hv:cicd-init`; el equipo los ajusta. El pipeline dispara también con cambios aquí. Los
**informes** de tests no están aquí sino en `docs/testing/`, y el **código** de los tests en `src/`.

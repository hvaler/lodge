# `ops/` — what gets run

| File | What for |
|---|---|
| `environment/docker-compose.yml` | Lodge and a test LDAP, which is how UC-07 was verified: one server, two institutions, different catalogues |
| `environment/carrigmore.json` | a worked `standards` configuration, against files in this repository |
| `environment/demo.json` | the one the public demonstration runs |
| `environment/README.md` | **the configuration-file reference**: every block, what it publishes, and what happens without it |

AWS infrastructure is not here but in [`infra/`](../infra), because CDK v2 is code. The pipeline is
`.github/workflows/ci.yml`: it typechecks, runs the tests, builds, builds the container image and
asks it a question.

To deploy it or adopt it, the path is [`docs/adopting.md`](../docs/adopting.md).

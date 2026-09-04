# Immutable container image

`.github/workflows/container-image.yml` builds the production runtime for every
pull request and scans it for unfixed HIGH/CRITICAL vulnerabilities. A push to
the protected `main` branch repeats the checks, then publishes only the full
40-character commit tag to GHCR. The Docker build embeds BuildKit provenance
and an SBOM; the workflow uploads the resulting `ghcr.io/<owner>/<repo>@sha256`
reference as an artifact.

Before enabling the workflow, a repository administrator must set the
`TRIVY_IMAGE_SHA256` repository variable to the approved immutable digest for
the `aquasec/trivy` image. No personal access token or paid service is needed:
publishing uses the job-scoped `GITHUB_TOKEN` with `packages: write`.

Deployments must consume the captured digest, not `main`, `latest`, or a
mutable version tag. The image contains both `apps/web/server.js` and
`dist/worker.mjs`; runtime credentials may be supplied through the existing
`*_FILE` entries mounted below `/run/secrets/`.

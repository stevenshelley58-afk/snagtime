# Immutable container image

`.github/workflows/container-image.yml` builds the production runtime for every
pull request and scans it for unfixed HIGH/CRITICAL vulnerabilities. A push to
the protected `main` branch repeats the checks, then publishes only the full
40-character commit tag to GHCR. The Docker build embeds BuildKit provenance
and an SBOM; the workflow uploads the resulting `ghcr.io/<owner>/<repo>@sha256`
reference as an artifact.

The vulnerability scanner is pinned in the workflow to the reviewed immutable
`aquasec/trivy` 0.74.0 image digest. Updates require a reviewed PR. No
personal access token or paid service is needed: publishing uses the job-scoped
`GITHUB_TOKEN` with `packages: write`.

Deployments must consume the captured digest, not `main`, `latest`, or a
mutable version tag. The image contains both `apps/web/server.js` and
`dist/worker.mjs`; runtime credentials may be supplied through the existing
`*_FILE` entries mounted below `/run/secrets/`.

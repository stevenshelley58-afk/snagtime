import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/container-image.yml", import.meta.url), "utf8");
const generatedNames = [
  "AUTH_SECRET", "BOOKING_CAPABILITY_SECRET", "RATE_LIMIT_HASH_SECRET", "TENANT_CONTEXT_SECRET",
  "TOKEN_ENCRYPTION_KEY", "PROXY_SHARED_SECRET", "OPERATOR_HEALTH_SECRET", "GOOGLE_CLIENT_SECRET",
  "EMAIL_TOKEN_SECRET", "BLOCKWISE_WEBHOOK_SECRET", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
  "SMTP_PASSWORD", "BLOCKWISE_BOOKING_ACTION_SECRET", "TEMPOCOVE_APP_DB_PASSWORD", "TEMPOCOVE_WORKER_DB_PASSWORD",
  "TEMPOCOVE_MONITOR_DB_PASSWORD", "TEMPOCOVE_MIGRATION_DB_PASSWORD",
];
const runtimeNames = [
  "DATABASE_URL", "WORKER_DATABASE_URL", "MONITOR_DATABASE_URL", "AUTH_SECRET", "BOOKING_CAPABILITY_SECRET",
  "BOOKING_CAPABILITY_KEYRING", "RATE_LIMIT_HASH_SECRET", "TENANT_CONTEXT_SECRET", "TOKEN_ENCRYPTION_KEY",
  "PROXY_SHARED_SECRET", "OPERATOR_HEALTH_SECRET", "GOOGLE_CLIENT_SECRET", "EMAIL_TOKEN_SECRET",
  "BLOCKWISE_WEBHOOK_SECRET", "BLOCKWISE_BOOKING_ACTION_SECRET", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "SMTP_PASSWORD",
];
const failures = [];
if (!workflow.includes("openssl rand -hex")) failures.push("cryptographically random generation is absent");
if (!workflow.includes("::add-mask::")) failures.push("generated values are not registered with GitHub masking");
if (!workflow.includes("--env-file")) failures.push("database provisioning does not use a protected env file");
if (!workflow.includes("/run/secrets:ro")) failures.push("runtime secrets are not mounted read-only");
if (!workflow.includes("1000:1000:700") || !workflow.includes("1000:1000:400")) failures.push("secret volume ownership/mode assertions are absent");
for (const name of generatedNames) {
  if (!new RegExp(`mask_and_export ${name}(?: |\\\\\")`).test(workflow)) failures.push(`${name} is not masked/exported at generation`);
}
for (const name of runtimeNames) {
  if (!new RegExp(`write_secret ${name}(?: |\\\\\")`).test(workflow)) failures.push(`${name} is not installed into the runtime secret volume`);
  if (!workflow.includes(`${name}_FILE=/run/secrets/${name}`)) failures.push(`${name}_FILE is not wired to the runtime`);
}
const forbiddenFixtures = /(?:ci-only-ephemeral|CI-[A-Za-z0-9-]*Password|ci-[a-z0-9-]*secret|sk_test_ci|whsec_ci|postgres(?:ql)?:\/\/[^\s:/]+:[^\s@]+@)/i;
if (forbiddenFixtures.test(workflow)) failures.push("static credential-shaped fixture detected in container workflow");
if (failures.length) throw new Error(`Container image secret contract failed: ${failures.join("; ")}`);
console.log(`Container image secret contract passed for ${generatedNames.length} generated values and ${runtimeNames.length} runtime files.`);

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const compose = readFileSync("compose.free-only.yml", "utf8");
const requiredComposeTokens = [
  "CALENDAR_PROVIDER: google",
  "GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:?set Google client id}",
  "GOOGLE_CLIENT_SECRET_FILE: /run/secrets/google_client_secret",
  "google_client_secret: { external: true }",
  "migration_database_url: { external: true }",
  "profiles: [migration]",
  "BLOCKWISE_WEBHOOK_URL",
  "BLOCKWISE_WEBHOOK_SECRET_FILE",
  "healthcheck:",
];
for (const token of requiredComposeTokens) {
  if (!compose.includes(token)) throw new Error(`free-only Compose contract missing ${token}`);
}
if ((compose.match(/CALENDAR_PROVIDER: google/g) || []).length !== 2) {
  throw new Error("free-only web and worker must both use Google Calendar");
}
if (/stripe|payment.*secret|secret.*payment/i.test(compose)) {
  throw new Error("free-only Compose must not declare payment-provider secrets");
}

const common = {
  NODE_ENV: "production",
  DATABASE_PROVIDER: "postgresql",
  NEXT_PUBLIC_APP_URL: "https://book.blockwise.sale/",
  TOKEN_ENCRYPTION_KEY: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
  EMAIL_TOKEN_SECRET: "ci-email-token-secret-with-at-least-32-bytes-0001",
  GOOGLE_CLIENT_ID: "ci-free-only.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "ci-free-only-google-secret-000001",
  BUILD_ID: "0123456789abcdef0123456789abcdef01234567",
  FREE_ONLY: "true",
  RATE_LIMIT_PROVIDER: "postgresql",
  OUTBOX_WORKER_MODE: "dedicated",
  EMAIL_PROVIDER: "smtp",
  CALENDAR_PROVIDER: "google",
  SMTP_TLS_MODE: "starttls",
  EMAIL_SENDER_DOMAIN: "book.blockwise.sale",
  EMAIL_FROM: "SnagTime <calendar@book.blockwise.sale>",
  EMAIL_REPLY_TO: "support@book.blockwise.sale",
  TRUST_PROXY: "true",
};
const app = {
  ...common,
  DATABASE_ROLE: "app",
  DATABASE_URL: "postgresql://app@example.invalid/tempocove?sslmode=verify-full&sslrootcert=/run/secrets/ca&connect_timeout=3&pool_timeout=20&connection_limit=20&statement_timeout=2000",
  AUTH_SECRET: "ci-auth-secret-with-at-least-32-bytes-0001",
  BOOKING_CAPABILITY_KEY_ID: "ci-free-only-v1",
  BOOKING_CAPABILITY_SECRET: "ci-booking-capability-secret-0000001",
  TENANT_CONTEXT_SECRET: "ci-tenant-context-secret-with-at-least-32-bytes-0001",
  RATE_LIMIT_HASH_SECRET: "ci-rate-limit-hash-secret-with-at-least-32-bytes-0001",
  PROXY_SHARED_SECRET: "ci-proxy-shared-secret-with-at-least-32-bytes-0001",
  OPERATOR_HEALTH_SECRET: "ci-operator-health-secret-with-at-least-32-bytes-0001",
};
const worker = {
  ...common,
  DATABASE_ROLE: "worker",
  WORKER_DATABASE_URL: "postgresql://worker@example.invalid/tempocove?sslmode=verify-full&sslrootcert=/run/secrets/ca&connect_timeout=3&pool_timeout=20&connection_limit=20&statement_timeout=2000",
};

function run(env) {
  return spawnSync(process.execPath, ["scripts/production-config.mjs", "runtime"], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}
for (const [role, env] of [["app", app], ["worker", worker]]) {
  const result = run(env);
  if (result.status !== 0) throw new Error(`production ${role} configuration fixture rejected`);
  if (result.stdout.includes(env.GOOGLE_CLIENT_SECRET) || result.stderr.includes(env.GOOGLE_CLIENT_SECRET)) {
    throw new Error(`production ${role} configuration printed a secret`);
  }
}
const local = run({ ...app, CALENDAR_PROVIDER: "local" });
if (local.status === 0) {
  throw new Error("production configuration must fail closed for local calendar");
}
const missingGoogleSecret = run({ ...app, GOOGLE_CLIENT_SECRET: "" });
if (missingGoogleSecret.status === 0) {
  throw new Error("production configuration must fail closed when Google client secret is absent");
}
console.log("Free-only Google Compose and production startup/readiness configuration contracts passed without live credentials.");

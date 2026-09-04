import fs from "node:fs";
import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.WORKER_DATABASE_URL,
  ssl: { rejectUnauthorized: true, ca: fs.readFileSync("ci-certs/ca.crt", "utf8") },
});
await client.connect();
await client.query(`
  INSERT INTO "WorkerHeartbeat" ("workerId", "lastSeenAt", "status", "buildId")
  VALUES ('ci-worker', clock_timestamp(), 'IDLE', current_setting('application_name'))
  ON CONFLICT ("workerId") DO UPDATE SET
    "lastSeenAt" = EXCLUDED."lastSeenAt",
    "status" = EXCLUDED."status",
    "buildId" = EXCLUDED."buildId"
`);
await client.end();

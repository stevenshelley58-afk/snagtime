import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSourceText, sha1Normalized } from "./ci-generated-drift.mjs";

test("generated drift hashing treats LF and CRLF as equivalent", () => {
  const lf = "CREATE TABLE bookings;\nALTER TABLE bookings ADD COLUMN title text;\n";
  const crlf = lf.replaceAll("\n", "\r\n");

  assert.equal(normalizeSourceText(crlf), lf);
  assert.equal(sha1Normalized(crlf), sha1Normalized(lf));
});

test("generated drift hashing rejects content changes", () => {
  assert.notEqual(
    sha1Normalized("CREATE TABLE bookings;\n"),
    sha1Normalized("CREATE TABLE customers;\n"),
  );
});

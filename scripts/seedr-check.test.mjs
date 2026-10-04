import assert from "node:assert/strict";
import { test } from "node:test";
import { checkQuota, responseShape } from "./seedr-check.mjs";
import { renderWorkerVars } from "./seedr-configure.mjs";

test("quota check uses only the documented GET endpoint and Bearer header", async () => {
  const result = await checkQuota("dummy-test-token", async (url, options) => {
    assert.equal(url, "https://www.seedr.cc/api/v0.1/p/me/quota");
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Authorization, "Bearer dummy-test-token");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ storage: { used: 123, total: 456 }, email: "private@example.com", token: "never-share" });
  });
  assert.deepEqual(result.responseShape, { storage: { used: "number", total: "number" } });
  assert.ok(!JSON.stringify(result).includes("123"));
  assert.ok(!JSON.stringify(result).includes("private"));
});

test("token validation happens before any request", async () => {
  for (const token of ["", "Bearer secret", "secret\nInjected: value", "x".repeat(8193)]) {
    await assert.rejects(checkQuota(token, () => { assert.fail("must not fetch"); }), /Invalid token/);
  }
});

test("HTTP failures never echo provider bodies or secrets", async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(checkQuota("dummy", async () => new Response("private-token", { status })), error => {
      assert.ok(error.message.includes(`HTTP ${status}`));
      assert.ok(!error.message.includes("private-token"));
      return true;
    });
  }
});

test("network failures return a safe message", async () => {
  await assert.rejects(checkQuota("dummy", async () => { throw new Error("secret backend details"); }), /connection failed or timed out/);
});

test("non-JSON and malformed responses fail safely", async () => {
  await assert.rejects(checkQuota("dummy", async () => new Response("private HTML")), /unexpected response format/);
  await assert.rejects(checkQuota("dummy", async () => new Response("secret invalid json", { headers: { "content-type": "application/json" } })), /invalid JSON/);
});

test("oversized responses are rejected before parsing", async () => {
  await assert.rejects(checkQuota("dummy", async () => Response.json({ padding: "x".repeat(65536) })), /size limit/);
});

test("API error envelopes and unexpected root types are not counted as success", async () => {
  for (const body of [{ error: "private error" }, { success: false }, [], null, "private"]) {
    await assert.rejects(checkQuota("dummy", async () => Response.json(body)));
  }
});

test("diagnostic types omit sensitive names, dynamic keys and all values", () => {
  const result = responseShape({ account: { id: 123, access_token: "secret" }, "private@example.com": 1, "123": "id", items: [{ name: "Private file", size: 123 }] });
  assert.deepEqual(result, { account: { id: "number" }, items: [{ name: "string", size: "number" }] });
});

test("a provider echoing a token in a field name cannot leak it into diagnostics", async () => {
  const result = await checkQuota("privatetestsecret", async () => Response.json({ privatetestsecret: 42, used: 123 }));
  assert.deepEqual(result.responseShape, { used: "number" });
  assert.ok(!JSON.stringify(result).includes("privatetestsecret"));
});

test("a failed response stream does not expose runtime error details", async () => {
  const stream = new ReadableStream({ start(controller) { controller.error(new Error("private backend detail")); } });
  await assert.rejects(checkQuota("dummy", async () => new Response(stream, { headers: { "content-type": "application/json" } })), /response could not be read/);
});

test("setup obtains only verified storage counts without profile or token values", async () => {
  const result = await checkQuota("dummy", async () => Response.json({ space_used: 123, space_max: 456, email: "private@example.com", token: "private" }), true);
  assert.deepEqual(result.storageCounts, { space_used: 123, space_max: 456 });
  assert.ok(!JSON.stringify(result).includes("private"));
});

test("setup refuses incomplete or invalid real quota data", async () => {
  for (const data of [{}, { space_max: "5", space_used: 1 }, { space_max: 5, space_used: 6 }, { space_max: 5, space_used: -1 }]) {
    await assert.rejects(checkQuota("dummy", async () => Response.json(data), true), /invalid storage counts/);
  }
});

test("single-account setup derives capacity from Seedr and preserves unrelated configuration", () => {
  const source = '# private\nSEEDR_MODE=mock\nSEEDR_MODE=mock\nSEEDR_ACCESS=full\nSEEDR_ACCOUNT_CONFIG=old-demo\nALLOWED_ORIGIN=http://localhost:5173\nTURNSTILE_SECRET_KEY=dummy-preserved\n';
  const vars = renderWorkerVars(source, "dummy-pat", { space_used: 123, space_max: 2147483648 });
  assert.equal(vars.match(/^SEEDR_MODE=/gm).length, 1);
  assert.ok(vars.includes("SEEDR_MODE=live\nSEEDR_ACCESS=full"));
  assert.ok(vars.includes("ALLOWED_ORIGIN=http://localhost:5173"));
  assert.ok(vars.includes("TURNSTILE_SECRET_KEY=dummy-preserved"));
  assert.ok(vars.includes("SEEDR_ACCOUNT_A_TOKEN=dummy-pat"));
  const config = JSON.parse(vars.split("\n").find(line => line.startsWith("SEEDR_ACCOUNT_CONFIG=")).slice("SEEDR_ACCOUNT_CONFIG=".length));
  assert.equal(config.length, 1); assert.equal(config[0].capacityBytes, 2147483648);
  assert.equal(config[0].secretKeyReference, "SEEDR_ACCOUNT_A_TOKEN");
  assert.ok(!vars.includes("old-demo"));
});

test("setup rejects credential newline injection and invalid quota before rendering any config", () => {
  assert.throws(() => renderWorkerVars("", "dummy\nSEEDR_ACCESS=full", { space_max: 5, space_used: 1 }));
  assert.throws(() => renderWorkerVars("", "dummy", { space_max: 0, space_used: 0 }));
});

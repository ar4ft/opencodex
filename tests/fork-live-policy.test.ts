import { expect, test } from "bun:test";
import { assertNativeSafeProxyLifecycle } from "../src/clients/live-policy";

test("legacy proxy lifecycle is refused after a read-only policy probe", async () => {
  const requests: string[] = [];
  const server = Bun.serve({ port: 0, fetch(req) {
    requests.push(`${req.method} ${new URL(req.url).pathname}`);
    return Response.json({ error: "not found" }, { status: 404 });
  } });
  try {
    await expect(assertNativeSafeProxyLifecycle({ port: server.port!, pid: 1234, source: "runtime" }))
      .rejects.toThrow("shutdown hooks may modify Codex");
    expect(requests).toEqual(["GET /api/fork-client-policy"]);
  } finally { server.stop(true); }
});

test("isolated proxy lifecycle remains available", async () => {
  const server = Bun.serve({ port: 0, fetch() {
    return Response.json({ version: 1, nativeClientIntegration: false });
  } });
  try {
    await expect(assertNativeSafeProxyLifecycle({ port: server.port!, pid: 1234, source: "runtime" }))
      .resolves.toBeUndefined();
  } finally { server.stop(true); }
});

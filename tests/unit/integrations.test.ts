import { describe, expect, it, vi } from "vitest";
import { KEY_RE, bearerApiKey, newApiKey } from "../../src/lib/integrations/apikey";
import { hashToken } from "../../src/lib/auth/tokens";
import { backoffSec, dispatchOnce, isPrivateIp, sign, verify, webhookUrlError } from "../../src/lib/integrations/webhooks";

const req = (h?: string) => new Request("http://x/api", { headers: h === undefined ? {} : { authorization: h } });

describe("API keys", () => {
  it("generates mlk_<prefix>_<secret> and stores only its sha256", () => {
    const k = newApiKey();
    expect(k.token).toMatch(KEY_RE);
    expect(k.token.slice(4, 12)).toBe(k.prefix);
    expect(k.hash).toBe(hashToken(k.token));
    expect(k.hash).not.toContain(k.token);
    expect(newApiKey().token).not.toBe(k.token);
  });
  it("parses the bearer header: absent -> undefined, malformed -> null", () => {
    const k = newApiKey().token;
    expect(bearerApiKey(req())).toBeUndefined();
    expect(bearerApiKey(req(`Bearer ${k}`))).toBe(k);
    expect(bearerApiKey(req(`bearer  ${k}`))).toBe(k);
    expect(bearerApiKey(req("Bearer nope"))).toBeNull();
    expect(bearerApiKey(req(`Basic ${k}`))).toBeNull();
    expect(bearerApiKey(req(`Bearer ${k}x`))).toBeNull();
  });
});

describe("webhook signatures", () => {
  const body = JSON.stringify({ event: "issue.created" }), t = 1_800_000_000;
  it("verifies its own signature and rejects tampering, wrong secret and stale timestamps", () => {
    const h = sign("s3cret", body, t);
    expect(h).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    expect(verify("s3cret", body, h, t)).toBe(true);
    expect(verify("s3cret", body + " ", h, t)).toBe(false);
    expect(verify("other", body, h, t)).toBe(false);
    expect(verify("s3cret", body, h, t + 301)).toBe(false);
    expect(verify("s3cret", body, "garbage", t)).toBe(false);
  });
  it("backs off exponentially, capped at 6h", () => {
    expect([1, 2, 3, 4].map(backoffSec)).toEqual([30, 60, 120, 240]);
    expect(backoffSec(20)).toBe(21600);
  });
});

describe("webhook URL guard", () => {
  it("requires https in production and blocks private targets", () => {
    expect(webhookUrlError("https://hooks.example.com/x", "production")).toBeNull();
    expect(webhookUrlError("http://hooks.example.com/x", "production")).toBe("url must be https");
    expect(webhookUrlError("http://localhost:4000/x", "development")).toBeNull();
    expect(webhookUrlError("https://u:p@example.com", "production")).toMatch(/credentials/);
    for (const u of ["https://localhost/", "https://127.0.0.1/", "https://10.1.2.3/", "https://192.168.0.1/", "https://169.254.169.254/", "https://[::1]/", "https://db.internal/"])
      expect(webhookUrlError(u, "production")).toBe("url host not allowed");
    expect(webhookUrlError("ftp://example.com", "development")).toBe("url must be https");
    expect(webhookUrlError("not a url")).toBe("invalid url");
  });
  it("classifies IPs", () => {
    expect(isPrivateIp("172.20.0.1")).toBe(true);
    expect(isPrivateIp("172.32.0.1")).toBe(false);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("fd00::1")).toBe(true);
  });
});

describe("dispatchOnce", () => {
  // Fake tagged-template sql: first call = claim, then one complete per delivery.
  const fakeSql = (claimed: unknown[]) => {
    const calls: unknown[][] = [];
    const sql = ((strings: TemplateStringsArray, ...v: unknown[]) => { calls.push([strings.join("?"), ...v]); return Promise.resolve(calls.length === 1 ? claimed : []); }) as never;
    return { sql, calls };
  };
  const d = { id: "d1", workspace_id: "w", webhook_id: "h", event: "issue.created", payload: { event: "issue.created", data: { id: "i1" } }, attempts: 1, url: "https://r.example/h", secret: "whsec_x" };
  it("POSTs a signed body and records success", async () => {
    const { sql, calls } = fakeSql([d]);
    const fetcher = vi.fn(async () => new Response("ok", { status: 200 }));
    expect(await dispatchOnce(sql, { fetcher, now: () => 1_800_000_000_000 })).toBe(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(d.url);
    const h = init.headers as Record<string, string>;
    expect(verify(d.secret, init.body as string, h["x-minilinear-signature"]!, 1_800_000_000)).toBe(true);
    expect(h["x-minilinear-event"]).toBe("issue.created");
    expect(JSON.parse(init.body as string)).toMatchObject({ id: "d1", data: { id: "i1" } });
    expect(init.redirect).toBe("manual");
    expect(calls[1]!.slice(1)).toEqual(["d1", true, 200, null]);
  });
  it("records non-2xx and network errors as failures (retried by the DB backoff)", async () => {
    const a = fakeSql([d]);
    await dispatchOnce(a.sql, { fetcher: async () => new Response("", { status: 500 }) });
    expect(a.calls[1]!.slice(1)).toEqual(["d1", false, 500, "HTTP 500"]);
    const b = fakeSql([d]);
    await dispatchOnce(b.sql, { fetcher: async () => { throw new Error("ECONNREFUSED"); } });
    expect(b.calls[1]!.slice(1)).toEqual(["d1", false, null, "ECONNREFUSED"]);
  });
});

import { describe, expect, it, vi } from "vitest";

const dns = vi.hoisted(() => ({ answers: {} as Record<string, { address: string; family: number }[]> }));
vi.mock("node:dns", async (orig) => {
  const real = await orig<typeof import("node:dns")>();
  const lookup = (host: string, _o: unknown, cb: (e: Error | null, a?: unknown) => void) => { const a = dns.answers[host]; return a ? cb(null, a) : cb(Object.assign(new Error(`ENOTFOUND ${host}`), { code: "ENOTFOUND" })); };
  return { ...real, default: { ...real, lookup }, lookup };
});
import { KEY_RE, bearerApiKey, newApiKey } from "../../src/lib/integrations/apikey";
import { hashToken } from "../../src/lib/auth/tokens";
import { backoffSec, destinationError, dispatchOnce, guardedLookup, isPrivateIp, safeFetch, sign, verify, webhookUrlError } from "../../src/lib/integrations/webhooks";

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
    expect(calls[1]!.slice(1)).toEqual(["d1", "w", true, 200, null]);
  });
  it("records non-2xx and network errors as failures (retried by the DB backoff)", async () => {
    const a = fakeSql([d]);
    await dispatchOnce(a.sql, { fetcher: async () => new Response("", { status: 500 }) });
    expect(a.calls[1]!.slice(1)).toEqual(["d1", "w", false, 500, "HTTP 500"]);
    const b = fakeSql([d]);
    await dispatchOnce(b.sql, { fetcher: async () => { throw new Error("ECONNREFUSED"); } });
    expect(b.calls[1]!.slice(1)).toEqual(["d1", "w", false, null, "ECONNREFUSED"]);
  });
});

describe("SSRF bypasses (Rex review of #70)", () => {
  it("strips the trailing dot: localhost. and friends", () => {
    for (const u of ["https://localhost./", "https://LOCALHOST../", "https://foo.localhost./", "https://db.internal./", "https://127.0.0.1./"])
      expect(webhookUrlError(u, "production"), u).toBe("url host not allowed");
  });
  it("blocks the missing ranges (v4 and v6, also in mapped forms)", () => {
    for (const ip of ["192.0.0.8", "192.0.0.255", "198.18.0.1", "198.19.255.255", "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255", "64:ff9b::7f00:1", "64:ff9b::a00:1", "2002:7f00:1::1", "2002::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "::127.0.0.1", "fe80::1", "ff02::1", "::", "100.64.0.1"])
      expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "198.17.255.255", "198.20.0.1", "192.0.1.1", "223.255.255.255", "2606:4700::1111", "::ffff:8.8.8.8"])
      expect(isPrivateIp(ip), ip).toBe(false);
    for (const u of ["https://192.0.0.8/", "https://198.18.0.1/", "https://224.0.0.1/", "https://[64:ff9b::7f00:1]/", "https://[2002:7f00:1::1]/"])
      expect(webhookUrlError(u, "production"), u).toBe("url host not allowed");
  });
  it("numeric host spellings normalise to the blocked IP", () => {
    for (const u of ["https://2130706433/", "https://0x7f.1/", "https://0177.0.0.1/", "https://127.1/"]) expect(webhookUrlError(u, "production"), u).toBe("url host not allowed");
  });
  it("port allowlist: 443 or above 1024", () => {
    expect(webhookUrlError("https://example.com/", "production")).toBeNull();
    expect(webhookUrlError("https://example.com:443/", "production")).toBeNull();
    expect(webhookUrlError("https://example.com:8443/", "production")).toBeNull();
    expect(webhookUrlError("https://example.com:1025/", "production")).toBeNull();
    for (const port of [22, 25, 80, 1000, 1024]) expect(webhookUrlError(`https://example.com:${port}/`, "production"), String(port)).toMatch(/port not allowed/);
    expect(webhookUrlError("http://example.com/", "development")).toMatch(/port not allowed/);
  });
  const look = (host: string, all = false) => new Promise<unknown[]>((res) => guardedLookup(host, { all }, (...a) => res(a), false));
  it("send time: a name resolving to a private IP is refused (nip.io style, rebinding, metadata)", async () => {
    dns.answers["127.0.0.1.nip.io"] = [{ address: "127.0.0.1", family: 4 }];
    dns.answers["meta.evil.test"] = [{ address: "169.254.169.254", family: 4 }];
    dns.answers["six.evil.test"] = [{ address: "::ffff:10.0.0.5", family: 6 }];
    dns.answers["mixed.evil.test"] = [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }];
    for (const h of ["127.0.0.1.nip.io", "meta.evil.test", "six.evil.test", "mixed.evil.test"]) {
      const [err] = await look(h);
      expect((err as Error).message, h).toMatch(/non-public address/);
      expect(((await look(h, true))[0] as Error).message).toMatch(/non-public/);
    }
  });
  it("send time: a public name is allowed and the connection is pinned to the validated address", async () => {
    dns.answers["hooks.example.test"] = [{ address: "93.184.216.34", family: 4 }];
    expect(await look("hooks.example.test")).toEqual([null, "93.184.216.34", 4]);
    expect(await look("hooks.example.test", true)).toEqual([null, [{ address: "93.184.216.34", family: 4 }]]);
  });
  it("send time: literal IPs, localhost, odd ports and http are refused before any socket opens (safeFetch)", async () => {
    const init = { method: "POST", body: "{}", headers: {} } as RequestInit;
    for (const u of ["https://127.0.0.1/", "https://[::1]/", "https://localhost./", "https://169.254.169.254/latest", "https://198.18.0.1/", "https://example.com:22/", "http://example.com:8080/", "https://u:p@example.com/"])
      await expect(safeFetch(u, init), u).rejects.toThrow(/not allowed|must be https|credentials/);
    dns.answers["rebind.evil.test"] = [{ address: "127.0.0.1", family: 4 }];
    await expect(safeFetch("https://rebind.evil.test/", init)).rejects.toThrow(/non-public address/);
  });
  it("ML_WEBHOOKS_ALLOW_PRIVATE only relaxes the send-time check when explicitly set", () => {
    expect(destinationError(new URL("http://127.0.0.1:4000/"), false)).not.toBeNull();
    expect(destinationError(new URL("http://127.0.0.1:4000/"), true)).toBeNull();
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { clientIp, setSocketAddrResolver } from "../../src/lib/auth/ratelimit";

const req = (xff?: string) => new Request("http://x/", { headers: xff ? { "x-forwarded-for": xff } : {} });
afterEach(() => { delete process.env.TRUSTED_PROXIES; setSocketAddrResolver(() => null); });

describe("clientIp spoofing", () => {
  it("behind trusted proxies: takes the rightmost untrusted hop, forged leftmost hops are ignored", () => {
    process.env.TRUSTED_PROXIES = "10.0.0.1,10.0.0.2";
    setSocketAddrResolver(() => "10.0.0.1");
    expect(clientIp(req("1.2.3.4, 203.0.113.9, 10.0.0.2"))).toBe("203.0.113.9");
    expect(clientIp(req("9.9.9.9, 203.0.113.9, 10.0.0.2"))).toBe("203.0.113.9");
  });
  it("empty TRUSTED_PROXIES: XFF is ignored, the socket peer is the key (no rotation bypass)", () => {
    setSocketAddrResolver(() => "192.0.2.7");
    expect(clientIp(req("6.6.6.6"))).toBe("192.0.2.7");
    expect(clientIp(req("7.7.7.7"))).toBe("192.0.2.7");
  });
  it("untrusted peer: XFF ignored even when TRUSTED_PROXIES is set", () => {
    process.env.TRUSTED_PROXIES = "10.0.0.1";
    setSocketAddrResolver(() => "198.51.100.4");
    expect(clientIp(req("1.1.1.1, 10.0.0.1"))).toBe("198.51.100.4");
  });
  it("invalid hops stop the walk; peer fallback; no peer -> unknown", () => {
    process.env.TRUSTED_PROXIES = "10.0.0.1";
    setSocketAddrResolver(() => "::ffff:10.0.0.1");
    expect(clientIp(req("1.2.3.4, " + "x".repeat(500)))).toBe("10.0.0.1");
    expect(clientIp(req("10.0.0.1"))).toBe("10.0.0.1");
    setSocketAddrResolver(() => null);
    expect(clientIp(req("5.5.5.5"))).toBe("unknown");
  });
});

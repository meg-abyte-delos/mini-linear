import { describe, it, expect, afterEach } from "vitest";
import { clientIp, setSocketAddrResolver } from "../../src/lib/auth/ratelimit";

const req = (xff?: string) => new Request("http://x/", { headers: xff ? { "x-forwarded-for": xff } : {} });
afterEach(() => { delete process.env.TRUSTED_PROXIES; setSocketAddrResolver(() => null); });

describe("clientIp spoofing", () => {
  it("ignores a client-forged leftmost hop: takes the rightmost untrusted one", () => {
    process.env.TRUSTED_PROXIES = "10.0.0.1,10.0.0.2";
    expect(clientIp(req("1.2.3.4, 203.0.113.9, 10.0.0.2, 10.0.0.1"))).toBe("203.0.113.9");
    expect(clientIp(req("6.6.6.6"))).toBe("6.6.6.6");
    expect(clientIp(req("9.9.9.9, 203.0.113.9"))).not.toBe("9.9.9.9"); // rotating the forged value cannot change the bucket
  });
  it("falls back to the socket address, then 'unknown', when every hop is trusted or absent", () => {
    process.env.TRUSTED_PROXIES = "10.0.0.1";
    setSocketAddrResolver(() => "192.0.2.7");
    expect(clientIp(req("10.0.0.1"))).toBe("192.0.2.7");
    expect(clientIp(req())).toBe("192.0.2.7");
    setSocketAddrResolver(() => null);
    expect(clientIp(req())).toBe("unknown");
  });
});

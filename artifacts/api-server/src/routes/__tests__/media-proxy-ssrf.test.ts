import { describe, it, expect } from "vitest";
import { isPrivateIp, isPrivateIpv4, isPrivateIpv6 } from "../media-proxy.js";

describe("Media Proxy SSRF IP Protection", () => {
  describe("IPv4 SSRF Blocking", () => {
    it("blocks private, loopback, and metadata IPv4 addresses", () => {
      // Loopback
      expect(isPrivateIpv4("127.0.0.1")).toBe(true);
      expect(isPrivateIpv4("127.255.255.254")).toBe(true);

      // Private RFC 1918
      expect(isPrivateIpv4("10.0.0.1")).toBe(true);
      expect(isPrivateIpv4("172.16.0.1")).toBe(true);
      expect(isPrivateIpv4("172.31.255.255")).toBe(true);
      expect(isPrivateIpv4("192.168.1.1")).toBe(true);

      // Cloud instance metadata / Link-local
      expect(isPrivateIpv4("169.254.169.254")).toBe(true);

      // Broadcast and unspecified
      expect(isPrivateIpv4("0.0.0.0")).toBe(true);
      expect(isPrivateIpv4("255.255.255.255")).toBe(true);

      // Multicast and reserved
      expect(isPrivateIpv4("224.0.0.1")).toBe(true);
      expect(isPrivateIpv4("240.0.0.1")).toBe(true);
    });

    it("allows valid public IPv4 addresses", () => {
      expect(isPrivateIpv4("8.8.8.8")).toBe(false);
      expect(isPrivateIpv4("1.1.1.1")).toBe(false);
      expect(isPrivateIpv4("93.184.216.34")).toBe(false);
    });
  });

  describe("IPv6 SSRF Blocking", () => {
    it("blocks IPv6 loopback and unspecified addresses", () => {
      expect(isPrivateIpv6("::1")).toBe(true);
      expect(isPrivateIpv6("::")).toBe(true);
    });

    it("blocks IPv6 Unique Local Addresses (fc00::/7)", () => {
      expect(isPrivateIpv6("fc00::1")).toBe(true);
      expect(isPrivateIpv6("fd00::1")).toBe(true);
      expect(isPrivateIpv6("fd12:3456:789a::1")).toBe(true);
      expect(isPrivateIpv6("fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff")).toBe(
        true,
      );
    });

    it("blocks IPv6 link-local addresses (fe80::/10)", () => {
      expect(isPrivateIpv6("fe80::1")).toBe(true);
      expect(isPrivateIpv6("fe80::dead:beef")).toBe(true);
      expect(isPrivateIpv6("febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff")).toBe(
        true,
      );
    });

    it("blocks IPv6 multicast addresses (ff00::/8)", () => {
      expect(isPrivateIpv6("ff00::1")).toBe(true);
      expect(isPrivateIpv6("ff02::1")).toBe(true);
      expect(isPrivateIpv6("ffff:ffff::1")).toBe(true);
    });

    it("blocks IPv6 documentation addresses (2001:db8::/32)", () => {
      expect(isPrivateIpv6("2001:db8::1")).toBe(true);
      expect(isPrivateIpv6("2001:db8:ffff:ffff::1")).toBe(true);
    });

    it("blocks IPv4-mapped IPv6 addresses (::ffff:0:0/96)", () => {
      // Loopback mapped to IPv6
      expect(isPrivateIpv6("::ffff:127.0.0.1")).toBe(true);
      // Cloud metadata mapped to IPv6
      expect(isPrivateIpv6("::ffff:169.254.169.254")).toBe(true);
      // Private RFC 1918 mapped to IPv6
      expect(isPrivateIpv6("::ffff:10.0.0.1")).toBe(true);
      expect(isPrivateIpv6("::ffff:192.168.1.1")).toBe(true);
    });

    it("allows valid public IPv6 addresses", () => {
      // Cloudflare DNS
      expect(isPrivateIpv6("2606:4700:4700::1111")).toBe(false);
      // Google DNS
      expect(isPrivateIpv6("2001:4860:4860::8888")).toBe(false);
      // Quad9 DNS
      expect(isPrivateIpv6("2620:fe::fe")).toBe(false);
    });
  });

  describe("isPrivateIp combined helper", () => {
    it("correctly evaluates IPv4, IPv6, and malformed strings", () => {
      expect(isPrivateIp("127.0.0.1")).toBe(true);
      expect(isPrivateIp("::1")).toBe(true);
      expect(isPrivateIp("fe80::1")).toBe(true);
      expect(isPrivateIp("fd00::1")).toBe(true);
      expect(isPrivateIp("::ffff:169.254.169.254")).toBe(true);

      expect(isPrivateIp("8.8.8.8")).toBe(false);
      expect(isPrivateIp("2606:4700:4700::1111")).toBe(false);

      // Non-IP strings are treated as blocked by default for safety
      expect(isPrivateIp("not-an-ip")).toBe(true);
      expect(isPrivateIp("")).toBe(true);
    });
  });
});

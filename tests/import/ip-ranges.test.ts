import { describe, expect, it } from "vitest";
import { isBlockedAddress, parseIPv6 } from "@/server/security/ip-ranges";

describe("isBlockedAddress (SSRF guard)", () => {
  it.each([
    "127.0.0.1",
    "127.255.255.254",
    "10.0.0.1",
    "10.255.1.2",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.10",
    "169.254.169.254", // cloud metadata
    "169.254.0.1",
    "100.64.0.1", // CGNAT
    "0.0.0.0",
    "0.1.2.3",
    "224.0.0.1",
    "239.255.255.250",
    "240.0.0.1",
    "255.255.255.255",
    "192.0.2.5",
    "198.18.0.1",
    "198.51.100.7",
    "203.0.113.9",
    "::1",
    "::",
    "[::1]",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "::ffff:10.0.0.1",
    "::127.0.0.1",
    "fe80::1",
    "fe80::1%en0",
    "fc00::1",
    "fd00:ec2::254", // AWS IPv6 metadata
    "ff02::1",
    "2001:db8::1",
    "2001:0:4136:e378::1", // Teredo
    "2002:7f00:0001::1", // 6to4 of 127.0.0.1
    "64:ff9b::a00:1", // NAT64 of 10.0.0.1
    "not-an-ip",
    "",
    "1.2.3",
  ])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "93.184.216.34", "172.32.0.1", "100.128.0.1", "2606:4700::1111", "2a00:1450:4001::200e", "::ffff:8.8.8.8", "2002:0808:0808::1"])(
    "allows public %s",
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(false);
    },
  );

  it("parses IPv6 forms", () => {
    expect(parseIPv6("::ffff:1.2.3.4")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
    expect(parseIPv6("1::")).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseIPv6("1:2:3:4:5:6:7:8")).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(parseIPv6("1::2::3")).toBeNull();
  });
});

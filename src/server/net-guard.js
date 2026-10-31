/**
 * SSRF guard for the discovery probe. The probe fetches URLs built from user input, so every
 * connection must land on a public unicast address. The check runs inside the socket's DNS
 * lookup (not before it), so a DNS answer can't change between "checked" and "connected".
 */
import dns from "node:dns";
import net from "node:net";

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, including cloud metadata (169.254.169.254)
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
]) {
  blocked.addSubnet(addr, prefix, "ipv4");
}
for (const [addr, prefix] of [
  ["::", 128],
  ["::1", 128],
  // No rule for IPv4-mapped ::ffff:0:0/96: Node's BlockList applies mapped rules to plain IPv4
  // addresses, so it would block everything. Mapped addresses fail the 2000::/3 check below.
  ["64:ff9b::", 96], // NAT64
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23], // IETF protocol assignments, Teredo
  ["2001:db8::", 32],
  ["2002::", 16], // 6to4
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
]) {
  blocked.addSubnet(addr, prefix, "ipv6");
}

/** True only for public unicast addresses: no loopback, private, link-local, CGNAT, multicast or documentation ranges. */
export function isPublicAddress(ip) {
  const family = net.isIP(String(ip ?? ""));
  if (family === 4) return !blocked.check(ip, "ipv4");
  if (family === 6) {
    if (blocked.check(ip, "ipv6")) return false;
    const first = parseInt(String(ip).split(":")[0] || "0", 16);
    return first >= 0x2000 && first <= 0x3fff; // global unicast 2000::/3 only
  }
  return false;
}

/**
 * Drop-in `lookup` for http(s).request: resolves every address and fails with EBLOCKED if
 * any of them is not public (a mixed answer is treated as hostile).
 */
export function guardedLookup(hostname, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  const opts = typeof options === "number" ? { family: options } : (options ?? {});
  dns.lookup(hostname, { family: opts.family ?? 0, hints: opts.hints, all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [];
    if (!list.length || list.some((a) => !isPublicAddress(a.address))) {
      const e = new Error(`${hostname} resolves to a non-public address`);
      e.code = "EBLOCKED";
      return callback(e);
    }
    if (opts.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

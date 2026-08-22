const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeUlid(data: Uint8Array): string {
  if (data.length !== 16) throw new Error("ULID requires 16 bytes");
  let n = 0n;
  for (const b of data) n = (n << 8n) | BigInt(b);
  let out = "";
  for (let i = 25; i >= 0; i--) out += CROCKFORD[Number((n >> BigInt(5 * i)) & 31n)];
  return out;
}

export function newOrbitaId(): string {
  const buf = new Uint8Array(16);
  const ts = BigInt(Date.now());
  for (let i = 5; i >= 0; i--) buf[5 - i] = Number((ts >> BigInt(8 * i)) & 0xffn);
  crypto.getRandomValues(buf.subarray(6));
  return `txn_${encodeUlid(buf)}`;
}

// Off https and localhost the browser hides `crypto.subtle` and `crypto.randomUUID`: both are
// for secure contexts only. upm hashes tarballs and files with the first and names temp files
// with the second, so the app opened on a LAN address would fail. Here both are filled in
// JavaScript: slower, but the same bytes, so the integrity check still runs.

/** Fill what is missing. Returns a warning to show when it did, else undefined. */
export function fillCrypto(): string | undefined {
  if (globalThis.crypto?.subtle) return undefined;
  Object.defineProperty(crypto, "subtle", { value: { digest }, configurable: true });
  if (!crypto.randomUUID) {
    Object.defineProperty(crypto, "randomUUID", { value: randomUUID, configurable: true });
  }
  return (
    `${location.origin} is not a secure context, so WebCrypto is missing: hashing in JavaScript, ` +
    `which is slower. Open the app on https or localhost for the native one.`
  );
}

async function digest(algorithm: string, data: BufferSource): Promise<ArrayBuffer> {
  const bytes = ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
  const name = algorithm.toUpperCase();
  const out =
    name === "SHA-1"
      ? sha1(bytes)
      : name === "SHA-256"
        ? sha256(bytes)
        : name === "SHA-384"
          ? sha512(bytes, H384).subarray(0, 48)
          : name === "SHA-512"
            ? sha512(bytes, H512)
            : undefined;
  if (!out) throw new Error(`Unsupported digest: ${algorithm}`);
  return out.slice().buffer;
}

function randomUUID(): `${string}-${string}-${string}-${string}-${string}` {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The message, a 1 bit, zeros and its bit length, filling whole blocks. */
function pad(data: Uint8Array, block: number): DataView {
  const size = Math.ceil((data.length + 1 + block / 8) / block) * block;
  const out = new Uint8Array(size);
  out.set(data);
  out[data.length] = 0x80;
  const view = new DataView(out.buffer);
  const bits = data.length * 8;
  view.setUint32(size - 8, Math.floor(bits / 2 ** 32));
  view.setUint32(size - 4, bits >>> 0);
  return view;
}

function output(words: Int32Array | number[]): Uint8Array {
  const out = new DataView(new ArrayBuffer(words.length * 4));
  for (let i = 0; i < words.length; i++) out.setInt32(i * 4, words[i]!);
  return new Uint8Array(out.buffer);
}

function sha1(data: Uint8Array): Uint8Array {
  const view = pad(data, 64);
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Int32Array(80);
  for (let off = 0; off < view.byteLength; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(off + i * 4);
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!;
      w[i] = (x << 1) | (x >>> 31);
    }
    let [a, b, c, d, e] = h as [number, number, number, number, number];
    for (let i = 0; i < 80; i++) {
      const f =
        i < 20
          ? ((b & c) | (~b & d)) + 0x5a827999
          : i < 40
            ? (b ^ c ^ d) + 0x6ed9eba1
            : i < 60
              ? ((b & c) | (b & d) | (c & d)) + 0x8f1bbcdc
              : (b ^ c ^ d) + 0xca62c1d6;
      const t = (((a << 5) | (a >>> 27)) + f + e + w[i]!) | 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    h[0] = (h[0]! + a) | 0;
    h[1] = (h[1]! + b) | 0;
    h[2] = (h[2]! + c) | 0;
    h[3] = (h[3]! + d) | 0;
    h[4] = (h[4]! + e) | 0;
  }
  return output(h);
}

// SHA-512's round constants and first hash, as high and low 32 bits. SHA-256 uses the high
// halves of the first 64 constants and of the first hash.
// prettier-ignore
const K512 = Int32Array.from([
  0x428a2f98, 0xd728ae22, 0x71374491, 0x23ef65cd, 0xb5c0fbcf, 0xec4d3b2f, 0xe9b5dba5, 0x8189dbbc,
  0x3956c25b, 0xf348b538, 0x59f111f1, 0xb605d019, 0x923f82a4, 0xaf194f9b, 0xab1c5ed5, 0xda6d8118,
  0xd807aa98, 0xa3030242, 0x12835b01, 0x45706fbe, 0x243185be, 0x4ee4b28c, 0x550c7dc3, 0xd5ffb4e2,
  0x72be5d74, 0xf27b896f, 0x80deb1fe, 0x3b1696b1, 0x9bdc06a7, 0x25c71235, 0xc19bf174, 0xcf692694,
  0xe49b69c1, 0x9ef14ad2, 0xefbe4786, 0x384f25e3, 0x0fc19dc6, 0x8b8cd5b5, 0x240ca1cc, 0x77ac9c65,
  0x2de92c6f, 0x592b0275, 0x4a7484aa, 0x6ea6e483, 0x5cb0a9dc, 0xbd41fbd4, 0x76f988da, 0x831153b5,
  0x983e5152, 0xee66dfab, 0xa831c66d, 0x2db43210, 0xb00327c8, 0x98fb213f, 0xbf597fc7, 0xbeef0ee4,
  0xc6e00bf3, 0x3da88fc2, 0xd5a79147, 0x930aa725, 0x06ca6351, 0xe003826f, 0x14292967, 0x0a0e6e70,
  0x27b70a85, 0x46d22ffc, 0x2e1b2138, 0x5c26c926, 0x4d2c6dfc, 0x5ac42aed, 0x53380d13, 0x9d95b3df,
  0x650a7354, 0x8baf63de, 0x766a0abb, 0x3c77b2a8, 0x81c2c92e, 0x47edaee6, 0x92722c85, 0x1482353b,
  0xa2bfe8a1, 0x4cf10364, 0xa81a664b, 0xbc423001, 0xc24b8b70, 0xd0f89791, 0xc76c51a3, 0x0654be30,
  0xd192e819, 0xd6ef5218, 0xd6990624, 0x5565a910, 0xf40e3585, 0x5771202a, 0x106aa070, 0x32bbd1b8,
  0x19a4c116, 0xb8d2d0c8, 0x1e376c08, 0x5141ab53, 0x2748774c, 0xdf8eeb99, 0x34b0bcb5, 0xe19b48a8,
  0x391c0cb3, 0xc5c95a63, 0x4ed8aa4a, 0xe3418acb, 0x5b9cca4f, 0x7763e373, 0x682e6ff3, 0xd6b2b8a3,
  0x748f82ee, 0x5defb2fc, 0x78a5636f, 0x43172f60, 0x84c87814, 0xa1f0ab72, 0x8cc70208, 0x1a6439ec,
  0x90befffa, 0x23631e28, 0xa4506ceb, 0xde82bde9, 0xbef9a3f7, 0xb2c67915, 0xc67178f2, 0xe372532b,
  0xca273ece, 0xea26619c, 0xd186b8c7, 0x21c0c207, 0xeada7dd6, 0xcde0eb1e, 0xf57d4f7f, 0xee6ed178,
  0x06f067aa, 0x72176fba, 0x0a637dc5, 0xa2c898a6, 0x113f9804, 0xbef90dae, 0x1b710b35, 0x131c471b,
  0x28db77f5, 0x23047d84, 0x32caab7b, 0x40c72493, 0x3c9ebe0a, 0x15c9bebc, 0x431d67c4, 0x9c100d4c,
  0x4cc5d4be, 0xcb3e42b6, 0x597f299c, 0xfc657e2a, 0x5fcb6fab, 0x3ad6faec, 0x6c44198c, 0x4a475817,
]);
// prettier-ignore
const H512 = [
  0x6a09e667, 0xf3bcc908, 0xbb67ae85, 0x84caa73b, 0x3c6ef372, 0xfe94f82b, 0xa54ff53a, 0x5f1d36f1,
  0x510e527f, 0xade682d1, 0x9b05688c, 0x2b3e6c1f, 0x1f83d9ab, 0xfb41bd6b, 0x5be0cd19, 0x137e2179,
];
// prettier-ignore
const H384 = [
  0xcbbb9d5d, 0xc1059ed8, 0x629a292a, 0x367cd507, 0x9159015a, 0x3070dd17, 0x152fecd8, 0xf70e5939,
  0x67332667, 0xffc00b31, 0x8eb44a87, 0x68581511, 0xdb0c2e0d, 0x64f98fa7, 0x47b5481d, 0xbefa4fa4,
];

function sha256(data: Uint8Array): Uint8Array {
  const view = pad(data, 64);
  const h = Int32Array.from({ length: 8 }, (_, i) => H512[i * 2]!);
  const w = new Int32Array(64);
  for (let off = 0; off < view.byteLength; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]!;
      const y = w[i - 2]!;
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as unknown as number[] as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    for (let i = 0; i < 64; i++) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (hh + s1 + ((e & f) ^ (~e & g)) + K512[i * 2]! + w[i]!) | 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = h[0]! + a;
    h[1] = h[1]! + b;
    h[2] = h[2]! + c;
    h[3] = h[3]! + d;
    h[4] = h[4]! + e;
    h[5] = h[5]! + f;
    h[6] = h[6]! + g;
    h[7] = h[7]! + hh;
  }
  return output(h);
}

/** SHA-512 on pairs of 32-bit halves, `[high, low]` per 64-bit word, as JavaScript has no u64. */
function sha512(data: Uint8Array, init: number[]): Uint8Array {
  const view = pad(data, 128);
  const h = Int32Array.from(init);
  const w = new Int32Array(160);
  // The low half as unsigned, and the carry out of a sum of low halves.
  const u = (x: number) => x >>> 0;
  const carry = (lo: number) => Math.floor(lo / 2 ** 32);
  for (let off = 0; off < view.byteLength; off += 128) {
    for (let i = 0; i < 32; i++) w[i] = view.getInt32(off + i * 4);
    for (let i = 32; i < 160; i += 2) {
      let xh = w[i - 30]!;
      let xl = w[i - 29]!;
      // σ0: rotr 1, rotr 8, shr 7
      const s0h = ((xh >>> 1) | (xl << 31)) ^ ((xh >>> 8) | (xl << 24)) ^ (xh >>> 7);
      const s0l = ((xl >>> 1) | (xh << 31)) ^ ((xl >>> 8) | (xh << 24)) ^ ((xl >>> 7) | (xh << 25));
      xh = w[i - 4]!;
      xl = w[i - 3]!;
      // σ1: rotr 19, rotr 61, shr 6
      const s1h = ((xh >>> 19) | (xl << 13)) ^ ((xl >>> 29) | (xh << 3)) ^ (xh >>> 6);
      const s1l =
        ((xl >>> 19) | (xh << 13)) ^ ((xh >>> 29) | (xl << 3)) ^ ((xl >>> 6) | (xh << 26));
      const lo = u(s0l) + u(s1l) + u(w[i - 13]!) + u(w[i - 31]!);
      w[i] = s0h + s1h + w[i - 14]! + w[i - 32]! + carry(lo);
      w[i + 1] = lo;
    }
    let [ah, al, bh, bl, ch, cl, dh, dl, eh, el, fh, fl, gh, gl, hh, hl] = h as unknown as number[];
    for (let i = 0; i < 160; i += 2) {
      // Σ1: rotr 14, rotr 18, rotr 41
      const s1h =
        ((eh! >>> 14) | (el! << 18)) ^ ((eh! >>> 18) | (el! << 14)) ^ ((el! >>> 9) | (eh! << 23));
      const s1l =
        ((el! >>> 14) | (eh! << 18)) ^ ((el! >>> 18) | (eh! << 14)) ^ ((eh! >>> 9) | (el! << 23));
      const chh = (eh! & fh!) ^ (~eh! & gh!);
      const chl = (el! & fl!) ^ (~el! & gl!);
      const t1l = u(hl!) + u(s1l) + u(chl) + u(K512[i + 1]!) + u(w[i + 1]!);
      const t1h = (hh! + s1h + chh + K512[i]! + w[i]! + carry(t1l)) | 0;
      // Σ0: rotr 28, rotr 34, rotr 39
      const s0h =
        ((ah! >>> 28) | (al! << 4)) ^ ((al! >>> 2) | (ah! << 30)) ^ ((al! >>> 7) | (ah! << 25));
      const s0l =
        ((al! >>> 28) | (ah! << 4)) ^ ((ah! >>> 2) | (al! << 30)) ^ ((ah! >>> 7) | (al! << 25));
      const majh = (ah! & bh!) ^ (ah! & ch!) ^ (bh! & ch!);
      const majl = (al! & bl!) ^ (al! & cl!) ^ (bl! & cl!);
      const t2l = u(s0l) + u(majl);
      const t2h = (s0h + majh + carry(t2l)) | 0;
      hh = gh;
      hl = gl;
      gh = fh;
      gl = fl;
      fh = eh;
      fl = el;
      const el2 = u(dl!) + u(t1l);
      eh = (dh! + t1h + carry(el2)) | 0;
      el = el2 | 0;
      dh = ch;
      dl = cl;
      ch = bh;
      cl = bl;
      bh = ah;
      bl = al;
      const al2 = u(t1l) + u(t2l);
      ah = (t1h + t2h + carry(al2)) | 0;
      al = al2 | 0;
    }
    const next = [ah, al, bh, bl, ch, cl, dh, dl, eh, el, fh, fl, gh, gl, hh, hl];
    for (let i = 0; i < 16; i += 2) {
      const lo = u(h[i + 1]!) + u(next[i + 1]!);
      h[i] = h[i]! + next[i]! + carry(lo);
      h[i + 1] = lo;
    }
  }
  return output(h);
}

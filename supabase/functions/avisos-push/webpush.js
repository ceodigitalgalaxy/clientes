/* Web Push sem bibliotecas (WebCrypto): roda igual no Deno (função) e no Node (testes).
   - VAPID (RFC 8292): JWT ES256 assinado com a chave privada da agência.
   - Conteúdo cifrado para o aparelho (RFC 8291, aes128gcm): só o navegador
     que assinou consegue ler; o serviço de push (Google, Apple, Mozilla) não. */

const enc = new TextEncoder();
export const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const fromB64url = (text) => Uint8Array.from(atob(String(text).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };

/** Só serviços de push conhecidos (o endereço vem do navegador da pessoa: nunca chamar outro lugar) */
const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/;
export function pushOrigin(endpoint) {
  let url;
  try { url = new URL(endpoint); } catch { return null; }
  return url.protocol === "https:" && !url.port && !url.username && PUSH_HOSTS.test(url.hostname) ? url.origin : null;
}

/** Par de chaves da agência: { private: JWK em texto, public: ponto P-256 em base64url } */
export async function generateVapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return {
    private: JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey)),
    public: b64url(await crypto.subtle.exportKey("raw", pair.publicKey))
  };
}

async function vapidHeader(keys, audience, subject, now = Date.now()) {
  const key = await crypto.subtle.importKey("jwk", JSON.parse(keys.private), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(enc.encode(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${claims}`));
  return `vapid t=${head}.${claims}.${b64url(signature)}, k=${keys.public}`;
}

const hkdf = async (salt, ikm, info, bytes) => new Uint8Array(await crypto.subtle.deriveBits(
  { name: "HKDF", hash: "SHA-256", salt, info }, await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), bytes * 8));

/** Corpo cifrado (aes128gcm, um registro) para a assinatura { p256dh, auth } */
export async function encryptPayload(subscription, text) {
  const uaPublic = fromB64url(subscription.p256dh);
  const authSecret = fromB64url(subscription.auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error("assinatura_invalida");
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const peer = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(enc.encode(text), Uint8Array.of(2))));
  return concat(salt, Uint8Array.of(0, 0, 16, 0), Uint8Array.of(asPublic.length), asPublic, cipher);   // rs = 4096
}

/**
 * Envia um aviso. Devolve "ok", "gone" (assinatura morta: apagar) ou "fail".
 * @param {{endpoint: string, p256dh: string, auth: string}} subscription
 * @param {{title: string, body?: string, url?: string, tag?: string}} message
 */
export async function sendPush(subscription, message, keys, { fetchImpl = fetch, subject }) {
  const origin = pushOrigin(subscription.endpoint);
  if (!origin) return "gone";
  let body;
  try { body = await encryptPayload(subscription, JSON.stringify(message)); } catch { return "gone"; }
  let response;
  try {
    response = await fetchImpl(subscription.endpoint, {
      method: "POST",
      redirect: "error",
      headers: { Authorization: await vapidHeader(keys, origin, subject), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "high" },
      body,
      signal: AbortSignal.timeout(8000)
    });
  } catch { return "fail"; }
  if (response.status >= 200 && response.status < 300) return "ok";
  return [403, 404, 410].includes(response.status) ? "gone" : "fail";
}

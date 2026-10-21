/* ==========================================================================
   Login da equipe (Supabase Auth, usuário e senha)
   --------------------------------------------------------------------------
   - O usuário digita o nome (ex.: "admdg"); o Supabase recebe o endereço
     interno equipe+admdg@digitalgalaxy.com.br (veja domain/rules.js).
   - A senha vai direto para o Supabase, que guarda só a versão criptografada.
     Este código nunca guarda a senha.
   - A sessão (token de acesso de 1 hora + token de renovação) fica no
     navegador para não pedir login a cada página. "Sair" apaga a sessão aqui
     e a encerra no Supabase.
   ========================================================================== */

import { parseUsername, loginEmail, usernameFromEmail } from "./domain/rules.js";

const STORAGE_KEY = "dg-painel-sessao";
const RENEW_BEFORE_MS = 60_000;   // renova o token 1 minuto antes de vencer

export class AuthError extends Error {
  constructor(message, reason) { super(message); this.reason = reason; this.status = 401; }
}

const MESSAGES = {
  invalid: "Usuário ou senha incorretos.",
  limited: "Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.",
  offline: "Não foi possível conectar. Verifique a internet e tente de novo.",
  expired: "Sua sessão expirou. Entre de novo.",
  signedOut: "Entre com seu usuário e senha."
};

/** localStorage pode não existir ou falhar (modo privado, bloqueio do navegador) */
function safeStorage() {
  try {
    const store = window.localStorage;
    const probe = "__dg__";
    store.setItem(probe, "1"); store.removeItem(probe);
    return store;
  } catch {
    const memory = new Map();
    return { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v), removeItem: (k) => memory.delete(k) };
  }
}

export function createAuth({ url, apiKey, storage = safeStorage(), fetchImpl = globalThis.fetch.bind(globalThis), now = () => Date.now() }) {
  const base = `${url.replace(/\/+$/, "")}/auth/v1`;
  let session = read();
  let refreshing = null;
  const listeners = new Set();

  function read() {
    try {
      const data = JSON.parse(storage.getItem(STORAGE_KEY) || "null");
      return data && data.access_token && data.refresh_token && data.user?.id ? data : null;
    } catch { return null; }
  }

  /** Guarda só o necessário da resposta do Supabase */
  function save(data) {
    const expiresAt = data.expires_at ? data.expires_at * 1000 : now() + (Number(data.expires_in) || 3600) * 1000;
    session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at_ms: expiresAt,
      user: { id: data.user?.id, email: data.user?.email, name: data.user?.user_metadata?.name || "" }
    };
    try { storage.setItem(STORAGE_KEY, JSON.stringify(session)); } catch { /* segue só na memória */ }
    listeners.forEach((fn) => fn(session));
  }

  function clear() {
    session = null;
    try { storage.removeItem(STORAGE_KEY); } catch { /* nada a fazer */ }
    listeners.forEach((fn) => fn(null));
  }

  async function post(path, body, token) {
    let response;
    try {
      response = await fetchImpl(`${base}/${path}`, {
        method: "POST",
        headers: { apikey: apiKey, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(15000)
      });
    } catch {
      throw new AuthError(MESSAGES.offline, "offline");
    }
    let data = null;
    try { data = await response.json(); } catch { data = null; }
    return { response, data };
  }

  async function doRefresh() {
    const current = session;
    if (!current) throw new AuthError(MESSAGES.signedOut, "signed_out");
    const { response, data } = await post("token?grant_type=refresh_token", { refresh_token: current.refresh_token });
    if (response.ok && data?.access_token) { save(data); return session; }
    if (response.status >= 500 || response.status === 429) throw new AuthError(MESSAGES.offline, "offline");
    // Token de renovação recusado: sessão encerrada (saiu em outro lugar, senha trocada, conta removida)
    clear();
    throw new AuthError(MESSAGES.expired, "expired");
  }

  return {
    get session() { return session; },

    /** Pessoa logada: { id, username, name } */
    get user() {
      if (!session) return null;
      const username = usernameFromEmail(session.user.email);
      return { id: session.user.id, username, name: session.user.name || username || "Equipe" };
    },

    async signIn(rawUsername, password) {
      const username = parseUsername(rawUsername);
      // Usuário em formato impossível: mesma mensagem de senha errada (não revela qual dos dois está errado)
      if (!username || !password) throw new AuthError(MESSAGES.invalid, "invalid");
      const { response, data } = await post("token?grant_type=password", { email: loginEmail(username), password });
      if (response.ok && data?.access_token) { save(data); return this.user; }
      if (response.status === 429) throw new AuthError(MESSAGES.limited, "limited");
      if (response.status >= 500) throw new AuthError(MESSAGES.offline, "offline");
      throw new AuthError(MESSAGES.invalid, "invalid");
    },

    /** Token válido para o banco; renova sozinho perto de vencer */
    async accessToken() {
      if (!session) throw new AuthError(MESSAGES.signedOut, "signed_out");
      if (session.expires_at_ms - now() > RENEW_BEFORE_MS) return session.access_token;
      return (await this.refresh()).access_token;
    },

    /** Uma renovação por vez, mesmo com vários pedidos ao mesmo tempo */
    refresh() {
      if (!refreshing) refreshing = doRefresh().finally(() => { refreshing = null; });
      return refreshing;
    },

    /** Encerra a sessão neste navegador e no Supabase */
    async signOut() {
      const token = session?.access_token;
      clear();
      if (token) { try { await post("logout?scope=local", {}, token); } catch { /* já saiu deste navegador */ } }
    },

    /** Login ou saída em outra aba do mesmo navegador */
    syncTabs() {
      window.addEventListener("storage", (event) => {
        if (event.key !== STORAGE_KEY) return;
        const next = read();
        if (!next) clear(); else { session = next; listeners.forEach((fn) => fn(session)); }
      });
    },

    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  };
}

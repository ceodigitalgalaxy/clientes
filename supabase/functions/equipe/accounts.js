/* ==========================================================================
   Contas de acesso (usuário e senha)
   --------------------------------------------------------------------------
   O Supabase Auth identifica cada pessoa por e-mail. Para entrar só com um
   nome de usuário, cada usuário vira um endereço interno fixo:
     equipe da agência → equipe+<usuario>@digitalgalaxy.com.br
     cliente           → cliente+<usuario>@digitalgalaxy.com.br
   Nenhum e-mail é enviado para eles: as contas são criadas já confirmadas,
   pelo comando admin/equipe.mjs ou (logins de cliente) pelo painel, via a
   função supabase/functions/acesso-cliente, que usa uma cópia deste arquivo.
   Sem dependências (navegador, Node e Deno).
   ========================================================================== */

export const USERNAME_LIMITS = { min: 3, max: 32 };
export const PASSWORD_LIMITS = { min: 6, max: 72 };
const USERNAME = /^[a-z0-9]+([._-][a-z0-9]+)*$/;
const LOGIN_EMAIL = /^(equipe|cliente)\+([a-z0-9._-]+)@digitalgalaxy\.com\.br$/;
export const ACCOUNT_KINDS = ["equipe", "cliente"];

/** "  João.Silva " → "joao.silva" (minúsculas, sem acento, sem espaços nas pontas) */
export const normalizeUsername = (raw) => String(raw ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Usuário válido ou null */
export function parseUsername(raw) {
  const value = normalizeUsername(raw);
  if (value.length < USERNAME_LIMITS.min || value.length > USERNAME_LIMITS.max || !USERNAME.test(value)) return null;
  return value;
}

/** Endereço interno usado pelo Supabase Auth para esse usuário */
export const loginEmail = (username, kind = "equipe") => {
  if (!ACCOUNT_KINDS.includes(kind)) throw new Error(`Tipo de conta desconhecido: ${kind}`);
  return `${kind}+${username}@digitalgalaxy.com.br`;
};

/** Caminho inverso: endereço interno → usuário (null se não for uma conta do portal) */
export const usernameFromEmail = (email) => String(email ?? "").match(LOGIN_EMAIL)?.[2] ?? null;

/** "equipe" | "cliente" | null */
export const accountKind = (email) => String(email ?? "").match(LOGIN_EMAIL)?.[1] ?? null;

/** Regras da senha nova (só para criar ou trocar; a de login não é validada aqui) */
export function passwordProblem(password, username = "") {
  const text = String(password ?? "");
  if (text.length < PASSWORD_LIMITS.min) return `Use pelo menos ${PASSWORD_LIMITS.min} caracteres.`;
  if (new TextEncoder().encode(text).length > PASSWORD_LIMITS.max) return `Use no máximo ${PASSWORD_LIMITS.max} caracteres.`;
  if (username && text.toLowerCase().includes(username)) return "A senha não pode conter o nome de usuário.";
  if (new Set(text).size < 5) return "A senha precisa variar mais os caracteres.";
  return null;
}

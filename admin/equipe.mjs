/* ==========================================================================
   Equipe do painel: criar usuários, trocar senha, listar e remover acesso
   --------------------------------------------------------------------------
   Rode no computador da agência, na pasta do projeto (precisa de admin/.env
   com a chave secreta):

       node admin/equipe.mjs criar       cria um usuário com acesso ao painel
       node admin/equipe.mjs senha       troca a senha de um usuário
       node admin/equipe.mjs listar      mostra quem tem acesso
       node admin/equipe.mjs remover     apaga um usuário (perde o acesso)
       node admin/equipe.mjs verificar   confere se o cadastro aberto está desligado

   A senha é digitada sem aparecer na tela e vai direto para o Supabase, que
   guarda só a versão criptografada. Ela não fica em nenhum arquivo.
   ========================================================================== */

import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./server.mjs";
import { parseUsername, loginEmail, usernameFromEmail, passwordProblem, USERNAME_LIMITS } from "../site/admin/js/domain/rules.js";

export class TeamError extends Error {}

/** Operações de equipe na API de administração do Supabase Auth (chave secreta) */
export function createTeamAdmin({ url, secretKey, fetchImpl = globalThis.fetch.bind(globalThis) }) {
  const base = url.replace(/\/+$/, "");
  // Mesmo formato do supabase-js: chave no apikey e no Authorization
  const headers = { apikey: secretKey, Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" };

  async function call(pathname, { method = "GET", body, extraHeaders = {} } = {}) {
    let response;
    try {
      response = await fetchImpl(`${base}${pathname}`, { method, headers: { ...headers, ...extraHeaders }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    } catch {
      throw new TeamError("Não foi possível conectar ao Supabase. Verifique a internet e tente de novo.");
    }
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (response.status === 401 || response.status === 403) throw new TeamError("O Supabase recusou a chave. Confira SUPABASE_SECRET_KEY em admin/.env.");
    if (!response.ok) {
      const code = data?.error_code || data?.code;
      if (code === "email_exists" || code === "user_already_exists") throw new TeamError("Esse usuário já existe. Para trocar a senha, use: node admin/equipe.mjs senha");
      if (code === "weak_password") throw new TeamError(`O Supabase achou a senha fraca: ${data?.msg || "use uma senha mais longa e variada."}`);
      if (code === "23505") return null;   // membro já cadastrado
      throw new TeamError(`O Supabase respondeu com erro (${response.status}${code ? `, ${code}` : ""}).`);
    }
    return data;
  }

  async function listAuthUsers() {
    const users = [];
    for (let page = 1; page <= 50; page += 1) {
      const data = await call(`/auth/v1/admin/users?page=${page}&per_page=200`);
      const batch = data?.users || [];
      users.push(...batch);
      if (batch.length < 200) break;
    }
    return users;
  }

  async function findUser(username) {
    const email = loginEmail(username);
    return (await listAuthUsers()).find((u) => (u.email || "").toLowerCase() === email) || null;
  }

  return {
    /** O cadastro aberto (qualquer pessoa criar conta) está desligado? */
    async signupDisabled() {
      const data = await call("/auth/v1/settings");
      return data?.disable_signup === true;
    },

    async list() {
      const [users, members] = await Promise.all([listAuthUsers(), call("/rest/v1/agency_members?select=user_id,created_at")]);
      const memberIds = new Set((members || []).map((m) => m.user_id));
      return users
        .map((u) => ({ id: u.id, username: usernameFromEmail(u.email), email: u.email, name: u.user_metadata?.name || "", member: memberIds.has(u.id), lastSignIn: u.last_sign_in_at || null }))
        .sort((a, b) => String(a.username || a.email).localeCompare(String(b.username || b.email)));
    },

    async create({ username, name, password }) {
      const user = await call("/auth/v1/admin/users", {
        method: "POST",
        body: { email: loginEmail(username), password, email_confirm: true, user_metadata: { name: name || username } }
      });
      try {
        await call("/rest/v1/agency_members", { method: "POST", body: { user_id: user.id }, extraHeaders: { Prefer: "return=minimal" } });
      } catch (error) {
        // Sem o vínculo com a equipe a conta não serve para nada: desfaz
        await call(`/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE" }).catch(() => {});
        throw error;
      }
      return user;
    },

    async setPassword(username, password) {
      const user = await findUser(username);
      if (!user) throw new TeamError("Usuário não encontrado. Veja os usuários com: node admin/equipe.mjs listar");
      await call(`/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { method: "PUT", body: { password } });
      return user;
    },

    async remove(username) {
      const user = await findUser(username);
      if (!user) throw new TeamError("Usuário não encontrado. Veja os usuários com: node admin/equipe.mjs listar");
      // Apagar a conta também apaga o vínculo com a equipe (on delete cascade)
      await call(`/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE" });
      return user;
    }
  };
}

/* ---------- Perguntas no terminal ---------- */

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    if (hidden) {
      // Mostra só a pergunta; o que for digitado não aparece
      rl._writeToOutput = (text) => {
        if (text.includes(question)) process.stdout.write(question);
        else if (/^[\r\n]+$/.test(text)) process.stdout.write(text);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function askUsername() {
  for (;;) {
    const username = parseUsername(await ask("Usuário: "));
    if (username) return username;
    console.log(`  Use de ${USERNAME_LIMITS.min} a ${USERNAME_LIMITS.max} caracteres: letras, números, ponto, hífen ou sublinhado (ex.: admdg, ana.paula).`);
  }
}

async function askNewPassword(username) {
  console.log("  A senha não aparece enquanto você digita. Use pelo menos 10 caracteres, misturando letras, números e símbolos.");
  for (;;) {
    const password = await ask("Senha nova: ", { hidden: true });
    const problem = passwordProblem(password, username);
    if (problem) { console.log(`  ${problem}`); continue; }
    const again = await ask("Repita a senha: ", { hidden: true });
    if (again !== password) { console.log("  As senhas não são iguais. Tente de novo."); continue; }
    return password;
  }
}

async function warnIfSignupOpen(team) {
  try {
    if (!(await team.signupDisabled())) {
      console.log("\n  ⚠ ATENÇÃO: o cadastro aberto está LIGADO no Supabase. Qualquer pessoa pode criar uma conta");
      console.log("    (sem acesso aos dados, mas é melhor desligar): Authentication → Sign In / Providers →");
      console.log("    desligue \"Allow new users to sign up\" e clique em Save.\n");
      return false;
    }
    return true;
  } catch { return null; }
}

const HELP = `
Equipe do painel da agência

  node admin/equipe.mjs criar       cria um usuário com acesso ao painel
  node admin/equipe.mjs senha       troca a senha de um usuário
  node admin/equipe.mjs listar      mostra quem tem acesso
  node admin/equipe.mjs remover     apaga um usuário (perde o acesso)
  node admin/equipe.mjs verificar   confere se o cadastro aberto está desligado
`;

async function main(command) {
  const env = loadEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    console.error("Preencha SUPABASE_URL e SUPABASE_SECRET_KEY em admin/.env (veja admin/.env.example).");
    process.exitCode = 1;
    return;
  }
  const team = createTeamAdmin({ url: env.SUPABASE_URL, secretKey: env.SUPABASE_SECRET_KEY });

  if (command === "criar") {
    console.log("\nNovo usuário do painel da agência\n");
    const username = await askUsername();
    const name = (await ask(`Nome que aparece no painel (Enter para usar "${username}"): `)).trim().slice(0, 80) || username;
    const password = await askNewPassword(username);
    await team.create({ username, name, password });
    console.log(`\n✔ Usuário "${username}" criado com acesso ao painel.`);
    await warnIfSignupOpen(team);
    return;
  }
  if (command === "senha") {
    console.log("\nTrocar a senha de um usuário\n");
    const username = await askUsername();
    const password = await askNewPassword(username);
    await team.setPassword(username, password);
    console.log(`\n✔ Senha de "${username}" trocada. Sessões abertas com a senha antiga deixam de ser renovadas.`);
    return;
  }
  if (command === "listar") {
    const users = await team.list();
    if (!users.length) { console.log("\nNenhum usuário cadastrado. Crie o primeiro com: node admin/equipe.mjs criar\n"); return; }
    console.log("\nUsuários do painel:\n");
    for (const u of users) {
      const last = u.lastSignIn ? `último acesso ${new Date(u.lastSignIn).toLocaleString("pt-BR")}` : "nunca entrou";
      console.log(`  ${u.member ? "✔" : "✘"} ${u.username || u.email}  (${u.name || "sem nome"}, ${last})${u.member ? "" : "  ← sem acesso ao painel"}`);
    }
    console.log("");
    return;
  }
  if (command === "remover") {
    console.log("\nRemover um usuário (ele perde o acesso ao painel)\n");
    const username = await askUsername();
    const typed = parseUsername(await ask(`Para confirmar, digite de novo o usuário "${username}": `));
    if (typed !== username) { console.log("\nNada foi removido."); return; }
    await team.remove(username);
    console.log(`\n✔ Usuário "${username}" removido.`);
    return;
  }
  if (command === "verificar") {
    const ok = await warnIfSignupOpen(team);
    if (ok) console.log("\n✔ Cadastro aberto desligado: só entra quem for criado por este comando.\n");
    if (ok === null) { console.log("\nNão foi possível consultar a configuração do Supabase.\n"); process.exitCode = 1; }
    if (ok === false) process.exitCode = 1;
    return;
  }
  console.log(HELP);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv[2]).catch((error) => {
    console.error(`\n✘ ${error instanceof TeamError ? error.message : `Erro inesperado: ${error.message}`}\n`);
    process.exitCode = 1;
  });
}

/* ==========================================================================
   Acessos: equipe (painel da agência) e clientes (portal do cliente)
   --------------------------------------------------------------------------
   Rode no computador da agência, na pasta do projeto (precisa de admin/.env
   com a chave secreta):

       node admin/equipe.mjs criar           cria um usuário da EQUIPE (painel)
       node admin/equipe.mjs criar-cliente   cria o login de um CLIENTE (portal)
       node admin/equipe.mjs senha           troca a senha de um usuário
       node admin/equipe.mjs listar          mostra quem tem acesso
       node admin/equipe.mjs remover         apaga um usuário (perde o acesso)
       node admin/equipe.mjs verificar       confere se o cadastro aberto está desligado

   Cada login de cliente vê só os conteúdos do próprio cliente.

   A senha é digitada sem aparecer na tela e vai direto para o Supabase, que
   guarda só a versão criptografada. Ela não fica em nenhum arquivo.
   ========================================================================== */

import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./server.mjs";
import { parseUsername, loginEmail, usernameFromEmail, accountKind, passwordProblem, USERNAME_LIMITS } from "../site/js/domain/accounts.js";

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

  /** Contas com esse nome de usuário (pode haver uma da equipe e uma de cliente) */
  async function findUsers(username, kind = null) {
    const emails = (kind ? [kind] : ["equipe", "cliente"]).map((k) => loginEmail(username, k));
    return (await listAuthUsers()).filter((u) => emails.includes((u.email || "").toLowerCase()));
  }

  async function findOne(username, kind) {
    const found = await findUsers(username, kind);
    if (!found.length) throw new TeamError("Usuário não encontrado. Veja os usuários com: node admin/equipe.mjs listar");
    if (found.length > 1) throw new TeamError("Existe um usuário da equipe e um de cliente com esse nome. Informe qual.");
    return found[0];
  }

  async function createAccount({ email, password, name, link }) {
    const user = await call("/auth/v1/admin/users", {
      method: "POST",
      body: { email, password, email_confirm: true, user_metadata: { name } }
    });
    try {
      await link(user);
    } catch (error) {
      // Sem o vínculo a conta não serve para nada: desfaz
      await call(`/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE" }).catch(() => {});
      throw error;
    }
    return user;
  }

  return {
    /** O cadastro aberto (qualquer pessoa criar conta) está desligado? */
    async signupDisabled() {
      const data = await call("/auth/v1/settings");
      return data?.disable_signup === true;
    },

    /** Clientes cadastrados no painel (para escolher a quem dar acesso) */
    async listClients() {
      return (await call("/rest/v1/clients?select=id,name,slug,active&order=name.asc")) || [];
    },

    async list() {
      const [users, members, clientMembers, clients] = await Promise.all([
        listAuthUsers(),
        call("/rest/v1/agency_members?select=user_id"),
        call("/rest/v1/client_members?select=user_id,client_id"),
        call("/rest/v1/clients?select=id,name")
      ]);
      const team = new Set((members || []).map((m) => m.user_id));
      const clientName = Object.fromEntries((clients || []).map((c) => [c.id, c.name]));
      const clientOf = Object.fromEntries((clientMembers || []).map((m) => [m.user_id, clientName[m.client_id] || "cliente removido"]));
      return users
        .map((u) => ({
          id: u.id, username: usernameFromEmail(u.email), email: u.email, kind: accountKind(u.email),
          name: u.user_metadata?.name || "", member: team.has(u.id), client: clientOf[u.id] || null,
          lastSignIn: u.last_sign_in_at || null
        }))
        .sort((a, b) => `${a.kind}${a.username || a.email}`.localeCompare(`${b.kind}${b.username || b.email}`));
    },

    /** Usuário da equipe (painel da agência) */
    async create({ username, name, password }) {
      return createAccount({
        email: loginEmail(username, "equipe"), password, name: name || username,
        link: (user) => call("/rest/v1/agency_members", { method: "POST", body: { user_id: user.id }, extraHeaders: { Prefer: "return=minimal" } })
      });
    },

    /** Login de um cliente (portal do cliente), ligado a UM cliente */
    async createClientAccess({ username, clientId, clientName, password }) {
      return createAccount({
        email: loginEmail(username, "cliente"), password, name: clientName,
        link: (user) => call("/rest/v1/client_members", { method: "POST", body: { user_id: user.id, client_id: clientId, username }, extraHeaders: { Prefer: "return=minimal" } })
      });
    },

    findUsers,

    async setPassword(username, password, kind = null) {
      const user = await findOne(username, kind);
      await call(`/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { method: "PUT", body: { password } });
      return user;
    },

    async remove(username, kind = null) {
      const user = await findOne(username, kind);
      // Apagar a conta também apaga o vínculo (agency_members / client_members: on delete cascade)
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
  console.log("  A senha não aparece enquanto você digita. Use pelo menos 6 caracteres (de preferência misturando letras, números e símbolos).");
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
Acessos do painel da agência e do portal do cliente

  node admin/equipe.mjs criar           cria um usuário da EQUIPE (painel da agência)
  node admin/equipe.mjs criar-cliente   cria o login de um CLIENTE (portal do cliente)
  node admin/equipe.mjs senha           troca a senha de um usuário
  node admin/equipe.mjs listar          mostra quem tem acesso
  node admin/equipe.mjs remover         apaga um usuário (perde o acesso)
  node admin/equipe.mjs verificar       confere se o cadastro aberto está desligado
`;

const KIND_LABEL = { equipe: "da equipe", cliente: "de cliente" };

/** Mesmo nome na equipe e num cliente: pergunta qual */
async function askKind(team, username) {
  const found = await team.findUsers(username);
  if (!found.length) throw new TeamError("Usuário não encontrado. Veja os usuários com: node admin/equipe.mjs listar");
  if (found.length === 1) return accountKind(found[0].email);
  for (;;) {
    const answer = (await ask('Existe um usuário da equipe e um de cliente com esse nome. Qual? (digite "equipe" ou "cliente"): ')).trim().toLowerCase();
    if (answer === "equipe" || answer === "cliente") return answer;
  }
}

async function askClient(team) {
  const clients = (await team.listClients()).filter((c) => c.active);
  if (!clients.length) throw new TeamError("Nenhum cliente ativo cadastrado. Cadastre o cliente no painel da agência primeiro.");
  console.log("Clientes ativos:\n");
  clients.forEach((c, i) => console.log(`  ${String(i + 1).padStart(2)}. ${c.name}  (${c.slug})`));
  console.log("");
  for (;;) {
    const answer = (await ask("Número ou identificador do cliente: ")).trim().toLowerCase();
    const chosen = clients[Number(answer) - 1] || clients.find((c) => c.slug === answer);
    if (chosen) return chosen;
    console.log("  Não encontrei esse cliente. Use o número da lista ou o identificador.");
  }
}

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
  if (command === "criar-cliente") {
    console.log("\nNovo login de cliente (portal do cliente)\n");
    const client = await askClient(team);
    console.log(`\nCliente: ${client.name}. Sugestão de usuário: ${client.slug.slice(0, 32)}`);
    const username = await askUsername();
    const password = await askNewPassword(username);
    await team.createClientAccess({ username, clientId: client.id, clientName: client.name, password });
    console.log(`\n✔ Login "${username}" criado para ${client.name}.`);
    console.log("  Envie ao cliente o endereço https://clientes.digitalgalaxy.com.br, o usuário e a senha (de preferência por canais separados).");
    console.log("  Ele vê só os conteúdos deste cliente com status Aguardando aprovação, Aprovado ou Publicado.");
    await warnIfSignupOpen(team);
    return;
  }
  if (command === "senha") {
    console.log("\nTrocar a senha de um usuário\n");
    const username = await askUsername();
    const kind = await askKind(team, username);
    const password = await askNewPassword(username);
    await team.setPassword(username, password, kind);
    console.log(`\n✔ Senha do usuário ${KIND_LABEL[kind]} "${username}" trocada. Sessões abertas com a senha antiga deixam de ser renovadas.`);
    return;
  }
  if (command === "listar") {
    const users = await team.list();
    if (!users.length) { console.log("\nNenhum usuário cadastrado. Crie o primeiro com: node admin/equipe.mjs criar\n"); return; }
    const last = (u) => (u.lastSignIn ? `último acesso ${new Date(u.lastSignIn).toLocaleString("pt-BR")}` : "nunca entrou");
    console.log("\nEquipe (painel da agência):\n");
    users.filter((u) => u.kind === "equipe").forEach((u) => {
      console.log(`  ${u.member ? "✔" : "✘"} ${u.username}  (${u.name || "sem nome"}, ${last(u)})${u.member ? "" : "  ← sem acesso ao painel"}`);
    });
    console.log("\nClientes (portal do cliente):\n");
    const clientUsers = users.filter((u) => u.kind === "cliente");
    if (!clientUsers.length) console.log("  Nenhum. Crie com: node admin/equipe.mjs criar-cliente");
    clientUsers.forEach((u) => {
      console.log(`  ${u.client ? "✔" : "✘"} ${u.username}  (${u.client || "sem cliente ligado"}, ${last(u)})`);
    });
    const other = users.filter((u) => !u.kind);
    if (other.length) console.log(`\n  ⚠ ${other.length} conta(s) fora do padrão no Supabase Auth (sem acesso ao painel nem ao portal).`);
    console.log("");
    return;
  }
  if (command === "remover") {
    console.log("\nRemover um usuário (ele perde o acesso)\n");
    const username = await askUsername();
    const kind = await askKind(team, username);
    const typed = parseUsername(await ask(`Para confirmar, digite de novo o usuário "${username}": `));
    if (typed !== username) { console.log("\nNada foi removido."); return; }
    await team.remove(username, kind);
    console.log(`\n✔ Usuário ${KIND_LABEL[kind]} "${username}" removido.`);
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

/* Capturas do PAINEL no celular (390 px) para revisão visual, sobre o
   Supabase de mentira com dados de teste. Não testa nada: fotografa cada
   tela e mede a rolagem lateral.
   PLAYWRIGHT=... UX_SHOTS=pasta node admin/test/ux-admin-shots.mjs */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPreviewServer } from "../server.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { createFakeSupabase } from "./fake-supabase.mjs";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../../site/js/config.js";
import { validateContent } from "../../site/admin/js/domain/rules.js";

const { chromium, devices } = await import(process.env.PLAYWRIGHT || "playwright");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5621;
const OUT = process.env.UX_SHOTS;
const FIX = (name) => readFileSync(path.join(HERE, "fixtures", name));
const pad = (n) => String(n).padStart(2, "0");
const now = new Date();
const D = (day) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(day)}`;

const store = createMemoryStore();
const fake = createFakeSupabase({ store, publishableKey: SUPABASE_PUBLISHABLE_KEY });
const client = await store.createClient({ name: "Padaria Central Ltda", slug: "padaria-central", segment: "Alimentação", contact_name: "Maria", active: true });
await store.createClient({ name: "Estúdio Luz Fotografia e Eventos", slug: "estudio-luz", active: true });
fake.addUser("admdg-teste", "Senha-de-teste-123", { name: "Equipe Digital Galaxy" });
fake.addUser("padaria", "Senha-padaria-123", { kind: "cliente", clientId: client.id });
for (const [day, title, network, format, status] of [[3, "Bom dia com pão quentinho e café passado na hora", "instagram", "post", "publicado"], [10, "Promoção de café da manhã", "facebook", "carrossel", "aprovado"], [14, "Receita de pão de queijo", "tiktok", "reels", "aguardando_aprovacao"], [22, "Depoimento de cliente", "instagram", "post", "planejado"]]) {
  await store.createContent(validateContent({ client_id: client.id, title, scheduled_date: D(day), scheduled_time: "10:30", network, format, status, media_url: "https://cdn.exemplo.com/ref.png", caption: "Legenda de exemplo." }).value);
}
const team = { id: "equipe", role: "equipe", username: "admdg-teste" };
const ad = await store.createAd({ client_id: client.id, title: "Promoção de inverno · público frio", platform: "meta", format: "carrossel", primary_text: "Pão quentinho e café por R$ 9,90!", headline: "Café da manhã completo", cta: "Saiba mais", destination_url: "https://padariacentral.com.br" }, team);
await store.addAdAsset({ ad_id: ad.id, kind: "image", url: "https://cdn.exemplo.com/a.png", position: 0 });
await store.adTransition(team, { p_ad_id: ad.id, p_action: "enviar" });
await store.createAd({ client_id: client.id, title: "Vídeo da fornada", platform: "google", format: "video" }, team);

const server = createPreviewServer({ port: PORT });
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const browser = await chromium.launch();
const context = await browser.newContext({ ...devices["iPhone 13"] });
await context.route(`${SUPABASE_URL}/**`, async (route) => {
  const req = route.request();
  const answer = await fake.handle({ method: req.method(), url: req.url(), headers: await req.allHeaders(), body: req.postData(), bodyBuffer: req.postDataBuffer() });
  return answer === "abort" ? route.abort("failed") : route.fulfill(answer);
});
await context.route("https://cdn.exemplo.com/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: FIX("arte2.png") }));
const page = await context.newPage();
page.setDefaultTimeout(8000);
page.on("pageerror", (e) => console.log("erro:", e.message));
const report = [];
const overflow = () => page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const wide = [...document.querySelectorAll("body *")].filter((n) => { const r = n.getBoundingClientRect(); return r.width && r.right > vw + 1 && !n.closest(".imp-table, .status-tabs, .legend, .mini-stats__list, .spot__track, .carousel__track"); });
  return { page: document.documentElement.scrollWidth - vw, culprits: wide.slice(0, 4).map((n) => `${n.tagName.toLowerCase()}.${[...n.classList].join(".")}`) };
});
const shot = async (name, { full = true } = {}) => {
  await page.waitForTimeout(500);
  const o = await overflow();
  report.push(`${name}: rolagem lateral ${o.page}px${o.culprits.length ? ` (${o.culprits.join(", ")})` : ""}`);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
};

await page.goto(`http://localhost:${PORT}/admin/`);
await shot("m00-entrar");
await page.fill('#login-form [name="username"]', "admdg-teste");
await page.fill('#login-form [name="password"]', "Senha-de-teste-123");
await page.click("#login-form [type=submit]");
await page.waitForSelector("#app:not([hidden])");
await page.waitForSelector(".row[data-row]");
await shot("m01-conteudos");
await page.click('[data-action="new-content"]');
await page.waitForSelector("#content-modal[open]");
await shot("m02-novo-conteudo", { full: false });
await page.click('#content-modal [data-action="close-modal"]');
await page.waitForTimeout(400);
await page.click(".row__title >> nth=0");
await page.waitForSelector("#content-drawer[open]");
await shot("m03-detalhe-conteudo", { full: false });
await page.click('#content-drawer [data-action="close-drawer"]');
await page.waitForTimeout(400);
await page.check(".row[data-row] [data-pick] >> nth=0");
await shot("m04-massa-conteudos", { full: false });
await page.click("[data-bulk-clear]");
await page.click('[data-route="anuncios"]');
await page.waitForSelector(".ad-card");
await shot("m05-anuncios");
await page.click(".ad-card__open >> nth=0");
await page.waitForSelector("#ad-drawer[open]");
await shot("m06-detalhe-anuncio", { full: false });
await page.click('#ad-drawer [data-action="close-drawer"]');
await page.waitForTimeout(400);
await page.click('#view-anuncios [data-action="new-ad"]');
await page.waitForSelector("#ad-modal[open]");
await shot("m07-novo-anuncio", { full: false });
await page.click('#ad-modal [data-action="close-modal"]');
await page.waitForTimeout(400);
await page.click('[data-route="clientes"]');
await page.waitForSelector(".client-card");
await shot("m08-clientes");
await page.click(".client-card [data-edit-client] >> nth=0");
await page.waitForSelector("#client-modal[open]");
await shot("m09-editar-cliente", { full: false });
await page.click('#client-modal [data-action="close-modal"]');
await page.waitForTimeout(400);
await page.click('[data-route="importar"]');
await page.waitForSelector("#view-importar:not([hidden])");
await page.selectOption('#import-form [name="client_id"]', client.id);
await page.setInputFiles('#import-form [name="file"]', { name: "importacao.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: FIX("importacao.xlsx") });
await page.waitForSelector("#import-preview .imp-table");
await shot("m10-importar");
console.log(report.join("\n"));
await browser.close();
server.close();

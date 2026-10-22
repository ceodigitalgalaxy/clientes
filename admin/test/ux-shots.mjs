/* Capturas do portal para revisão visual (desktop e celular), sobre o
   Supabase de mentira com conteúdos de teste. Não testa nada: só fotografa.
   PLAYWRIGHT=... UX_SHOTS=pasta node admin/test/ux-shots.mjs */

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
const PORT = 5620;
const ORIGIN = `http://localhost:${PORT}`;
const OUT = process.env.UX_SHOTS;
const FIX = (name) => readFileSync(path.join(HERE, "fixtures", name));
const pad = (n) => String(n).padStart(2, "0");
const now = new Date();
const D = (day) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(day)}`;

const store = createMemoryStore();
const fake = createFakeSupabase({ store, publishableKey: SUPABASE_PUBLISHABLE_KEY });
const client = await store.createClient({ name: "Padaria Central Ltda", slug: "padaria-central", segment: "Alimentação", active: true });
fake.addUser("padaria", "Senha-padaria-123", { kind: "cliente", clientId: client.id });
const items = [
  [3, "09:00", "Bom dia com pão quentinho", "instagram", "post", "publicado"],
  [6, "18:00", "Bastidores da fornada", "instagram", "reels", "publicado"],
  [10, "10:30", "Promoção de café da manhã", "facebook", "carrossel", "aprovado"],
  [14, "12:00", "Receita de pão de queijo", "tiktok", "reels", "aguardando_aprovacao"],
  [14, "19:00", "Enquete: doce ou salgado?", "instagram", "stories", "aguardando_aprovacao"],
  [18, "11:00", "Carrossel de lançamento", "instagram", "carrossel", "aguardando_aprovacao"],
  [22, "15:00", "Depoimento de cliente", "instagram", "post", "ajustes"],
  [26, "09:00", "Novidade no cardápio", "instagram", "post", "aguardando_aprovacao"],
  [28, null, "Sorteio de aniversário", "instagram", "carrossel", "aprovado"]
];
for (const [day, time, title, network, format, status] of items) {
  const c = await store.createContent(validateContent({ client_id: client.id, title, scheduled_date: D(day), scheduled_time: time, network, format, status: "em_producao", media_url: "https://cdn.exemplo.com/ref.png", caption: "Legenda de exemplo para o conteúdo." }).value);
  if (["aguardando_aprovacao", "publicado", "aprovado"].includes(status) && day % 2 === 0) {
    const p = `${client.id}/${c.id}/arte.png`;
    fake.files.set(`content-media/${p}`, { type: "image/png", body: FIX(day % 4 ? "arte2.png" : "arte.png") });
    await store.addAsset({ content_id: c.id, kind: "image", storage_path: p, position: 0 });
  }
  await store.setContentStatus(c.id, status);
}
const server = createPreviewServer({ port: PORT });
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const browser = await chromium.launch();
async function ctx(options) {
  const context = await browser.newContext(options);
  await context.route(`${SUPABASE_URL}/**`, async (route) => {
    const req = route.request();
    const answer = await fake.handle({ method: req.method(), url: req.url(), headers: await req.allHeaders(), body: req.postData(), bodyBuffer: req.postDataBuffer() });
    return answer === "abort" ? route.abort("failed") : route.fulfill(answer);
  });
  await context.route("https://cdn.exemplo.com/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: FIX("arte.png") }));
  return context;
}
async function session(name, options, extra) {
  const context = await ctx(options);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log(`${name} erro:`, e.message));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load")) console.log(`${name} console:`, m.text()); });
  await page.goto(`${ORIGIN}/`);
  await page.fill('#login-form [name="username"]', "padaria");
  await page.fill('#login-form [name="password"]', "Senha-padaria-123");
  await page.click("#login-form [type=submit]");
  await page.waitForSelector("#app:not([hidden])");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${name}-topo.png` });
  await page.screenshot({ path: `${OUT}/${name}-inteira.png`, fullPage: true });
  if (extra) await extra(page);
  await context.close();
}
await session("desktop", { viewport: { width: 1360, height: 900 } });
await session("celular", { ...devices["iPhone 13"] }, async (page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log("rolagem lateral no celular:", overflow);
  const cell = page.locator(`.cal__cell[data-day="${D(14)}"] .cal__date`);
  if (await cell.count()) { await cell.tap(); await page.waitForTimeout(600); await page.screenshot({ path: `${OUT}/celular-dia.png`, fullPage: true }); }
  const item = page.locator('.agenda__item').first();
  if (await item.count()) { await item.tap(); await page.waitForTimeout(800); await page.screenshot({ path: `${OUT}/celular-detalhe.png` }); }
});
await browser.close();
server.close();

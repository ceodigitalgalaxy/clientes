/* Capturas da página pública de aprovação para revisão visual (computador e
   celular), sobre o Supabase de mentira com a função "aprovacao" de verdade.
   Não testa nada: só fotografa lista, detalhe, navegação e calendário.
   PLAYWRIGHT=... UX_SHOTS=pasta node admin/test/ux-approval-shots.mjs */

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
const PORT = 5600;
const ORIGIN = `http://localhost:${PORT}`;
const OUT = process.env.UX_SHOTS;
const FIX = (name) => readFileSync(path.join(HERE, "fixtures", name));
const pad = (n) => String(n).padStart(2, "0");
const next = new Date(); next.setDate(1); next.setMonth(next.getMonth() + 1);
const MONTH = `${next.getFullYear()}-${pad(next.getMonth() + 1)}`;
const D = (day) => `${MONTH}-${pad(day)}`;

const store = createMemoryStore();
const fake = createFakeSupabase({ store, publishableKey: SUPABASE_PUBLISHABLE_KEY });
const client = await store.createClient({ name: "Padaria Central", slug: "padaria-central", active: true });
const long = "Mostrar o processo da primeira fornada do dia, do forno abrindo até os pães chegando na vitrine. A ideia é aproximar o público da rotina da padaria e reforçar que tudo é feito na hora, com ingredientes selecionados.";
const rows = [
  [3, "09:00", "Primeira fornada do dia", "reels", { idea: long, content_plan: "1. Forno abrindo (2s)\n2. Close no pão dourado\n3. Pães indo para a vitrine\n4. Cliente pegando o pão", art_text: "Saiu agora!", objective: "Aumentar o movimento de manhã", caption: "Nada como começar o dia com pão quentinho. Passa aqui e garante o seu! 🥖", cta: "Peça pelo WhatsApp", pillar: "Bastidores" }, "arte.png"],
  [7, "18:00", "Promoção do café da manhã", "carrossel", { idea: "Café + pão na chapa por R$ 9,90 de segunda a sexta.", caption: "Seu café da manhã completo por um precinho especial.", cta: "Venha conferir", pillar: "Oferta" }, "arte2.png"],
  [12, "12:00", "Receita de pão de queijo da casa, passo a passo", "reels", { idea: "Mostrar a receita tradicional em 30 segundos.", objective: "Engajamento", pillar: "Educativo" }, null],
  [12, "19:00", "Enquete: doce ou salgado?", "stories", { idea: "Caixinha de enquete para conhecer o gosto do público." }, null],
  [18, "11:00", "Depoimento de cliente", "post", { idea: "Cliente antigo conta há quanto tempo compra na padaria.", caption: "Há 20 anos fazendo parte da sua manhã." }, "arte.png"],
  [26, null, "Novidade no cardápio: sonho de doce de leite", "post", { idea: "Apresentar o novo sabor com foto de close." }, "arte2.png"]
];
const ids = [];
for (const [day, time, title, format, extra, file] of rows) {
  const c = await store.createContent(validateContent({ client_id: client.id, title, scheduled_date: D(day), scheduled_time: time, network: "instagram", format, ...extra }).value);
  if (file) {
    const p = `${client.id}/${c.id}/capa.png`;
    fake.files.set(`content-media/${p}`, { type: "image/png", body: FIX(file) });
    await store.addAsset({ content_id: c.id, kind: "image", role: "capa", storage_path: p, position: 0 });
  }
  ids.push(c.id);
}
const actor = { id: "equipe-1", username: "equipe", member: true };
const batch = await store.createBatch({ client_id: client.id, title: "Planejamento de conteúdo", month: `${MONTH}-01`, approval_mode: process.env.MODE || "planejamento" }, actor);
await store.approvalSetItems(actor, { p_batch: batch.id, p_contents: ids });
const { token } = await store.approvalPublish(actor, { p_batch: batch.id, p_title: "Planejamento de conteúdo", p_intro: "", p_mode: process.env.MODE || "planejamento" });

const server = createPreviewServer({ port: PORT });
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const browser = await chromium.launch();
async function shoot(name, options, steps) {
  const context = await browser.newContext(options);
  await context.route(`${SUPABASE_URL}/**`, async (route) => {
    const req = route.request();
    const answer = await fake.handle({ method: req.method(), url: req.url(), headers: await req.allHeaders(), body: req.postData(), bodyBuffer: req.postDataBuffer() });
    return answer === "abort" ? route.abort("failed") : route.fulfill(answer);
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log(`${name} erro:`, e.message));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load")) console.log(`${name} console:`, m.text()); });
  await page.goto(`${ORIGIN}/aprovacao/#${token}`);
  await page.waitForSelector(".ap-hero");
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${name}-topo.png` });
  await page.screenshot({ path: `${OUT}/${name}-inteira.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) console.log(`${name}: rolagem lateral de ${overflow}px`);
  await steps(page);
  await context.close();
}
const detail = async (page, name) => {
  const open = page.locator("[data-ap-open]").first();
  if (await open.count()) {
    await open.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/${name}-detalhe.png` });
    const nextBtn = page.locator("[data-ap-step='1']");
    if (await nextBtn.count()) { await nextBtn.click(); await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${name}-detalhe-2.png` }); }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  await page.click("[data-ap-layout='calendario']");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}-calendario.png`, fullPage: true });
};
await shoot("desktop", { viewport: { width: 1360, height: 900 } }, (p) => detail(p, "desktop"));
await shoot("celular", { ...devices["iPhone 13"] }, (p) => detail(p, "celular"));
await browser.close();
server.close();
console.log("capturas em", OUT);

/* Teste de ponta a ponta: interações e movimento do painel.
   Confere a linguagem de movimento (tempos e curvas dos tokens), que cliques
   rápidos e repetidos não deixam janelas/menus presos, que o teclado mostra o
   foco, que o toque não deixa cartão "levantado", que "reduzir movimento" do
   sistema é respeitado (mas o indicador de carregamento continua girando) e
   que nenhuma animação fica rodando à toa com a tela parada.
   Rode: PLAYWRIGHT=/caminho/playwright/index.mjs node admin/test/movimento-e2e.mjs */

import assert from "node:assert/strict";
import { createPreviewServer } from "../server.mjs";
import { createMemoryStore } from "./memory-store.mjs";
import { createFakeSupabase } from "./fake-supabase.mjs";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../../site/js/config.js";
import { validateContent } from "../../site/admin/js/domain/rules.js";

const { chromium, devices } = await import(process.env.PLAYWRIGHT || "playwright");
const PORT = 5722;
const ORIGIN = `http://localhost:${PORT}`;
const pad = (n) => String(n).padStart(2, "0");
const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const store = createMemoryStore();
const fake = createFakeSupabase({ store, publishableKey: SUPABASE_PUBLISHABLE_KEY });
const padaria = await store.createClient({ name: "Padaria Central Ltda", slug: "padaria-central", active: true });
fake.addUser("admdg-teste", "Senha-de-teste-123", { name: "Bruna Admin" });
await store.createContent(validateContent({ client_id: padaria.id, title: "Stories do café", scheduled_date: plus(1), scheduled_time: "10:00", network: "instagram", format: "stories" }).value);

const server = createPreviewServer({ port: PORT });
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const results = [];
const consoleErrors = [];
const step = async (label, fn) => {
  try { await fn(); results.push(`✔ ${label}`); }
  catch (error) { results.push(`✘ ${label}: ${error.message.split("\n").slice(0, 3).join(" | ")}`); process.exitCode = 1; }
  console.log(results.at(-1));
};
const browser = await chromium.launch();
async function newPage(options, name) {
  const context = await browser.newContext(options);
  await context.route(`${SUPABASE_URL}/**`, async (route) => {
    const req = route.request();
    const answer = await fake.handle({ method: req.method(), url: req.url(), headers: await req.allHeaders(), body: req.postData(), bodyBuffer: req.postDataBuffer() });
    return answer === "abort" ? route.abort("failed") : route.fulfill(answer);
  });
  const p = await context.newPage();
  p.setDefaultTimeout(8000);
  p.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) consoleErrors.push(`${name}: ${m.text()}`); });
  p.on("pageerror", (e) => consoleErrors.push(`${name}: ${e.message}`));
  await p.goto(`${ORIGIN}/admin/`);
  await p.fill('#login-form [name="username"]', "admdg-teste");
  await p.fill('#login-form [name="password"]', "Senha-de-teste-123");
  await p.click("#login-form [type=submit]");
  await p.waitForSelector("#app:not([hidden])");
  await p.waitForSelector(".kpis .kpi__n");
  return p;
}
const ms = (v) => Math.round(parseFloat(v) * (String(v).endsWith("ms") ? 1 : 1000));
const go = async (p, route) => { await p.evaluate((r) => { location.hash = `#/${r}`; }, route); await p.waitForTimeout(400); };

let page = await newPage({ viewport: { width: 1366, height: 800 } }, "computador");

await step("Linguagem de movimento: tokens definidos e usados nos componentes básicos", async () => {
  const t = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const btn = document.querySelector(".btn"); const input = document.querySelector(".field__input");
    return {
      tokens: ["--dur-instant", "--dur-fast", "--dur-normal", "--dur-moderate", "--dur-smooth", "--dur-slow", "--ease-out", "--ease-in", "--ease-in-out"].map((k) => css.getPropertyValue(k).trim()),
      btn: getComputedStyle(btn).transitionDuration.split(", "), input: getComputedStyle(input).transitionDuration.split(", ")
    };
  });
  assert.deepEqual(t.tokens.slice(0, 6), ["100ms", "150ms", "200ms", "250ms", "300ms", "400ms"]);
  assert.ok(t.tokens.slice(6).every(Boolean), "curvas definidas");
  assert.ok(t.btn.every((d) => ms(d) <= 150), `botão responde em até 150 ms (${t.btn})`);
  assert.ok(t.input.every((d) => ms(d) <= 150), "campo responde em até 150 ms");
});

await step("Janela (modal): entra em 300 ms com ease-out; abrir e fechar 5x seguidas não deixa nada preso", async () => {
  const button = page.locator('[data-action="home-new-content"]');
  await button.click();
  await page.waitForSelector("#content-modal[open]");
  const anim = await page.$eval("#content-modal", (m) => ({ d: getComputedStyle(m).animationDuration, n: getComputedStyle(m).animationName }));
  assert.equal(anim.n, "modal-in"); assert.equal(ms(anim.d), 300);
  await page.keyboard.press("Escape");
  for (let i = 0; i < 5; i += 1) { await button.click(); await page.keyboard.press("Escape"); }
  await page.waitForTimeout(500);
  assert.equal(await page.locator("dialog[open]").count(), 0, "nenhuma janela aberta sobrando");
  await button.click();
  await page.waitForSelector("#content-modal[open]:not(.is-closing)");
  assert.equal(await page.locator("dialog[open]").count(), 1, "abre de novo normalmente");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#content-modal:not([open])", { state: "attached" });
});

await step("Seções do formulário abrem suaves; erro do campo aparece com entrada curta", async () => {
  await page.click('[data-action="home-new-content"]');
  await page.waitForSelector("#content-modal[open]");
  await page.click('#content-modal [data-fold="ideia"] summary');
  const fold = await page.$eval('#content-modal [data-fold="ideia"] > .form-fold__body', (b) => getComputedStyle(b).animationName);
  assert.equal(fold, "fold-in");
  await page.fill('#content-modal [name="title"]', "");
  await page.click("#content-modal [type=submit]");
  await page.waitForSelector("#content-modal .field__error");
  const err = await page.$eval("#content-modal .field__error", (e) => ({ n: getComputedStyle(e).animationName, d: getComputedStyle(e).animationDuration }));
  assert.equal(err.n, "msg-in"); assert.ok(ms(err.d) <= 200);
  await page.keyboard.press("Escape");
  await page.waitForSelector("#content-modal:not([open])", { state: "attached" });
});

await step("Menus (conta, avisos, ⋯) abrem com a mesma entrada; cliques repetidos e Esc fecham certo", async () => {
  for (let i = 0; i < 6; i += 1) await page.click("[data-me-toggle]");   // número par: termina fechado
  assert.equal(await page.isVisible("#me-pop"), false);
  await page.click("[data-me-toggle]");
  assert.equal(await page.$eval("#me-pop", (m) => getComputedStyle(m).animationName), "menu-in");
  await page.keyboard.press("Escape");
  assert.equal(await page.isVisible("#me-pop"), false);
  assert.equal(await page.evaluate(() => document.activeElement?.matches("[data-me-toggle]")), true, "o foco volta para o botão");
  await page.click("[data-action=toggle-inbox]");
  await page.waitForSelector("#inbox:not([hidden])");
  assert.equal(await page.$eval("#inbox", (m) => getComputedStyle(m).animationName), "menu-in");
  await page.click("[data-action=toggle-inbox]");
  await go(page, "gestao");
  await page.click("#view-gestao [data-board-settings]");
  assert.equal(await page.$eval("#view-gestao .menu:not([hidden])", (m) => getComputedStyle(m).animationName), "menu-in");
  await page.keyboard.press("Escape");
});

await step("Teclado: o foco aparece nos botões; pressionar dá retorno sem atrasar a ação", async () => {
  await go(page, "inicio");
  await page.focus('[data-action="home-new-content"]');
  await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab");
  const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== "none" || s.boxShadow !== "none"; });
  assert.ok(ring, "anel de foco visível");
  const pressed = await page.evaluate(() => {
    const b = document.querySelector('[data-action="home-new-content"]');
    return [...document.styleSheets].some((sh) => { try { return [...sh.cssRules].some((r) => r.selectorText === ".btn:active:not(:disabled)" && /scale\(0\.98\)/.test(r.cssText)); } catch { return false; } }) && Boolean(b);
  });
  assert.ok(pressed, "botão encolhe de leve ao pressionar (scale 0.98)");
});

await step("Botão carregando fica nítido (não apagado) e bloqueia clique duplo", async () => {
  const s = await page.evaluate(() => {
    const b = document.createElement("button"); b.className = "btn btn--primary is-loading"; b.disabled = true; b.textContent = "Salvar";
    document.querySelector("#view-inicio").append(b);
    const st = getComputedStyle(b); const after = getComputedStyle(b, "::after");
    const out = { opacity: st.opacity, pointer: st.pointerEvents, spin: after.animationName };
    b.remove(); return out;
  });
  assert.equal(s.opacity, "1"); assert.equal(s.pointer, "none"); assert.equal(s.spin, "spin");
});

await step("Aviso de erro: anunciado na hora (role=alert) e fica mais tempo na tela", async () => {
  await page.evaluate(async () => { const { toast } = await import("/js/ui/toast.js"); toast("Não foi possível salvar.", "error"); });
  await page.waitForSelector(".toast--error.is-visible");
  assert.equal(await page.getAttribute(".toast--error", "role"), "alert");
  await page.waitForTimeout(3600);
  assert.equal(await page.locator(".toast--error").count(), 1, "erro ainda visível depois de 3,6 s");
});

await step("Com a tela parada, só o carregamento anima sem fim (nada rodando à toa)", async () => {
  await go(page, "conteudos"); await page.waitForTimeout(1200);
  const infinite = await page.evaluate(() => document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations === Infinity).map((a) => a.effect.target?.className || "?"));
  assert.ok(infinite.every((c) => /skeleton|is-loading|is-spinning/.test(String(c))), `animações sem fim: ${infinite.join(", ")}`);
});

await step("Movimento reduzido (preferência do sistema): sem deslocamentos, carregamento continua girando", async () => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await go(page, "gestao"); await go(page, "inicio");
  const r = await page.evaluate(() => {
    const view = getComputedStyle(document.querySelector("#view-inicio"));
    const b = document.createElement("button"); b.className = "btn btn--primary is-loading"; b.disabled = true; document.body.append(b);
    const spin = getComputedStyle(b, "::after"); const out = { view: view.animationName, spinIter: spin.animationIterationCount }; b.remove(); return out;
  });
  assert.equal(r.view, "none", "seção sem animação de entrada");
  assert.equal(r.spinIter, "infinite", "o indicador de carregamento continua");
  await page.click('[data-action="home-new-content"]');
  await page.waitForSelector("#content-modal[open]");
  assert.ok(ms(await page.$eval("#content-modal", (m) => getComputedStyle(m).animationDuration)) < 1, "janela abre sem animação");
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "no-preference" });
});

await step("Toque (celular): cartão não fica 'levantado' depois do toque e nada usa hover para funcionar", async () => {
  const phone = await newPage({ ...devices["iPhone 13"] }, "celular");
  await phone.tap(".kpi >> nth=0").catch(() => {});
  await phone.waitForTimeout(400);
  await go(phone, "inicio");
  const lifted = await phone.$eval(".kpi", (k) => getComputedStyle(k).transform);
  assert.ok(lifted === "none" || lifted === "matrix(1, 0, 0, 1, 0, 0)", `kpi ficou com ${lifted}`);
  const tap = await phone.$eval(".btn", (b) => getComputedStyle(b).webkitTapHighlightColor);
  assert.match(tap, /rgba\(0, 0, 0, 0\)|transparent/);
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(overflow <= 1, `a página passou ${overflow}px da tela`);
});

await step("Sem erros no console", async () => { assert.deepEqual(consoleErrors, []); });

await browser.close();
server.close();
console.log(`\n${results.filter((r) => r.startsWith("✔")).length}/${results.length} passos ok`);

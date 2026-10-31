/* ==========================================================================
   Criar artes (portal do cliente)
   --------------------------------------------------------------------------
   Mesmo login do portal. A identidade vem de portal_brand_kit(): o banco
   descobre o cliente pela sessão; sem identidade liberada, a página avisa.
   A arte é desenhada no navegador (engine.js) e baixada em PNG.
   ========================================================================== */

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../config.js?v=4e9810fb40";
import { createAuth } from "../lib/auth.js?v=4e9810fb40";
import { createSupabaseRepository } from "../data/supabase-repository.js?v=4e9810fb40";
import { icon, brandMark } from "../lib/icons.js?v=4e9810fb40";
import { $, esc } from "../lib/dom.js?v=4e9810fb40";
import { createEngine, FORMATS, CAMPAIGNS, STATUS, isMoney, formatPhone } from "./engine.js?v=4e9810fb40";
import { imageFromBlob, imageFromUrl, removeBackground, thumbnail } from "./photos.js?v=4e9810fb40";

const auth = createAuth({ url: SUPABASE_URL, apiKey: SUPABASE_PUBLISHABLE_KEY, kind: "cliente" });
const repo = createSupabaseRepository({ url: SUPABASE_URL, apiKey: SUPABASE_PUBLISHABLE_KEY, auth });
const UNIT_KEY = "dg-artes-unidade";

const el = { login: $("#login"), noKit: $("#no-kit"), app: $("#app"), form: $("#art-form"), canvas: $("#cv"), download: $("#baixar"), status: $("#status"), tag: $("#prev-tag") };
let engine = null, kit = null, current = null;
const photos = { oferta: { raw: null, ready: null }, plano: { raw: null, ready: null }, aviso: { raw: null, ready: null } };

/* ---------- utilidades ---------- */
const val = (id) => $(`#${id}`).value.trim();
const radio = (name) => el.form.querySelector(`input[name="${name}"]:checked`).value;
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* sem memória neste navegador */ } }
};
function say(text, error = false) { el.status.textContent = text; el.status.classList.toggle("is-error", error); }
function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((node) => { node.insertAdjacentHTML("afterbegin", icon(node.dataset.icon)); node.removeAttribute("data-icon"); });
  root.querySelectorAll('[data-slot="brand-mark"]').forEach((node) => { node.innerHTML = brandMark(); });
}
function loadLogo(url) {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return; }
    const im = new Image(); im.crossOrigin = "anonymous";
    im.onload = () => resolve(im); im.onerror = () => resolve(null); im.src = url;
  });
}
const fontsReady = () => Promise.all(["500", "600", "700", "800", "900"].map((w) => document.fonts.load(`${w} 40px Montserrat`))
  .concat([document.fonts.load("italic 800 40px Montserrat"), document.fonts.load("40px Anton"), document.fonts.load('40px "Lilita One"')])).catch(() => {});

/* ---------- formulário ---------- */
function photoField(model, { label, required, nobg }) {
  const box = el.form.querySelector(`[data-photo-field="${model}"]`);
  box.innerHTML = `
    <span class="field__label">${esc(label)} ${required ? '<span class="req">*</span>' : '<span class="field__optional">(opcional)</span>'}</span>
    <label class="art-drop" for="ph-${model}"><img alt="" hidden><span>Escolher foto do aparelho</span></label>
    <input class="visually-hidden" type="file" id="ph-${model}" accept="image/*">
    <div class="art-paste"><input class="field__input" type="text" autocomplete="off" placeholder="Ou cole aqui a imagem copiada ou o link" aria-label="Colar imagem ou link"><button class="btn btn--ghost btn--sm" type="button">Usar link</button></div>
    <span class="field__hint">Na web: clique com o botão direito na imagem, "Copiar imagem", e cole no campo acima.</span>
    ${nobg ? '<label class="check"><input type="checkbox" checked><span>Remover o fundo automaticamente</span></label>' : ""}`;
  const file = box.querySelector("input[type=file]"), link = box.querySelector(".art-paste input"), drop = box.querySelector(".art-drop"), nobgBox = box.querySelector(".check input");
  const thumb = drop.querySelector("img"), text = drop.querySelector("span");
  const apply = () => {
    const raw = photos[model].raw;
    if (!raw) return;
    photos[model].ready = nobgBox?.checked ? removeBackground(raw) : raw;
    thumb.src = thumbnail(photos[model].ready); thumb.hidden = false;
    clearError(box); stale(); preview();
  };
  const set = (im, name) => { photos[model].raw = im; text.textContent = name; apply(); };
  const fromBlob = async (blob, name) => { try { set(await imageFromBlob(blob), name); } catch (error) { say(error.message, true); } };
  const fromUrl = async (url) => {
    say("Buscando a imagem…");
    try { set(await imageFromUrl(url), "Imagem da web"); link.value = ""; say("Imagem carregada."); } catch (error) { say(error.message, true); }
  };
  file.addEventListener("change", () => { if (file.files[0]) fromBlob(file.files[0], file.files[0].name); });
  link.addEventListener("paste", (event) => {
    const item = [...(event.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (item) { event.preventDefault(); fromBlob(item.getAsFile(), "Imagem colada"); return; }
    const txt = event.clipboardData?.getData("text")?.trim();
    if (txt && /^https?:\/\//i.test(txt)) { event.preventDefault(); link.value = txt; fromUrl(txt); }
  });
  link.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); fromUrl(link.value); } });
  box.querySelector(".art-paste button").addEventListener("click", () => fromUrl(link.value));
  drop.addEventListener("dragover", (event) => { event.preventDefault(); drop.classList.add("is-over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
  drop.addEventListener("drop", (event) => {
    event.preventDefault(); drop.classList.remove("is-over");
    const f = [...event.dataTransfer.files].find((x) => x.type.startsWith("image/"));
    if (f) { fromBlob(f, f.name); return; }
    const url = (event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain") || "").split("\n")[0];
    if (url) fromUrl(url);
  });
  nobgBox?.addEventListener("change", apply);
  return { fromBlob };
}

function buildUnits() {
  const units = engine.units;
  const select = $("#unidade");
  select.innerHTML = units.map((u) => `<option value="${esc(u.id)}">${esc([u.marca, u.nome].filter(Boolean).join(" · "))}</option>`).join("");
  const saved = store.get(UNIT_KEY);
  if (units.some((u) => u.id === saved)) select.value = saved;
  $("#box-unit").hidden = units.length <= 1;
  $("#a-units").innerHTML = units.map((u) => `
    <div class="art-unit">
      <span class="art-unit__name">${esc(u.nome)}</span>
      <label class="field"><span class="field__label">Situação</span><select class="field__input" data-unit-status="${esc(u.id)}">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select></label>
      <label class="field"><span class="field__label">Horário</span><input class="field__input" data-unit-hours="${esc(u.id)}" maxlength="22" placeholder="Ex.: 9h às 18h"></label>
    </div>`).join("");
  showContact();
}
function showContact() {
  const u = engine.units.find((x) => x.id === $("#unidade").value);
  $("#unit-contact").textContent = u ? [u.endereco, u.whatsapp ? `WhatsApp ${formatPhone(u.whatsapp)}` : ""].filter(Boolean).join(" · ") : "";
}
function buildCampaigns() {
  const list = kit.campaigns.filter((c) => CAMPAIGNS[c]);
  if (!list.includes("padrao")) list.unshift("padrao");
  $("#tema").innerHTML = list.map((c) => `<option value="${c}">${esc(CAMPAIGNS[c].label)}</option>`).join("");
}
function campaignDefaults(force) {
  const c = CAMPAIGNS[$("#tema").value] || CAMPAIGNS.padrao, model = radio("modelo");
  const pair = model === "plano" ? [c.plano[0], c.plano[1] || kit.client] : c.titulo;
  if (force || $("#c-nome").dataset.touched !== "1") { $("#c-chamada").value = pair[0]; $("#c-nome").value = pair[1]; }
}
function example() {
  const t = new Date(); t.setDate(t.getDate() + 30);
  const iso = t.toISOString().slice(0, 10);
  $("#o-validade").value = iso; $("#p-validade").value = iso;
  $("#a-selo").value = "Aproveite o"; $("#a-titulo").value = "Feriadão"; $("#a-cta").value = "Faça sua reserva:";
}

function read() {
  const d = { unidade: $("#unidade").value, modelo: radio("modelo"), formato: radio("formato"), tema: $("#tema").value, chamada: val("c-chamada"), nome: val("c-nome") };
  if (d.modelo === "oferta") Object.assign(d, { produto: val("o-produto"), de: val("o-de"), por: val("o-por"), selo: $("#o-selo").value, validade: $("#o-validade").value, extra: val("o-extra"), photo: photos.oferta.ready });
  if (d.modelo === "plano") Object.assign(d, { tipo: $("#p-tipo").value, validade: $("#p-validade").value, titulo: val("p-titulo"), detalhe: val("p-detalhe"), brinde: val("p-brinde"), modo: radio("p-modo"), valor: val("p-valor"), photo: photos.plano.ready });
  if (d.modelo === "aviso") Object.assign(d, {
    selo: val("a-selo"), titulo: val("a-titulo"), sub: val("a-sub"), destaque: val("a-destaque"), retorno: val("a-retorno"), cta: val("a-cta"), photo: photos.aviso.ready,
    units: engine.units.map((u) => ({ nome: u.nome, status: el.form.querySelector(`[data-unit-status="${CSS.escape(u.id)}"]`).value, horario: el.form.querySelector(`[data-unit-hours="${CSS.escape(u.id)}"]`).value.trim() }))
  });
  return d;
}
/** Texto de exemplo quando o campo ainda está vazio (só na prévia) */
function withPlaceholders(d) {
  const x = { ...d };
  if (x.modelo === "oferta") { x.produto ||= "Nome do produto"; x.por ||= "99,90"; }
  if (x.modelo === "plano") { x.titulo ||= "Nome do plano"; x.valor ||= x.modo === "desconto" ? "10" : "199,90"; }
  if (x.modelo === "aviso") { x.selo ||= "Aviso"; x.titulo ||= "Título"; }
  x.nome ||= " ";
  return x;
}

function clearError(field) { field.classList.remove("is-invalid"); field.querySelector(".art-error")?.remove(); }
function validate(d) {
  el.form.querySelectorAll(".field.is-invalid").forEach(clearError);
  const bad = [];
  const check = (node, wrong) => {
    const field = node.closest("[data-req]");
    if (!wrong || !field) return;
    field.classList.add("is-invalid");
    field.insertAdjacentHTML("beforeend", `<span class="art-error">${esc(field.dataset.req)}</span>`);
    bad.push(field);
  };
  if (d.modelo !== "aviso") check($("#c-nome"), !d.nome);
  if (d.modelo === "oferta") { check(el.form.querySelector('[data-photo-field="oferta"]'), !d.photo); check($("#o-produto"), !d.produto); check($("#o-por"), !isMoney(d.por)); check($("#o-validade"), !d.validade); }
  if (d.modelo === "plano") { check(el.form.querySelector('[data-photo-field="plano"]'), !d.photo); check($("#p-titulo"), !d.titulo); check($("#p-validade"), !d.validade); check($("#p-valor"), d.modo === "desconto" ? !/\d/.test(d.valor) : !isMoney(d.valor)); }
  if (d.modelo === "aviso") { check($("#a-selo"), !d.selo); check($("#a-titulo"), !d.titulo); check($("#a-units"), d.units.every((u) => u.status === "oculto")); }
  return bad;
}

function preview() { engine.render(el.canvas, withPlaceholders(read()), 1); }
function stale() {
  if (!current) return;
  current = null; el.download.disabled = true; el.tag.textContent = "Prévia";
  say("Você mudou o formulário. Toque em Gerar arte de novo.");
}
function switchModel() {
  const m = radio("modelo");
  ["oferta", "plano", "aviso"].forEach((k) => { $(`#sec-${k}`).hidden = m !== k; });
  $("#camp-row").hidden = m === "aviso";
  campaignDefaults(false);
}

function wire() {
  const pickers = {
    oferta: photoField("oferta", { label: "Foto do produto", required: true, nobg: true }),
    plano: photoField("plano", { label: "Foto", required: true, nobg: false }),
    aviso: photoField("aviso", { label: "Foto de pet", required: false, nobg: true })
  };
  ["c-nome", "c-chamada"].forEach((id) => $(`#${id}`).addEventListener("input", () => { $("#c-nome").dataset.touched = "1"; }));
  el.form.querySelectorAll('input[name="p-modo"]').forEach((r) => r.addEventListener("change", () => {
    const pct = radio("p-modo") === "desconto";
    $("#p-valor-lbl").innerHTML = `${pct ? "Desconto (%)" : "Preço (R$)"} <span class="req">*</span>`;
    $("#p-valor").placeholder = pct ? "Ex.: 25" : "Ex.: 1.700,00";
  }));
  el.form.addEventListener("change", (event) => {
    const t = event.target;
    if (t.type === "file" || t.type === "checkbox" || t.closest(".art-paste")) return;
    if (t.name === "modelo") switchModel();
    if (t.id === "tema") campaignDefaults(false);
    if (t.id === "unidade") { store.set(UNIT_KEY, t.value); showContact(); }
    if (t.name === "formato" && current) { current = read(); engine.render(el.canvas, current, 1); return; }
    stale(); preview();
  });
  let timer = null;
  el.form.addEventListener("input", (event) => {
    const t = event.target;
    if (t.type === "file" || t.type === "radio" || t.type === "checkbox" || t.tagName === "SELECT" || t.closest(".art-paste")) return;
    t.closest(".field.is-invalid") && clearError(t.closest(".field.is-invalid"));
    stale(); clearTimeout(timer); timer = setTimeout(preview, 250);
  });
  // Colar uma imagem fora dos campos de texto vai para a foto do modelo aberto
  document.addEventListener("paste", (event) => {
    const t = event.target;
    if (event.defaultPrevented || (t && (t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && t.type === "text")))) return;
    const item = [...(event.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (!item) return;
    event.preventDefault();
    pickers[radio("modelo")].fromBlob(item.getAsFile(), "Imagem colada");
  });
  el.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const d = read(), bad = validate(d);
    if (bad.length) {
      say(`Falta${bad.length > 1 ? "m" : ""} ${bad.length} ${bad.length > 1 ? "campos obrigatórios" : "campo obrigatório"}. Veja o que está marcado.`, true);
      bad[0].scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    engine.render(el.canvas, d, 1);
    current = d; el.download.disabled = false; el.tag.textContent = "Pronta para baixar";
    say("Arte gerada. Confira a prévia e toque em Baixar imagem.");
    if (window.matchMedia("(max-width: 960px)").matches) el.canvas.scrollIntoView({ block: "start", behavior: "smooth" });
  });
  el.download.addEventListener("click", async () => {
    if (!current) return;
    const out = document.createElement("canvas");
    engine.render(out, current, FORMATS[current.formato].exp);
    const blob = await new Promise((resolve) => out.toBlob(resolve, "image/png"));
    if (!blob) { say("Não foi possível criar a imagem. Tente de novo.", true); return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${current.modelo}-${current.formato}-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    say("Imagem baixada.");
  });
}

/* ---------- entrada ---------- */
function showLogin(message = "") {
  el.app.hidden = true; el.noKit.hidden = true; el.login.hidden = false;
  const box = el.login.querySelector(".form-error");
  box.textContent = message; box.hidden = !message;
  el.login.querySelector("[name=username]").focus();
}

async function enter() {
  try {
    kit = await repo.getBrandKit();
  } catch (error) {
    if (error.reason === "session") { showLogin(error.message); return; }
    showLogin(error.message);
    return;
  }
  el.login.hidden = true;
  if (!kit) { el.noKit.hidden = false; return; }
  const [logos] = await Promise.all([
    Promise.all(["emblema", "principal", "alternativo"].map((k) => loadLogo(kit.logos[k]))).then(([emblema, principal, alternativo]) => ({ emblema, principal, alternativo })),
    fontsReady()
  ]);
  engine = createEngine({ kit, logos });
  if (!engine.units.length) engine.units.push({ id: "unica", nome: kit.client, marca: kit.client, whatsapp: "", logo: "principal" });
  $("#art-client").innerHTML = `${kit.logos.emblema ? `<img src="${esc(kit.logos.emblema)}" alt="">` : ""}<span>${esc(kit.client)}</span>`;
  buildUnits(); buildCampaigns(); example();
  if (!wire.done) { wire(); wire.done = true; }
  switchModel();
  el.app.hidden = false;
  document.title = `Criar artes · ${kit.client}`;
  say("A prévia mostra um exemplo. Preencha os campos e toque em Gerar arte.");
  preview();
}

el.login.querySelector("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget, button = form.querySelector("[type=submit]");
  button.disabled = true;
  try {
    await auth.signIn(form.elements.username.value, form.elements.password.value);
    form.reset();
    await enter();
  } catch (error) {
    showLogin(error.message);
  } finally {
    button.disabled = false;
  }
});
document.addEventListener("click", async (event) => {
  if (!event.target.closest('[data-action="sign-out"]')) return;
  await auth.signOut();
  showLogin("Você saiu.");
});

hydrateIcons();
document.body.classList.add("is-ready");
if (auth.session) enter(); else showLogin();

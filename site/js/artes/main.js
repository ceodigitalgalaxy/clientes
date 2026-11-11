/* ==========================================================================
   Criar artes (portal do cliente)
   --------------------------------------------------------------------------
   Mesmo login do portal. A identidade vem de portal_brand_kit(): o banco
   descobre o cliente pela sessão; sem identidade liberada, a página avisa.
   A arte é desenhada no navegador (engine.js) e baixada em PNG.
   ========================================================================== */

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../config.js?v=476ab22dd7";
import { createAuth } from "../lib/auth.js?v=476ab22dd7";
import { createSupabaseRepository } from "../data/supabase-repository.js?v=476ab22dd7";
import { icon, brandMark } from "../lib/icons.js?v=476ab22dd7";
import { $, esc } from "../lib/dom.js?v=476ab22dd7";
import { createEngine, FORMATS, CAMPAIGNS, STATUS, MODELS, STYLES, isMoney, formatPhone } from "./engine.js?v=476ab22dd7";
import { imageFromBlob, imageFromUrl, removeBackgroundSmart, thumbnail } from "./photos.js?v=476ab22dd7";

const auth = createAuth({ url: SUPABASE_URL, apiKey: SUPABASE_PUBLISHABLE_KEY, kind: "cliente" });
const repo = createSupabaseRepository({ url: SUPABASE_URL, apiKey: SUPABASE_PUBLISHABLE_KEY, auth });
const UNIT_KEY = "dg-artes-unidade";
const STYLE_KEY = "dg-artes-estilo";

const el = { login: $("#login"), noKit: $("#no-kit"), app: $("#app"), form: $("#art-form"), canvas: $("#cv"), download: $("#baixar"), status: $("#status"), tag: $("#prev-tag") };
let engine = null, kit = null, current = null;
const photos = Object.fromEntries(["oferta", "plano", "aviso", "evento", "antes", "depois", "frase"].map((k) => [k, { raw: null, ready: null, shadow: true }]));
let pickers = {};

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

/* ---------- produto vindo de uma loja ---------- */
/** Preço em reais (aceita 189.9, 189,90, 1.299,90) */
function toBRL(value) {
  let s = String(value || "").trim().replace(/[^\d.,]/g, "");
  if (!s) return "";
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
}
/**
 * Botão de favoritos "Enviar para o gerador": roda na página da loja que a pessoa está vendo
 * (lê o que já está na tela dela: dados de produto da página ou as etiquetas de compartilhamento)
 * e abre o gerador com esses dados no endereço (#produto=...). Nada é enviado para servidor.
 */
function bookmarklet(origin) {
  const code = `(()=>{try{const q=s=>document.querySelector(s);const m=n=>(q('meta[property="'+n+'"]')||q('meta[name="'+n+'"]')||{}).content||'';let p={};const w=o=>{if(!o||typeof o!=='object')return;if(Array.isArray(o)){o.forEach(w);return}const t=[].concat(o['@type']||[]).map(String);if(!p.name&&t.some(x=>/Product/i.test(x)))p=o;Object.values(o).forEach(v=>{if(v&&typeof v==='object')w(v)})};document.querySelectorAll('script[type="application/ld+json"]').forEach(s=>{try{w(JSON.parse(s.textContent))}catch(e){}});const of=[].concat(p.offers||[]).flatMap(o=>[o].concat((o&&o.offers)||[]));const pr=of.map(o=>o&&(o.price||o.lowPrice)).find(Boolean)||m('product:price:amount');const ip=[].concat(p.image||[])[0];let im=(ip&&(ip.url||ip))||m('og:image');try{im=new URL(im,location.href).href}catch(e){im=''}const d={nome:p.name||m('og:title')||document.title,descricao:String(p.description||m('og:description')||'').replace(/<[^>]+>/g,' ').slice(0,300),preco:String(pr||''),imagem:im,site:location.hostname};window.open('${origin}/artes/#produto='+encodeURIComponent(JSON.stringify(d)),'_blank')}catch(e){alert('Não foi possível ler esta página.')}})()`;
  return `javascript:${code}`;
}
/** Dados do produto que chegaram pelo endereço (#produto=...), conferidos e limpos */
function productFromHash() {
  const m = location.hash.match(/^#produto=(.+)$/);
  if (!m) return null;
  history.replaceState(null, "", location.pathname + location.search);
  let data;
  try { data = JSON.parse(decodeURIComponent(m[1])); } catch { return null; }
  const str = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
  const imagem = str(data?.imagem, 2000);
  return { nome: str(data?.nome, 90), descricao: str(data?.descricao, 140), preco: toBRL(str(data?.preco, 20)), precoAntigo: "", imagem: /^https:\/\//i.test(imagem) ? imagem : "", site: str(data?.site, 60) };
}
/** Preenche a Oferta com os dados de um produto (do link ou do botão de favoritos) */
async function fillProduct(p) {
  const offer = el.form.querySelector('input[name="modelo"][value="oferta"]');
  if (!offer) { say("O modelo Oferta não está liberado para a sua empresa.", true); return; }
  if (!offer.checked) { offer.checked = true; switchModel(); }
  if (p.nome) $("#o-produto").value = p.nome.slice(0, 90);
  if (p.descricao) $("#o-desc").value = p.descricao.slice(0, 140);
  if (p.preco) $("#o-por").value = p.preco;
  if (p.precoAntigo) $("#o-de").value = p.precoAntigo;
  if (p.imagem) await pickers.oferta.fromUrl(p.imagem);
  stale(); preview();
  say(`Dados de ${p.site || "a loja"} preenchidos. Confira o preço antes de gerar.`);
}

/* ---------- formulário ---------- */
/** Imagem de um link: pelo servidor (ler-produto), senão direto/repassada */
async function loadWebImage(url) {
  try { return await imageFromBlob(await repo.productImage(url)); } catch { return imageFromUrl(url); }
}
function photoField(model, { label, required, nobg }) {
  const box = el.form.querySelector(`[data-photo-field="${model}"]`);
  box.innerHTML = `
    <span class="field__label">${esc(label)} ${required ? '<span class="req">*</span>' : '<span class="field__optional">(opcional)</span>'}</span>
    <label class="art-drop" for="ph-${model}"><img alt="" hidden><span>Escolher foto do aparelho</span></label>
    <input class="visually-hidden" type="file" id="ph-${model}" accept="image/*">
    <div class="art-paste"><input class="field__input" type="text" autocomplete="off" placeholder="Ou cole aqui a imagem copiada ou o link" aria-label="Colar imagem ou link"><button class="btn btn--ghost btn--sm" type="button">Usar link</button></div>
    <span class="field__hint">Na web: clique com o botão direito na imagem, "Copiar imagem", e cole no campo acima.</span>
    ${nobg ? '<span class="art-checks"><label class="check"><input type="checkbox" data-nobg checked><span>Remover o fundo automaticamente</span></label><label class="check"><input type="checkbox" data-shadow checked><span>Sombra no recorte</span></label></span>' : ""}`;
  const file = box.querySelector("input[type=file]"), link = box.querySelector(".art-paste input"), drop = box.querySelector(".art-drop"), nobgBox = box.querySelector("[data-nobg]"), shadowBox = box.querySelector("[data-shadow]");
  const thumb = drop.querySelector("img"), text = drop.querySelector("span");
  let job = 0;
  const apply = async () => {
    const raw = photos[model].raw;
    if (!raw) return;
    const mine = ++job;
    if (nobgBox?.checked) {
      say("Tirando o fundo da foto… (na primeira vez pode levar alguns segundos)");
      const cut = await removeBackgroundSmart(raw);
      if (mine !== job) return;   // outra foto foi escolhida enquanto isso
      photos[model].ready = cut;
      say("Fundo removido. Confira a prévia.");
    } else photos[model].ready = raw;
    thumb.src = thumbnail(photos[model].ready); thumb.hidden = false;
    clearError(box); stale(); preview();
  };
  const set = (im, name) => { photos[model].raw = im; text.textContent = name; return apply(); };
  const fromBlob = async (blob, name) => { try { await set(await imageFromBlob(blob), name); } catch (error) { say(error.message, true); } };
  const fromUrl = async (url) => {
    say("Buscando a imagem…");
    try { await set(await loadWebImage(url), "Imagem da web"); link.value = ""; } catch (error) { say(error.message, true); }
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
  shadowBox?.addEventListener("change", () => { photos[model].shadow = shadowBox.checked; stale(); preview(); });
  return { fromBlob, fromUrl };
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
function buildModels() {
  const list = (kit.models || []).filter((m) => MODELS[m]);
  const models = list.length ? list : ["oferta", "plano", "aviso"];
  $("#model-seg").innerHTML = models.map((m, i) => `<input type="radio" name="modelo" id="m-${m}" value="${m}"${i === 0 ? " checked" : ""}><label for="m-${m}">${esc(MODELS[m].label)}<small>${esc(MODELS[m].hint)}</small></label>`).join("");
  $("#model-seg").hidden = models.length === 1;
}
function buildStyles() {
  $("#estilo").innerHTML = Object.entries(STYLES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
  const saved = store.get(STYLE_KEY);
  if (STYLES[saved]) $("#estilo").value = saved;
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
  $("#e-cta").value = "Garanta sua vaga:"; $("#d-cta").value = "Agende o seu:"; $("#f-tipo").value = "Dica do dia";
}

function read() {
  const d = { unidade: $("#unidade").value, modelo: radio("modelo"), formato: radio("formato"), tema: $("#tema").value, estilo: $("#estilo").value, chamada: val("c-chamada"), nome: val("c-nome") };
  if (d.modelo === "oferta") Object.assign(d, { produto: val("o-produto"), de: val("o-de"), por: val("o-por"), selo: $("#o-selo").value, validade: $("#o-validade").value, extra: val("o-extra"), photo: photos.oferta.ready });
  if (d.modelo === "plano") Object.assign(d, { tipo: $("#p-tipo").value, validade: $("#p-validade").value, titulo: val("p-titulo"), detalhe: val("p-detalhe"), brinde: val("p-brinde"), modo: radio("p-modo"), valor: val("p-valor"), photo: photos.plano.ready });
  if (d.modelo === "aviso") Object.assign(d, {
    selo: val("a-selo"), titulo: val("a-titulo"), sub: val("a-sub"), destaque: val("a-destaque"), retorno: val("a-retorno"), cta: val("a-cta"), photo: photos.aviso.ready,
    units: engine.units.map((u) => ({ nome: u.nome, status: el.form.querySelector(`[data-unit-status="${CSS.escape(u.id)}"]`).value, horario: el.form.querySelector(`[data-unit-hours="${CSS.escape(u.id)}"]`).value.trim() }))
  });
  if (d.modelo === "oferta") Object.assign(d, { descricao: val("o-desc"), shadow: photos.oferta.shadow, composicao: $("#o-comp").value });
  if (d.modelo === "aviso") d.shadow = photos.aviso.shadow;
  if (d.modelo === "evento") Object.assign(d, { chamada: val("e-chamada"), titulo: val("e-titulo"), data: val("e-data"), horario: val("e-horario"), local: val("e-local"), descricao: val("e-desc"), cta: val("e-cta"), photo: photos.evento.ready });
  if (d.modelo === "antesdepois") Object.assign(d, { chamada: val("d-chamada"), titulo: val("d-titulo"), descricao: val("d-desc"), cta: val("d-cta"), photo: photos.antes.ready, photo2: photos.depois.ready });
  if (d.modelo === "frase") Object.assign(d, { tipo: val("f-tipo"), texto: val("f-texto"), autor: val("f-autor"), detalhe: val("f-detalhe"), photo: photos.frase.ready });
  return d;
}
/** Texto de exemplo quando o campo ainda está vazio (só na prévia) */
function withPlaceholders(d) {
  const x = { ...d };
  if (x.modelo === "oferta") { x.produto ||= "Nome do produto"; x.por ||= "99,90"; }
  if (x.modelo === "plano") { x.titulo ||= "Nome do plano"; x.valor ||= x.modo === "desconto" ? "10" : "199,90"; }
  if (x.modelo === "aviso") { x.selo ||= "Aviso"; x.titulo ||= "Título"; }
  if (x.modelo === "evento") { x.titulo ||= "Título do evento"; if (!x.data && !x.horario && !x.local) { x.data = "Data"; x.horario = "Horário"; } }
  if (x.modelo === "antesdepois") x.titulo ||= "Resultado";
  if (x.modelo === "frase") x.texto ||= "Escreva aqui a frase, a dica ou o depoimento do seu cliente.";
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
  if (["oferta", "plano"].includes(d.modelo)) check($("#c-nome"), !d.nome);
  if (d.modelo === "evento") check($("#e-titulo"), !d.titulo);
  if (d.modelo === "antesdepois") { check(el.form.querySelector('[data-photo-field="antes"]'), !d.photo); check(el.form.querySelector('[data-photo-field="depois"]'), !d.photo2); check($("#d-titulo"), !d.titulo); }
  if (d.modelo === "frase") check($("#f-texto"), !d.texto);
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
  Object.keys(MODELS).forEach((k) => { $(`#sec-${k}`).hidden = m !== k; });
  $("#camp-row").hidden = !["oferta", "plano"].includes(m);
  campaignDefaults(false);
}

function wire() {
  pickers = {
    oferta: photoField("oferta", { label: "Foto do produto", required: true, nobg: true }),
    plano: photoField("plano", { label: "Foto", required: true, nobg: false }),
    aviso: photoField("aviso", { label: "Foto sem fundo", required: false, nobg: true }),
    evento: photoField("evento", { label: "Foto (professor, convidado, lugar)", required: false, nobg: false }),
    antes: photoField("antes", { label: "Foto do antes", required: true, nobg: false }),
    depois: photoField("depois", { label: "Foto do depois", required: true, nobg: false }),
    frase: photoField("frase", { label: "Foto de quem disse", required: false, nobg: false })
  };
  // Link do produto: nome, descrição, preço e foto preenchidos sozinhos
  const fetchProduct = async () => {
    const link = val("o-link");
    if (!/^https?:\/\//i.test(link)) { say("Cole o link da página do produto (começa com http).", true); return; }
    const button = $("#o-buscar"); button.disabled = true; say("Lendo a página do produto…");
    try {
      await fillProduct(await repo.readProduct(link));
    } catch (error) {
      say(error.message || "Não deu para ler esse link. Preencha à mão.", true);
    } finally { button.disabled = false; }
  };
  $("#o-buscar").addEventListener("click", fetchProduct);
  const mark = $("#bookmarklet");
  mark.href = bookmarklet(location.origin);
  mark.addEventListener("click", (event) => { event.preventDefault(); say("Arraste esse botão para a barra de favoritos. Ele funciona na página do produto, na loja."); });
  window.addEventListener("hashchange", () => { const p = productFromHash(); if (p && engine) fillProduct(p); });
  $("#o-link").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); fetchProduct(); } });
  ["c-nome", "c-chamada"].forEach((id) => $(`#${id}`).addEventListener("input", () => { $("#c-nome").dataset.touched = "1"; }));
  el.form.querySelectorAll('input[name="p-modo"]').forEach((r) => r.addEventListener("change", () => {
    const pct = radio("p-modo") === "desconto";
    $("#p-valor-lbl").innerHTML = `${pct ? "Desconto (%)" : "Preço (R$)"} <span class="req">*</span>`;
    $("#p-valor").placeholder = pct ? "Ex.: 25" : "Ex.: 1.700,00";
  }));
  el.form.addEventListener("change", (event) => {
    const t = event.target;
    if (t.type === "file" || t.type === "checkbox" || t.closest(".art-paste") || t.id === "o-link") return;
    if (t.name === "modelo") switchModel();
    if (t.id === "tema") campaignDefaults(false);
    if (t.id === "unidade") { store.set(UNIT_KEY, t.value); showContact(); }
    if (t.id === "estilo") store.set(STYLE_KEY, t.value);
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
    const target = { antesdepois: "antes" }[radio("modelo")] || radio("modelo");
    pickers[target].fromBlob(item.getAsFile(), "Imagem colada");
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
  buildUnits(); buildModels(); buildStyles(); buildCampaigns(); example();
  if (!wire.done) { wire(); wire.done = true; }
  switchModel();
  el.app.hidden = false;
  document.title = `Criar artes · ${kit.client}`;
  say("A prévia mostra um exemplo. Preencha os campos e toque em Gerar arte.");
  const incoming = productFromHash();
  preview();
  if (incoming) fillProduct(incoming);
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

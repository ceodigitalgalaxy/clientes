/* Identidade do cliente para o gerador de artes (logos, cores, unidades e campanhas).
   Abre pelo botão "Identidade para artes" do cartão do cliente. */

import { $, esc, on } from "../../../js/lib/dom.js?v=887272bbb7";
import { icon } from "../../../js/lib/icons.js?v=887272bbb7";
import { BRAND_COLORS, BRAND_CAMPAIGNS, BRAND_LOGO_SLOTS, BRAND_MODELS } from "../domain/rules.js?v=887272bbb7";
import { closeDialog, wireDialog, showFieldErrors, setBusy } from "../ui/dialogs.js?v=887272bbb7";

const DEFAULT_COLORS = { primaria: "#06603A", secundaria: "#A9CF45", preco: "#F28C00", alerta: "#E53935", titulo: "#F59E0B" };
const MAX_UNITS = 12;

export function setupBrand({ api, state, toast }) {
  const dialog = $("#brand-modal");
  const form = dialog.querySelector("form");
  const submit = form.querySelector("[type=submit]");
  const logosBox = form.querySelector("[data-brand-logos]");
  const unitsBox = form.querySelector("[data-brand-units]");
  let client = null;
  let logos = {};        // caminhos salvos no banco
  let pending = {};      // arquivos escolhidos agora (slot → File)
  let removed = new Set();
  let previews = [];
  let saving = false;

  wireDialog(dialog, { canClose: () => !saving });
  dialog.addEventListener("close", () => { previews.forEach((u) => URL.revokeObjectURL(u)); previews = []; });

  form.querySelector("[data-brand-colors]").innerHTML = Object.entries(BRAND_COLORS).map(([key, label]) => `
    <label class="brand-color field">
      <input type="color" name="color_${key}" value="${DEFAULT_COLORS[key]}">
      <span>${esc(label)}</span>
    </label>`).join("");
  form.querySelector("[data-brand-models]").innerHTML = Object.entries(BRAND_MODELS).map(([key, label]) => `
    <label class="check"><input type="checkbox" name="model" value="${key}"${["oferta", "plano", "aviso"].includes(key) ? " checked" : ""}><span>${esc(label)}</span></label>`).join("");
  form.querySelector("[data-brand-campaigns]").innerHTML = Object.entries(BRAND_CAMPAIGNS).map(([key, label]) => `
    <label class="check"><input type="checkbox" name="campaigns" value="${key}"${key === "padrao" ? " checked disabled" : ""}><span>${esc(label)}</span></label>`).join("");

  function renderLogos() {
    logosBox.innerHTML = Object.entries(BRAND_LOGO_SLOTS).map(([slot, label]) => {
      const file = pending[slot];
      let src = null;
      if (file) { src = URL.createObjectURL(file); previews.push(src); }
      else if (logos[slot] && !removed.has(slot)) src = api.logoUrl(logos[slot]);
      return `
        <div class="brand-logo field">
          <span class="brand-logo__preview">${src ? `<img src="${esc(src)}" alt="">` : icon("image")}</span>
          <span class="brand-logo__label">${esc(label)}</span>
          <label class="btn btn--ghost btn--sm logo-picker__choose">
            <input class="visually-hidden" type="file" name="logo_${slot}" accept="image/png,image/webp,image/jpeg" data-slot="${slot}">
            <span>${icon("image")}${src ? "Trocar" : "Escolher"}</span>
          </label>
          ${src ? `<button class="link-btn link-btn--danger" type="button" data-remove-logo="${slot}">Tirar</button>` : ""}
        </div>`;
    }).join("");
  }

  function unitRow(u = {}, i = 0) {
    return `
      <fieldset class="brand-unit" data-unit>
        <legend class="visually-hidden">Unidade ${i + 1}</legend>
        <label class="field"><span class="field__label">Nome da unidade</span><input class="field__input" name="unit_${i}_nome" maxlength="60" value="${esc(u.nome || "")}" placeholder="Ex.: Nilo Peçanha"></label>
        <label class="field"><span class="field__label">Marca</span><input class="field__input" name="unit_${i}_marca" maxlength="60" value="${esc(u.marca || "")}" placeholder="Ex.: Santuário Pet Center"></label>
        <label class="field"><span class="field__label">Endereço</span><input class="field__input" name="unit_${i}_endereco" maxlength="120" value="${esc(u.endereco || "")}"></label>
        <label class="field"><span class="field__label">WhatsApp</span><input class="field__input" name="unit_${i}_whatsapp" inputmode="tel" maxlength="20" value="${esc(u.whatsapp || "")}" placeholder="51999999999"></label>
        <label class="field"><span class="field__label">Logo nas artes</span><select class="field__input" name="unit_${i}_logo"><option value="principal">Principal</option><option value="alternativo"${u.logo === "alternativo" ? " selected" : ""}>Alternativo</option></select></label>
        <button class="icon-btn icon-btn--danger brand-unit__remove" type="button" data-remove-unit aria-label="Tirar esta unidade" title="Tirar">${icon("trash")}</button>
      </fieldset>`;
  }
  /** Lê as unidades da tela (na ordem) */
  const readUnits = () => [...unitsBox.querySelectorAll("[data-unit]")].map((row) => {
    const get = (k) => row.querySelector(`[name$="_${k}"]`).value;
    return { nome: get("nome"), marca: get("marca"), endereco: get("endereco"), whatsapp: get("whatsapp"), logo: get("logo") };
  });
  function renderUnits(units) {
    unitsBox.innerHTML = units.map((u, i) => unitRow(u, i)).join("");
    form.querySelector('[data-action="add-unit"]').hidden = units.length >= MAX_UNITS;
  }

  async function open(target) {
    client = target;
    pending = {}; removed = new Set(); logos = {};
    form.reset();
    showFieldErrors(form, {});
    dialog.querySelector("[data-brand-client]").textContent = `${client.name}: as artes do portal usam estas cores, logos e unidades.`;
    renderLogos(); renderUnits([{}]);
    dialog.showModal();
    setBusy(submit, true);
    try {
      const kit = await api.brandKit(client.id);
      if (kit) {
        logos = kit.logos || {};
        form.elements.enabled.checked = kit.enabled !== false;
        Object.keys(BRAND_COLORS).forEach((key) => { if (kit.colors?.[key]) form.elements[`color_${key}`].value = kit.colors[key].toLowerCase(); });
        form.querySelectorAll('[name="campaigns"]').forEach((box) => { box.checked = box.value === "padrao" || (kit.campaigns || []).includes(box.value); });
        form.elements.legal.value = kit.legal || "";
        if (Array.isArray(kit.models)) form.querySelectorAll('[name="model"]').forEach((box) => { box.checked = kit.models.includes(box.value); });
        renderUnits(kit.units?.length ? kit.units : [{}]);
        renderLogos();
      }
    } catch (error) {
      showFieldErrors(form, {}, error.message);
    } finally {
      setBusy(submit, false);
    }
  }

  on(logosBox, "change", "input[type=file]", (event, input) => {
    const file = input.files?.[0];
    if (!file) return;
    pending[input.dataset.slot] = file;
    removed.delete(input.dataset.slot);
    renderLogos();
  });
  on(logosBox, "click", "[data-remove-logo]", (event, btn) => {
    delete pending[btn.dataset.removeLogo];
    removed.add(btn.dataset.removeLogo);
    renderLogos();
  });
  on(form, "click", '[data-action="add-unit"]', () => { renderUnits([...readUnits(), {}]); unitsBox.querySelector("[data-unit]:last-child input")?.focus(); });
  on(unitsBox, "click", "[data-remove-unit]", (event, btn) => {
    const rows = [...unitsBox.querySelectorAll("[data-unit]")];
    const units = readUnits().filter((u, i) => rows[i] !== btn.closest("[data-unit]"));
    renderUnits(units.length ? units : [{}]);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!client) return;
    saving = true;
    setBusy(submit, true);
    const uploaded = [];
    try {
      const next = { ...logos };
      removed.forEach((slot) => { delete next[slot]; });
      for (const [slot, file] of Object.entries(pending)) {
        const path = await api.uploadBrandLogo(client, slot, file);
        uploaded.push(path);
        next[slot] = path;
      }
      const colors = {};
      Object.keys(BRAND_COLORS).forEach((key) => { colors[key] = form.elements[`color_${key}`].value; });
      await api.saveBrandKit(client, {
        enabled: form.elements.enabled.checked,
        colors,
        logos: next,
        units: readUnits(),
        campaigns: [...form.querySelectorAll('[name="campaigns"]:checked')].map((box) => box.value),
        models: [...form.querySelectorAll('[name="model"]:checked')].map((box) => box.value),
        legal: form.elements.legal.value
      });
      // Arquivos que saíram da identidade
      const old = Object.entries(logos).filter(([slot, path]) => next[slot] !== path).map(([, path]) => path);
      await api.removeBrandFiles(old);
      saving = false;
      closeDialog(dialog);
      toast("Identidade para artes salva");
    } catch (error) {
      await api.removeBrandFiles(uploaded).catch(() => {});
      showFieldErrors(form, error.fields || {}, error.message);
    } finally {
      saving = false;
      setBusy(submit, false);
    }
  });

  on(document, "click", "[data-brand-client-id]", (event, btn) => {
    const target = state.clients.find((c) => c.id === btn.dataset.brandClientId);
    if (target) open(target);
  });

  return { open };
}

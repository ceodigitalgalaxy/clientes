/* Janelas do painel: abrir/fechar com a mesma animação do portal,
   confirmação antes de excluir e erros de formulário campo a campo. */

import { reduceMotion, esc } from "../../../js/lib/dom.js?v=fd0ca6eef6";
import { icon } from "../../../js/lib/icons.js?v=fd0ca6eef6";

export function closeDialog(dialog) {
  if (!dialog.open) return;
  if (reduceMotion()) { dialog.close(); return; }
  dialog.classList.add("is-closing");
  setTimeout(() => { dialog.classList.remove("is-closing"); dialog.close(); }, 220);
}

/** Fecha no fundo escuro, no Esc e nos botões data-action="close-*" */
export function wireDialog(dialog, { canClose = () => true } = {}) {
  dialog.addEventListener("click", (event) => {
    if (!canClose()) return;
    if (event.target === dialog || event.target.closest('[data-action="close-modal"], [data-action="close-drawer"]')) closeDialog(dialog);
  });
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); if (canClose()) closeDialog(dialog); });
}

/** Mostra os erros que vieram da validação (tela ou servidor) ao lado de cada campo */
export function showFieldErrors(form, fields = {}, message = "") {
  form.querySelectorAll(".field__error").forEach((node) => node.remove());
  form.querySelectorAll("[aria-invalid]").forEach((node) => node.removeAttribute("aria-invalid"));
  let first = null;
  Object.entries(fields).forEach(([name, text]) => {
    const input = form.elements[name];
    const control = input instanceof RadioNodeList ? input[0] : input;
    if (!control) return;
    const field = control.closest(".field");
    (input instanceof RadioNodeList ? [...input] : [control]).forEach((node) => node.setAttribute("aria-invalid", "true"));
    field?.insertAdjacentHTML("beforeend", `<span class="field__error">${esc(text)}</span>`);
    first = first || control;
  });
  const box = form.querySelector(".form-error");
  box.textContent = message;
  box.hidden = !message;
  first?.focus();
}

export function setBusy(button, busy) {
  button.disabled = busy;
  button.classList.toggle("is-loading", busy);
  button.setAttribute("aria-busy", String(busy));
}

/** Confirmação: resolve true (Excluir) ou false (Cancelar / Esc / fora) */
export function createConfirm(dialog) {
  let resolver = null;
  const finish = (answer) => {
    if (!resolver) return;
    const resolve = resolver; resolver = null;
    closeDialog(dialog);
    resolve(answer);
  };
  dialog.addEventListener("click", (event) => {
    const button = event.target.closest("[data-confirm]");
    if (button) finish(button.dataset.confirm === "ok");
    else if (event.target === dialog) finish(false);
  });
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish(false); });

  // tone "danger" (excluir, padrão) ou "primary" (confirmar uma mudança comum)
  return ({ title, text, confirmLabel = "Excluir", tone = "danger" }) => new Promise((resolve) => {
    resolver = resolve;
    const danger = tone === "danger";
    dialog.querySelector("#confirm-title").textContent = title;
    dialog.querySelector("#confirm-text").textContent = text;
    const ok = dialog.querySelector('[data-confirm="ok"]');
    ok.textContent = confirmLabel;
    ok.classList.toggle("btn--danger", danger);
    ok.classList.toggle("btn--primary", !danger);
    const mark = dialog.querySelector(".modal__icon");
    mark.classList.toggle("modal__icon--danger", danger);
    mark.classList.toggle("modal__icon--brand", !danger);
    mark.innerHTML = icon(danger ? "close" : "refresh");
    dialog.showModal();
    dialog.querySelector('[data-confirm="cancel"]').focus();   // o padrão seguro é cancelar
  });
}

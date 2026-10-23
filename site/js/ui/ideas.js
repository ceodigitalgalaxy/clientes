/* "Compartilhar uma ideia": modal com o formulário e a lista das ideias enviadas.
   O mesmo modal serve para editar uma ideia já enviada. */

import { esc, reduceMotion } from "../lib/dom.js?v=0470164d89";
import { icon } from "../lib/icons.js?v=0470164d89";
import { dayLabel, stampLabel } from "../lib/dates.js?v=0470164d89";
import { IDEA_STATUS } from "../domain/model.js?v=0470164d89";
import { toast } from "./toast.js?v=0470164d89";

export function renderIdeas(container, ideas) {
  container.innerHTML = ideas.length
    ? `<ul class="idea-list">${ideas.map((idea) => `
        <li class="idea">
          <span class="idea__icon">${icon("lightbulb")}</span>
          <div class="idea__body">
            <div class="idea__head">
              <p class="idea__title">${esc(idea.title)}</p>
              <button class="idea__edit" type="button" data-edit-idea="${esc(idea.id)}" aria-label="${esc(`Editar a ideia: ${idea.title}`)}">${icon("edit")}<span>Editar</span></button>
            </div>
            <p class="idea__text">${esc(idea.description)}</p>
            <p class="idea__meta">
              <span class="idea__status idea__status--${esc(idea.status)}">${esc(IDEA_STATUS[idea.status] || idea.status)}</span>
              <span>${idea.updatedAt ? `Editada em ${esc(stampLabel(idea.updatedAt))}` : `Enviada em ${esc(stampLabel(idea.createdAt))}`}</span>
              ${idea.suggestedDate ? `<span>${icon("calendar")}Sugestão para ${esc(dayLabel(idea.suggestedDate))}</span>` : ""}
            </p>
          </div>
        </li>`).join("")}</ul>`
    : `
      <div class="ideas__empty">
        <span class="ideas__empty-icon">${icon("lightbulb")}</span>
        <p>Você ainda não compartilhou nenhuma ideia. Pode ser uma promoção, um tema, um bastidor... a gente adora ouvir!</p>
      </div>`;
}

const COPY = {
  new: { title: "Teve uma ideia para sua marca?", text: "Conta pra gente! Suas sugestões também fazem parte do nosso planejamento.", submit: "Enviar ideia", icon: "send" },
  edit: { title: "Editar ideia", text: "Ajuste o que quiser. A nossa equipe vê a versão atualizada.", submit: "Salvar alterações", icon: "check" }
};

export function setupIdeaModal({ dialog, repo, onSaved }) {
  const form = dialog.querySelector("form");
  const submit = form.querySelector("[type=submit]");
  let editingId = null;

  const setMode = (mode) => {
    const copy = COPY[mode];
    dialog.querySelector(".modal__title").textContent = copy.title;
    dialog.querySelector(".modal__text").textContent = copy.text;
    submit.innerHTML = `${icon(copy.icon)}<span></span>`;
    submit.querySelector("span").textContent = copy.submit;
  };

  const close = () => {
    if (!dialog.open) return;
    if (reduceMotion()) { dialog.close(); return; }
    dialog.classList.add("is-closing");
    setTimeout(() => { dialog.classList.remove("is-closing"); dialog.close(); }, 220);
  };

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog || event.target.closest('[data-action="close-modal"]')) close();
  });
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  form.addEventListener("input", (event) => { if (event.target.value.trim()) event.target.removeAttribute("aria-invalid"); });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fields = ["title", "description"].map((name) => form.elements[name]);
    const invalid = fields.filter((field) => !field.value.trim());
    fields.forEach((field) => (invalid.includes(field) ? field.setAttribute("aria-invalid", "true") : field.removeAttribute("aria-invalid")));
    if (invalid.length) { invalid[0].focus(); return; }
    submit.disabled = true;
    const data = {
      title: form.elements.title.value,
      description: form.elements.description.value,
      suggestedDate: form.elements.suggestedDate.value
    };
    const editing = editingId;
    const idea = editing ? await repo.updateIdea({ id: editing, ...data }) : await repo.addIdea(data);
    submit.disabled = false;
    form.reset();
    close();
    await onSaved(idea);
    toast(editing ? "Ideia atualizada" : "Ideia enviada! Obrigado por compartilhar.");
  });

  return {
    /** Sem argumento: nova ideia. Com { idea }: edita a ideia. */
    open({ idea, date } = {}) {
      form.reset();
      form.querySelectorAll("[aria-invalid]").forEach((f) => f.removeAttribute("aria-invalid"));
      editingId = idea ? idea.id : null;
      setMode(idea ? "edit" : "new");
      if (idea) {
        form.elements.title.value = idea.title;
        form.elements.description.value = idea.description;
        form.elements.suggestedDate.value = idea.suggestedDate || "";
      } else if (date) {
        form.elements.suggestedDate.value = date;
      }
      dialog.showModal();
      form.elements.title.focus();
      if (idea) form.elements.title.select();
    }
  };
}

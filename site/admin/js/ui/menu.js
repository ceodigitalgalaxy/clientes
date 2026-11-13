/* Menu "⋯" (ações secundárias) para linhas e cartões.
   Marcação:
     <div class="kebab">
       <button class="icon-btn" type="button" data-menu-toggle aria-haspopup="menu" aria-expanded="false" aria-label="Mais ações">…</button>
       <div class="menu" role="menu" hidden> <button role="menuitem" data-…>…</button> </div>
     </div>
   Os itens mantêm os data-* de sempre: os cliques continuam nos mesmos tratadores.
   O menu abre "flutuando" (position: fixed) para não ser cortado pela lista,
   e sobe quando não cabe embaixo. Fecha ao clicar fora, no Esc, ao rolar e ao escolher. */

import { icon } from "../../../js/lib/icons.js?v=8083d4a8ab";
import { esc } from "../../../js/lib/dom.js?v=8083d4a8ab";

/** HTML do menu: items = [{ label, icon, attrs: 'data-x="id"', danger }] (itens vazios são ignorados) */
export function kebab(items, label = "Mais ações") {
  const list = items.filter(Boolean);
  if (!list.length) return "";
  return `
    <div class="kebab">
      <button class="icon-btn kebab__toggle" type="button" data-menu-toggle aria-haspopup="menu" aria-expanded="false" aria-label="${esc(label)}" title="${esc(label)}">${icon("more")}</button>
      <div class="menu" role="menu" hidden>
        ${list.map((it) => `<button class="menu__item${it.danger ? " menu__item--danger" : ""}" type="button" role="menuitem" ${it.attrs}>${it.icon ? icon(it.icon) : ""}<span>${esc(it.label)}</span></button>`).join("")}
      </div>
    </div>`;
}

let open = null;   // { toggle, menu }

function close({ focus = false } = {}) {
  if (!open) return;
  open.menu.hidden = true;
  open.menu.classList.remove("is-up");
  open.toggle.setAttribute("aria-expanded", "false");
  if (focus) open.toggle.focus();
  open = null;
}

function place(toggle, menu) {
  const r = toggle.getBoundingClientRect();
  menu.hidden = false;
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w));
  const below = r.bottom + 6 + h <= window.innerHeight - 8;
  menu.classList.toggle("is-up", !below);
  menu.style.setProperty("--menu-left", `${left}px`);
  menu.style.setProperty("--menu-top", `${below ? r.bottom + 6 : Math.max(8, r.top - h - 6)}px`);
}

export function wireMenus() {
  document.addEventListener("click", (event) => {
    const toggle = event.target.closest?.("[data-menu-toggle]");
    if (toggle) {
      event.preventDefault();
      const menu = toggle.nextElementSibling;
      const same = open?.toggle === toggle;
      close();
      if (same || !menu) return;
      place(toggle, menu);
      toggle.setAttribute("aria-expanded", "true");
      open = { toggle, menu };
      menu.querySelector("[role=menuitem]")?.focus();
      return;
    }
    // Escolher um item ou clicar fora fecha (o item segue para o tratador dele)
    if (open && (event.target.closest?.("[role=menuitem]") || !event.target.closest?.(".menu"))) close();
  });
  document.addEventListener("keydown", (event) => {
    if (!open) return;
    if (event.key === "Escape") { event.preventDefault(); close({ focus: true }); return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = [...open.menu.querySelectorAll("[role=menuitem]")];
    const i = items.indexOf(document.activeElement);
    event.preventDefault();
    items[(i + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  });
  window.addEventListener("scroll", () => close(), { passive: true, capture: true });
  window.addEventListener("resize", () => close());
  window.addEventListener("hashchange", () => close());
}

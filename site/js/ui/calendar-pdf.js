/* ==========================================================================
   PDF do calendário do cliente (botão "Baixar PDF" no portal)
   --------------------------------------------------------------------------
   Página 1: o mês em grade (dias, horário e título de cada postagem, com a
   cor do status). Páginas seguintes: a lista completa (data, horário,
   título, rede, formato e status). Só o que o cliente já vê no portal.
   Montado no navegador (lib/pdf.js): nada é enviado a nenhum servidor.
   ========================================================================== */

import { createPdf, fitText, wrapText, textWidth } from "../lib/pdf.js?v=e96162d7e7";
import { monthGrid, monthLabel, timeLabel, WEEKDAYS_SHORT, fromISO } from "../lib/dates.js?v=e96162d7e7";
import { ACTIVITY_TYPES, PLATFORMS, STATUS } from "../domain/model.js?v=e96162d7e7";
import { statusOf } from "../domain/status.js?v=e96162d7e7";

const C = {
  brand: "#5A1AC7", deep: "#3B008E", text: "#160B2E", muted: "#5E5774", subtle: "#8F88A3",
  line: "#E4DEF0", soft: "#F6F3FC", out: "#FBFAFD", white: "#FFFFFF"
};
const STATUS_COLOR = { aguardando: "#C27C0E", ajustes: "#D9483B", aprovado: "#1E9E63", publicado: "#5A1AC7" };
const STATUS_SOFT = { aguardando: "#FFF6E3", ajustes: "#FDEEEC", aprovado: "#E8F7EF", publicado: "#F1EAFF" };
const DAY_ORDER = ["aguardando", "ajustes", "aprovado", "publicado"];
const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const pad = (n) => String(n).padStart(2, "0");

const sortItems = (list) => [...list].sort((a, b) => (a.date + (a.time || "99")).localeCompare(b.date + (b.time || "99")) || a.title.localeCompare(b.title));

function header(page, { client, month, generatedAt }, subtitle) {
  const W = page.width;
  page.rect(0, 0, W, 6, { fill: C.brand });
  page.text(32, 40, `Calendário de ${monthLabel(month).toLowerCase()}`, { size: 20, bold: true, color: C.text });
  page.text(32, 58, fitText(`${client}${subtitle ? ` · ${subtitle}` : ""}`, W - 260, 10), { size: 10, color: C.muted });
  const brand = "Digital Galaxy";
  page.text(W - 32 - textWidth(brand, 12, true), 40, brand, { size: 12, bold: true, color: C.deep });
  const when = `Gerado em ${generatedAt}`;
  page.text(W - 32 - textWidth(when, 8), 56, when, { size: 8, color: C.subtle });
}

function footer(page, n, total) {
  const label = `Página ${n} de ${total}`;
  page.text(page.width - 32 - textWidth(label, 8), page.height - 18, label, { size: 8, color: C.subtle });
  page.text(32, page.height - 18, "Portal de clientes · Digital Galaxy", { size: 8, color: C.subtle });
}

function legend(page, y) {
  let x = 32;
  for (const key of DAY_ORDER) {
    page.rect(x, y - 7, 8, 8, { fill: STATUS_COLOR[key] });
    page.text(x + 12, y, STATUS[key].label, { size: 8, color: C.muted });
    x += 12 + textWidth(STATUS[key].label, 8) + 16;
  }
}

/** Grade do mês */
function monthPage(pdf, meta, items, approvals) {
  const page = pdf.addPage();
  header(page, meta, `${items.length} ${items.length === 1 ? "conteúdo" : "conteúdos"} no mês`);
  legend(page, 78);
  const grid = monthGrid(meta.month);
  const rows = grid.length / 7;
  const left = 32; const top = 92; const right = page.width - 32; const bottom = page.height - 34;
  const colW = (right - left) / 7;
  const headH = 18;
  const rowH = (bottom - top - headH) / rows;
  // Dias da semana
  WEEKDAYS_SHORT.forEach((d, i) => page.text(left + i * colW + 6, top + 12, d, { size: 8, bold: true, color: i === 0 || i === 6 ? C.brand : C.muted }));
  const byDay = {};
  items.forEach((a) => { (byDay[a.date] ||= []).push(a); });
  grid.forEach((day, i) => {
    const x = left + (i % 7) * colW;
    const y = top + headH + Math.floor(i / 7) * rowH;
    const list = day.inMonth ? sortItems(byDay[day.iso] || []) : [];
    const statuses = list.map((a) => statusOf(a, approvals));
    const dayStatus = DAY_ORDER.find((s) => statuses.includes(s));
    page.rect(x, y, colW, rowH, { fill: !day.inMonth ? C.out : dayStatus ? STATUS_SOFT[dayStatus] : C.white, stroke: C.line, lineWidth: 0.6 });
    if (dayStatus) page.rect(x, y, colW, 2.5, { fill: STATUS_COLOR[dayStatus] });
    page.text(x + 6, y + 13, String(day.day), { size: 9, bold: true, color: day.inMonth ? C.text : "#C5BFD3" });
    // Postagens: uma linha cada ("10h Título"), com a cor do status
    const lineH = 9.5;
    const maxLines = Math.max(1, Math.floor((rowH - 20) / lineH));
    const shown = list.length > maxLines ? list.slice(0, maxLines - 1) : list;
    shown.forEach((a, k) => {
      const ly = y + 25 + k * lineH;
      const st = statusOf(a, approvals);
      page.rect(x + 6, ly - 5.5, 4, 4, { fill: STATUS_COLOR[st] || C.subtle });
      const time = a.time ? `${timeLabel(a.time)} ` : "";
      const timeW = time ? textWidth(time, 7, true) : 0;
      if (time) page.text(x + 13, ly, time, { size: 7, bold: true, color: C.muted });
      page.text(x + 13 + timeW, ly, fitText(a.title, colW - 19 - timeW, 7), { size: 7, color: C.text });
    });
    if (list.length > shown.length) page.text(x + 13, y + 25 + shown.length * lineH, `+${list.length - shown.length} (ver lista)`, { size: 7, bold: true, color: C.brand });
  });
}

/** Lista completa, com quebra de página */
function listPages(pdf, meta, items, approvals) {
  const cols = [
    { key: "date", label: "Data", w: 92 },
    { key: "time", label: "Horário", w: 52 },
    { key: "title", label: "Título", w: 330 },
    { key: "network", label: "Rede", w: 96 },
    { key: "format", label: "Formato", w: 86 },
    { key: "status", label: "Status", w: 122 }
  ];
  const left = 32;
  let page = null;
  let y = 0;
  const start = () => {
    page = pdf.addPage();
    header(page, meta, "Lista completa de conteúdos");
    y = 84;
    page.rect(left, y, page.width - 64, 20, { fill: C.soft });
    let x = left + 8;
    cols.forEach((c) => { page.text(x, y + 13.5, c.label, { size: 8, bold: true, color: C.muted }); x += c.w; });
    y += 20;
  };
  start();
  if (!items.length) {
    page.text(left + 8, y + 24, "Ainda não há conteúdos liberados para este mês.", { size: 10, color: C.muted });
    return;
  }
  sortItems(items).forEach((a, idx) => {
    const titleLines = wrapText(a.title, cols[2].w - 12, 9, true, 2);
    const rowH = Math.max(24, 10 + titleLines.length * 11);
    if (y + rowH > page.height - 40) start();
    if (idx % 2 === 1) page.rect(left, y, page.width - 64, rowH, { fill: "#FCFBFE" });
    page.line(left, y + rowH, page.width - 32, y + rowH, { color: C.line, lineWidth: 0.6 });
    const d = fromISO(a.date);
    const st = statusOf(a, approvals);
    const t = ACTIVITY_TYPES[a.type] || ACTIVITY_TYPES.outro;
    const values = {
      date: `${WEEKDAYS[d.getDay()].slice(0, 3)}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`,
      time: a.time ? timeLabel(a.time) : "—",
      network: (a.platforms || []).map((p) => PLATFORMS[p] || p).join(", ") || "—",
      format: t.label,
      status: st ? STATUS[st].label : "—"
    };
    let x = left + 8;
    cols.forEach((c) => {
      if (c.key === "title") {
        titleLines.forEach((line, k) => page.text(x, y + 15 + k * 11, line, { size: 9, bold: true, color: C.text }));
      } else if (c.key === "status") {
        if (st) page.rect(x, y + 9, 6, 6, { fill: STATUS_COLOR[st] });
        page.text(x + (st ? 10 : 0), y + 15, fitText(values.status, c.w - 14, 8.5), { size: 8.5, color: C.text });
      } else {
        page.text(x, y + 15, fitText(values[c.key], c.w - 10, 8.5, c.key === "date"), { size: 8.5, bold: c.key === "date", color: c.key === "date" ? C.text : C.muted });
      }
      x += c.w;
    });
    y += rowH;
  });
}

/**
 * @param {{client: string, month: string, activities: object[], approvals?: object[], now?: Date}} data
 * @returns {Uint8Array}
 */
export function buildCalendarPdf({ client, month, activities, approvals = [], now = new Date() }) {
  const items = activities.filter((a) => a.date.startsWith(month));
  const generatedAt = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} às ${pad(now.getHours())}h${pad(now.getMinutes())}`;
  const meta = { client, month, generatedAt };
  const pdf = createPdf({ title: `Calendário de ${monthLabel(month)} · ${client}`, author: "Digital Galaxy" });
  const pages = [];
  const addPage = pdf.addPage;
  const doc = { addPage: () => { const page = addPage(); pages.push(page); return page; } };
  monthPage(doc, meta, items, approvals);
  listPages(doc, meta, items, approvals);
  // Rodapé com "Página X de Y" (o total só se sabe no fim)
  pages.forEach((page, i) => footer(page, i + 1, pages.length));
  return pdf.build();
}

/** Nome do arquivo: calendario-padaria-central-2026-10.pdf */
export function pdfFileName(client, month) {
  const slug = String(client).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "cliente";
  return `calendario-${slug}-${month}.pdf`;
}

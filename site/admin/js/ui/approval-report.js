/* Relatório do lote de aprovação em PDF (painel): cliente, mês, conteúdos
   (data, horário, título, formato, rede, status) e o histórico resumido das
   decisões. Montado no navegador com lib/pdf.js; nada vai para servidor. */

import { createPdf, fitText, wrapText, textWidth } from "../../../js/lib/pdf.js?v=75a584518a";
import { monthLabel, timeLabel, fromISO } from "../../../js/lib/dates.js?v=75a584518a";
import { APPROVAL_STATUS, APPROVAL_MODES, APPROVAL_EVENTS } from "../../../js/domain/approvals.js?v=75a584518a";
import { NETWORKS, FORMATS } from "../domain/rules.js?v=75a584518a";

const C = { brand: "#5A1AC7", text: "#160B2E", muted: "#5E5774", subtle: "#8F88A3", line: "#E4DEF0", soft: "#F6F3FC" };
const TONE = { aguardando: "#C27C0E", aprovado: "#1E9E63", ajustes: "#D9483B", reenviado: "#0A5D73", neutral: "#8F88A3" };
const pad = (n) => String(n).padStart(2, "0");
const stamp = (iso) => { const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}h${pad(d.getMinutes())}`; };

/**
 * @param {{client: string, batch: object, rows: Array<{content: object, status: string, version: number}>, decisions: object[], events: object[], now?: Date}} data
 * @returns {Uint8Array}
 */
export function buildApprovalReport({ client, batch, rows, decisions, events, now = new Date() }) {
  const pdf = createPdf({ width: 595, height: 842, title: `Aprovação · ${batch.title} · ${client}`, author: "Digital Galaxy" });
  const pages = [];
  const left = 36; const right = 559;
  let page; let y;
  const newPage = (subtitle) => {
    page = pdf.addPage(); pages.push(page);
    page.rect(0, 0, 595, 6, { fill: C.brand });
    page.text(left, 40, fitText(batch.title, 380, 18), { size: 18, bold: true, color: C.text });
    page.text(left, 58, fitText(`${client} · ${monthLabel(batch.month.slice(0, 7))} · ${APPROVAL_MODES[batch.approval_mode]?.label || ""}`, 400, 10), { size: 10, color: C.muted });
    const brand = "Digital Galaxy";
    page.text(right - textWidth(brand, 11, true), 40, brand, { size: 11, bold: true, color: C.brand });
    const when = `Gerado em ${stamp(now.toISOString())}`;
    page.text(right - textWidth(when, 8), 56, when, { size: 8, color: C.subtle });
    if (subtitle) page.text(left, 84, subtitle, { size: 11, bold: true, color: C.text });
    y = subtitle ? 96 : 80;
  };
  const ensure = (h, subtitle) => { if (y + h > 800) newPage(subtitle); };

  // Resumo
  newPage("Resumo");
  const count = (fn) => rows.filter(fn).length;
  const summary = [
    ["Conteúdos", rows.length], ["Aprovados", count((r) => r.status === "aprovado")],
    ["Aguardando", count((r) => r.status === "aguardando_aprovacao" || r.status === "reenviado")], ["Ajustes", count((r) => r.status === "ajustes")]
  ];
  summary.forEach(([label, n], i) => {
    const x = left + i * 130;
    page.rect(x, y, 120, 44, { fill: C.soft });
    page.text(x + 10, y + 20, String(n), { size: 16, bold: true, color: C.text });
    page.text(x + 10, y + 36, label, { size: 8, color: C.muted });
  });
  y += 64;

  // Conteúdos
  const cols = [["Data", 70], ["Hora", 40], ["Título", 190], ["Formato", 70], ["Rede", 70], ["Status", 83]];
  const head = () => {
    page.rect(left, y, right - left, 18, { fill: C.soft });
    let x = left + 6;
    cols.forEach(([label, w]) => { page.text(x, y + 12, label, { size: 8, bold: true, color: C.muted }); x += w; });
    y += 18;
  };
  page.text(left, y + 10, "Conteúdos", { size: 11, bold: true, color: C.text }); y += 18;
  head();
  rows.forEach((r) => {
    const c = r.content || {};
    const title = wrapText(c.title || "(sem título)", 182, 8.5, true, 2);
    const h = Math.max(20, 8 + title.length * 10);
    if (y + h > 800) { newPage("Conteúdos (continuação)"); head(); }
    const d = c.scheduled_date ? fromISO(c.scheduled_date) : null;
    const s = APPROVAL_STATUS[r.status] || APPROVAL_STATUS.rascunho;
    let x = left + 6;
    page.text(x, y + 13, d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}` : "—", { size: 8.5, bold: true, color: C.text }); x += cols[0][1];
    page.text(x, y + 13, c.scheduled_time ? timeLabel(c.scheduled_time.slice(0, 5)) : "—", { size: 8.5, color: C.muted }); x += cols[1][1];
    title.forEach((line, k) => page.text(x, y + 13 + k * 10, line, { size: 8.5, bold: true, color: C.text })); x += cols[2][1];
    page.text(x, y + 13, fitText(FORMATS[c.format]?.label || c.format || "—", 64, 8), { size: 8, color: C.muted }); x += cols[3][1];
    page.text(x, y + 13, fitText(NETWORKS[c.network] || c.network || "—", 64, 8), { size: 8, color: C.muted }); x += cols[4][1];
    page.rect(x, y + 7, 6, 6, { fill: TONE[s.tone] || C.subtle });
    page.text(x + 10, y + 13, fitText(`${s.short}${r.version > 1 ? ` · v${r.version}` : ""}`, 70, 8), { size: 8, color: C.text });
    page.line(left, y + h, right, y + h, { color: C.line, lineWidth: 0.5 });
    y += h;
  });

  // Histórico resumido
  y += 20;
  ensure(60, "Histórico resumido");
  page.text(left, y + 10, "Histórico resumido das aprovações", { size: 11, bold: true, color: C.text }); y += 22;
  const titleOf = (contentId) => rows.find((r) => r.contentId === contentId)?.content?.title || "Conteúdo";
  const lines = decisions.length
    ? [...decisions].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((d) => ({
        head: `${stamp(d.created_at)} · ${d.action === "aprovado" ? "Aprovado" : "Ajuste solicitado"}${d.reviewer_name ? ` por ${d.reviewer_name}` : ""}${d.bulk ? " (em lote)" : ""}`,
        body: `${titleOf(d.content_id)}${d.comment ? ` — “${d.comment}”` : ""}`
      }))
    : events.filter((e) => ["enviado", "nova_versao", "link_gerado", "link_desativado"].includes(e.event_type)).map((e) => ({ head: `${stamp(e.created_at)} · ${APPROVAL_EVENTS[e.event_type] || e.event_type}`, body: e.actor_reference ? `Por ${e.actor_reference}` : "" }));
  if (!lines.length) { page.text(left, y + 10, "Ainda não há decisões do cliente.", { size: 9, color: C.muted }); }
  lines.forEach((l) => {
    const body = wrapText(l.body, right - left - 12, 8.5, false, 4);
    const h = 16 + body.length * 11;
    ensure(h, "Histórico resumido (continuação)");
    page.text(left, y + 10, fitText(l.head, right - left, 8.5), { size: 8.5, bold: true, color: C.text });
    body.forEach((line, k) => page.text(left + 10, y + 22 + k * 11, line, { size: 8.5, color: C.muted }));
    y += h + 4;
  });

  pages.forEach((p, i) => {
    const label = `Página ${i + 1} de ${pages.length}`;
    p.text(right - textWidth(label, 8), 826, label, { size: 8, color: C.subtle });
    p.text(left, 826, "Central de aprovação · Digital Galaxy", { size: 8, color: C.subtle });
  });
  return pdf.build();
}

export const reportFileName = (client, batch) => {
  const slug = String(`${client}-${batch.title}`).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "lote";
  return `aprovacao-${slug}.pdf`;
};

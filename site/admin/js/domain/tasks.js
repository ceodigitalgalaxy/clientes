/* Gestão de demandas: status oficiais, cores e validação das tarefas.
   O status oficial é o que vale (relatórios, sincronia com o conteúdo); as
   colunas do quadro são só nome/cor/ordem por cima dele. Etiqueta (categoria),
   prioridade (urgência), status (etapa) e prazo (data) são coisas separadas. */

export const TASK_STATUS = Object.freeze({
  a_fazer: { label: "A fazer", color: "cinza" },
  em_andamento: { label: "Em andamento", color: "azul" },
  em_revisao: { label: "Em revisão", color: "roxo" },
  aguardando_pessoa: { label: "Aguardando outra pessoa", color: "laranja" },
  aguardando_cliente: { label: "Aguardando cliente", color: "amarelo" },
  ajustes: { label: "Ajustes solicitados", color: "vermelho" },
  concluido: { label: "Concluído", color: "verde" }
});

export const COLORS = Object.freeze({
  cinza: "Cinza", azul: "Azul", roxo: "Roxo", amarelo: "Amarelo", laranja: "Laranja", vermelho: "Vermelho", verde: "Verde", rosa: "Rosa"
});

export const TASK_PRIORITIES = Object.freeze({
  baixa: { label: "Baixa", rank: 3 },
  media: { label: "Média", rank: 2 },
  alta: { label: "Alta", rank: 1 },
  urgente: { label: "Urgente", rank: 0 }
});

/** Pedido de edição de vídeo */
export const VIDEO_FORMATS = Object.freeze({
  "9_16": "Vertical 9:16 (Reels, Stories, TikTok)",
  "4_5": "Feed 4:5",
  "1_1": "Quadrado 1:1",
  "16_9": "Horizontal 16:9 (YouTube)",
  outro: "Outro formato"
});
export const VIDEO_FORMAT_SHORT = Object.freeze({ "9_16": "9:16", "4_5": "4:5", "1_1": "1:1", "16_9": "16:9", outro: "Outro" });
/** Checklist que já vem marcado no pedido (dá para tirar itens) */
export const EDIT_CHECKLIST = Object.freeze(["Cortes e ritmo", "Legendas", "Trilha e áudio", "Cor", "Textos e letreiros", "Exportar no formato pedido", "Revisar antes de entregar"]);
/** Formato do vídeo a partir do formato do conteúdo do calendário */
export const formatFromContent = (format) => ({ reels: "9_16", stories: "9_16", video: "16_9", carrossel: "4_5", post: "4_5" }[format] || "");

/** Link seguro: só https, sem usuário/senha embutidos, até 1.000 caracteres. Devolve o link limpo ou null */
export function httpsUrl(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 1000 || /\s/.test(text)) return null;
  let url;
  try { url = new URL(text); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) return null;
  return url.href;
}
/** Nome curto do serviço do link (para o botão) */
export function linkHost(value) {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    if (/(^|\.)drive\.google\.com$|(^|\.)docs\.google\.com$/.test(host)) return "Google Drive";
    if (/dropbox\.com$/.test(host)) return "Dropbox";
    if (/(youtube\.com|youtu\.be)$/.test(host)) return "YouTube";
    if (/canva\.com$/.test(host)) return "Canva";
    if (/figma\.com$/.test(host)) return "Figma";
    if (/instagram\.com$/.test(host)) return "Instagram";
    if (/tiktok\.com$/.test(host)) return "TikTok";
    if (/wetransfer\.com$/.test(host)) return "WeTransfer";
    return host;
  } catch { return ""; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isId = (v) => UUID.test(String(v || ""));
const clean = (v) => (typeof v === "string" ? v.trim() : v ?? "");

/** "AAAA-MM-DD" + "HH:MM" (horário local) → ISO; sem data = sem prazo */
export function dueFrom(date, time) {
  if (!date) return null;
  const [y, m, d] = String(date).split("-").map(Number);
  const [hh, mm] = (time || "18:00").split(":").map(Number);
  const when = new Date(y, m - 1, d, hh || 0, mm || 0);
  return Number.isNaN(when.getTime()) ? undefined : when.toISOString();
}
/** ISO → { date, time } no horário local (para os campos do formulário) */
export function dueParts(iso) {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/**
 * Valida o que a tela manda criar/alterar. Só os campos presentes entram (dá para
 * mandar só o status, só o prazo…). client_id "" = interno da agência.
 */
export function validateTask(input = {}, { creating = false } = {}) {
  const errors = {};
  const value = {};
  if (creating || "title" in input) {
    value.title = clean(input.title);
    if (!value.title) errors.title = "Dê um título para a demanda.";
    else if (value.title.length > 200) errors.title = "Use até 200 caracteres.";
  }
  if ("description" in input) {
    value.description = clean(input.description) || null;
    if (value.description && value.description.length > 10000) errors.description = "Use até 10.000 caracteres.";
  }
  if ("client_id" in input) {
    value.client_id = clean(input.client_id) || null;
    if (value.client_id && !isId(value.client_id)) errors.client_id = "Escolha o cliente.";
  }
  for (const key of ["project_id", "content_id", "parent_id", "column_id"]) {
    if (key in input) {
      value[key] = clean(input[key]) || null;
      if (value[key] && !isId(value[key])) errors[key] = "Registro inválido.";
    }
  }
  if ("status" in input) {
    value.status = clean(input.status);
    if (!TASK_STATUS[value.status]) errors.status = "Escolha a etapa.";
  }
  if ("priority" in input) {
    value.priority = clean(input.priority) || "media";
    if (!TASK_PRIORITIES[value.priority]) errors.priority = "Escolha a prioridade.";
  }
  if ("due_date" in input || "due_time" in input) {
    const due = dueFrom(clean(input.due_date), clean(input.due_time));
    if (due === undefined) errors.due_date = "Data inválida.";
    else value.due_at = due;
  } else if ("due_at" in input) {
    value.due_at = input.due_at || null;
  }
  if ("position" in input) {
    value.position = Number(input.position);
    if (!Number.isFinite(value.position)) errors.position = "Posição inválida.";
  }
  if ("archived_at" in input) value.archived_at = input.archived_at || null;
  if ("kind" in input) {
    value.kind = input.kind === "edicao" ? "edicao" : "geral";
  }
  for (const [key, label] of [["drive_url", "Cole o link da pasta (começa com https://)."], ["reference_url", "Cole um link que começa com https://."]]) {
    if (key in input) {
      const raw = clean(input[key]);
      value[key] = raw ? httpsUrl(raw) : null;
      if (raw && !value[key]) errors[key] = label;
    }
  }
  if (value.kind === "edicao" && creating && !value.drive_url && !errors.drive_url) errors.drive_url = "Cole o link da pasta do Drive com os brutos.";
  if ("video_format" in input) {
    value.video_format = clean(input.video_format) || null;
    if (value.video_format && !VIDEO_FORMATS[value.video_format]) errors.video_format = "Escolha o formato.";
  }
  if ("video_duration" in input) {
    value.video_duration = clean(input.video_duration) || null;
    if (value.video_duration && value.video_duration.length > 40) errors.video_duration = "Use até 40 caracteres.";
  }
  return { value, errors };
}

/** Prazo de uma tarefa em relação a agora: atrasada, hoje, amanhã… */
export function dueState(iso, status, now = new Date()) {
  if (!iso) return null;
  if (status === "concluido") return { tone: "done", label: "Entregue" };
  const due = new Date(iso);
  const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(due) - start(now)) / 86400000);
  if (due < now) return { tone: "late", label: days === 0 ? "Atrasada hoje" : `Atrasada ${-days || 1} ${-days === 1 ? "dia" : "dias"}`, days };
  if (days === 0) return { tone: "today", label: "Hoje", days };
  if (days === 1) return { tone: "soon", label: "Amanhã", days };
  return { tone: days <= 3 ? "soon" : "ok", label: due.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), days };
}

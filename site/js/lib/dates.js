/* Datas em português, sempre no fuso local e sem horário (AAAA-MM-DD) */

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
export const WEEKDAYS_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const pad = (n) => String(n).padStart(2, "0");

export const toISO = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const monthKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
export const fromISO = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d || 1); };
export const todayISO = () => toISO(new Date());
/** Agora, no fuso local, no mesmo formato dos dados (AAAA-MM-DDTHH:MM:SS) */
export const nowStamp = () => { const d = new Date(); return `${toISO(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };

export const addMonths = (key, delta) => { const d = fromISO(`${key}-01`); d.setMonth(d.getMonth() + delta); return monthKey(d); };
export const daysInMonth = (key) => { const d = fromISO(`${key}-01`); return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); };

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const monthName = (key) => capitalize(MONTHS[fromISO(`${key}-01`).getMonth()]);
export const monthLabel = (key) => `${monthName(key)} ${key.slice(0, 4)}`;

/** "15 de outubro" */
export const dayLabel = (iso) => { const d = fromISO(iso); return `${d.getDate()} de ${MONTHS[d.getMonth()]}`; };
/** "Quarta-feira, 15 de outubro" */
export const longDayLabel = (iso) => `${capitalize(WEEKDAYS[fromISO(iso).getDay()])}, ${dayLabel(iso)}`;
/** "14h" ou "14h30" */
export const timeLabel = (time) => { if (!time) return ""; const [h, m] = time.split(":"); return m === "00" ? `${Number(h)}h` : `${Number(h)}h${m}`; };
/** "20/10 às 14h05" */
export const stampLabel = (isoDateTime) => {
  const d = new Date(isoDateTime);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} às ${d.getHours()}h${pad(d.getMinutes())}`;
};

/** Semanas (domingo a sábado) que cobrem o mês, com os dias de fora marcados */
export function monthGrid(key) {
  const first = fromISO(`${key}-01`);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const total = Math.ceil((first.getDay() + daysInMonth(key)) / 7) * 7;
  return Array.from({ length: total }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return { iso: toISO(d), day: d.getDate(), inMonth: monthKey(d) === key, weekday: d.getDay() };
  });
}

/** Soma (ou subtrai) dias de uma data AAAA-MM-DD */
export const addDays = (iso, delta) => { const d = fromISO(iso); d.setDate(d.getDate() + delta); return toISO(d); };

/** Semana (domingo a sábado) que contém a data */
export function weekDays(iso) {
  const d = fromISO(iso);
  const start = addDays(iso, -d.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const day = fromISO(addDays(start, i));
    return { iso: toISO(day), day: day.getDate(), inMonth: true, weekday: day.getDay() };
  });
}

/** "18 a 24 de outubro de 2026" ou "28 de setembro a 4 de outubro de 2026" */
export function weekLabel(iso) {
  const days = weekDays(iso);
  const first = fromISO(days[0].iso);
  const last = fromISO(days[6].iso);
  const year = last.getFullYear();
  if (first.getMonth() === last.getMonth()) return `${first.getDate()} a ${last.getDate()} de ${MONTHS[last.getMonth()]} de ${year}`;
  const firstYear = first.getFullYear() !== year ? ` de ${first.getFullYear()}` : "";
  return `${first.getDate()} de ${MONTHS[first.getMonth()]}${firstYear} a ${last.getDate()} de ${MONTHS[last.getMonth()]} de ${year}`;
}

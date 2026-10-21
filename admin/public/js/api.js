/* Conexão da tela com o servidor local do painel (admin/server.mjs).
   A tela nunca fala direto com o banco: o servidor guarda a chave secreta. */

export class ApiError extends Error {
  constructor(status, message, fields) { super(message); this.status = status; this.fields = fields || {}; }
}

async function call(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(`/api/${path}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new ApiError(0, "Sem conexão com o servidor do painel. Ele está rodando neste computador?");
  }
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) throw new ApiError(response.status, data?.error || "Algo deu errado. Tente de novo.", data?.fields);
  return data;
}

const query = (filters) => {
  const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
  const text = params.toString();
  return text ? `?${text}` : "";
};

export const api = {
  health: () => call("health"),
  listClients: () => call("clients"),
  createClient: (data) => call("clients", { method: "POST", body: data }),
  updateClient: (id, data) => call(`clients/${id}`, { method: "PATCH", body: data }),
  deleteClient: (id) => call(`clients/${id}`, { method: "DELETE" }),
  listContents: (filters = {}) => call(`contents${query(filters)}`),
  getContent: (id) => call(`contents/${id}`),
  createContent: (data) => call("contents", { method: "POST", body: data }),
  updateContent: (id, data) => call(`contents/${id}`, { method: "PATCH", body: data }),
  deleteContent: (id) => call(`contents/${id}`, { method: "DELETE" })
};

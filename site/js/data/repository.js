/* ==========================================================================
   Repositório de dados
   --------------------------------------------------------------------------
   A interface abaixo é o único ponto de contato da tela com os dados. Hoje
   existe só a implementação de DEMONSTRAÇÃO (createDemoRepository): os
   conteúdos vêm de demo-data.js e o que o cliente faz (aprovar, pedir ajuste,
   observar, enviar ideia) fica salvo SÓ NESTE NAVEGADOR (localStorage).
   Nada é enviado para a Digital Galaxy ainda.

   Para ligar um backend de verdade (ex.: Supabase com login por cliente),
   basta criar outra implementação com os mesmos métodos e trocá-la em
   js/main.js. O painel administrativo usará a mesma interface, com métodos
   de escrita a mais (salvar plano, salvar atividade, mudar versão etc.).

   Métodos (todos assíncronos):
     getClient()                         → Client
     getPlan(month)                      → Plan | null   (só planos "compartilhado")
     listActivities(month)               → Activity[]
     listApprovals(activityIds)          → Approval[]
     listComments(activityId)            → Comment[]
     countComments(activityIds)          → { [activityId]: number }
     addApproval({activityId, version, decision, message}) → Approval
     addComment({activityId, text})      → Comment
     listIdeas()                         → Idea[]
     addIdea({title, description, suggestedDate}) → Idea
     updateIdea({id, title, description, suggestedDate}) → Idea
     resetDemo()                         → apaga o que foi feito neste navegador
   ========================================================================== */

import { buildDemoData } from "./demo-data.js";
import { nowStamp } from "../lib/dates.js";

const STORAGE_KEY = "dg-portal-clientes:demo:v1";

/* localStorage pode não existir (modo privado, bloqueio): a demonstração segue só na memória */
const storage = {
  read() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
  },
  write(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); return true; } catch { return false; }
  },
  clear() {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* sem armazenamento */ }
  }
};

const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function createDemoRepository() {
  const seed = buildDemoData();
  // Registros criados pelo cliente neste navegador
  let local = { approvals: [], comments: [], ideas: [], ideaEdits: {}, ...storage.read() };
  const persist = () => storage.write(local);

  const all = (kind) => [...seed[kind], ...local[kind]];

  return {
    isDemo: true,

    async getClient() { return seed.client; },

    async getPlan(month) {
      return seed.plans.find((p) => p.month === month && p.visibility === "compartilhado") || null;
    },

    async listActivities(month) {
      return seed.activities
        .filter((a) => a.date.startsWith(month))
        .sort((a, b) => (a.date + (a.time || "99")).localeCompare(b.date + (b.time || "99")));
    },

    async listApprovals(activityIds) {
      const ids = new Set(activityIds);
      return all("approvals").filter((a) => ids.has(a.activityId));
    },

    async listComments(activityId) {
      return all("comments").filter((c) => c.activityId === activityId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async countComments(activityIds) {
      const counts = {};
      all("comments").forEach((c) => { if (activityIds.includes(c.activityId)) counts[c.activityId] = (counts[c.activityId] || 0) + 1; });
      return counts;
    },

    async addApproval({ activityId, version, decision, message = "" }) {
      const approval = { id: uid("apr"), activityId, version, decision, message: message.trim(), author: seed.author, createdAt: nowStamp() };
      local.approvals.push(approval);
      persist();
      return approval;
    },

    async addComment({ activityId, text }) {
      const comment = { id: uid("com"), activityId, author: seed.author, text: text.trim(), createdAt: nowStamp() };
      local.comments.push(comment);
      persist();
      return comment;
    },

    async listIdeas() {
      return all("ideas")
        .map((idea) => ({ ...idea, ...(local.ideaEdits[idea.id] || {}) }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async addIdea({ title, description, suggestedDate }) {
      const idea = { id: uid("idea"), clientId: seed.client.id, title: title.trim(), description: description.trim(), suggestedDate: suggestedDate || undefined, status: "recebida", createdAt: nowStamp() };
      local.ideas.push(idea);
      persist();
      return idea;
    },

    async updateIdea({ id, title, description, suggestedDate }) {
      const changes = { title: title.trim(), description: description.trim(), suggestedDate: suggestedDate || undefined, updatedAt: nowStamp() };
      const own = local.ideas.find((idea) => idea.id === id);
      if (own) Object.assign(own, changes);          // ideia criada neste navegador
      else local.ideaEdits[id] = changes;            // ideia da demonstração: guarda só a edição
      persist();
      return (await this.listIdeas()).find((idea) => idea.id === id);
    },

    async resetDemo() {
      storage.clear();
      local = { approvals: [], comments: [], ideas: [], ideaEdits: {} };
    }
  };
}

/* Avisos no celular/computador (Web Push): a pessoa ativa NESTE aparelho e os
   avisos do sininho passam a chegar mesmo com o painel fechado.
   - Só com o aceite da pessoa (permissão do navegador) e só para quem ativou:
     trocar de usuário no mesmo aparelho não herda os avisos do anterior.
   - Sair do painel desliga os avisos deste aparelho no servidor.
   - No iPhone a Apple só permite com o painel na Tela de Início.
   O aparelho assina com a chave pública da agência; o envio é da função
   "avisos-push" (supabase/functions/avisos-push). */

import { esc, on } from "../../../js/lib/dom.js?v=6303f0a5a4";
import { icon } from "../../../js/lib/icons.js?v=6303f0a5a4";

const OWNER_KEY = "dg-painel-avisos-de";   // quem ativou os avisos neste navegador
const bytes = (b64) => Uint8Array.from(atob(String(b64).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const remember = (id) => { try { if (id) localStorage.setItem(OWNER_KEY, id); else localStorage.removeItem(OWNER_KEY); } catch { /* só não lembra */ } };
const owner = () => { try { return localStorage.getItem(OWNER_KEY); } catch { return null; } };

export function setupPush({ api, toast }) {
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const installed = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
  let registration = null;
  let subscription = null;
  let userId = null;
  let active = false;     // este aparelho está recebendo os avisos da pessoa logada
  let busy = false;
  let host = null;

  const register = async () => (registration ||= await navigator.serviceWorker.register("./sw.js", { scope: "./" }));
  const keysOf = (sub) => { const j = sub.toJSON(); return { endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth }; };

  function status() {
    if (!supported) return ios && !installed() ? "iphone" : "sem-suporte";
    if (Notification.permission === "denied") return "bloqueado";
    return active ? "ativo" : "inativo";
  }
  function paint() {
    if (!host?.isConnected) return;
    const s = status();
    const lock = busy ? " disabled" : "";
    host.className = `inbox__push inbox__push--${s}`;
    host.innerHTML = {
      ativo: `<p class="inbox__push-text">${icon("check")}<span><b>Avisos ativados neste aparelho.</b> Chegam mesmo com o painel fechado.</span></p>
        <p class="inbox__push-actions"><button class="link-btn" type="button" data-push="teste"${lock}>Enviar um teste</button><button class="link-btn" type="button" data-push="desativar"${lock}>Desativar</button></p>`,
      inativo: `<p class="inbox__push-text">${icon("bell")}<span>Receba estes avisos no celular ou no computador, como num aplicativo.</span></p>
        <button class="btn btn--primary btn--sm" type="button" data-push="ativar"${lock}>${busy ? "Ativando…" : "Ativar avisos neste aparelho"}</button>`,
      bloqueado: `<p class="inbox__push-text">${icon("lock")}<span><b>Os avisos estão bloqueados neste navegador.</b> Libere as notificações deste site nas configurações do navegador e volte aqui.</span></p>`,
      iphone: `<p class="inbox__push-text">${icon("bell")}<span><b>Avisos no iPhone:</b> no Safari, toque em Compartilhar e em "Adicionar à Tela de Início". Depois abra o painel pelo ícone novo e ative aqui.</span></p>`,
      "sem-suporte": `<p class="inbox__push-text">${icon("bell")}<span>Este navegador não recebe avisos. Use o Chrome (Android ou computador) ou, no iPhone, o Safari com o painel na Tela de Início.</span></p>`
    }[s];
  }

  /** Confere o estado deste aparelho; se foi esta pessoa que ativou, garante que o servidor sabe */
  async function sync() {
    active = false;
    if (!supported || !userId) { paint(); return; }
    try {
      subscription = await (await register()).pushManager.getSubscription();
      if (subscription && Notification.permission === "granted" && owner() === userId) {
        await api.pushSubscribe({ ...keysOf(subscription), agent: navigator.userAgent });
        active = true;
      }
    } catch { /* sem conexão agora: tenta de novo na próxima vez */ }
    paint();
  }

  async function enable() {
    busy = true; paint();
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { toast(permission === "denied" ? "Avisos bloqueados neste navegador." : "Você não liberou os avisos.", "info"); return; }
      const reg = await register();
      await navigator.serviceWorker.ready;
      const { public_key: key } = await api.pushKey();
      const options = { userVisibleOnly: true, applicationServerKey: bytes(key) };
      try { subscription = await reg.pushManager.subscribe(options); }
      catch {
        // Assinatura antiga (de outra chave): troca por uma nova
        await (await reg.pushManager.getSubscription())?.unsubscribe();
        subscription = await reg.pushManager.subscribe(options);
      }
      await api.pushSubscribe({ ...keysOf(subscription), agent: navigator.userAgent });
      remember(userId);
      active = true;
      toast("Avisos ativados neste aparelho");
      api.pushTest().catch(() => toast("Ativado, mas o aviso de teste não saiu. Toque em \"Enviar um teste\".", "info"));
    } catch (error) {
      toast(error?.status ? error.message : "Não foi possível ativar os avisos neste navegador.", "error");
    } finally { busy = false; paint(); }
  }
  async function disable({ quiet = false } = {}) {
    busy = true; paint();
    try {
      if (subscription) {
        await api.pushUnsubscribe(subscription.endpoint).catch(() => {});
        await subscription.unsubscribe().catch(() => {});
      }
      subscription = null;
      active = false;
      remember(null);
      if (!quiet) toast("Avisos desativados neste aparelho");
    } finally { busy = false; paint(); }
  }
  async function test() {
    busy = true; paint();
    try { await api.pushTest(); toast("Teste enviado: deve chegar em instantes"); }
    catch (error) { toast(error.message, "error"); if (error.status === 409) await sync(); }
    finally { busy = false; paint(); }
  }

  on(document, "click", "[data-push]", (event, b) => {
    if (busy || !host?.contains(b)) return;
    const act = { ativar: enable, desativar: () => disable(), teste: test }[b.dataset.push];
    // Depois dos outros cliques da página: redesenhar agora tiraria o botão da tela e o painel de avisos se fecharia
    if (act) setTimeout(act, 0);
  });

  return {
    /** Depois do login: registra o receptor e confere este aparelho */
    start(id) { userId = id; return sync(); },
    /** Antes de sair: este aparelho para de receber os avisos desta pessoa (a escolha fica lembrada para a volta) */
    async beforeSignOut() {
      if (active && subscription) await api.pushUnsubscribe(subscription.endpoint).catch(() => {});
      active = false; userId = null;
    },
    /** Desenha o bloco dentro do painel de avisos */
    mount(el) { host = el; paint(); },
    status
  };
}

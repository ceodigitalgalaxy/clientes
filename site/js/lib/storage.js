/* ==========================================================================
   Arquivos no Supabase Storage (painel e portal)
   --------------------------------------------------------------------------
   - client-logos  (público): foto/logo de cada cliente.
   - content-media (privado): arte final. O navegador recebe só links
     assinados, que valem por pouco tempo, e o banco decide quem pode
     assinar (equipe: tudo; cliente: só a arte liberada do próprio cliente).
   Sempre com a sessão de quem entrou (token), nunca com a chave secreta.
   ========================================================================== */

export class StorageError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Limites (iguais aos dos buckets no banco) */
export const UPLOAD_LIMITS = {
  logoBytes: 2 * 1024 * 1024,
  mediaBytes: 50 * 1024 * 1024,
  logoTypes: ["image/png", "image/jpeg", "image/webp"],
  mediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4", "video/webm", "video/quicktime"]
};

const EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };

/** Nome de arquivo seguro e único: <aleatório>.<extensão> */
export function fileName(type) {
  const id = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`).replace(/[^a-z0-9-]/gi, "");
  return `${id}.${EXTENSIONS[type] || "bin"}`;
}

const sizeLabel = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(0)} MB` : `${Math.ceil(bytes / 1024)} KB`);

/** Confere tipo e tamanho antes de enviar; devolve a mensagem do problema ou null */
export function fileProblem(file, { types, maxBytes }) {
  if (!file) return "Escolha um arquivo.";
  if (!types.includes(file.type)) return `Formato não aceito (${file.name}). Use ${[...new Set(types.map((t) => EXTENSIONS[t]))].join(", ")}.`;
  if (file.size > maxBytes) return `${file.name} tem ${sizeLabel(file.size)}; o limite é ${sizeLabel(maxBytes)}. Para vídeos maiores, use um link (Drive, YouTube...).`;
  return null;
}

/**
 * @param {object} options
 * @param {string} options.url      endereço do Supabase
 * @param {string} options.apiKey   chave publicável
 * @param {() => Promise<string>} options.getToken
 * @param {() => Promise<unknown>} [options.refresh]
 */
export function createStorage({ url, apiKey, getToken, refresh = async () => {}, fetchImpl = globalThis.fetch?.bind(globalThis), XHR = globalThis.XMLHttpRequest }) {
  const base = `${url.replace(/\/+$/, "")}/storage/v1`;
  const encodePath = (path) => path.split("/").map(encodeURIComponent).join("/");

  async function request(path, init, retry = true) {
    const token = await getToken();
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, { ...init, headers: { apikey: apiKey, Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
    } catch {
      throw new StorageError(503, "Não foi possível conectar. Verifique a internet e tente de novo.");
    }
    const data = await response.json().catch(() => null);
    // Token vencido aparece como 401/403 (ou 400 com statusCode 403) no Storage: renova uma vez
    const denied = response.status === 401 || response.status === 403 || (response.status === 400 && ["401", "403"].includes(String(data?.statusCode)));
    if (denied && retry && /jwt|token|expired/i.test(String(data?.message || data?.error || "jwt"))) {
      await refresh();
      return request(path, init, false);
    }
    if (!response.ok) throw new StorageError(response.status, data?.message ? `Arquivo: ${data.message}` : "Não foi possível acessar os arquivos agora.");
    return data;
  }

  return {
    publicUrl: (bucket, path) => (path ? `${base}/object/public/${bucket}/${encodePath(path)}` : null),

    /** Envia um arquivo; onProgress recebe de 0 a 1 */
    async upload(bucket, path, file, { onProgress } = {}) {
      const token = await getToken();
      return new Promise((resolve, reject) => {
        const xhr = new XHR();
        xhr.open("POST", `${base}/object/${bucket}/${encodePath(path)}`);
        xhr.setRequestHeader("apikey", apiKey);
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.setRequestHeader("x-upsert", "false");
        xhr.setRequestHeader("cache-control", "max-age=31536000");
        if (onProgress && xhr.upload) xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(event.loaded / event.total); };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) { onProgress?.(1); resolve(path); return; }
          let message = "";
          try { message = JSON.parse(xhr.responseText)?.message || ""; } catch { /* sem detalhe */ }
          if (xhr.status === 413 || /size/i.test(message)) reject(new StorageError(413, "Arquivo grande demais para o armazenamento."));
          else if (/mime|type/i.test(message)) reject(new StorageError(415, "Formato de arquivo não aceito."));
          else reject(new StorageError(xhr.status, "Não foi possível enviar o arquivo. Tente de novo."));
        };
        xhr.onerror = () => reject(new StorageError(503, "A conexão caiu durante o envio. Tente de novo."));
        xhr.send(file);
      });
    },

    async remove(bucket, paths) {
      const list = paths.filter(Boolean);
      if (!list.length) return;
      await request(`/object/${bucket}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: list }) });
    },

    /** Links temporários para arquivos privados: { [path]: url } (só os permitidos) */
    async sign(bucket, paths, expiresIn = 3600) {
      const list = [...new Set(paths.filter(Boolean))];
      if (!list.length) return {};
      const data = await request(`/object/sign/${bucket}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn, paths: list }) });
      const out = {};
      for (const item of Array.isArray(data) ? data : []) {
        if (item?.signedURL && !item.error) out[item.path] = `${base}${item.signedURL.startsWith("/") ? "" : "/"}${item.signedURL}`;
      }
      return out;
    }
  };
}

/** Diminui uma foto no navegador (lado maior até `max` px) e devolve WebP (ou PNG) */
export async function resizeImage(file, max = 512) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
  if (blob && blob.type === "image/webp") return new File([blob], "logo.webp", { type: "image/webp" });
  const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return new File([png], "logo.png", { type: "image/png" });
}

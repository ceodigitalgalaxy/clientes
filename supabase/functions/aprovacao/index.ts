// Função "aprovacao": a página pública de aprovação (sem login) fala só com ela.
// Toda a lógica está em handler.js (testada em admin/test).
// verify_jwt fica desligado: quem abre o link não tem login; a função confere o
// token do link no banco a cada pedido.
import { createHandler, keysFromEnv } from "./handler.js";

const handler = createHandler(keysFromEnv((name) => Deno.env.get(name)));

Deno.serve(handler);

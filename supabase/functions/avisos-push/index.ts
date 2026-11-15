// Função "avisos-push": manda os avisos do sininho para o celular/computador
// da equipe (Web Push). Toda a lógica está em handler.js e webpush.js
// (testadas em admin/test).
// verify_jwt fica desligado: quem chama é o banco (com o segredo do gancho,
// conferido no próprio banco) ou a pessoa logada (login conferido no código).
import { createHandler, keysFromEnv } from "./handler.js";

const handler = createHandler(keysFromEnv((name) => Deno.env.get(name)));

Deno.serve(handler);

// Função "acesso-cliente": a equipe cria, troca a senha e remove logins de cliente
// pelo painel da agência. Toda a lógica está em handler.js (testada em admin/test).
// verify_jwt fica desligado: a função confere o login de quem chama no próprio código.
import { createHandler, keysFromEnv } from "./handler.js";

const handler = createHandler(keysFromEnv((name) => Deno.env.get(name)));

Deno.serve(handler);

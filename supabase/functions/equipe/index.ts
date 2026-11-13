// Função "equipe": o ADMINISTRADOR cria logins da equipe (colaboradores e
// administradores), troca a senha e ativa/desativa o acesso pelo painel.
// Toda a lógica está em handler.js (testada em admin/test).
// verify_jwt fica desligado: a função confere o login de quem chama no próprio código.
import { createHandler, keysFromEnv } from "./handler.js";

const handler = createHandler(keysFromEnv((name) => Deno.env.get(name)));

Deno.serve(handler);

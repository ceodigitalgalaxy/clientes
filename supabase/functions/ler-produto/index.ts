// Função "ler-produto": o gerador de artes manda o link de um produto e recebe
// nome, descrição, preço e foto. Toda a lógica está em handler.js (testada em admin/test).
// verify_jwt fica desligado: a função confere o login de quem chama no próprio código.
import { createHandler, keysFromEnv } from "./handler.js";

const handler = createHandler(keysFromEnv((name) => Deno.env.get(name)));

Deno.serve(handler);

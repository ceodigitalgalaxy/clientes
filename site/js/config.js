/* Endereço do banco e chave PUBLICÁVEL do Supabase.
   A chave publicável é feita para ficar no navegador: sozinha, ela não dá
   acesso a nenhum dado (o banco recusa visitantes sem login). Quem protege os
   dados são o login e as regras de acesso (RLS) em supabase/migrations.
   NUNCA coloque aqui a chave secreta (sb_secret_...). */

export const SUPABASE_URL = "https://peieimwpkrattuldmjux.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ahRYPZLLinQh81B-GQRX3Q_xfZxa1r2";

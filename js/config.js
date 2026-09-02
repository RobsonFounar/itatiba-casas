// Supabase (Settings → API). A chave anon é pública; a segurança fica nas políticas RLS.
// Nunca coloque a service_role key aqui.
//
// Depois do primeiro login, marque o admin no SQL Editor:
//   update public.profiles set role = 'admin' where email = 'seu@email.com';
window.ITATIBA_CONFIG = {
  supabaseUrl: "https://sljhacgmyklxwremjwah.supabase.co",
  supabaseAnonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNsamhhY2dteWtseHdyZW1qd2FoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzMDQ0MzAsImV4cCI6MjEwMzg4MDQzMH0.EzlsimJKCdfcA_i22p_kTVeFtKoafjN7Jg59xw1R4r0",
};

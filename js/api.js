(() => {
  const CONFIG_LS_KEY = "itatiba-supabase-config";
  let client = null;
  let bootstrapped = false;

  function mergeConfig() {
    const base = window.ITATIBA_CONFIG || {};
    try {
      const local = JSON.parse(localStorage.getItem(CONFIG_LS_KEY) || "{}");
      return {
        supabaseUrl: String(local.supabaseUrl || base.supabaseUrl || "").trim(),
        supabaseAnonKey: String(local.supabaseAnonKey || base.supabaseAnonKey || "").trim(),
      };
    } catch {
      return {
        supabaseUrl: String(base.supabaseUrl || "").trim(),
        supabaseAnonKey: String(base.supabaseAnonKey || "").trim(),
      };
    }
  }

  function isConfigured() {
    const cfg = mergeConfig();
    return Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  }

  function saveLocalConfig(partial) {
    const current = mergeConfig();
    const next = {
      supabaseUrl: String(partial.supabaseUrl ?? current.supabaseUrl ?? "").trim(),
      supabaseAnonKey: String(partial.supabaseAnonKey ?? current.supabaseAnonKey ?? "").trim(),
    };
    localStorage.setItem(CONFIG_LS_KEY, JSON.stringify(next));
    client = null;
    bootstrapped = false;
    return next;
  }

  function getClient() {
    if (!isConfigured()) {
      throw new Error("Supabase não configurado. Preencha js/config.js ou a tela de configuração.");
    }
    if (!client) {
      const cfg = mergeConfig();
      client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
    }
    return client;
  }

  function mapHouse(row, extras = {}) {
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      title: row.title || "",
      bairro: row.bairro || "",
      address: row.address || "",
      notes: row.notes || "",
      lat: Number(row.lat),
      lng: Number(row.lng),
      precision: row.loc_precision || "bairro",
      toSchool: row.to_school || null,
      toCentro: row.to_centro || null,
      ownerEmail: extras.ownerEmail || row.owner_email || "",
      ownerName: extras.ownerName || row.owner_name || "",
      canEdit: extras.canEdit !== undefined ? extras.canEdit : Boolean(extras.canEdit),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function toRow(house, userId) {
    return {
      id: house.id,
      user_id: house.userId || userId,
      title: house.title || "",
      bairro: house.bairro || "",
      address: house.address || "",
      notes: house.notes || "",
      lat: house.lat,
      lng: house.lng,
      loc_precision: house.precision || "bairro",
      to_school: house.toSchool || null,
      to_centro: house.toCentro || null,
    };
  }

  async function getSession() {
    const { data, error } = await getClient().auth.getSession();
    if (error) throw error;
    return data.session || null;
  }

  async function getUser() {
    const session = await getSession();
    return session?.user || null;
  }

  async function getProfile() {
    const user = await getUser();
    if (!user) return null;
    const { data, error } = await getClient()
      .from("profiles")
      .select("id, email, display_name, role")
      .eq("id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return {
        id: user.id,
        email: user.email || "",
        displayName: user.user_metadata?.full_name || user.email || "",
        role: "user",
      };
    }
    return {
      id: data.id,
      email: data.email || user.email || "",
      displayName: data.display_name || "",
      role: data.role || "user",
    };
  }

  function authErrorMessage(error) {
    const msg = String(error?.message || error || "Erro de autenticação");
    if (/Invalid login credentials/i.test(msg)) return "Email ou senha incorretos.";
    if (/Email not confirmed/i.test(msg)) return "Confirme o email antes de entrar.";
    if (/User already registered/i.test(msg)) return "Este email já tem conta. Entre com a senha.";
    if (/Password should be at least/i.test(msg)) return "A senha precisa ter pelo menos 6 caracteres.";
    return msg;
  }

  async function signUp(email, password) {
    const { data, error } = await getClient().auth.signUp({
      email: email.trim(),
      password,
    });
    if (error) throw new Error(authErrorMessage(error));
    return data;
  }

  async function signIn(email, password) {
    const { data, error } = await getClient().auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw new Error(authErrorMessage(error));
    return data;
  }

  async function signInWithGoogle() {
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { data, error } = await getClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) throw new Error(authErrorMessage(error));
    return data;
  }

  async function signOut() {
    const { error } = await getClient().auth.signOut();
    if (error) throw error;
  }

  function onAuthStateChange(callback) {
    return getClient().auth.onAuthStateChange((event, session) => {
      callback(event, session);
    });
  }

  async function listMyHouses() {
    const user = await getUser();
    if (!user) return [];
    const { data, error } = await getClient()
      .from("houses")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data || []).map((row) =>
      mapHouse(row, {
        ownerEmail: user.email || "",
        canEdit: true,
      })
    );
  }

  async function listHousesByOwner(ownerId, canEdit = false) {
    const { data, error } = await getClient()
      .from("houses")
      .select("*")
      .eq("user_id", ownerId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data || []).map((row) => mapHouse(row, { canEdit: Boolean(canEdit) }));
  }

  async function listAllHouses() {
    const { data, error } = await getClient()
      .from("houses")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data || []).map((row) =>
      mapHouse(row, {
        canEdit: false,
      })
    );
  }

  async function upsertHouse(house) {
    const user = await getUser();
    if (!user) throw new Error("Não autenticado");
    const row = toRow(house, user.id);
    if (!row.user_id) row.user_id = user.id;

    // Convidado com can_edit: só UPDATE (RLS bloqueia INSERT com user_id de outro).
    if (row.user_id !== user.id) {
      const { data, error } = await getClient()
        .from("houses")
        .update({
          title: row.title,
          bairro: row.bairro,
          address: row.address,
          notes: row.notes,
          lat: row.lat,
          lng: row.lng,
          loc_precision: row.loc_precision,
          to_school: row.to_school,
          to_centro: row.to_centro,
        })
        .eq("id", row.id)
        .select("*")
        .single();
      if (error) throw error;
      return mapHouse(data, {
        canEdit: Boolean(house.canEdit),
        ownerEmail: house.ownerEmail || "",
        ownerName: house.ownerName || "",
      });
    }

    const { data, error } = await getClient()
      .from("houses")
      .upsert(row, { onConflict: "id" })
      .select("*")
      .single();
    if (error) throw error;
    return mapHouse(data, {
      canEdit: true,
      ownerEmail: house.ownerEmail || user.email || "",
      ownerName: house.ownerName || "",
    });
  }

  async function deleteHouse(id) {
    const { error } = await getClient().from("houses").delete().eq("id", id);
    if (error) throw error;
  }

  async function clearMyHouses() {
    const user = await getUser();
    if (!user) return;
    const { error } = await getClient().from("houses").delete().eq("user_id", user.id);
    if (error) throw error;
  }

  async function migrateLocalHouses(houses) {
    const user = await getUser();
    if (!user || !Array.isArray(houses) || !houses.length) return [];
    const rows = houses.map((house) => {
      const row = toRow(house, user.id);
      row.user_id = user.id;
      if (!row.id) row.id = crypto.randomUUID();
      return row;
    });
    const { data, error } = await getClient()
      .from("houses")
      .upsert(rows, { onConflict: "id" })
      .select("*");
    if (error) throw error;
    return (data || []).map((row) => mapHouse(row, { canEdit: true, ownerEmail: user.email || "" }));
  }

  async function shareListWithEmail(email, canEdit) {
    const { data, error } = await getClient().rpc("share_list_with_email", {
      target_email: email.trim(),
      p_can_edit: Boolean(canEdit),
    });
    if (error) throw new Error(error.message || "Não foi possível compartilhar.");
    return data;
  }

  async function listOutgoingShares() {
    const { data, error } = await getClient().rpc("list_outgoing_shares");
    if (error) throw error;
    return (data || []).map((row) => ({
      id: row.id,
      sharedWithUserId: row.shared_with_user_id,
      email: row.shared_with_email || "",
      name: row.shared_with_name || "",
      canEdit: Boolean(row.can_edit),
      createdAt: row.created_at,
    }));
  }

  async function listIncomingShares() {
    const { data, error } = await getClient().rpc("list_incoming_shares");
    if (error) throw error;
    return (data || []).map((row) => ({
      id: row.id,
      ownerId: row.owner_id,
      email: row.owner_email || "",
      name: row.owner_name || "",
      canEdit: Boolean(row.can_edit),
      createdAt: row.created_at,
    }));
  }

  async function revokeShare(shareId) {
    const { error } = await getClient().from("list_shares").delete().eq("id", shareId);
    if (error) throw error;
  }

  async function adminListOwners() {
    const { data, error } = await getClient().rpc("admin_list_owners");
    if (error) throw error;
    return (data || []).map((row) => ({
      ownerId: row.owner_id,
      email: row.owner_email || "",
      name: row.owner_name || "",
      houseCount: Number(row.house_count || 0),
    }));
  }

  async function bootstrap() {
    if (bootstrapped) return getSession();
    if (!isConfigured()) return null;
    getClient();
    bootstrapped = true;
    return getSession();
  }

  window.ItatibaAPI = {
    CONFIG_LS_KEY,
    isConfigured,
    mergeConfig,
    saveLocalConfig,
    getClient,
    bootstrap,
    getSession,
    getUser,
    getProfile,
    signUp,
    signIn,
    signInWithGoogle,
    signOut,
    onAuthStateChange,
    listMyHouses,
    listHousesByOwner,
    listAllHouses,
    upsertHouse,
    deleteHouse,
    clearMyHouses,
    migrateLocalHouses,
    shareListWithEmail,
    listOutgoingShares,
    listIncomingShares,
    revokeShare,
    adminListOwners,
  };
})();

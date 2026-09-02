(() => {
  const STORAGE_KEY = "itatiba-casas-v1";
  const GEOCACHE_KEY = "itatiba-geocode-cache-v1";
  const FIXED_SCHOOL = {
    id: "school",
    name: "Colégio São José",
    subtitle: "Antigo Rancho Paumar",
    address: "Estr. Mun. Alexandre Marchi, 21 — Tapera Grande, Itatiba - SP, 13255-733",
    lat: -23.0483583,
    lng: -46.8775538,
    color: "#1a73e8",
  };
  const FIXED_CENTRO = {
    id: "centro",
    name: "Centro",
    subtitle: "Praça da Bandeira",
    address: "Praça da Bandeira, Centro, Itatiba - SP",
    lat: -23.0052478,
    lng: -46.8399019,
    color: "#188038",
  };
  const ITATIBA = {
    center: [-23.0056, -46.8389],
    south: -23.16,
    west: -46.98,
    north: -22.90,
    east: -46.66,
  };

  const ICON_SCHOOL = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3 1 9l11 6 9-4.91V17h2V9L12 3z"/></svg>`;
  const ICON_CENTRO = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21V10h5V6l4-3 4 3v4h5v11"/><path d="M7 21v-4h3v4"/><path d="M14 21v-6h3v6"/><path d="M6 13h2"/><path d="M6 16h2"/><path d="M16 13h2"/></svg>`;

  const API = window.ItatibaAPI;
  const els = {
    authScreen: document.getElementById("auth-screen"),
    authCard: document.getElementById("auth-card"),
    appShell: document.getElementById("app-shell"),
    panelBody: document.getElementById("panel-body"),
    schoolCard: document.getElementById("school-card"),
    sortBy: document.getElementById("sort-by"),
    btnAdd: document.getElementById("btn-add"),
    btnMenu: document.getElementById("btn-menu"),
    menuPop: document.getElementById("menu-pop"),
    menuUser: document.getElementById("menu-user"),
    menuShared: document.getElementById("menu-shared"),
    menuAdmin: document.getElementById("menu-admin"),
    menuMine: document.getElementById("menu-mine"),
    scopeBar: document.getElementById("scope-bar"),
    importFile: document.getElementById("import-file"),
    mapHint: document.getElementById("map-hint"),
    navBanner: document.getElementById("nav-banner"),
    toast: document.getElementById("toast"),
  };

  const state = {
    school: null,
    houses: [],
    selectedId: null,
    expandedId: null,
    view: "list",
    clickMode: null,
    searchHits: [],
    searchActive: -1,
    editingId: null,
    draftPoint: null,
    routeFocus: "school",
    user: null,
    profile: null,
    authMode: "login",
    authError: "",
    scope: "mine",
    sharedOwnerId: null,
    sharedOwnerLabel: "",
    sharedCanEdit: false,
    incomingShares: [],
    outgoingShares: [],
    adminOwners: [],
    mapReady: false,
    saveTimer: null,
  };

  let map;
  let houseLayer;
  let schoolLayer;
  let routeLayer;
  let searchTimer;
  let toastTimer;

  function readLocalHouses() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return Array.isArray(raw.houses) ? raw.houses : [];
    } catch {
      return [];
    }
  }

  function clearLocalHouses() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function isAdmin() {
    return state.profile?.role === "admin";
  }

  function canEditHouse(house) {
    if (!state.user || !house) return false;
    if (house.userId === state.user.id) return true;
    return Boolean(house.canEdit);
  }

  function canAddHouses() {
    if (!state.user) return false;
    if (state.scope === "mine") return true;
    if (state.scope === "shared") return Boolean(state.sharedCanEdit);
    return false;
  }

  async function loadHousesFromCloud() {
    if (state.scope === "all" && isAdmin()) {
      const houses = await API.listAllHouses();
      const owners = await API.adminListOwners();
      state.adminOwners = owners;
      const byId = Object.fromEntries(owners.map((o) => [o.ownerId, o]));
      state.houses = houses.map((h) => ({
        ...h,
        ownerEmail: byId[h.userId]?.email || h.ownerEmail || "",
        ownerName: byId[h.userId]?.name || h.ownerName || "",
        canEdit: false,
      }));
      return;
    }
    if (state.scope === "shared" && state.sharedOwnerId) {
      state.houses = await API.listHousesByOwner(
        state.sharedOwnerId,
        state.sharedCanEdit
      );
      return;
    }
    state.scope = "mine";
    state.sharedOwnerId = null;
    state.sharedOwnerLabel = "";
    state.sharedCanEdit = false;
    state.houses = await API.listMyHouses();
  }

  async function refreshSharesMeta() {
    try {
      state.incomingShares = await API.listIncomingShares();
      state.outgoingShares = await API.listOutgoingShares();
    } catch {
      state.incomingShares = [];
      state.outgoingShares = [];
    }
    els.menuShared?.classList.toggle("hidden", !state.incomingShares.length);
    els.menuAdmin?.classList.toggle("hidden", !isAdmin());
    els.menuMine?.classList.toggle(
      "hidden",
      state.scope === "mine" || (!isAdmin() && !state.incomingShares.length)
    );
  }

  async function load() {
    state.school = { ...FIXED_SCHOOL };
    await loadHousesFromCloud();
    await refreshSharesMeta();
  }

  function scheduleSaveHouse(house) {
    if (!house || !canEditHouse(house)) return;
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
      persistHouse(house).catch((err) => {
        console.error(err);
        toast("Não foi possível salvar na nuvem.");
      });
    }, 350);
  }

  async function persistHouse(house) {
    if (!canEditHouse(house)) return house;
    const saved = await API.upsertHouse(house);
    const idx = state.houses.findIndex((item) => item.id === house.id);
    if (idx >= 0) {
      state.houses[idx] = {
        ...state.houses[idx],
        ...saved,
        canEdit: canEditHouse({ ...state.houses[idx], ...saved, canEdit: state.houses[idx].canEdit }),
      };
    }
    return saved;
  }

  async function save() {
    const editable = state.houses.filter((house) => canEditHouse(house));
    await Promise.all(editable.map((house) => API.upsertHouse(house)));
  }

  function updateMenuUser() {
    if (!els.menuUser) return;
    const label = state.profile?.email || state.user?.email || "";
    const role = isAdmin() ? " · admin" : "";
    els.menuUser.textContent = label ? `${label}${role}` : "";
  }

  function updateScopeBar() {
    if (!els.scopeBar) return;
    if (state.scope === "mine") {
      els.scopeBar.classList.add("hidden");
      els.scopeBar.innerHTML = "";
      els.btnAdd.disabled = false;
      els.btnAdd.classList.remove("hidden");
      return;
    }
    els.scopeBar.classList.remove("hidden");
    if (state.scope === "all") {
      els.scopeBar.innerHTML = `
        <span>Visão admin: todas as casas</span>
        <button type="button" data-scope="mine">Minhas casas</button>
      `;
      els.btnAdd.classList.add("hidden");
      return;
    }
    const editLabel = state.sharedCanEdit ? "pode editar" : "somente leitura";
    els.scopeBar.innerHTML = `
      <span>Lista de ${esc(state.sharedOwnerLabel || "outro usuário")} · ${editLabel}</span>
      <button type="button" data-scope="mine">Minhas casas</button>
    `;
    els.btnAdd.classList.toggle("hidden", !state.sharedCanEdit);
  }

  function geoCache() {
    try {
      return JSON.parse(localStorage.getItem(GEOCACHE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function putGeoCache(query, result) {
    const cache = geoCache();
    cache[query.toLowerCase()] = result;
    localStorage.setItem(GEOCACHE_KEY, JSON.stringify(cache));
  }

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function linkify(text) {
    const src = String(text || "");
    const re = /https?:\/\/[^\s<>"']+/gi;
    let out = "";
    let last = 0;
    let match;
    while ((match = re.exec(src))) {
      out += esc(src.slice(last, match.index));
      const raw = match[0];
      const trail = (raw.match(/[),.;!?]+$/) || [""])[0];
      const url = trail ? raw.slice(0, -trail.length) : raw;
      out += `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`;
      if (trail) out += esc(trail);
      last = match.index + raw.length;
    }
    out += esc(src.slice(last));
    return out;
  }

  function cleanLabel(label) {
    return String(label || "")
      .replace(/,?\s*Southeast Region,?/gi, "")
      .replace(/,?\s*Brazil,?/gi, "")
      .replace(/,?\s*Brasil,?/gi, "")
      .replace(/\s+,/g, ",")
      .replace(/,\s*$/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : `h-${Date.now()}-${Math.random()}`;
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.add("hidden"), 2800);
  }

  function setHint(text) {
    els.mapHint.textContent = text || "";
    els.mapHint.classList.toggle("visible", Boolean(text));
  }

  function haversineKm(a, b) {
    const toRad = (n) => (n * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function formatKm(km) {
    if (km == null || Number.isNaN(km)) return "—";
    if (km < 1) return `${Math.round(km * 1000)} m`;
    return `${km.toFixed(1).replace(".", ",")} km`;
  }

  function formatMin(min) {
    if (min == null || Number.isNaN(min)) return "—";
    if (min < 1) return "< 1 min";
    return `${Math.round(min)} min`;
  }

  function chipClass(minutes) {
    if (minutes == null) return "neutral";
    if (minutes <= 8) return "";
    if (minutes <= 15) return "warn";
    return "bad";
  }

  function insideItatiba(lat, lng) {
    return (
      lat >= ITATIBA.south &&
      lat <= ITATIBA.north &&
      lng >= ITATIBA.west &&
      lng <= ITATIBA.east
    );
  }

  function fold(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\b(condominio|residencial|loteamento|fechado|cond|bairro|jardim|vila|nucleo)\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function localNames(item) {
    return [item.nome, ...(item.aliases || [])];
  }

  function foldKeep(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function scoreLocal(item, query) {
    const q = fold(query);
    const qKeep = foldKeep(query);
    if (!q || q.length < 2) return 0;
    let best = 0;
    for (const name of localNames(item)) {
      const n = fold(name);
      const nKeep = foldKeep(name);
      if (!n) continue;
      if (nKeep === qKeep) return 120;
      if (n === q) best = Math.max(best, 100);
      if (n.startsWith(q) || q.startsWith(n)) best = Math.max(best, 92);
      if (n.includes(q) || (q.length >= 5 && q.includes(n))) best = Math.max(best, 80);
    }
    return best;
  }

  function closenessLocal(item, query) {
    const qKeep = foldKeep(query);
    let best = 0;
    for (const name of localNames(item)) {
      const nKeep = foldKeep(name);
      if (!nKeep) continue;
      if (nKeep === qKeep) best = Math.max(best, 3);
      else if (qKeep.includes(nKeep) || nKeep.includes(qKeep)) best = Math.max(best, 2);
      else {
        const qTok = new Set(qKeep.split(" "));
        const shared = nKeep.split(" ").filter((tok) => qTok.has(tok)).length;
        if (shared) best = Math.max(best, 1);
      }
    }
    return best;
  }

  function findLocais(query, min = 70) {
    return (window.ITATIBA_LOCAIS || [])
      .map((item) => ({ item, score: scoreLocal(item, query) }))
      .filter((row) => row.score >= min)
      .sort((a, b) => b.score - a.score || closenessLocal(b.item, query) - closenessLocal(a.item, query) || a.item.nome.localeCompare(b.item.nome, "pt-BR"));
  }

  function hitFromLocal(item) {
    if (item.lat == null) return null;
    return {
      lat: item.lat,
      lng: item.lng,
      label: item.address ? `${item.nome} · ${item.address}` : `${item.nome}, Itatiba, SP`,
      name: item.nome,
      tipo: item.tipo,
      address: item.address || "",
    };
  }

  function queryFallbacks(query) {
    const cleaned = query
      .replace(/,?\s*Itatiba.*$/i, "")
      .replace(/,?\s*SP\b.*$/i, "")
      .trim();
    const parts = cleaned
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const list = [cleaned];
    if (parts.length > 1) {
      list.push(parts.slice(1).join(", "));
      list.push(parts[parts.length - 1]);
    }
    list.push(`Condomínio ${cleaned}`);
    list.push(`Residencial ${cleaned}`);
    return [...new Set(list.filter(Boolean))];
  }

  function toHits(items) {
    return items.filter((item) => insideItatiba(item.lat, item.lng));
  }

  async function geocodePhoton(query) {
    const url = new URL("https://photon.komoot.io/api/");
    url.searchParams.set("q", `${query}, Itatiba`);
    url.searchParams.set("lat", String(ITATIBA.center[0]));
    url.searchParams.set("lon", String(ITATIBA.center[1]));
    url.searchParams.set("limit", "8");
    url.searchParams.set("lang", "pt");
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return toHits(
      (data.features || []).map((feat) => {
        const [lng, lat] = feat.geometry.coordinates;
        const props = feat.properties || {};
        const label = [props.name, props.street, props.district, props.city, props.state]
          .filter(Boolean)
          .join(", ");
        return {
          lat,
          lng,
          label: cleanLabel(label || query),
          name: props.name || query,
        };
      })
    );
  }

  async function geocodeNominatim(query) {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "6");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("countrycodes", "br");
    url.searchParams.set("q", `${query}, Itatiba, São Paulo, Brasil`);
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const data = await res.json();
    return toHits(
      data.map((item) => ({
        lat: Number(item.lat),
        lng: Number(item.lon),
        label: cleanLabel(item.display_name),
        name: item.name || query,
      }))
    );
  }

  async function geocode(query) {
    const key = query.trim().toLowerCase();
    const local = findLocais(query);
    const withCoords = local.map((row) => hitFromLocal(row.item)).filter(Boolean);
    if (withCoords.length) {
      putGeoCache(key, withCoords);
      return withCoords;
    }

    const cache = geoCache();
    if (cache[key]?.length) return cache[key];

    const attempts = [
      ...queryFallbacks(query),
      ...local.map((row) => row.item.address).filter(Boolean),
      ...local.map((row) => `Condomínio ${row.item.nome}`),
      ...local.map((row) => row.item.nome),
    ];

    for (const attempt of [...new Set(attempts.filter(Boolean))]) {
      try {
        const photon = await geocodePhoton(attempt);
        if (photon.length) {
          putGeoCache(key, photon);
          return photon;
        }
      } catch {
        /* tenta Nominatim */
      }
      try {
        const nominatim = await geocodeNominatim(attempt);
        if (nominatim.length) {
          putGeoCache(key, nominatim);
          return nominatim;
        }
      } catch {
        /* próxima tentativa */
      }
    }
    putGeoCache(key, []);
    return [];
  }

  async function reverseGeocode(lat, lng) {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", lat);
    url.searchParams.set("lon", lng);
    url.searchParams.set("zoom", "18");
    url.searchParams.set("addressdetails", "1");
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const data = await res.json();
    const addr = data.address || {};
    return {
      label: data.display_name,
      bairro:
        addr.suburb ||
        addr.neighbourhood ||
        addr.quarter ||
        addr.village ||
        addr.hamlet ||
        "",
      road: [addr.road, addr.house_number].filter(Boolean).join(", "),
    };
  }

  async function routeBetween(from, to) {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true&annotations=false`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("rota");
    const data = await res.json();
    const route = data.routes && data.routes[0];
    if (!route) throw new Error("rota");
    const rawSteps = (route.legs || []).flatMap((leg) => leg.steps || []);
    return {
      km: route.distance / 1000,
      min: route.duration / 60,
      geometry: route.geometry,
      steps: compactSteps(rawSteps),
    };
  }

  function describeStep(step) {
    const type = step.maneuver?.type || "";
    const mod = step.maneuver?.modifier || "";
    const road = step.name ? step.name : "a via";
    const turns = {
      uturn: "Retorne",
      "sharp right": "Vire bem à direita",
      right: "Vire à direita",
      "slight right": "Mantenha-se à direita",
      straight: "Siga em frente",
      "slight left": "Mantenha-se à esquerda",
      left: "Vire à esquerda",
      "sharp left": "Vire bem à esquerda",
    };
    const turn = turns[mod] || "Continue";
    if (type === "depart") return `Siga por ${road}`;
    if (type === "arrive") return "Chegue ao destino";
    if (type === "roundabout" || type === "rotary") return `Entre na rotatória em ${road}`;
    if (type === "exit roundabout" || type === "exit rotary") return `Saia da rotatória em ${road}`;
    if (type === "merge") return `Entre em ${road}`;
    if (type === "on ramp") return `Pegue a entrada para ${road}`;
    if (type === "off ramp" || type === "off_ramp") return `Saia em ${road}`;
    if (type === "fork") return `${turn} na bifurcação, em ${road}`;
    if (type === "end of road") return `${turn} no fim de ${road}`;
    if (type === "new name" || type === "continue") return `Continue em ${road}`;
    if (type === "turn") return `${turn} em ${road}`;
    return `${turn} em ${road}`;
  }

  function compactSteps(steps) {
    const labels = [];
    for (const step of steps || []) {
      const label = describeStep(step);
      if (!label || label === labels[labels.length - 1]) continue;
      if (step.distance < 25 && step.maneuver?.type !== "arrive" && step.maneuver?.type !== "depart") continue;
      labels.push(label);
    }
    return labels.slice(0, 14);
  }

  async function measureTo(house, dest, prev) {
    const key = `v2|${house.lat},${house.lng}|${dest.lat},${dest.lng}`;
    const straightKm = haversineKm(house, dest);
    const walkMin = (straightKm / 4.5) * 60;
    if (prev && prev._from === key && prev.geometry) {
      return { ...prev, straightKm, walkMin };
    }
    try {
      const route = await routeBetween(house, dest);
      return {
        driveKm: route.km,
        driveMin: route.min,
        walkMin,
        straightKm,
        geometry: route.geometry,
        steps: route.steps,
        _from: key,
      };
    } catch {
      const driveKm = straightKm * 1.3;
      return {
        driveKm,
        driveMin: (driveKm / 25) * 60,
        walkMin,
        straightKm,
        geometry: null,
        steps: [],
        _from: key,
      };
    }
  }

  async function refreshDistances() {
    const next = [];
    for (const house of state.houses) {
      const toSchool = await measureTo(house, FIXED_SCHOOL, house.toSchool);
      const toCentro = await measureTo(house, FIXED_CENTRO, house.toCentro);
      next.push({ ...house, toSchool, toCentro });
    }
    state.houses = next;
    try {
      await save();
    } catch (err) {
      console.error(err);
      toast("Distâncias calculadas, mas falhou ao salvar na nuvem.");
    }
    if (state.view === "list") render();
    else renderMarkers();
  }

  function sortedHouses() {
    const list = [...state.houses];
    const key = els.sortBy.value;
    list.sort((a, b) => {
      if (key === "name") return (a.title || "").localeCompare(b.title || "", "pt-BR");
      const fields = {
        schoolDrive: (h) => h.toSchool?.driveMin,
        centroDrive: (h) => h.toCentro?.driveMin,
        schoolWalk: (h) => h.toSchool?.walkMin,
        centroWalk: (h) => h.toCentro?.walkMin,
      };
      const read = fields[key] || fields.schoolDrive;
      const av = read(a);
      const bv = read(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return av - bv;
    });
    return list;
  }

  function houseIcon(house, index) {
    const selected = house.id === state.selectedId;
    return L.divIcon({
      className: `pin-house${selected ? " is-selected" : ""}`,
      html: `<div class="pin"><span>${index}</span></div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 28],
      popupAnchor: [0, -28],
    });
  }

  function schoolIcon() {
    return L.divIcon({
      className: "pin-school",
      html: `<div class="pin"><span>${ICON_SCHOOL}</span></div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -32],
    });
  }

  function centroIcon() {
    return L.divIcon({
      className: "pin-centro",
      html: `<div class="pin"><span>${ICON_CENTRO}</span></div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -32],
    });
  }

  function addStreetRoute(geometry, color, emphasize) {
    const casing = emphasize ? 11 : 6;
    const line = emphasize ? 6 : 3;
    L.geoJSON(geometry, {
      style: {
        color: "#fff",
        weight: casing,
        opacity: emphasize ? 0.95 : 0.55,
        lineCap: "round",
        lineJoin: "round",
      },
    }).addTo(routeLayer);
    L.geoJSON(geometry, {
      style: {
        color,
        weight: line,
        opacity: emphasize ? 1 : 0.45,
        lineCap: "round",
        lineJoin: "round",
      },
    }).addTo(routeLayer);
  }

  function destOf(focus) {
    return focus === "centro" ? FIXED_CENTRO : FIXED_SCHOOL;
  }

  function measureOf(house, focus) {
    return focus === "centro" ? house.toCentro : house.toSchool;
  }

  function wazeUrl(from, to) {
    return `https://www.waze.com/ul?ll=${to.lat},${to.lng}&navigate=yes&from=${from.lat},${from.lng}`;
  }

  function mapsUrl(from, to) {
    return `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=driving`;
  }

  function drawRoute(house) {
    if (routeLayer) {
      routeLayer.remove();
      routeLayer = null;
    }
    if (!house) return;
    routeLayer = L.layerGroup().addTo(map);
    const focus = state.routeFocus;
    const other = focus === "centro" ? "school" : "centro";
    const otherMeasure = measureOf(house, other);
    const focusMeasure = measureOf(house, focus);
    if (otherMeasure?.geometry) {
      addStreetRoute(
        otherMeasure.geometry,
        other === "centro" ? FIXED_CENTRO.color : FIXED_SCHOOL.color,
        false
      );
    }
    if (focusMeasure?.geometry) {
      addStreetRoute(
        focusMeasure.geometry,
        focus === "centro" ? FIXED_CENTRO.color : FIXED_SCHOOL.color,
        true
      );
    }
  }

  function fitRoute(house) {
    const measure = measureOf(house, state.routeFocus);
    if (!measure?.geometry || !map) return;
    const layer = L.geoJSON(measure.geometry);
    const wide = window.innerWidth > 840;
    map.fitBounds(layer.getBounds(), {
      paddingTopLeft: wide ? [430, 28] : [20, 20],
      paddingBottomRight: wide ? [48, 110] : [20, 130],
      maxZoom: 16,
      animate: true,
    });
  }

  function renderMarkers() {
    houseLayer.clearLayers();
    schoolLayer.clearLayers();

    L.marker([FIXED_SCHOOL.lat, FIXED_SCHOOL.lng], {
      icon: schoolIcon(),
      title: FIXED_SCHOOL.name,
      alt: FIXED_SCHOOL.name,
      zIndexOffset: 600,
      draggable: false,
    })
      .bindPopup(
        `<strong>${esc(FIXED_SCHOOL.name)}</strong><br>${esc(
          FIXED_SCHOOL.subtitle
        )}<br>${esc(FIXED_SCHOOL.address)}`
      )
      .addTo(schoolLayer);

    L.marker([FIXED_CENTRO.lat, FIXED_CENTRO.lng], {
      icon: centroIcon(),
      title: FIXED_CENTRO.name,
      alt: "Centro da cidade",
      zIndexOffset: 600,
      draggable: false,
    })
      .bindPopup(
        `<strong>${esc(FIXED_CENTRO.name)}</strong><br>${esc(
          FIXED_CENTRO.subtitle
        )}<br>${esc(FIXED_CENTRO.address)}`
      )
      .addTo(schoolLayer);

    sortedHouses().forEach((house, i) => {
      const marker = L.marker([house.lat, house.lng], {
        icon: houseIcon(house, i + 1),
        draggable: true,
      })
        .on("click", () => toggleHouse(house.id, true))
        .on("dragend", async (ev) => {
          const { lat, lng } = ev.target.getLatLng();
          if (!insideItatiba(lat, lng)) {
            toast("A casa precisa ficar em Itatiba.");
            renderMarkers();
            return;
          }
          const info = await reverseGeocode(lat, lng);
          const current = state.houses.find((item) => item.id === house.id);
          if (!current) return;
          current.lat = lat;
          current.lng = lng;
          current.precision = "mapa";
          if (info?.bairro) current.bairro = info.bairro;
          if (info?.road) current.address = info.road;
          save();
          refreshDistances();
        })
        .bindPopup(
          `<strong>${esc(house.title)}</strong><br>${esc(house.bairro || "")}<br>
           Colégio: ${formatMin(house.toSchool?.driveMin)} · Centro: ${formatMin(house.toCentro?.driveMin)}`
        );
      marker.addTo(houseLayer);
    });
  }

  function sortMetric(house) {
    const key = els.sortBy.value;
    const specs = {
      schoolDrive: { km: house.toSchool?.driveKm, min: house.toSchool?.driveMin },
      centroDrive: { km: house.toCentro?.driveKm, min: house.toCentro?.driveMin },
      schoolWalk: { km: house.toSchool?.straightKm, min: house.toSchool?.walkMin },
      centroWalk: { km: house.toCentro?.straightKm, min: house.toCentro?.walkMin },
    };
    const spec = specs[key];
    if (!spec) return { text: "", cls: "neutral" };
    return { text: formatKm(spec.km), cls: chipClass(spec.min) };
  }

  function toggleExpand(id) {
    state.expandedId = state.expandedId === id ? null : id;
    renderSidebar();
  }

  function closeHouse() {
    state.selectedId = null;
    drawRoute(null);
    renderSidebar();
    renderMarkers();
    renderNavBanner();
  }

  function toggleHouse(id, fly) {
    if (state.selectedId === id) {
      closeHouse();
      return;
    }
    selectHouse(id, fly);
  }

  function selectHouse(id, fly) {
    state.selectedId = id;
    state.expandedId = id;
    const house = state.houses.find((item) => item.id === id);
    drawRoute(house);
    if (fly && house) fitRoute(house);
    renderSidebar();
    renderMarkers();
    renderNavBanner();
  }

  function distRow(label, cls, measure, houseId, focus) {
    const active = state.selectedId === houseId && state.routeFocus === focus;
    return `
      <div class="dist-block ${active ? "is-active" : ""}" data-focus="${focus}" data-select="${houseId}">
        <span class="dist-label ${cls}">${label}${active ? " · rota" : ""}</span>
        <div class="chips">
          <span class="chip ${chipClass(measure?.driveMin)}">${formatMin(measure?.driveMin)} de carro · ${formatKm(measure?.driveKm)}</span>
          <span class="chip walk ${chipClass(measure?.walkMin)}">${formatMin(measure?.walkMin)} a pé</span>
        </div>
      </div>
    `;
  }

  function routePanel(house) {
    if (house.id !== state.selectedId) return "";
    const focus = state.routeFocus;
    const dest = destOf(focus);
    const measure = measureOf(house, focus);
    const steps = (measure?.steps || [])
      .map((step) => `<li>${esc(step)}</li>`)
      .join("");
    return `
      <div class="route-panel">
        <div class="route-toggles">
          <button type="button" class="${focus === "school" ? "is-on" : ""}" data-focus="school">Colégio</button>
          <button type="button" class="${focus === "centro" ? "is-on" : ""}" data-focus="centro">Centro</button>
        </div>
        <p class="route-eta">
          <span>${formatMin(measure?.driveMin)} de carro · ${formatKm(measure?.driveKm)} até ${esc(dest.name)}</span>
          <span class="route-eta-walk">${formatMin(measure?.walkMin)} a pé</span>
        </p>
        ${steps ? `<ol class="route-steps">${steps}</ol>` : `<p class="help">Rota pelas ruas, no estilo do Waze.</p>`}
        <div class="route-links">
          <a class="waze-btn" href="${wazeUrl(house, dest)}" target="_blank" rel="noopener" data-waze="1">Abrir no Waze</a>
          <a class="maps-btn" href="${mapsUrl(house, dest)}" target="_blank" rel="noopener" data-waze="1">Google Maps</a>
        </div>
        <button type="button" class="text-btn close-point" data-toggle="${house.id}">Fechar ponto</button>
      </div>
    `;
  }

  function renderSchoolCard() {
    els.schoolCard.className = "anchors";
    els.schoolCard.innerHTML = `
      <p class="anchors-label">Pontos de comparação</p>
      <div class="anchor-row">
        <button type="button" class="anchor-chip" data-fly="school">
          <span class="school-icon" aria-hidden="true">${ICON_SCHOOL}</span>
          <span class="anchor-text">
            <strong>${esc(FIXED_SCHOOL.name)}</strong>
            <small>${esc(FIXED_SCHOOL.subtitle)}</small>
          </span>
        </button>
        <button type="button" class="anchor-chip" data-fly="centro">
          <span class="school-icon centro" aria-hidden="true">${ICON_CENTRO}</span>
          <span class="anchor-text">
            <strong>${esc(FIXED_CENTRO.name)}</strong>
            <small>${esc(FIXED_CENTRO.subtitle)}</small>
          </span>
        </button>
      </div>
    `;
  }

  function renderList() {
    const houses = sortedHouses();
    const heading =
      state.scope === "all"
        ? "Todas as casas"
        : state.scope === "shared"
          ? "Lista compartilhada"
          : "Suas casas";
    if (!houses.length) {
      els.panelBody.innerHTML = `
        <div class="empty-state">
          <h3>Nenhuma casa na lista</h3>
          <p>${
            canAddHouses()
              ? "Toque em Adicionar para buscar um condomínio, bairro ou rua. Cada casa mostra o tempo até o colégio e até o centro."
              : "Esta lista ainda não tem casas."
          }</p>
        </div>
      `;
      return;
    }

    els.panelBody.innerHTML = `
      <p class="list-heading">${heading}</p>
      ${houses
      .map((house, i) => {
        const open = house.id === state.selectedId;
        const expanded = house.id === state.expandedId;
        const editable = canEditHouse(house);
        const condo = house.precision === "condominio";
        const metric = sortMetric(house);
        const approx =
          condo
            ? `<span class="chip neutral">Ponto do condomínio</span>`
            : house.precision === "bairro"
            ? `<span class="chip neutral">Ponto aproximado do bairro</span>`
            : "";
        const toggleLabel = open
          ? "Fechar ponto"
          : condo
            ? "Abrir ponto do condomínio"
            : "Abrir ponto";
        const addressLine = `${esc(house.bairro || "Bairro não informado")}${
          house.address ? ` · ${esc(house.address)}` : ""
        }`;
        const ownerLine =
          state.scope === "all" && (house.ownerEmail || house.ownerName)
            ? `<span class="owner-chip">${esc(house.ownerName || house.ownerEmail)}</span>`
            : "";
        const actions = editable
          ? `
            <div class="card-actions">
              <button type="button" class="action-btn edit" data-edit="${house.id}">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                </svg>
                Editar
              </button>
              <button type="button" class="action-btn delete" data-del="${house.id}">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path fill="currentColor" d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                </svg>
                Excluir
              </button>
            </div>`
          : `<p class="help">Somente leitura<span class="readonly-badge">privado</span></p>`;
        const details = expanded
          ? `
            <div class="chips-wrap">
              ${distRow("Colégio", "school", house.toSchool, house.id, "school")}
              ${distRow("Centro", "centro", house.toCentro, house.id, "centro")}
              ${approx}
            </div>
            <button type="button" class="point-toggle ${open ? "is-open" : ""}" data-toggle="${house.id}">
              ${toggleLabel}
            </button>
            ${routePanel(house)}
            ${
              house.notes
                ? `<div class="house-notes">
                    <span class="notes-label">Observações</span>
                    <p class="notes">${linkify(house.notes)}</p>
                  </div>`
                : ""
            }
            ${actions}
          `
          : "";
        const metricEl = !expanded && metric.text
          ? `<span class="house-metric ${metric.cls}">${esc(metric.text)}</span>`
          : "";
        return `
        <article class="house-card ${open ? "is-selected" : ""} ${expanded ? "is-expanded" : ""}"${expanded ? "" : ` data-expand="${house.id}"`}>
          <div class="house-index" data-expand="${house.id}">${i + 1}</div>
          <div class="house-body">
            <button type="button" class="house-head" data-expand="${house.id}">
              <span class="house-name">${esc(house.title)}</span>
              ${expanded ? `<span class="meta">${addressLine}</span>${ownerLine}` : ownerLine}
            </button>
            ${details}
          </div>
          ${metricEl}
        </article>
      `;
      })
      .join("")}
    `;
  }

  function bairroOptions(selected) {
    const seen = new Set();
    const opts = [];
    for (const item of window.ITATIBA_LOCAIS || []) {
      const values = [item.nome, ...(item.aliases || [])];
      for (const value of values) {
        const key = value.trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        opts.push(
          `<option value="${esc(value)}" ${value === selected ? "selected" : ""}></option>`
        );
      }
    }
    return opts.join("");
  }

  function renderBairroSuggest(query) {
    const list = document.getElementById("bairro-suggest");
    if (!list) return;
    const q = String(query || "").trim();
    if (q.length < 2) {
      list.classList.add("hidden");
      list.innerHTML = "";
      return;
    }
    const hits = findLocais(q, 70).slice(0, 8);
    if (!hits.length) {
      list.classList.add("hidden");
      list.innerHTML = "";
      return;
    }
    list.innerHTML = hits
      .map(
        ({ item }) => `
        <li data-bairro="${esc(item.nome)}">
          <strong>${esc(item.nome)}</strong>
          <small>${item.tipo === "condominio" ? "Condomínio" : "Bairro"}</small>
        </li>`
      )
      .join("");
    list.classList.remove("hidden");
  }

  function pickBairro(nome) {
    const input = els.panelBody.querySelector('input[name="bairro"]');
    if (input) input.value = nome;
    const list = document.getElementById("bairro-suggest");
    if (list) {
      list.classList.add("hidden");
      list.innerHTML = "";
    }
    const local = findLocais(nome, 70)[0]?.item;
    if (local?.lat != null && map) {
      map.flyTo([local.lat, local.lng], 15);
    }
  }

  function renderHouseForm(house) {
    const isEdit = Boolean(house);
    const title = house?.title || "";
    const bairro = house?.bairro || "";
    const address = house?.address || "";
    const notes = house?.notes || "";
    const searchBlock = isEdit
      ? ""
      : `
        <form class="place-search" id="search-form" autocomplete="off">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path fill="currentColor" d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z" />
          </svg>
          <input
            id="search-input"
            type="search"
            placeholder="Buscar condomínio, bairro ou rua — ex.: Paineiras"
            aria-label="Buscar em Itatiba"
          />
          <button type="submit">Buscar</button>
        </form>
        <ul class="search-results hidden" id="search-results"></ul>
        <p class="help">Toque em Adicionar casa no resultado. Ou preencha abaixo e clique no mapa.</p>
      `;
    els.panelBody.innerHTML = `
      <div class="form-stack">
        <h3>${isEdit ? "Editar casa" : "Nova casa"}</h3>
        ${searchBlock}
        <form id="house-form" class="house-fields">
          <label class="field">Apelido
            <input name="title" required placeholder="Ex.: Casa 3 quartos no Engenho" value="${esc(title)}" />
          </label>
          <label class="field">Bairro ou condomínio
            <input name="bairro" list="bairros-list" required autocomplete="off" placeholder="Ex.: Paineiras, Privilege, Engenho" value="${esc(bairro)}" />
            <datalist id="bairros-list">${bairroOptions(bairro)}</datalist>
            <ul class="search-results hidden" id="bairro-suggest"></ul>
          </label>
          <label class="field">Rua e número (opcional)
            <input name="address" placeholder="Ex.: Rua das Flores, 120" value="${esc(address)}" />
          </label>
          <label class="field">Observações
            <textarea name="notes" placeholder="Preço, https://link-do-anuncio, número de quartos...">${esc(notes)}</textarea>
          </label>
          <p class="help">Complete o apelido, a rua e as observações. Se o mapa não achar a rua, usa o ponto do condomínio. Depois você arrasta o pin até a casa.</p>
          <div class="form-actions">
            <button class="primary-btn" type="submit">${isEdit ? "Salvar" : "Adicionar"}</button>
            <button class="text-btn" type="button" data-go="list">Cancelar</button>
          </div>
        </form>
      </div>
    `;
  }

  function renderAuthSetup() {
    const cfg = API.mergeConfig();
    els.authCard.innerHTML = `
      <h1>Configurar nuvem</h1>
      <p class="auth-sub">Cole a URL e a chave anon do Supabase para ativar contas e casas privadas.</p>
      <form class="auth-setup" id="setup-form">
        <label class="field">Project URL
          <input name="supabaseUrl" required placeholder="https://xxxx.supabase.co" value="${esc(cfg.supabaseUrl)}" />
        </label>
        <label class="field">anon public key
          <input name="supabaseAnonKey" required placeholder="eyJhbGciOi..." value="${esc(cfg.supabaseAnonKey)}" />
        </label>
        <p class="auth-error ${state.authError ? "" : "hidden"}">${esc(state.authError)}</p>
        <button class="primary-btn full" type="submit">Salvar e continuar</button>
      </form>
      <p class="auth-help">
        1) Crie um projeto em supabase.com<br />
        2) Rode o SQL de <code>supabase/schema.sql</code><br />
        3) Em Settings → API, copie URL e anon key<br />
        4) Para Google: Authentication → Providers → Google
      </p>
    `;
  }

  function renderAuthForm() {
    const isLogin = state.authMode === "login";
    els.authCard.innerHTML = `
      <h1>Itatiba</h1>
      <p class="auth-sub">Entre para salvar suas casas na nuvem. Só você vê o que cadastrou.</p>
      <div class="auth-tabs">
        <button type="button" data-auth-mode="login" class="${isLogin ? "is-on" : ""}">Entrar</button>
        <button type="button" data-auth-mode="signup" class="${!isLogin ? "is-on" : ""}">Criar conta</button>
      </div>
      <form class="auth-form" id="auth-form">
        <label class="field">Email
          <input name="email" type="email" required autocomplete="email" placeholder="voce@email.com" />
        </label>
        <label class="field">Senha
          <input name="password" type="password" required minlength="6" autocomplete="${isLogin ? "current-password" : "new-password"}" placeholder="Mínimo 6 caracteres" />
        </label>
        <p class="auth-error ${state.authError ? "" : "hidden"}">${esc(state.authError)}</p>
        <button class="primary-btn full" type="submit">${isLogin ? "Entrar" : "Criar conta"}</button>
      </form>
      <div class="auth-divider">ou</div>
      <button type="button" class="google-btn" id="btn-google">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Continuar com Google
      </button>
      <p class="auth-help">Ao criar conta, suas casas ficam salvas e privadas na sua sessão.</p>
    `;
  }

  function renderAuth() {
    els.authScreen.classList.remove("hidden");
    els.appShell.classList.add("hidden");
    if (!API.isConfigured()) renderAuthSetup();
    else renderAuthForm();
  }

  async function renderShareView() {
    state.view = "share";
    await refreshSharesMeta();
    els.panelBody.innerHTML = `
      <div class="form-stack">
        <h3>Compartilhar lista</h3>
        <p class="help">A pessoa precisa ter conta neste app. Ela verá suas casas; marque edição se quiser que ela altere.</p>
        <form id="share-form" class="house-fields">
          <label class="field">Email do convidado
            <input name="email" type="email" required placeholder="amigo@email.com" />
          </label>
          <label class="field" style="flex-direction:row;align-items:center;gap:8px;font-weight:500">
            <input name="canEdit" type="checkbox" style="width:auto" />
            Permitir editar minhas casas
          </label>
          <div class="form-actions">
            <button class="primary-btn" type="submit">Compartilhar</button>
            <button class="text-btn" type="button" data-go="list">Voltar</button>
          </div>
        </form>
        <p class="list-heading">Quem já tem acesso</p>
        <div class="share-list">
          ${
            state.outgoingShares.length
              ? state.outgoingShares
                  .map(
                    (share) => `
                <div class="share-item">
                  <div>
                    <strong>${esc(share.name || share.email)}</strong>
                    <small>${esc(share.email)} · ${share.canEdit ? "pode editar" : "somente leitura"}</small>
                  </div>
                  <button type="button" class="text-btn" data-revoke="${share.id}">Remover</button>
                </div>`
                  )
                  .join("")
              : `<p class="help">Nenhum compartilhamento ainda.</p>`
          }
        </div>
      </div>
    `;
  }

  async function renderSharedWithMeView() {
    state.view = "shared-with-me";
    await refreshSharesMeta();
    els.panelBody.innerHTML = `
      <div class="form-stack">
        <h3>Listas compartilhadas comigo</h3>
        <div class="share-list">
          ${
            state.incomingShares.length
              ? state.incomingShares
                  .map(
                    (share) => `
                <div class="share-item">
                  <div>
                    <strong>${esc(share.name || share.email)}</strong>
                    <small>${esc(share.email)} · ${share.canEdit ? "pode editar" : "somente leitura"}</small>
                  </div>
                  <button type="button" class="primary-btn" data-open-share="${share.ownerId}" data-share-label="${esc(share.name || share.email)}" data-share-edit="${share.canEdit ? "1" : "0"}">Abrir</button>
                </div>`
                  )
                  .join("")
              : `<p class="help">Ninguém compartilhou uma lista com você ainda.</p>`
          }
        </div>
        <button class="text-btn" type="button" data-go="list">Voltar</button>
      </div>
    `;
  }

  async function renderAdminView() {
    state.view = "admin";
    state.adminOwners = await API.adminListOwners();
    els.panelBody.innerHTML = `
      <div class="form-stack">
        <h3>Admin · usuários</h3>
        <p class="help">Veja todas as casas ou abra a lista de um usuário.</p>
        <button class="primary-btn" type="button" data-scope="all">Ver todas as casas</button>
        <div class="share-list">
          ${
            state.adminOwners.length
              ? state.adminOwners
                  .map(
                    (owner) => `
                <div class="share-item">
                  <div>
                    <strong>${esc(owner.name || owner.email)}</strong>
                    <small>${esc(owner.email)} · ${owner.houseCount} casa(s)</small>
                  </div>
                  <button type="button" class="text-btn" data-open-share="${owner.ownerId}" data-share-label="${esc(owner.name || owner.email)}" data-share-edit="0">Abrir</button>
                </div>`
                  )
                  .join("")
              : `<p class="help">Nenhum usuário ainda.</p>`
          }
        </div>
        <button class="text-btn" type="button" data-go="list">Voltar</button>
      </div>
    `;
  }

  function renderSidebar() {
    updateScopeBar();
    renderSchoolCard();
    if (state.view === "add") {
      if (!canAddHouses()) {
        state.view = "list";
        renderList();
        return;
      }
      renderHouseForm(null);
    } else if (state.view === "edit") {
      const house = state.houses.find((item) => item.id === state.editingId);
      if (!house || !canEditHouse(house)) {
        state.view = "list";
        renderList();
        return;
      }
      renderHouseForm(house);
    } else if (
      state.view === "share" ||
      state.view === "shared-with-me" ||
      state.view === "admin"
    ) {
      // preenchido pelas ações do menu (async)
      return;
    } else renderList();
  }

  function render() {
    updateMenuUser();
    updateScopeBar();
    renderSidebar();
    if (state.mapReady) {
      renderMarkers();
      const selected = state.houses.find((item) => item.id === state.selectedId);
      drawRoute(selected);
      renderNavBanner();
    }
  }

  function renderNavBanner() {
    const house = state.houses.find((item) => item.id === state.selectedId);
    if (!house) {
      els.navBanner.classList.add("hidden");
      els.navBanner.innerHTML = "";
      return;
    }
    const dest = destOf(state.routeFocus);
    const measure = measureOf(house, state.routeFocus);
    els.navBanner.classList.remove("hidden");
    els.navBanner.innerHTML = `
      <div>
        <strong>${formatMin(measure?.driveMin)} de carro</strong>
        <span class="nav-walk">${formatMin(measure?.walkMin)} a pé</span>
        <span>${formatKm(measure?.driveKm)} até ${esc(dest.name)}</span>
      </div>
      <a href="${wazeUrl(house, dest)}" target="_blank" rel="noopener">Abrir no Waze</a>
    `;
  }

  function go(view) {
    if (view === "add" && !canAddHouses()) {
      toast("Você não pode adicionar casas nesta lista.");
      return;
    }
    state.view = view;
    state.clickMode = view === "add" || view === "edit" ? "house" : null;
    setHint(state.clickMode === "house" ? "Clique no mapa para marcar a casa" : "");
    els.menuPop.classList.add("hidden");
    renderSidebar();
  }

  async function setScope(scope, opts = {}) {
    state.scope = scope;
    state.sharedOwnerId = opts.ownerId || null;
    state.sharedOwnerLabel = opts.label || "";
    state.sharedCanEdit = Boolean(opts.canEdit);
    state.selectedId = null;
    state.expandedId = null;
    state.view = "list";
    state.clickMode = null;
    setHint("");
    els.menuPop.classList.add("hidden");
    try {
      await loadHousesFromCloud();
      await refreshSharesMeta();
      render();
      await refreshDistances();
    } catch (err) {
      console.error(err);
      toast("Não foi possível carregar as casas.");
    }
  }

  async function locateBairro(nome) {
    const local = findLocais(nome)[0]?.item;
    if (local?.lat) {
      return { lat: local.lat, lng: local.lng, precision: local.tipo === "condominio" ? "condominio" : "bairro", nome: local.nome };
    }
    const hits = await geocode(local?.nome || nome);
    if (!hits.length) return null;
    return {
      lat: hits[0].lat,
      lng: hits[0].lng,
      precision: local?.tipo === "condominio" || hits[0].tipo === "condominio" ? "condominio" : "bairro",
      nome: local?.nome || hits[0].name,
    };
  }

  async function submitHouse(form) {
    const data = new FormData(form);
    const title = String(data.get("title") || "").trim();
    const bairro = String(data.get("bairro") || "").trim();
    const address = String(data.get("address") || "").trim();
    const notes = String(data.get("notes") || "").trim();
    if (!title || !bairro) return;

    const btn = form.querySelector("button[type='submit']");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Buscando…";
    }

    let lat;
    let lng;
    let precision = "bairro";
    const localMatch = findLocais(bairro)[0]?.item;
    const query = address
      ? `${address}, ${localMatch?.nome || bairro}`
      : localMatch?.nome || bairro;

    try {
      const hits = await geocode(query);
      if (hits.length) {
        lat = hits[0].lat;
        lng = hits[0].lng;
        precision = address
          ? "endereco"
          : localMatch?.tipo === "condominio" || hits[0].tipo === "condominio"
            ? "condominio"
            : "bairro";
      }
    } catch {
      /* fallback abaixo */
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = state.view === "edit" ? "Salvar" : "Adicionar";
      }
    }

    if (lat == null) {
      const fallback = await locateBairro(bairro);
      if (!fallback) {
        toast("Não achei esse condomínio ou bairro em Itatiba. Tente o nome completo ou clique no mapa.");
        return;
      }
      lat = fallback.lat;
      lng = fallback.lng;
      precision = fallback.precision;
    }

    const placeName = localMatch?.nome || bairro;

    try {
      if (state.view === "edit" && state.editingId) {
        const house = state.houses.find((item) => item.id === state.editingId);
        if (!house || !canEditHouse(house)) {
          toast("Você não pode editar esta casa.");
          return;
        }
        Object.assign(house, { title, bairro: placeName, address, notes, lat, lng, precision });
        await persistHouse(house);
      } else {
        if (!canAddHouses() || state.scope !== "mine") {
          toast("Só o dono pode adicionar casas novas.");
          return;
        }
        const house = {
          id: uid(),
          userId: state.user.id,
          title,
          bairro: placeName,
          address,
          notes,
          lat,
          lng,
          precision,
          canEdit: true,
        };
        const saved = await persistHouse(house);
        state.houses.push({ ...house, ...saved, canEdit: true });
      }
    } catch (err) {
      console.error(err);
      toast(err.message || "Não foi possível salvar a casa.");
      return;
    }

    state.view = "list";
    state.clickMode = null;
    setHint("");
    map.flyTo([lat, lng], 15);
    await refreshDistances();
  }

  async function onMapClick(ev) {
    const { lat, lng } = ev.latlng;
    if (!insideItatiba(lat, lng)) {
      toast("Este mapa cobre só Itatiba.");
      return;
    }
    if (state.clickMode !== "house" && state.view !== "add") return;
    if (!canAddHouses() || state.scope === "shared") {
      toast("Só o dono da lista pode marcar casas novas no mapa.");
      return;
    }
    const info = await reverseGeocode(lat, lng);
    const title = `Casa em ${info?.bairro || "Itatiba"}`;
    const house = {
      id: uid(),
      userId: state.user.id,
      title,
      bairro: info?.bairro || "",
      address: info?.road || "",
      notes: "",
      lat,
      lng,
      precision: "mapa",
      canEdit: true,
    };
    try {
      const saved = await persistHouse(house);
      state.houses.push({ ...house, ...saved, canEdit: true });
    } catch (err) {
      console.error(err);
      toast("Não foi possível salvar a casa.");
      return;
    }
    state.view = "list";
    state.clickMode = null;
    setHint("");
    await refreshDistances();
  }

  function dedupeHits(hits) {
    const seen = new Set();
    return hits.filter((hit) => {
      const key = `${hit.name}|${hit.lat?.toFixed(4)}|${hit.lng?.toFixed(4)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function searchBox() {
    return {
      input: document.getElementById("search-input"),
      results: document.getElementById("search-results"),
    };
  }

  async function runSearch(query) {
    const box = searchBox();
    if (!box.results) return;
    if (!query.trim()) {
      box.results.classList.add("hidden");
      box.results.innerHTML = "";
      return;
    }
    try {
      const local = findLocais(query, 70).slice(0, 8);
      const localHits = local.map((row) => hitFromLocal(row.item)).filter(Boolean);
      const remote = await geocode(query);
      const hits = dedupeHits([...localHits, ...remote]);
      state.searchHits = hits;
      state.searchActive = hits.length ? 0 : -1;
      if (!hits.length) {
        box.results.innerHTML = `<li>Nada encontrado em Itatiba para “${esc(query)}”. Tente o nome do condomínio, o bairro ou clique no mapa.</li>`;
        box.results.classList.remove("hidden");
        return;
      }
      box.results.innerHTML = hits
        .map(
          (hit, i) => `
          <li data-hit="${i}" class="${i === 0 ? "is-active" : ""}">
            <strong>${esc(hit.name)}</strong>
            <small>${esc(hit.tipo === "condominio" ? `Condomínio · ${hit.label}` : hit.label)}</small>
            <div class="result-actions">
              <button type="button" data-use="house">Adicionar casa</button>
            </div>
          </li>`
        )
        .join("");
      box.results.classList.remove("hidden");
    } catch {
      toast("A busca está indisponível no momento.");
    }
  }

  async function useHit(index) {
    const hit = state.searchHits[index];
    if (!hit) return;
    if (!canAddHouses() || state.scope !== "mine") {
      toast("Só é possível adicionar casas na sua própria lista.");
      return;
    }
    const info = await reverseGeocode(hit.lat, hit.lng);
    const id = uid();
    const house = {
      id,
      userId: state.user.id,
      title: hit.name,
      bairro: hit.name,
      address: hit.address || info?.road || "",
      notes: "",
      lat: hit.lat,
      lng: hit.lng,
      precision: hit.tipo === "condominio" ? "condominio" : "endereco",
      canEdit: true,
    };
    try {
      const saved = await persistHouse(house);
      state.houses.push({ ...house, ...saved, canEdit: true });
    } catch (err) {
      console.error(err);
      toast("Não foi possível salvar a casa.");
      return;
    }
    map.flyTo([hit.lat, hit.lng], 16);
    const box = searchBox();
    if (box.results) {
      box.results.classList.add("hidden");
      box.results.innerHTML = "";
    }
    if (box.input) box.input.value = "";
    state.editingId = id;
    state.expandedId = id;
    go("edit");
    toast("Casa adicionada. Complete apelido, observações ou o link do anúncio.");
    await refreshDistances();
  }

  async function migrateLocalToCloud() {
    const local = readLocalHouses();
    if (!local.length) {
      toast("Não há casas salvas neste navegador.");
      return;
    }
    if (!confirm(`Trazer ${local.length} casa(s) deste navegador para a sua conta?`)) return;
    try {
      await API.migrateLocalHouses(local);
      clearLocalHouses();
      await loadHousesFromCloud();
      render();
      await refreshDistances();
      toast("Casas do navegador salvas na sua conta.");
    } catch (err) {
      console.error(err);
      toast(err.message || "Falha ao migrar as casas.");
    }
  }

  function exportData() {
    const blob = new Blob(
      [JSON.stringify({ school: state.school, houses: state.houses }, null, 2)],
      { type: "application/json" }
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "itatiba-casas.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function initMap() {
    const bounds = L.latLngBounds(
      [ITATIBA.south, ITATIBA.west],
      [ITATIBA.north, ITATIBA.east]
    );
    map = L.map("map", {
      center: [
        (FIXED_SCHOOL.lat + FIXED_CENTRO.lat) / 2,
        (FIXED_SCHOOL.lng + FIXED_CENTRO.lng) / 2,
      ],
      zoom: 13,
      minZoom: 12,
      maxZoom: 19,
      maxBounds: bounds.pad(0.08),
      maxBoundsViscosity: 0.85,
      zoomControl: false,
    });
    L.control.zoom({ position: "topright" }).addTo(map);
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
      {
        attribution:
          "Tiles &copy; Esri &mdash; dados &copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a>",
        maxZoom: 19,
      }
    ).addTo(map);

    houseLayer = L.layerGroup().addTo(map);
    schoolLayer = L.layerGroup().addTo(map);
    const wide = window.innerWidth > 840;
    map.fitBounds(
      [
        [FIXED_SCHOOL.lat, FIXED_SCHOOL.lng],
        [FIXED_CENTRO.lat, FIXED_CENTRO.lng],
      ],
      {
        paddingTopLeft: wide ? [420, 24] : [16, 16],
        paddingBottomRight: wide ? [56, 24] : [16, Math.round(window.innerHeight * 0.48)],
        maxZoom: 14,
      }
    );
    map.on("click", onMapClick);
  }

  function bindEvents() {
    els.btnAdd.addEventListener("click", () => go("add"));
    els.sortBy.addEventListener("change", render);
    els.btnMenu.addEventListener("click", (ev) => {
      ev.stopPropagation();
      els.menuPop.classList.toggle("hidden");
    });
    els.menuPop.addEventListener("click", (ev) => ev.stopPropagation());
    document.addEventListener("click", () => els.menuPop.classList.add("hidden"));

    els.menuPop.addEventListener("click", async (ev) => {
      const action = ev.target.closest("button")?.dataset.action;
      if (!action) return;
      if (action === "export") exportData();
      if (action === "import") {
        if (state.scope !== "mine") {
          toast("Importe apenas na sua própria lista.");
          return;
        }
        els.importFile.click();
      }
      if (action === "clear") {
        if (state.scope !== "mine") {
          toast("Só é possível apagar a sua própria lista.");
          return;
        }
        if (!confirm("Apagar todas as suas casas na nuvem?")) return;
        try {
          await API.clearMyHouses();
          state.houses = [];
          state.selectedId = null;
          state.expandedId = null;
          render();
          toast("Suas casas foram apagadas.");
        } catch (err) {
          console.error(err);
          toast("Não foi possível apagar.");
        }
      }
      if (action === "logout") {
        await API.signOut();
        await showLoggedOut();
      }
      if (action === "share") {
        els.menuPop.classList.add("hidden");
        await renderShareView();
      }
      if (action === "shared-with-me") {
        els.menuPop.classList.add("hidden");
        await renderSharedWithMeView();
      }
      if (action === "admin") {
        if (!isAdmin()) return;
        els.menuPop.classList.add("hidden");
        await renderAdminView();
      }
      if (action === "mine") setScope("mine");
      if (action === "migrate") migrateLocalToCloud();
    });

    els.importFile.addEventListener("change", async () => {
      const file = els.importFile.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const houses = Array.isArray(data.houses) ? data.houses : [];
        await API.migrateLocalHouses(houses);
        await loadHousesFromCloud();
        render();
        await refreshDistances();
        toast("Dados importados na sua conta.");
      } catch (err) {
        console.error(err);
        toast("Arquivo inválido ou falha ao importar.");
      }
      els.importFile.value = "";
    });

    document.getElementById("school-card").addEventListener("click", (ev) => {
      const which = ev.target.closest("[data-fly]")?.dataset.fly;
      if (!which) return;
      const dest = which === "centro" ? FIXED_CENTRO : FIXED_SCHOOL;
      map.flyTo([dest.lat, dest.lng], 16);
      schoolLayer.eachLayer((layer) => {
        const ll = layer.getLatLng && layer.getLatLng();
        if (ll && Math.abs(ll.lat - dest.lat) < 0.0002) layer.openPopup();
      });
    });

    els.scopeBar?.addEventListener("click", (ev) => {
      const scope = ev.target.closest("[data-scope]")?.dataset.scope;
      if (scope === "mine") setScope("mine");
    });

    els.panelBody.addEventListener("click", async (ev) => {
      if (ev.target.closest("a[href]")) {
        ev.stopPropagation();
        return;
      }
      const bairroPick = ev.target.closest("[data-bairro]");
      if (bairroPick) {
        pickBairro(bairroPick.dataset.bairro);
        return;
      }
      const goTo = ev.target.closest("[data-go]")?.dataset.go;
      if (goTo) {
        go(goTo);
        return;
      }
      const hitItem = ev.target.closest("[data-hit]");
      if (hitItem && (ev.target.closest("[data-use]") || ev.target.closest("li"))) {
        useHit(Number(hitItem.dataset.hit));
        return;
      }
      const revoke = ev.target.closest("[data-revoke]")?.dataset.revoke;
      if (revoke) {
        try {
          await API.revokeShare(revoke);
          toast("Compartilhamento removido.");
          await renderShareView();
        } catch (err) {
          toast(err.message || "Falha ao remover.");
        }
        return;
      }
      const openShare = ev.target.closest("[data-open-share]");
      if (openShare) {
        await setScope("shared", {
          ownerId: openShare.dataset.openShare,
          label: openShare.dataset.shareLabel || "",
          canEdit: openShare.dataset.shareEdit === "1",
        });
        return;
      }
      const scopeAll = ev.target.closest("[data-scope]")?.dataset.scope;
      if (scopeAll === "all") {
        await setScope("all");
        return;
      }
      if (scopeAll === "mine") {
        await setScope("mine");
        return;
      }
      const del = ev.target.closest("[data-del]")?.dataset.del;
      if (del) {
        ev.stopPropagation();
        const house = state.houses.find((item) => item.id === del);
        if (!house || house.userId !== state.user.id) {
          toast("Só o dono pode excluir a casa.");
          return;
        }
        try {
          await API.deleteHouse(del);
          state.houses = state.houses.filter((item) => item.id !== del);
          if (state.selectedId === del) state.selectedId = null;
          if (state.expandedId === del) state.expandedId = null;
          render();
        } catch (err) {
          console.error(err);
          toast("Não foi possível excluir.");
        }
        return;
      }
      const edit = ev.target.closest("[data-edit]")?.dataset.edit;
      if (edit) {
        ev.stopPropagation();
        const house = state.houses.find((item) => item.id === edit);
        if (!house || !canEditHouse(house)) {
          toast("Você não pode editar esta casa.");
          return;
        }
        state.editingId = edit;
        go("edit");
        return;
      }
      const expand = ev.target.closest("[data-expand]")?.dataset.expand;
      if (expand) {
        toggleExpand(expand);
        return;
      }
      const toggle = ev.target.closest("[data-toggle]")?.dataset.toggle;
      if (toggle) {
        ev.stopPropagation();
        toggleHouse(toggle, state.selectedId !== toggle);
        return;
      }
      const focus = ev.target.closest("[data-focus]")?.dataset.focus;
      const select = ev.target.closest("[data-select]")?.dataset.select;
      if (focus) {
        state.routeFocus = focus;
        if (select) selectHouse(select, true);
        else render();
        return;
      }
      if (select) selectHouse(select, true);
    });

    els.panelBody.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (ev.target.id === "house-form") submitHouse(ev.target);
      if (ev.target.id === "search-form") {
        const input = ev.target.querySelector("#search-input");
        runSearch(input?.value || "");
      }
      if (ev.target.id === "share-form") {
        const data = new FormData(ev.target);
        const email = String(data.get("email") || "").trim();
        const canEdit = Boolean(data.get("canEdit"));
        try {
          await API.shareListWithEmail(email, canEdit);
          toast("Lista compartilhada.");
          ev.target.reset();
          await renderShareView();
        } catch (err) {
          toast(err.message || "Não foi possível compartilhar.");
        }
      }
    });

    els.panelBody.addEventListener("input", (ev) => {
      if (ev.target.id === "search-input") {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => runSearch(ev.target.value), 400);
        return;
      }
      if (ev.target.name === "bairro") renderBairroSuggest(ev.target.value);
    });

    els.authCard.addEventListener("click", async (ev) => {
      const mode = ev.target.closest("[data-auth-mode]")?.dataset.authMode;
      if (mode) {
        state.authMode = mode;
        state.authError = "";
        renderAuthForm();
        return;
      }
      if (ev.target.closest("#btn-google")) {
        try {
          await API.signInWithGoogle();
        } catch (err) {
          state.authError = err.message || "Google indisponível.";
          renderAuthForm();
        }
      }
    });

    els.authCard.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (ev.target.id === "setup-form") {
        const data = new FormData(ev.target);
        API.saveLocalConfig({
          supabaseUrl: String(data.get("supabaseUrl") || ""),
          supabaseAnonKey: String(data.get("supabaseAnonKey") || ""),
        });
        if (!API.isConfigured()) {
          state.authError = "Preencha URL e anon key válidas.";
          renderAuthSetup();
          return;
        }
        state.authError = "";
        try {
          await API.bootstrap();
          renderAuthForm();
        } catch (err) {
          state.authError = err.message || "Configuração inválida.";
          renderAuthSetup();
        }
        return;
      }
      if (ev.target.id === "auth-form") {
        const data = new FormData(ev.target);
        const email = String(data.get("email") || "");
        const password = String(data.get("password") || "");
        const btn = ev.target.querySelector("button[type='submit']");
        if (btn) btn.disabled = true;
        try {
          if (state.authMode === "login") await API.signIn(email, password);
          else {
            const result = await API.signUp(email, password);
            if (result.session) {
              toast("Conta criada.");
            } else {
              state.authError = "";
              toast("Conta criada. Confirme o email se o Supabase pedir verificação.");
              renderAuthForm();
              return;
            }
          }
          await enterApp();
        } catch (err) {
          state.authError = err.message || "Falha na autenticação.";
          renderAuthForm();
        } finally {
          if (btn) btn.disabled = false;
        }
      }
    });
  }

  async function showLoggedOut() {
    state.user = null;
    state.profile = null;
    state.houses = [];
    state.selectedId = null;
    state.expandedId = null;
    state.scope = "mine";
    state.view = "list";
    state.authError = "";
    renderAuth();
  }

  async function enterApp() {
    const session = await API.getSession();
    if (!session?.user) {
      await showLoggedOut();
      return;
    }
    state.user = session.user;
    state.profile = await API.getProfile();
    state.authError = "";
    els.authScreen.classList.add("hidden");
    els.appShell.classList.remove("hidden");
    if (!state.mapReady) {
      initMap();
      state.mapReady = true;
      setTimeout(() => map.invalidateSize(), 50);
    } else {
      setTimeout(() => map.invalidateSize(), 50);
    }
    await load();
    updateMenuUser();
    render();
    await refreshDistances();
    const local = readLocalHouses();
    if (local.length && state.scope === "mine") {
      toast(`Há ${local.length} casa(s) neste navegador. Use o menu → Trazer casas deste navegador.`);
    }
  }

  async function boot() {
    bindEvents();
    if (!API.isConfigured()) {
      renderAuth();
      return;
    }
    try {
      await API.bootstrap();
      let handlingAuth = false;
      API.onAuthStateChange(async (event, session) => {
        if (handlingAuth) return;
        if (event === "SIGNED_OUT" || !session) {
          if (state.user) await showLoggedOut();
          return;
        }
        if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
          if (!state.user || state.user.id !== session.user.id) {
            handlingAuth = true;
            try {
              await enterApp();
            } finally {
              handlingAuth = false;
            }
          }
        }
      });
      const session = await API.getSession();
      if (session?.user) await enterApp();
      else await showLoggedOut();
    } catch (err) {
      console.error(err);
      state.authError = err.message || "Não foi possível conectar ao Supabase.";
      renderAuth();
    }
  }

  boot();
})();

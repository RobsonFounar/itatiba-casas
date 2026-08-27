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

  const els = {
    panelBody: document.getElementById("panel-body"),
    schoolCard: document.getElementById("school-card"),
    searchForm: document.getElementById("search-form"),
    searchInput: document.getElementById("search-input"),
    searchResults: document.getElementById("search-results"),
    sortBy: document.getElementById("sort-by"),
    btnAdd: document.getElementById("btn-add"),
    btnMenu: document.getElementById("btn-menu"),
    menuPop: document.getElementById("menu-pop"),
    importFile: document.getElementById("import-file"),
    mapHint: document.getElementById("map-hint"),
    navBanner: document.getElementById("nav-banner"),
    toast: document.getElementById("toast"),
  };

  const state = {
    school: null,
    houses: [],
    selectedId: null,
    view: "list",
    clickMode: null,
    searchHits: [],
    searchActive: -1,
    editingId: null,
    draftPoint: null,
    routeFocus: "school",
  };

  let map;
  let houseLayer;
  let schoolLayer;
  let routeLayer;
  let searchTimer;
  let toastTimer;

  function load() {
    state.school = { ...FIXED_SCHOOL };
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      state.houses = Array.isArray(raw.houses) ? raw.houses : [];
    } catch {
      state.houses = [];
    }
  }

  function save() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ school: state.school, houses: state.houses })
    );
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
      .replace(/\b(condominio|residencial|loteamento|fechado|cond)\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function localNames(item) {
    return [item.nome, ...(item.aliases || [])];
  }

  function scoreLocal(item, query) {
    const q = fold(query);
    if (!q || q.length < 2) return 0;
    let best = 0;
    for (const name of localNames(item)) {
      const n = fold(name);
      if (!n) continue;
      if (n === q) return 100;
      if (n.startsWith(q) || q.startsWith(n)) best = Math.max(best, 92);
      if (n.includes(q) || (q.length >= 5 && q.includes(n))) best = Math.max(best, 80);
    }
    return best;
  }

  function findLocais(query, min = 70) {
    return (window.ITATIBA_LOCAIS || [])
      .map((item) => ({ item, score: scoreLocal(item, query) }))
      .filter((row) => row.score >= min)
      .sort((a, b) => b.score - a.score || a.item.nome.localeCompare(b.item.nome, "pt-BR"));
  }

  function hitFromLocal(item) {
    if (item.lat == null) return null;
    return {
      lat: item.lat,
      lng: item.lng,
      label: `${item.nome}, Itatiba, SP`,
      name: item.nome,
      tipo: item.tipo,
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
    const cache = geoCache();
    if (cache[key]?.length) return cache[key];

    const local = findLocais(query);
    const withCoords = local.map((row) => hitFromLocal(row.item)).filter(Boolean);
    if (withCoords.length) {
      putGeoCache(key, withCoords);
      return withCoords;
    }

    const attempts = [
      ...queryFallbacks(query),
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
    save();
    render();
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
      html: `<div class="pin"><span>★</span></div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -32],
    });
  }

  function centroIcon() {
    return L.divIcon({
      className: "pin-centro",
      html: `<div class="pin"><span>C</span></div>`,
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
      <article class="anchor-card">
        <div class="school-top">
          <div class="school-icon" aria-hidden="true">★</div>
          <div>
            <h2>${esc(FIXED_SCHOOL.name)}</h2>
            <p>${esc(FIXED_SCHOOL.subtitle)}</p>
            <p>${esc(FIXED_SCHOOL.address)}</p>
          </div>
        </div>
        <button class="ghost-btn" type="button" data-fly="school">Ver no mapa</button>
      </article>
      <article class="anchor-card">
        <div class="school-top">
          <div class="school-icon centro" aria-hidden="true">C</div>
          <div>
            <h2>${esc(FIXED_CENTRO.name)}</h2>
            <p>${esc(FIXED_CENTRO.subtitle)}</p>
            <p>${esc(FIXED_CENTRO.address)}</p>
          </div>
        </div>
        <button class="ghost-btn" type="button" data-fly="centro">Ver no mapa</button>
      </article>
    `;
  }

  function renderList() {
    const houses = sortedHouses();
    if (!houses.length) {
      els.panelBody.innerHTML = `
        <div class="empty-state">
          <h3>Nenhuma casa ainda</h3>
          <p>Adicione pelo bairro, condomínio, rua ou clique no mapa. Cada casa mostra o tempo até o colégio e até o centro.</p>
        </div>
      `;
      return;
    }

    els.panelBody.innerHTML = houses
      .map((house, i) => {
        const open = house.id === state.selectedId;
        const condo = house.precision === "condominio";
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
        return `
        <article class="house-card ${open ? "is-selected" : ""}" data-select="${house.id}">
          <div class="house-index">${i + 1}</div>
          <div>
            <h3>${esc(house.title)}</h3>
            <p class="meta">${esc(house.bairro || "Bairro não informado")}${
              house.address ? ` · ${esc(house.address)}` : ""
            }</p>
            <div class="chips-wrap">
              ${distRow("Colégio", "school", house.toSchool, house.id, "school")}
              ${distRow("Centro", "centro", house.toCentro, house.id, "centro")}
              ${approx}
            </div>
            <button type="button" class="point-toggle ${open ? "is-open" : ""}" data-toggle="${house.id}">
              ${toggleLabel}
            </button>
            ${routePanel(house)}
            ${house.notes ? `<p class="meta">${esc(house.notes)}</p>` : ""}
          </div>
          <div class="card-actions">
            <button type="button" data-edit="${house.id}">Editar</button>
            <button type="button" data-del="${house.id}">Excluir</button>
          </div>
        </article>
      `;
      })
      .join("");
  }

  function bairroOptions(selected) {
    return (window.ITATIBA_LOCAIS || []).map(
      (item) =>
        `<option value="${esc(item.nome)}" ${
          item.nome === selected ? "selected" : ""
        }></option>`
    ).join("");
  }

  function renderHouseForm(house) {
    const isEdit = Boolean(house);
    const title = house?.title || "";
    const bairro = house?.bairro || "";
    const address = house?.address || "";
    const notes = house?.notes || "";
    els.panelBody.innerHTML = `
      <form class="form-stack" id="house-form">
        <h3>${isEdit ? "Editar casa" : "Nova casa"}</h3>
        <label class="field">Apelido
          <input name="title" required placeholder="Ex.: Casa 3 quartos no Engenho" value="${esc(title)}" />
        </label>
        <label class="field">Bairro ou condomínio
          <input name="bairro" list="bairros-list" required placeholder="Ex.: Ville de France, Nova Itatiba" value="${esc(bairro)}" />
          <datalist id="bairros-list">${bairroOptions(bairro)}</datalist>
        </label>
        <label class="field">Rua e número (opcional)
          <input name="address" placeholder="Ex.: Rua das Flores, 120" value="${esc(address)}" />
        </label>
        <label class="field">Observações
          <textarea name="notes" placeholder="Preço, link do anúncio, número de quartos...">${esc(notes)}</textarea>
        </label>
        <p class="help">Pode ser o nome do condomínio. Se o mapa não achar a rua, usa o ponto do condomínio ou do bairro. Depois você arrasta o pin até a casa.</p>
        <div class="form-actions">
          <button class="primary-btn" type="submit">${isEdit ? "Salvar" : "Adicionar"}</button>
          <button class="text-btn" type="button" data-go="list">Cancelar</button>
        </div>
      </form>
    `;
  }

  function renderSidebar() {
    renderSchoolCard();
    if (state.view === "add") renderHouseForm(null);
    else if (state.view === "edit") {
      const house = state.houses.find((item) => item.id === state.editingId);
      renderHouseForm(house);
    } else renderList();
  }

  function render() {
    renderSidebar();
    renderMarkers();
    const selected = state.houses.find((item) => item.id === state.selectedId);
    drawRoute(selected);
    renderNavBanner();
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
    state.view = view;
    state.clickMode = view === "add" || view === "edit" ? "house" : null;
    setHint(state.clickMode === "house" ? "Clique no mapa para marcar a casa" : "");
    els.menuPop.classList.add("hidden");
    renderSidebar();
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

    if (state.view === "edit" && state.editingId) {
      const house = state.houses.find((item) => item.id === state.editingId);
      if (house) {
        Object.assign(house, { title, bairro: placeName, address, notes, lat, lng, precision });
      }
    } else {
      state.houses.push({
        id: uid(),
        title,
        bairro: placeName,
        address,
        notes,
        lat,
        lng,
        precision,
      });
    }

    save();
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
    const info = await reverseGeocode(lat, lng);
    const title = `Casa em ${info?.bairro || "Itatiba"}`;
    state.houses.push({
      id: uid(),
      title,
      bairro: info?.bairro || "",
      address: info?.road || "",
      notes: "",
      lat,
      lng,
      precision: "mapa",
    });
    save();
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

  async function runSearch(query) {
    if (!query.trim()) {
      els.searchResults.classList.add("hidden");
      els.searchResults.innerHTML = "";
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
        els.searchResults.innerHTML = `<li>Nada encontrado em Itatiba para “${esc(query)}”. Tente o nome do condomínio, o bairro ou clique no mapa.</li>`;
        els.searchResults.classList.remove("hidden");
        return;
      }
      els.searchResults.innerHTML = hits
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
      els.searchResults.classList.remove("hidden");
    } catch {
      toast("A busca está indisponível no momento.");
    }
  }

  async function useHit(index) {
    const hit = state.searchHits[index];
    if (!hit) return;
    const info = await reverseGeocode(hit.lat, hit.lng);
    state.houses.push({
      id: uid(),
      title: hit.name,
      bairro: hit.name,
      address: info?.road || "",
      notes: "",
      lat: hit.lat,
      lng: hit.lng,
      precision: hit.tipo === "condominio" ? "condominio" : "endereco",
    });
    save();
    map.flyTo([hit.lat, hit.lng], 16);
    await refreshDistances();
    els.searchResults.classList.add("hidden");
    els.searchInput.value = "";
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

    els.menuPop.addEventListener("click", (ev) => {
      const action = ev.target.closest("button")?.dataset.action;
      if (action === "export") exportData();
      if (action === "import") els.importFile.click();
      if (action === "clear") {
        if (confirm("Apagar todas as casas deste navegador?")) {
          state.houses = [];
          state.selectedId = null;
          save();
          render();
        }
      }
    });

    els.importFile.addEventListener("change", async () => {
      const file = els.importFile.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        state.school = { ...FIXED_SCHOOL };
        state.houses = Array.isArray(data.houses) ? data.houses : [];
        save();
        await refreshDistances();
        toast("Dados importados.");
      } catch {
        toast("Arquivo inválido.");
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

    els.panelBody.addEventListener("click", (ev) => {
      if (ev.target.closest("[data-waze]")) {
        ev.stopPropagation();
        return;
      }
      const goTo = ev.target.closest("[data-go]")?.dataset.go;
      if (goTo) {
        go(goTo);
        return;
      }
      const del = ev.target.closest("[data-del]")?.dataset.del;
      if (del) {
        state.houses = state.houses.filter((item) => item.id !== del);
        if (state.selectedId === del) state.selectedId = null;
        save();
        render();
        return;
      }
      const edit = ev.target.closest("[data-edit]")?.dataset.edit;
      if (edit) {
        state.editingId = edit;
        go("edit");
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

    els.panelBody.addEventListener("submit", (ev) => {
      ev.preventDefault();
      if (ev.target.id === "house-form") submitHouse(ev.target);
    });

    els.searchForm.addEventListener("submit", (ev) => {
      ev.preventDefault();
      runSearch(els.searchInput.value);
    });

    els.searchInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => runSearch(els.searchInput.value), 400);
    });

    els.searchResults.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-use]");
      const li = ev.target.closest("[data-hit]");
      if (!btn || !li) return;
      useHit(Number(li.dataset.hit));
    });
  }

  load();
  initMap();
  bindEvents();
  render();
  refreshDistances();
})();

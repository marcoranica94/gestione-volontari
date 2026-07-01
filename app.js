/* Gestione Volontari · Festa in Rocca 2026
   App SPA in JS puro. Dati cifrati (AES-256) sbloccati con password.
   Persistenza locale (localStorage) + import/export JSON. */
(function () {
  "use strict";

  /* ============ helpers DOM ============ */
  function el(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "html") e.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function")
        e.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) e.setAttribute(k, "");
      else e.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return e;
  }
  const $ = (sel) => document.querySelector(sel);

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  function openModal(node) {
    const root = $("#modalRoot");
    root.innerHTML = "";
    const bg = el("div", {
      class: "modal-bg",
      onclick: (e) => { if (e.target === bg) closeModal(); },
    });
    bg.append(el("div", { class: "modal glass" }, node));
    root.append(bg);
    document.addEventListener("keydown", escClose);
  }
  function closeModal() {
    $("#modalRoot").innerHTML = "";
    document.removeEventListener("keydown", escClose);
  }
  function escClose(e) { if (e.key === "Escape") closeModal(); }

  /* ============ crypto / login ============ */
  const b64dec = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const b64enc = (buf) => {
    const bytes = new Uint8Array(buf);
    let out = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(out);
  };

  async function decryptBlob(password, E) {
    const rawKey = new TextEncoder().encode(password);
    const baseKey = await crypto.subtle.importKey("raw", rawKey, "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: b64dec(E.salt), iterations: 200000, hash: "SHA-256" },
      baseKey, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
    );
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64dec(E.iv) }, key, b64dec(E.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  async function encryptBlob(password, data) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const rawKey = new TextEncoder().encode(password);
    const plaintext = new TextEncoder().encode(JSON.stringify(data));
    const baseKey = await crypto.subtle.importKey("raw", rawKey, "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 200000, hash: "SHA-256" },
      baseKey, { name: "AES-GCM", length: 256 }, false, ["encrypt"]
    );
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    return { v: 1, salt: b64enc(salt), iv: b64enc(iv), ct: b64enc(ct) };
  }

  async function decryptSeed(password) {
    const blobs = Array.isArray(window.SEED_ENC) ? window.SEED_ENC : [window.SEED_ENC];
    for (const E of blobs) {
      try {
        return await decryptBlob(password, E);
      } catch (_) { /* prova il prossimo blob */ }
    }
    throw new Error("password errata");
  }

  /* ============ stato ============ */
  const LS_KEY = "gv-festa-rocca-2026";
  const SNAPS_KEY = "gv-snapshots-rocca-2026";
  const SESS_KEY = "gv-unlocked";
  const SUPABASE_URL = "https://ypawiaaqzwxzxdvcdyzg.supabase.co";
  const SUPABASE_KEY = "sb_publishable_1IAOoGvEuc1b45XpAP1_Nw_qY3Kqv4_";
  const CLOUD_TABLE = "app_state";
  const CLOUD_ROW_ID = "main";
  const CLOUD_ENABLED = Boolean(SUPABASE_URL && SUPABASE_KEY);
  let DB = null;
  let LIVE_DB = null; // DB salvato quando si visualizza un'istantanea
  let cloudSaveTimer = null;
  let cloudSaveChain = Promise.resolve();
  let cloudLastError = "";
  const STATE = { view: "dashboard", search: "", sort: "nome-az", vfilter: "tutti", day: 0,
    readonly: false, snapName: null, snapDate: null, hiddenAreas: [] };
  const STATI = ["P", "A", "L"];
  const STATO_LABEL = { P: "Presente", A: "Assente", L: "Altra locazione" };

  function save() {
    if (STATE.readonly) return; // mai scrivere dati di un'istantanea nel localStorage
    try { localStorage.setItem(LS_KEY, JSON.stringify(DB)); } catch (e) { /* storage non disponibile */ }
    scheduleCloudSave();
  }
  function guardReadonly() {
    if (STATE.readonly) { toast("Sola lettura — esci dall'anteprima per modificare"); return true; }
    return false;
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }

  function supabaseHeaders(extra) {
    return {
      apikey: SUPABASE_KEY,
      Authorization: "Bearer " + SUPABASE_KEY,
      "Content-Type": "application/json",
      ...extra,
    };
  }
  async function supabaseFetch(path, options) {
    const res = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
      ...options,
      headers: supabaseHeaders(options?.headers),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error("Supabase " + res.status + (text ? ": " + text : ""));
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  async function loadCloudDB() {
    if (!CLOUD_ENABLED) return null;
    const rows = await supabaseFetch(
      CLOUD_TABLE + "?id=eq." + encodeURIComponent(CLOUD_ROW_ID) + "&select=payload,updated_at&limit=1",
      { method: "GET" }
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row?.payload) return null;
    if (row.payload.data) return normalize(row.payload.data);
    if (row.payload.festa && row.payload.volontari && row.payload.aree) return normalize(row.payload);
    throw new Error("Dati cloud ancora cifrati: importa un export JSON per inizializzare il nuovo formato.");
  }
  function setCloudStatus(text, cls) {
    const node = document.getElementById("cloudStatus");
    if (!node) return;
    node.textContent = text;
    node.className = "cloud-status" + (cls ? " " + cls : "");
  }
  function scheduleCloudSave() {
    if (!CLOUD_ENABLED || STATE.readonly || !DB) return;
    clearTimeout(cloudSaveTimer);
    setCloudStatus("Cloud: modifiche…", "cloud-pending");
    cloudSaveTimer = setTimeout(() => {
      cloudSaveChain = cloudSaveChain.then(saveCloudDB).catch((e) => {
        cloudLastError = e.message || String(e);
        console.error(e);
        setCloudStatus("Cloud: errore", "cloud-error");
        toast("Errore salvataggio cloud");
      });
    }, 650);
  }
  async function saveCloudDB() {
    setCloudStatus("Cloud: salvo…", "cloud-pending");
    await supabaseFetch(CLOUD_TABLE, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        id: CLOUD_ROW_ID,
        payload: { v: 2, data: DB },
        updated_at: new Date().toISOString(),
      }),
    });
    cloudLastError = "";
    setCloudStatus("Cloud: salvato", "cloud-ok");
  }

  function normalize(db) {
    for (const area of db.aree || []) {
      for (const p of area.postazioni || []) {
        if ((p.nome || "").trim().toLowerCase() === "consegna patatine") {
          p.nome = "Consegna patatine e dolci";
        }
      }
    }
    for (const a of db.assegnazioni) {
      a.validato = a.validato === true;
      for (const d of db.festa.date) {
        let s = (a.giorni[d] || "A").toString().toUpperCase();
        a.giorni[d] = STATI.includes(s) ? s : "A";
      }
    }
    return db;
  }

  /* ============ indici / query ============ */
  function allPostazioni() {
    const out = [];
    for (const a of DB.aree)
      for (const p of a.postazioni)
        out.push({ id: p.id, nome: p.nome, areaId: a.id, areaNome: a.nome });
    return out;
  }
  function posInfo(posId) { return allPostazioni().find((p) => p.id === posId); }
  function volById(id) { return DB.volontari.find((v) => v.id === id); }
  function assegByPos(posId) { return DB.assegnazioni.filter((a) => a.postazioneId === posId); }
  function assegByVol(volId) { return DB.assegnazioni.filter((a) => a.volontarioId === volId); }
  function countP(giorni) { return DB.festa.date.filter((d) => giorni[d] === "P").length; }
  function nextStato(s) { return s === "P" ? "A" : s === "A" ? "L" : "P"; }
  function pCountOnDay(volId, day) {
    return DB.assegnazioni.filter((a) => a.volontarioId === volId && a.giorni[day] === "P").length;
  }
  function statoTitle(ass, day) {
    const stato = ass.giorni[day];
    if (stato === "L") {
      const altre = DB.assegnazioni
        .filter((x) => x !== ass && x.volontarioId === ass.volontarioId && x.giorni[day] === "P")
        .map((x) => posInfo(x.postazioneId)?.nome || "?");
      return STATO_LABEL.L + (altre.length ? " · a: " + altre.join(", ") : " · postazione non indicata");
    }
    if (stato === "P" && pCountOnDay(ass.volontarioId, day) >= 2) {
      const altre = DB.assegnazioni
        .filter((x) => x !== ass && x.volontarioId === ass.volontarioId && x.giorni[day] === "P")
        .map((x) => posInfo(x.postazioneId)?.nome || "?");
      return STATO_LABEL.P + " · anche a: " + altre.join(", ");
    }
    return STATO_LABEL[stato];
  }
  function initials(nome) {
    const w = nome.trim().split(/\s+/);
    return ((w[0]?.[0] || "") + (w[1]?.[0] || "")).toUpperCase();
  }
  function slug(s) {
    return "v-" + s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  }
  const AREA_COLORS = { "a-pulizia": "#2c8597", "a-cucina": "#a8527a", "a-clienti": "#5560a6" };

  // Soglie per i totali giornalieri: { warn: N, ok: M } → <warn=rosso, >=warn=giallo, >=ok=verde
  const SOGLIE = {
    "p-clienti-casse":       { warn: 3, ok: 3 }, // <3 rosso, 3+ verde
    "p-clienti-cassa-veloce":{ warn: 3, ok: 3 },
    "p-clienti-scansione":   { warn: 2, ok: 4 }, // <2 rosso, 2-3 giallo, 4+ verde
    "p-clienti-bar":         { warn: 1, ok: 2 }, // 0 rosso, 1 giallo, 2+ verde
    "p-clienti-pizze":       { warn: 1, ok: 2 }, // 0 rosso, 1 giallo, 2+ verde
    "p-cucina-vassoi":       { warn: 5, ok: 6 }, // ≤4 rosso, 5 giallo, 6+ verde
  };
  function sogliaCls(posId, count) {
    const s = SOGLIE[posId];
    if (!s) return "tot-neu";
    if (count >= s.ok) return "tot-ok";
    if (count >= s.warn) return "tot-warn";
    return "tot-bad";
  }
  const AREA_FALLBACK = ["#2c8597", "#a8527a", "#5560a6", "#3f7d52", "#9a7b27", "#4d5da3"];
  function areaColor(areaId, i) { return AREA_COLORS[areaId] || AREA_FALLBACK[i % AREA_FALLBACK.length]; }

  /* ============ navigazione ============ */
  function setView(view) { STATE.view = view; render(); }
  function gotoPostazione(posId) {
    STATE.view = "postazioni";
    render();
    setTimeout(() => {
      const node = document.getElementById("pos-" + posId);
      if (node) {
        node.scrollIntoView({ behavior: "smooth", block: "center" });
        node.classList.add("flash");
        setTimeout(() => node.classList.remove("flash"), 1600);
      }
    }, 60);
  }

  /* ============ drag & drop riordino sezioni ============ */
  let dragAreaId = null;
  function attachDnD(sec, handle, areaId) {
    handle.addEventListener("dragstart", (e) => {
      dragAreaId = areaId;
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", areaId); } catch (_) {}
      }
      sec.classList.add("dragging");
    });
    handle.addEventListener("dragend", () => {
      dragAreaId = null;
      document.querySelectorAll(".area-sec").forEach((s) => s.classList.remove("dragging", "dragover"));
    });
    sec.addEventListener("dragover", (e) => {
      if (dragAreaId && dragAreaId !== areaId) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        sec.classList.add("dragover");
      }
    });
    sec.addEventListener("dragleave", () => sec.classList.remove("dragover"));
    sec.addEventListener("drop", (e) => {
      e.preventDefault();
      sec.classList.remove("dragover");
      reorderAree(dragAreaId, areaId);
    });
  }
  function reorderAree(fromId, toId) {
    if (guardReadonly()) return;
    if (!fromId || fromId === toId) return;
    const fromIdx = DB.aree.findIndex((a) => a.id === fromId);
    const toIdx = DB.aree.findIndex((a) => a.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = DB.aree.splice(fromIdx, 1);
    const newToIdx = DB.aree.findIndex((a) => a.id === toId);
    DB.aree.splice(newToIdx + (fromIdx < toIdx ? 1 : 0), 0, moved);
    save(); render(); toast("Sezioni riordinate");
  }

  /* ============ viste ============ */
  function allConflicts() {
    const out = [];
    const seen = new Set();
    for (const v of DB.volontari) {
      for (let i = 0; i < DB.festa.date.length; i++) {
        const d = DB.festa.date[i];
        const pAss = DB.assegnazioni.filter((a) => a.volontarioId === v.id && a.giorni[d] === "P");
        if (pAss.length >= 2) {
          const key = v.id + "|" + d;
          if (!seen.has(key)) {
            seen.add(key);
            out.push({ vol: v, dayIdx: i, nomi: pAss.map((a) => posInfo(a.postazioneId)?.nome || "?") });
          }
        }
      }
    }
    return out;
  }

  function viewDashboard() {
    const wrap = el("div");

    // ---- stat mini-cards ----
    const tot = DB.volontari.length;
    const nPos = allPostazioni().length;
    const nConfl = allConflicts().length;
    const nTaglieMancanti = DB.volontari.filter((v) => !v.taglia).length;
    const statsRow = el("div", { class: "dash-stats" },
      dashStat("Volontari", tot, "registrati"),
      dashStat("Postazioni", nPos, DB.aree.length + " aree"),
      dashStat("Conflitti P", nConfl, nConfl === 0 ? "nessuno" : "doppi turni", nConfl > 0 ? "ds-bad" : "ds-ok"),
      dashStat("Taglie mancanti", nTaglieMancanti, "magliette da impostare", nTaglieMancanti > 0 ? "ds-warn" : "ds-ok"),
    );
    wrap.append(statsRow);

    // ---- riquadro conflitti ----
    const conflicts = allConflicts();
    if (conflicts.length) {
      const byVol = {};
      for (const c of conflicts) {
        if (!byVol[c.vol.id]) byVol[c.vol.id] = { vol: c.vol, items: [] };
        byVol[c.vol.id].items.push(c);
      }
      const alertSec = el("div", { class: "section glass dash-conflict-sec" },
        el("div", { class: "head" },
          el("h2", { class: "dash-conflict-title" }, "⚠️ Conflitti turno P"),
          el("span", { class: "pill" }, conflicts.length + " casi")));
      const list = el("div", { class: "dash-conflict-list" });
      for (const { vol, items } of Object.values(byVol)) {
        const row = el("div", { class: "dash-conflict-row" },
          el("span", { class: "dcr-nome", style: "cursor:pointer", onclick: () => personDetail(vol.id) }, vol.nome),
          el("span", { class: "dcr-days" },
            ...items.map((c) => el("span", { class: "dcr-chip" },
              el("b", {}, DB.festa.label[c.dayIdx] + ":"),
              " " + c.nomi.join(" + ")))));
        list.append(row);
      }
      alertSec.append(list);
      wrap.append(alertSec);
    }

    // ---- griglia copertura ----
    const covSec = el("div", { class: "section glass" });
    covSec.append(el("div", { class: "head" },
      el("h2", {}, "Copertura postazioni"),
      el("span", { class: "pill" }, "clic su un giorno → dettaglio · clic sul nome → postazione")));

    const table = el("table", { class: "cov-table" });
    const thead = el("thead", {});
    const hrow = el("tr", {}, el("th", { class: "cov-pos-th" }, "Postazione"));
    DB.festa.label.forEach((l, i) => {
      const parts = l.split(" ");
      hrow.append(el("th", { class: "cov-day-th", title: "Vai al giorno " + l,
        onclick: () => { STATE.day = i; setView("giorno"); } },
        el("div", { class: "cov-dh-wd" }, parts[0] || ""),
        el("div", { class: "cov-dh-n" }, parts[1] || l)));
    });
    hrow.append(el("th", { class: "cov-tot-th" }, "Tot"));
    thead.append(hrow);
    table.append(thead);

    const tbody = el("tbody", {});
    DB.aree.forEach((a, ai) => {
      tbody.append(el("tr", { class: "cov-area-row" },
        el("td", { colspan: DB.festa.date.length + 2, class: "cov-area-label",
          style: "--ac:" + areaColor(a.id, ai) }, a.nome)));
      for (const p of a.postazioni) {
        const ass = assegByPos(p.id);
        const tr = el("tr", { class: "cov-pos-row" },
          el("td", { class: "cov-pos-name", onclick: () => gotoPostazione(p.id) }, p.nome));
        let totP = 0;
        DB.festa.date.forEach((d) => {
          const n = ass.filter((x) => x.giorni[d] === "P").length;
          totP += n;
          tr.append(el("td", { class: "cov-cell " + sogliaCls(p.id, n) }, n > 0 ? String(n) : "·"));
        });
        tr.append(el("td", { class: "cov-total" }, String(totP)));
        tbody.append(tr);
      }
    });
    table.append(tbody);
    covSec.append(el("div", { class: "cov-tablewrap" }, table));

    // legenda soglie
    covSec.append(el("div", { class: "cov-legend" },
      el("span", { class: "dot-sq tot-ok" }), "copertura ok",
      el("span", { class: "dot-sq tot-warn" }), "parziale",
      el("span", { class: "dot-sq tot-bad" }), "insufficiente",
      el("span", { class: "dot-sq tot-neu" }), "senza soglia"));
    wrap.append(covSec);

    return wrap;
  }

  function dashStat(label, value, sub, mod) {
    return el("div", { class: "card glass dash-stat" + (mod ? " " + mod : "") },
      el("div", { class: "ds-label" }, label),
      el("div", { class: "ds-value" }, String(value)),
      el("div", { class: "ds-sub" }, sub));
  }
  function dayPresenti(d) {
    return new Set(DB.assegnazioni.filter((a) => a.giorni[d] === "P")
      .map((a) => a.volontarioId)).size;
  }
  function statCard(title, value, sub) {
    return el("div", { class: "card glass" },
      el("h3", {}, title),
      el("div", { class: "stat" }, String(value), sub ? el("small", {}, " " + sub) : null));
  }

  /* ---- Volontari ---- */
  const SORT_OPTS = [
    { key: "nome-az", label: "A→Z" },
    { key: "nome-za", label: "Z→A" },
    { key: "pres-desc", label: "Presenze ↓" },
    { key: "pres-asc", label: "Presenze ↑" },
    { key: "pos-desc", label: "Postazioni ↓" },
  ];
  const FILTER_OPTS = [
    { key: "tutti", label: "Tutti" },
    { key: "attivi", label: "Con presenze" },
    { key: "zero", label: "Zero presenze" },
  ];

  function viewVolontari() {
    const wrap = el("div", { class: "section glass" });
    const nAttivi = DB.volontari.filter((v) => {
      const ass = assegByVol(v.id);
      return DB.festa.date.some((d) => ass.some((a) => a.giorni[d] === "P"));
    }).length;
    const nZero = DB.volontari.length - nAttivi;

    const head = el("div", { class: "head" },
      el("h2", {}, "Volontari"),
      el("span", { class: "pill" }, DB.volontari.length + " totali"),
      nZero > 0 ? el("span", { class: "pill warn-pill" }, nZero + " senza presenze") : null,
      el("input", {
        class: "search", placeholder: "Cerca volontario…", value: STATE.search,
        oninput: (e) => { STATE.search = e.target.value; refreshVList(); },
      }),
      el("button", { class: "btn primary", onclick: () => editVolontario(null) }, "➕ Aggiungi"),
      el("button", { class: "btn", onclick: exportMagliette }, "CSV magliette"),
      el("button", { class: "btn", onclick: printMagliette }, "Stampa magliette"));
    wrap.append(head);

    const toolbar = el("div", { class: "vtoolbar" },
      el("div", { class: "vtool-group" },
        el("span", { class: "vtool-label" }, "Ordina:"),
        ...SORT_OPTS.map((o) => el("button", {
          class: "btn sm" + (STATE.sort === o.key ? " vsort-active" : ""),
          onclick: () => { STATE.sort = o.key; render(); },
        }, o.label))),
      el("div", { class: "vtool-group" },
        el("span", { class: "vtool-label" }, "Filtra:"),
        ...FILTER_OPTS.map((o) => el("button", {
          class: "btn sm" + (STATE.vfilter === o.key ? " vsort-active" : ""),
          onclick: () => { STATE.vfilter = o.key; render(); },
        }, o.label))));
    wrap.append(toolbar);
    wrap.append(el("div", { class: "vlist", id: "vlist" }));
    refreshVListInto(wrap);
    return wrap;
  }

  function refreshVList() { refreshVListInto(document); }
  function refreshVListInto(root) {
    const list = root.querySelector ? root.querySelector("#vlist") : $("#vlist");
    if (!list) return;
    list.innerHTML = "";
    const total = DB.festa.date.length;
    const q = STATE.search.trim().toLowerCase();

    let vols = DB.volontari
      .filter((v) => v.nome.toLowerCase().includes(q))
      .map((v) => {
        const ass = assegByVol(v.id);
        const pres = DB.festa.date.filter((d) => ass.some((a) => a.giorni[d] === "P")).length;
        return { v, ass, pres };
      });

    if (STATE.vfilter === "attivi") vols = vols.filter((x) => x.pres > 0);
    else if (STATE.vfilter === "zero") vols = vols.filter((x) => x.pres === 0);

    const s = STATE.sort;
    if (s === "nome-za") vols.sort((a, b) => b.v.nome.localeCompare(a.v.nome, "it"));
    else if (s === "pres-desc") vols.sort((a, b) => b.pres - a.pres || a.v.nome.localeCompare(b.v.nome, "it"));
    else if (s === "pres-asc") vols.sort((a, b) => a.pres - b.pres || a.v.nome.localeCompare(b.v.nome, "it"));
    else if (s === "pos-desc") vols.sort((a, b) => b.ass.length - a.ass.length || a.v.nome.localeCompare(b.v.nome, "it"));
    else vols.sort((a, b) => a.v.nome.localeCompare(b.v.nome, "it"));

    if (!vols.length) { list.append(el("div", { class: "empty-state" }, "Nessun volontario trovato.")); return; }

    for (const { v, ass, pres } of vols) {
      const zero = pres === 0;
      const presBadge = el("span", { class: "pres-badge " + (zero ? "pres-zero" : "pres-ok") },
        `${pres}/${total} gg`);
      const tagliaBadge = v.taglia
        ? el("span", { class: "pres-badge taglia-badge" }, v.taglia)
        : el("span", { class: "pres-badge pres-zero", title: "Taglia non impostata" }, "—");
      const row = el("div", { class: "vrow" + (zero ? " vrow-zero" : "") },
        el("div", { class: "avatar" + (zero ? " avatar-zero" : "") }, initials(v.nome)),
        el("div", { class: "meta", style: "cursor:pointer", onclick: () => personDetail(v.id) },
          el("div", { class: "nm" }, v.nome),
          el("div", { class: "tags" }, ass.length + " postaz. · ", presBadge, " · ", tagliaBadge)),
        el("div", { class: "acts" },
          el("button", { class: "btn sm", title: "Modifica", onclick: () => editVolontario(v.id) }, "✏️"),
          el("button", { class: "btn sm danger", title: "Elimina", onclick: () => removeVolontario(v.id) }, "🗑️")));
      list.append(row);
    }
  }

  const TAGLIE = ["", "XS", "S", "M", "L", "XL", "XXL"];

  function editVolontario(id) {
    if (guardReadonly()) return;
    const v = id ? volById(id) : null;
    const assigned = new Set((id ? assegByVol(id) : []).map((a) => a.postazioneId));
    const nameInput = el("input", { value: v ? v.nome : "", placeholder: "Nome e cognome" });
    const tagliaSelect = el("select", {});
    TAGLIE.forEach((t) => tagliaSelect.append(
      el("option", { value: t, ...(( v?.taglia || "") === t ? { selected: true } : {}) },
        t || "— non specificata —")));
    const checks = el("div", { class: "checks" });
    for (const p of allPostazioni()) {
      const cb = el("input", { type: "checkbox" });
      if (assigned.has(p.id)) cb.checked = true;
      cb.dataset.pos = p.id;
      checks.append(el("label", {}, cb, `${p.nome}`, el("span",
        { style: "color:var(--text-dim);font-size:.72rem" }, ` · ${p.areaNome}`)));
    }
    const modal = el("div", {},
      el("h3", {}, id ? "Modifica volontario" : "Nuovo volontario"),
      el("div", { class: "field" }, el("label", {}, "Nome"), nameInput),
      el("div", { class: "field" }, el("label", {}, "Taglia maglietta"), tagliaSelect),
      el("div", { class: "field" },
        el("label", {}, "Postazioni assegnate (nuovi turni = tutti Presente)"), checks),
      el("div", { class: "row" },
        el("button", { class: "btn", onclick: closeModal }, "Annulla"),
        el("button", { class: "btn primary", onclick: doSave }, "Salva")));
    openModal(modal);
    nameInput.focus();

    function doSave() {
      const nome = nameInput.value.trim();
      if (!nome) { toast("Inserisci un nome"); return; }
      let vol = v;
      if (!vol) {
        let newId = slug(nome);
        while (volById(newId)) newId += "-2";
        vol = { id: newId, nome };
        DB.volontari.push(vol);
      } else { vol.nome = nome; }
      if (tagliaSelect.value) vol.taglia = tagliaSelect.value;
      else delete vol.taglia;
      const wanted = new Set([...checks.querySelectorAll("input:checked")].map((c) => c.dataset.pos));
      // rimuovi deselezionate
      DB.assegnazioni = DB.assegnazioni.filter(
        (a) => !(a.volontarioId === vol.id && !wanted.has(a.postazioneId)));
      // aggiungi nuove
      for (const posId of wanted) {
        if (!DB.assegnazioni.some((a) => a.volontarioId === vol.id && a.postazioneId === posId)) {
          const giorni = {};
          for (const d of DB.festa.date) giorni[d] = "P";
          DB.assegnazioni.push({ volontarioId: vol.id, postazioneId: posId, giorni, validato: false });
        }
      }
      save(); closeModal(); render(); toast(id ? "Volontario aggiornato" : "Volontario aggiunto");
    }
  }

  function removeVolontario(id) {
    if (guardReadonly()) return;
    const v = volById(id);
    if (!confirm(`Eliminare "${v.nome}" e tutte le sue assegnazioni?`)) return;
    DB.volontari = DB.volontari.filter((x) => x.id !== id);
    DB.assegnazioni = DB.assegnazioni.filter((a) => a.volontarioId !== id);
    save(); render(); toast("Volontario eliminato");
  }

  function personDetail(id) {
    const v = volById(id);
    const ass = assegByVol(id);
    const body = el("div", {},
      el("h3", {}, el("span", { class: "avatar", style: "display:inline-grid;vertical-align:middle;margin-right:8px" }, initials(v.nome)), v.nome));

    const giorniBox = el("div", { class: "detail-days" });
    DB.festa.date.forEach((d, i) => {
      const presenti = ass.filter((a) => a.giorni[d] === "P");
      const altrove = ass.filter((a) => a.giorni[d] === "L");
      const line = el("div", { class: "detail-row" }, el("span", { class: "dlab" }, DB.festa.label[i]));
      const slot = el("span", { class: "dslot" });
      if (presenti.length) {
        presenti.forEach((a) => {
          const info = posInfo(a.postazioneId);
          slot.append(el("button", { class: "chip linkchip",
            onclick: () => { closeModal(); gotoPostazione(a.postazioneId); } },
            (info ? info.nome : "?")));
        });
      } else if (altrove.length) {
        const names = altrove.flatMap((a) => DB.assegnazioni
          .filter((x) => x !== a && x.volontarioId === a.volontarioId && x.giorni[d] === "P")
          .map((x) => posInfo(x.postazioneId)?.nome || "?"));
        slot.append(el("span", { class: "chip", style: "color:var(--l)" },
          names.length ? "altra locazione: " + names.join(", ") : "altra locazione"));
      } else {
        slot.append(el("span", { class: "chip empty" }, "—"));
      }
      line.append(slot);
      giorniBox.append(line);
    });
    body.append(el("div", { class: "field" }, el("label", {}, "Dov'è ogni giorno (clic per andare alla postazione)"), giorniBox));
    body.append(el("div", { class: "row" },
      el("button", { class: "btn", onclick: () => { closeModal(); editVolontario(id); } }, "✏️ Modifica"),
      el("button", { class: "btn primary", onclick: closeModal }, "Chiudi")));
    openModal(body);
  }

  /* ---- Postazioni ---- */
  function viewPostazioni() {
    const wrap = el("div");
    wrap.append(legend());

    // toggle bar: mostra/nascondi aree
    const toggleBar = el("div", { class: "area-toggle-bar" },
      el("span", { class: "vtool-label" }, "Mostra:"));
    DB.aree.forEach((a, i) => {
      const hidden = STATE.hiddenAreas.includes(a.id);
      toggleBar.append(el("button", {
        class: "area-chip" + (hidden ? " area-chip-off" : ""),
        style: "--ac:" + areaColor(a.id, i),
        onclick: () => {
          STATE.hiddenAreas = hidden
            ? STATE.hiddenAreas.filter((id) => id !== a.id)
            : [...STATE.hiddenAreas, a.id];
          render();
        },
      }, a.nome));
    });
    wrap.append(el("div", { class: "section glass", style: "padding:10px 16px; margin-top:0" }, toggleBar));

    const grid = el("div", { class: "area-grid" });
    DB.aree.forEach((a, i) => {
      if (STATE.hiddenAreas.includes(a.id)) return;
      const handle = el("span", { class: "draghandle", title: "Trascina per riordinare", draggable: "true" }, "⠿");
      const sec = el("div", { class: "section glass area-sec", "data-area": a.id, style: "--ac:" + areaColor(a.id, i) },
        el("div", { class: "head" }, handle, el("h2", {}, a.nome),
          el("span", { class: "pill" }, a.postazioni.length + " postazioni")));
      for (const p of a.postazioni) sec.append(postazioneBlock(p));
      attachDnD(sec, handle, a.id);
      grid.append(sec);
    });
    wrap.append(grid);
    return wrap;
  }
  function legend() {
    return el("div", { class: "section glass" },
      el("div", { class: "legend" },
        el("span", {}, el("span", { class: "dot P" }), "P · Presente"),
        el("span", {}, el("span", { class: "dot A" }), "A · Assente"),
        el("span", {}, el("span", { class: "dot L" }), "L · Altra locazione"),
        el("span", { style: "color:var(--text-dim)" }, "Clic su una cella per cambiare stato · clic sul nome per i dettagli")));
  }
  function postazioneBlock(p) {
    const block = el("div", { class: "posblock", id: "pos-" + p.id });
    const ass = assegByPos(p.id).slice()
      .sort((a, b) => volById(a.volontarioId).nome.localeCompare(volById(b.volontarioId).nome, "it"));
    block.append(el("div", { class: "ph" },
      el("h4", {}, p.nome),
      el("span", { class: "pill" }, ass.length + " volontari"),
      el("button", { class: "btn sm", onclick: () => assegnaModal(p.id) }, "➕ Assegna")));

    if (!ass.length) { block.append(el("div", { class: "empty-state" }, "Nessun volontario assegnato.")); return block; }

    const table = el("table", { class: "grid-t" });
    const thead = el("tr", {}, el("th", { class: "name" }, "Volontario"));
    DB.festa.label.forEach((l) => {
      const parts = l.split(" ");
      thead.append(el("th", {}, el("div", { class: "dh-wd" }, parts[0] || ""),
        el("div", { class: "dh-n" }, parts[1] || l)));
    });
    thead.append(el("th", {}, "Tot"));
    table.append(el("thead", {}, thead));

    // celle dei totali giornalieri (popolate dopo il tbody e nella vista mobile)
    const dayTotCells = {};
    const addDayTotCell = (day, node) => {
      if (!dayTotCells[day]) dayTotCells[day] = [];
      dayTotCells[day].push(node);
    };

    const tbody = el("tbody", {});
    const mobileCards = el("div", { class: "shift-cards" });
    for (const a of ass) {
      const v = volById(a.volontarioId);
      const tr = el("tr", {});
      const nameSpan = el("span", {
        class: "vol-name" + (a.validato ? " vol-validated" : ""),
        style: "cursor:pointer",
        onclick: () => personDetail(v.id),
      }, v.nome);
      const mobileName = el("button", {
        class: "shift-name" + (a.validato ? " vol-validated" : ""),
        onclick: () => personDetail(v.id),
      }, v.nome);
      const desktopValidBtn = el("button", {
        class: "validbtn" + (a.validato ? " validbtn-on" : ""),
        title: a.validato ? "Validato" : "Segna come validato",
      }, "✓");
      const mobileValidBtn = el("button", {
        class: "validbtn" + (a.validato ? " validbtn-on" : ""),
        title: a.validato ? "Validato" : "Segna come validato",
      }, "✓");
      const updateValidation = () => {
        const isOn = a.validato === true;
        [nameSpan, mobileName].forEach((node) => node.classList.toggle("vol-validated", isOn));
        [desktopValidBtn, mobileValidBtn].forEach((btn) => {
          btn.classList.toggle("validbtn-on", isOn);
          btn.title = isOn ? "Validato" : "Segna come validato";
        });
      };
      const toggleValidation = () => {
        if (guardReadonly()) return;
        a.validato = !a.validato;
        updateValidation();
        save();
        toast(a.validato ? v.nome + " validato" : v.nome + " da validare");
      };
      desktopValidBtn.addEventListener("click", toggleValidation);
      mobileValidBtn.addEventListener("click", toggleValidation);
      const nameTd = el("td", { class: "name" },
        el("span", { class: "name-line" }, nameSpan, desktopValidBtn),
        el("button", { class: "rmx", title: "Rimuovi da questa postazione",
          onclick: () => removeAssegnazione(a) }, "×"));
      tr.append(nameTd);
      const mobileTotCell = el("span", { class: "pill mobile-vol-total" }, "Tot " + countP(a.giorni));
      const mobileDays = el("div", { class: "shift-day-grid" });

      function updateCells(day, buttons, totCell, mobileTot) {
        if (guardReadonly()) return;
        a.giorni[day] = nextStato(a.giorni[day]);
        const btns = Array.isArray(buttons) ? buttons : [buttons];
        btns.forEach((btn) => {
          btn.className = "cellbtn " + a.giorni[day];
          btn.textContent = a.giorni[day];
          btn.title = statoTitle(a, day);
        });
        const total = countP(a.giorni);
        totCell.textContent = total;
        mobileTot.textContent = "Tot " + total;
        save();
        // avviso conflitto
        if (a.giorni[day] === "P" && pCountOnDay(a.volontarioId, day) >= 2) {
          const others = DB.assegnazioni.filter(
            (x) => x !== a && x.volontarioId === a.volontarioId && x.giorni[day] === "P"
          );
          const names = others.map((x) => posInfo(x.postazioneId)?.nome || "?").join(", ");
          toast("⚠️ " + v.nome + " è già P a: " + names);
          btns.forEach((btn) => {
            btn.classList.add("conflict");
            btn.title = STATO_LABEL["P"] + " · anche a: " + names;
          });
        }
        // aggiorna totale del giorno
        const cells = dayTotCells[day] || [];
        if (cells.length) {
          const n = ass.filter((x) => x.giorni[day] === "P").length;
          cells.forEach((tc) => {
            tc.textContent = String(n);
            tc.className = tc.className.replace(/\btot-(ok|warn|bad|neu)\b/g, "").trim() + " " + sogliaCls(p.id, n);
          });
        }
      }

      DB.festa.date.forEach((d) => {
        const isConflict = a.giorni[d] === "P" && pCountOnDay(a.volontarioId, d) >= 2;
        const btn = el("button", {
          class: "cellbtn " + a.giorni[d] + (isConflict ? " conflict" : ""),
          title: statoTitle(a, d),
        }, a.giorni[d]);
        tr.append(el("td", {}, btn));

        const mobileBtn = el("button", {
          class: "cellbtn " + a.giorni[d] + (isConflict ? " conflict" : ""),
          title: statoTitle(a, d),
        }, a.giorni[d]);
        const linkedButtons = [btn, mobileBtn];
        btn.addEventListener("click", () => updateCells(d, linkedButtons, totCell, mobileTotCell));
        mobileBtn.addEventListener("click", () => updateCells(d, linkedButtons, totCell, mobileTotCell));
        mobileDays.append(el("div", { class: "shift-day" },
          el("span", { class: "shift-day-label" }, DB.festa.label[DB.festa.date.indexOf(d)] || d),
          mobileBtn));
      });
      const totCell = el("td", { class: "tot" }, String(countP(a.giorni)));
      tr.append(totCell);
      tbody.append(tr);

      mobileCards.append(el("div", { class: "shift-card" },
        el("div", { class: "shift-card-head" },
          mobileName,
          mobileTotCell,
          mobileValidBtn,
          el("button", { class: "rmx", title: "Rimuovi da questa postazione",
            onclick: () => removeAssegnazione(a) }, "×")),
        mobileDays));
    }
    table.append(tbody);

    // riga totali per giorno
    const tfootRow = el("tr", {}, el("td", { class: "name day-tot-label" }, "Presenti"));
    const mobileTotals = el("div", { class: "mobile-day-totals" },
      el("div", { class: "mobile-day-totals-title" }, "Presenti"));
    DB.festa.date.forEach((d) => {
      const n = ass.filter((a) => a.giorni[d] === "P").length;
      const td = el("td", { class: "day-tot-cell " + sogliaCls(p.id, n) }, String(n));
      addDayTotCell(d, td);
      tfootRow.append(td);
      const mtd = el("span", { class: "mobile-day-total-cell " + sogliaCls(p.id, n) }, String(n));
      addDayTotCell(d, mtd);
      mobileTotals.append(el("div", { class: "mobile-day-total" },
        el("span", { class: "shift-day-label" }, DB.festa.label[DB.festa.date.indexOf(d)] || d),
        mtd));
    });
    tfootRow.append(el("td", {}));
    table.append(el("tfoot", {}, tfootRow));

    block.append(el("div", { class: "tablewrap pos-tablewrap" }, table), mobileCards, mobileTotals);
    return block;
  }
  function removeAssegnazione(a) {
    if (guardReadonly()) return;
    const v = volById(a.volontarioId), info = posInfo(a.postazioneId);
    if (!confirm(`Rimuovere ${v.nome} da "${info.nome}"?`)) return;
    DB.assegnazioni = DB.assegnazioni.filter((x) => x !== a);
    save(); render(); toast("Rimosso");
  }
  function assegnaModal(posId) {
    if (guardReadonly()) return;
    const info = posInfo(posId);
    const already = new Set(assegByPos(posId).map((a) => a.volontarioId));
    const avail = DB.volontari.filter((v) => !already.has(v.id))
      .sort((a, b) => a.nome.localeCompare(b.nome, "it"));
    const sel = el("select", {});
    sel.append(el("option", { value: "" }, "— scegli volontario —"));
    avail.forEach((v) => sel.append(el("option", { value: v.id }, v.nome)));
    const body = el("div", {},
      el("h3", {}, "Assegna a “" + info.nome + "”"),
      el("div", { class: "field" }, el("label", {}, "Volontario (turni = tutti Presente, poi modifichi)"), sel),
      el("div", { class: "row" },
        el("button", { class: "btn", onclick: closeModal }, "Annulla"),
        el("button", { class: "btn primary", onclick: add }, "Aggiungi")));
    openModal(body);
    function add() {
      if (!sel.value) { toast("Scegli un volontario"); return; }
      const giorni = {};
      for (const d of DB.festa.date) giorni[d] = "P";
      const volId = sel.value;
      DB.assegnazioni.push({ volontarioId: sel.value, postazioneId: posId, giorni, validato: false });
      save(); closeModal(); render(); gotoPostazione(posId);
      const conflictDays = DB.festa.date.filter((d) => pCountOnDay(volId, d) >= 2).length;
      if (conflictDays > 0) {
        toast("⚠️ " + volById(volId).nome + " ha conflitti P in " + conflictDays + " giorn" + (conflictDays === 1 ? "o" : "i"));
      } else {
        toast("Assegnato");
      }
    }
  }

  /* ---- Per giorno ---- */
  function viewGiorno() {
    const wrap = el("div");
    const picker = el("div", { class: "section glass" });
    const head = el("div", { class: "head" }, el("h2", {}, "📅 Per giorno"));
    const dp = el("div", { class: "daypicker" });
    DB.festa.label.forEach((l, i) => {
      dp.append(el("button", { class: i === STATE.day ? "active" : "",
        onclick: () => { STATE.day = i; render(); } }, l));
    });
    picker.append(head, dp);
    wrap.append(picker);

    const d = DB.festa.date[STATE.day];
    DB.aree.forEach((a, ai) => {
      const sec = el("div", { class: "section glass area-sec", style: "--ac:" + areaColor(a.id, ai) },
        el("div", { class: "head" }, el("h2", {}, a.nome)));
      const grid = el("div", { class: "grid daygrid" });
      for (const p of a.postazioni) {
        const ass = assegByPos(p.id);
        const presenti = ass.filter((x) => x.giorni[d] === "P");
        const altrove = ass.filter((x) => x.giorni[d] === "L");
        const card = el("div", { class: "daypos glass" },
          el("h4", {}, el("span", {}, p.nome),
            el("span", { class: "area-tag" }, presenti.length + " presenti")));
        if (presenti.length) {
          presenti.forEach((x) => {
            const v = volById(x.volontarioId);
            card.append(el("button", { class: "chip linkchip", onclick: () => personDetail(v.id) }, v.nome));
          });
        } else {
          card.append(el("span", { class: "chip empty" }, "nessuno"));
        }
        altrove.forEach((x) => {
          const v = volById(x.volontarioId);
          card.append(el("button", { class: "chip", style: "opacity:.55",
            onclick: () => personDetail(v.id), title: "Altra locazione" }, v.nome + " ↗"));
        });
        grid.append(card);
      }
      sec.append(grid);
      wrap.append(sec);
    });
    return wrap;
  }

  /* ============ stampa A5 postazioni (1 pagina per area) ============ */
  function buildPrint() {
    const printArea = $("#printArea");
    printArea.innerHTML = "";
    setPageSize("size:A5 landscape;margin:2mm 3mm");
    window.addEventListener("afterprint", () => setPageSize(""), { once: true });

    const range = DB.festa.label[0] + " – " + DB.festa.label[DB.festa.label.length - 1] + " luglio 2026";
    const order = ["puliz", "client", "cucin"];
    const printAree = DB.aree.slice().sort((a, b) => {
      const an = a.nome.toLowerCase();
      const bn = b.nome.toLowerCase();
      const ai = order.findIndex((x) => an.includes(x));
      const bi = order.findIndex((x) => bn.includes(x));
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });

    printAree.forEach((a, pageIdx) => {
      const ai = DB.aree.findIndex((x) => x.id === a.id);
      const page = el("div", { class: "p-page" + (pageIdx < printAree.length - 1 ? " p-break" : "") });
      page.append(el("div", { class: "p-head" },
        el("h1", {}, DB.festa.nome + " · " + a.nome),
        el("div", { class: "d" }, range + " · pagina " + (pageIdx + 1) + "/" + printAree.length)));

      const posCols = el("div", { class: "p-pos-cols" });
      const areaSec = el("section", { class: "p-area", style: "--ac:" + areaColor(a.id, ai) },
        el("h2", { class: "p-area-title" }, a.nome),
        posCols);

      for (const p of a.postazioni) {
        const ass = assegByPos(p.id).slice()
          .sort((x, y) => volById(x.volontarioId).nome.localeCompare(volById(y.volontarioId).nome, "it"));
        const sec = el("div", { class: "p-pos-sec" });
        sec.append(el("div", { class: "p-pos-title" }, p.nome));
        if (!ass.length) { sec.append(el("div", { class: "p-empty" }, "—")); posCols.append(sec); continue; }

        const t = el("table", { class: "p-grid" });
        const hr = el("tr", {}, el("th", { class: "pn" }, "Volontario"));
        DB.festa.label.forEach((l) => {
          const parts = l.split(" ");
          hr.append(el("th", {}, el("span", {}, parts[0] || ""), el("br", {}), el("span", {}, parts[1] || "")));
        });
        t.append(el("thead", {}, hr));

        const tb = el("tbody", {});
        for (const x of ass) {
          const tr = el("tr", {}, el("td", { class: "pn" }, volById(x.volontarioId).nome));
          DB.festa.date.forEach((dd) => {
            const s = x.giorni[dd];
            tr.append(el("td", { class: "cS " + "c" + s }, s));
          });
          tb.append(tr);
        }
        t.append(tb);

        // riga totali
        const tf = el("tr", { class: "p-tot-row" }, el("td", { class: "pn p-tot-lbl" }, "Presenti"));
        DB.festa.date.forEach((dd) => {
          const n = ass.filter((x) => x.giorni[dd] === "P").length;
          tf.append(el("td", { class: "ptot-day " + sogliaCls(p.id, n) }, String(n)));
        });
        t.append(el("tfoot", {}, tf));

        sec.append(t);
        posCols.append(sec);
      }
      page.append(areaSec);
      printArea.append(page);
    });
    window.print();
  }

  /* ============ stampa magliette A4 portrait 4 colonne ============ */
  let _pageStyleEl = null;
  function setPageSize(rule) {
    if (!_pageStyleEl) { _pageStyleEl = document.createElement("style"); document.head.append(_pageStyleEl); }
    _pageStyleEl.textContent = rule ? "@page{" + rule + "}" : "";
  }

  function printMagliette() {
    const area = $("#printArea");
    area.innerHTML = "";
    setPageSize("size:A4 portrait;margin:14mm 12mm");
    window.addEventListener("afterprint", () => setPageSize(""), { once: true });

    const vols = DB.volontari.slice().sort((a, b) => a.nome.localeCompare(b.nome, "it"));
    const nMiss = vols.filter((v) => !v.taglia).length;

    const page = el("div", { class: "pm-page" });
    page.append(el("div", { class: "pm-head" },
      el("h1", {}, DB.festa.nome + " · Lista magliette"),
      el("div", { class: "pm-sub" },
        vols.length + " volontari" +
        (nMiss ? " · " + nMiss + " taglia non impostata" : ""))));

    const list = el("div", { class: "pm-list" });
    vols.forEach((v, i) => {
      list.append(el("div", { class: "pm-row" },
        el("span", { class: "pm-num" }, String(i + 1)),
        el("span", { class: "pm-nome" }, v.nome),
        el("span", { class: "pm-taglia" + (v.taglia ? "" : " pm-taglia-miss") }, v.taglia || "—")));
    });
    page.append(list);
    area.append(page);
    window.print();
  }

  /* ============ import / export ============ */
  function exportJSON() {
    const blob = new Blob([JSON.stringify(DB, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: "festa-rocca-2026.json" });
    document.body.append(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast("Esportato");
  }
  function exportMagliette() {
    const rows = ["Nome,Taglia"];
    DB.volontari.slice()
      .sort((a, b) => a.nome.localeCompare(b.nome, "it"))
      .forEach((v) => rows.push(`"${v.nome}","${v.taglia || ""}"`));
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: "magliette-festa-rocca-2026.csv" });
    document.body.append(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast("CSV magliette esportato (" + DB.volontari.length + " righe)");
  }

  function importJSON(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        if (!data.festa || !data.volontari || !data.aree) throw new Error("formato");
        DB = normalize(data); save(); render(); toast("Dati importati");
      } catch (e) { toast("File non valido"); }
    };
    r.readAsText(file);
  }

  /* ============ istantanee (snapshot) ============ */
  function loadSnaps() { try { return JSON.parse(lsGet(SNAPS_KEY) || "[]"); } catch (e) { return []; } }
  function saveSnaps(list) { try { localStorage.setItem(SNAPS_KEY, JSON.stringify(list)); } catch (e) { toast("Errore salvataggio istantanea"); } }

  function snapshotModal() {
    const snaps = loadSnaps();
    function nowLabel() {
      const n = new Date();
      return n.toLocaleDateString("it") + " " + n.toLocaleTimeString("it", { hour: "2-digit", minute: "2-digit" });
    }
    const nameInput = el("input", { class: "snap-name-input", placeholder: "Nome istantanea…", value: nowLabel() });

    function doSave() {
      if (guardReadonly()) return;
      const name = nameInput.value.trim() || nowLabel();
      const list = loadSnaps();
      list.unshift({ id: Date.now(), name, date: new Date().toISOString(), db: JSON.parse(JSON.stringify(DB)) });
      if (list.length > 20) list.splice(20);
      saveSnaps(list);
      toast("Istantanea salvata");
      closeModal(); snapshotModal();
    }

    const snapList = el("div", { class: "snap-list" });
    if (!snaps.length) snapList.append(el("div", { class: "empty-state" }, "Nessuna istantanea salvata."));
    for (const s of snaps) {
      const d = new Date(s.date);
      const dateStr = d.toLocaleDateString("it") + " " + d.toLocaleTimeString("it", { hour: "2-digit", minute: "2-digit" });
      snapList.append(el("div", { class: "snap-row" },
        el("div", { class: "snap-info" },
          el("div", { class: "snap-name-lbl" }, s.name),
          el("div", { class: "snap-date" }, dateStr + " · " + s.db.volontari.length + " volontari")),
        el("div", { class: "snap-acts" },
          el("button", { class: "btn sm", onclick: () => { closeModal(); viewSnapshot(s); } }, "Visualizza"),
          el("button", { class: "btn sm primary", onclick: () => restoreSnapshot(s) }, "Ripristina"),
          el("button", { class: "btn sm danger", onclick: () => deleteSnapshot(s.id) }, "🗑️"))));
    }

    openModal(el("div", { class: "snap-modal" },
      el("h3", {}, "Istantanee"),
      el("div", { class: "snap-save-row" },
        el("label", {}, "Salva situazione attuale"),
        el("div", { class: "row" }, nameInput,
          el("button", { class: "btn primary", onclick: doSave }, "Salva"))),
      snaps.length ? el("div", { class: "snap-section-label" }, snaps.length + " istantanee salvate") : null,
      snapList,
      el("div", { class: "row" }, el("button", { class: "btn", onclick: closeModal }, "Chiudi"))));
  }

  function viewSnapshot(snap) {
    LIVE_DB = DB;
    DB = normalize(JSON.parse(JSON.stringify(snap.db)));
    STATE.readonly = true;
    STATE.snapName = snap.name;
    STATE.snapDate = snap.date;
    render();
  }

  function exitSnapshot() {
    DB = LIVE_DB;
    LIVE_DB = null;
    STATE.readonly = false;
    STATE.snapName = null;
    STATE.snapDate = null;
    render();
  }

  function restoreSnapshot(snap) {
    if (!confirm(`Sostituire i dati attuali con l'istantanea "${snap.name}"?\nI dati correnti verranno sovrascritti.`)) return;
    if (STATE.readonly) { LIVE_DB = null; STATE.readonly = false; STATE.snapName = null; STATE.snapDate = null; }
    DB = normalize(JSON.parse(JSON.stringify(snap.db)));
    save();
    closeModal();
    render();
    toast("Dati ripristinati dall'istantanea");
  }

  function deleteSnapshot(id) {
    if (!confirm("Eliminare questa istantanea?")) return;
    saveSnaps(loadSnaps().filter((s) => s.id !== id));
    closeModal(); snapshotModal();
  }

  function readonlyBanner() {
    const d = new Date(STATE.snapDate);
    const dateStr = d.toLocaleDateString("it", { day: "numeric", month: "long" }) + " " +
      d.toLocaleTimeString("it", { hour: "2-digit", minute: "2-digit" });
    return el("div", { class: "readonly-banner" },
      el("span", { class: "ro-label" }, "SOLA LETTURA"),
      el("span", { class: "ro-name" }, STATE.snapName),
      el("span", { class: "ro-date" }, dateStr),
      el("div", { class: "spacer" }),
      el("button", { class: "btn sm primary", onclick: () => { closeModal(); snapshotModal(); } }, "Gestisci"),
      el("button", { class: "btn sm", onclick: exitSnapshot }, "Esci dall'anteprima"));
  }

  /* ============ render principale ============ */
  function render() {
    $("#festaName").textContent = DB.festa.nome;
    $("#festaSub").textContent = "2–12 luglio 2026 · lun 6 escluso";
    document.body.classList.toggle("is-readonly", STATE.readonly);
    document.querySelectorAll(".tab").forEach((t) =>
      t.classList.toggle("active", t.dataset.view === STATE.view));
    const v = $("#view");
    v.innerHTML = "";
    if (STATE.readonly) v.append(readonlyBanner());
    if (STATE.view === "dashboard") v.append(viewDashboard());
    else if (STATE.view === "volontari") v.append(viewVolontari());
    else if (STATE.view === "postazioni") v.append(viewPostazioni());
    else if (STATE.view === "giorno") v.append(viewGiorno());
  }

  /* ============ wiring header / login ============ */
  function wireChrome() {
    document.querySelectorAll(".tab").forEach((t) =>
      t.addEventListener("click", () => setView(t.dataset.view)));
    $("#btnSnapshot").addEventListener("click", snapshotModal);
    $("#btnExport").addEventListener("click", exportJSON);
    $("#btnPrint").addEventListener("click", buildPrint);
    $("#btnImport").addEventListener("click", () => { if (guardReadonly()) return; $("#fileInput").click(); });
    $("#fileInput").addEventListener("change", (e) => {
      if (e.target.files[0]) importJSON(e.target.files[0]);
      e.target.value = "";
    });
    const cloud = el("button", {
      class: "cloud-status cloud-idle",
      id: "cloudStatus",
      title: "Salvataggio cloud Supabase",
      onclick: () => {
        if (!CLOUD_ENABLED) return toast("Cloud non configurato");
        saveCloudDB().catch((e) => {
          cloudLastError = e.message || String(e);
          console.error(e);
          setCloudStatus("Cloud: errore", "cloud-error");
          toast("Errore cloud: " + cloudLastError.slice(0, 80));
        });
      },
    }, CLOUD_ENABLED ? "Cloud: pronto" : "Cloud: off");
    $(".topbar").append(cloud);
    // bottone logout
    const lock = el("button", { class: "btn", title: "Blocca",
      onclick: () => { sessionStorage.removeItem(SESS_KEY); location.reload(); } }, "🔄");
    $(".topbar").append(lock);
  }

  function startApp(initialDB) {
    const saved = lsGet(LS_KEY);
    DB = initialDB ? normalize(initialDB) : saved ? normalize(JSON.parse(saved)) : normalize(window.__SEED_DECRYPTED);
    if (!saved) save();
    delete window.__SEED_DECRYPTED;
    document.querySelector(".app").style.display = "";
    wireChrome();
    render();
    if (CLOUD_ENABLED && !STATE.readonly) scheduleCloudSave();
  }
  async function loadInitialData() {
    if (CLOUD_ENABLED) {
      setCloudStatus("Cloud: carico…", "cloud-pending");
      try {
        const cloudDB = await loadCloudDB();
        if (cloudDB) {
          try { localStorage.setItem(LS_KEY, JSON.stringify(cloudDB)); } catch (e) { /* storage non disponibile */ }
          setCloudStatus("Cloud: caricato", "cloud-ok");
          return cloudDB;
        }
        setCloudStatus("Cloud: vuoto", "cloud-pending");
      } catch (e) {
        cloudLastError = e.message || String(e);
        console.error(e);
        setCloudStatus("Cloud: errore", "cloud-error");
        toast("Cloud non disponibile, uso i dati locali");
      }
    }
    const saved = lsGet(LS_KEY);
    if (saved) return normalize(JSON.parse(saved));
    throw new Error("Nessun dato disponibile. Importa un export JSON o salva da un browser che contiene gia' i dati locali.");
  }

  /* ============ boot ============ */
  async function boot() {
    // anteprima/demo: dati iniettati direttamente, niente login
    if (window.GV_BOOTSTRAP) {
      DB = normalize(window.GV_BOOTSTRAP);
      save();
      document.querySelector(".app").style.display = "";
      wireChrome();
      render();
      return;
    }
    try {
      const db = await loadInitialData();
      sessionStorage.setItem(SESS_KEY, "1");
      startApp(db);
    } catch (e) {
      document.body.innerHTML = "<div style='padding:28px;font-family:Segoe UI,system-ui,sans-serif;max-width:680px'><h2>Dati non disponibili</h2><p>" +
        (e.message || "Impossibile caricare i dati.") +
        "</p><p>Apri l'app dal browser dove avevi gia' modificato i dati, oppure usa Importa dopo aver caricato un export JSON.</p></div>";
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

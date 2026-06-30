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

  async function decryptSeed(password) {
    const E = window.SEED_ENC;
    const baseKey = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]
    );
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: b64dec(E.salt), iterations: 200000, hash: "SHA-256" },
      baseKey, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
    );
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64dec(E.iv) }, key, b64dec(E.ct)
    );
    return JSON.parse(new TextDecoder().decode(pt));
  }

  /* ============ stato ============ */
  const LS_KEY = "gv-festa-rocca-2026";
  const SESS_KEY = "gv-unlocked";
  let DB = null;
  const STATE = { view: "dashboard", search: "", day: 0 };
  const STATI = ["P", "A", "L"];
  const STATO_LABEL = { P: "Presente", A: "Assente", L: "Altra locazione" };

  function save() { localStorage.setItem(LS_KEY, JSON.stringify(DB)); }

  function normalize(db) {
    for (const a of db.assegnazioni) {
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
  function initials(nome) {
    const w = nome.trim().split(/\s+/);
    return ((w[0]?.[0] || "") + (w[1]?.[0] || "")).toUpperCase();
  }
  function slug(s) {
    return "v-" + s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  }

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

  /* ============ viste ============ */
  function viewDashboard() {
    const wrap = el("div");
    const tot = DB.volontari.length;
    const nPos = allPostazioni().length;
    const presenze = DB.assegnazioni.reduce((s, a) => s + countP(a.giorni), 0);

    const cards = el("div", { class: "grid cards" },
      statCard("Volontari", tot, "persone registrate"),
      statCard("Postazioni", nPos, DB.aree.length + " aree"),
      statCard("Assegnazioni", DB.assegnazioni.length, "volontario→postazione"),
      statCard("Presenze totali", presenze, "turni 'P' nei 10 giorni"),
    );
    wrap.append(cards);

    // copertura per giorno
    const cov = el("div", { class: "section glass" },
      el("div", { class: "head" }, el("h2", {}, "📅 Copertura per giorno"),
        el("span", { class: "pill" }, "volontari presenti")));
    const maxPres = Math.max(1, ...DB.festa.date.map(dayPresenti));
    const bars = el("div", { class: "bars" });
    DB.festa.date.forEach((d, i) => {
      const n = dayPresenti(d);
      const row = el("div", { class: "barrow", title: n + " presenti" },
        el("span", { class: "barlab" }, DB.festa.label[i]),
        el("div", { class: "bartrack" },
          el("div", { class: "barfill", style: `width:${(n / maxPres) * 100}%` })),
        el("span", { class: "barval" }, n));
      bars.append(row);
    });
    cov.append(bars);
    wrap.append(cov);

    // per area
    const perArea = el("div", { class: "section glass" },
      el("div", { class: "head" }, el("h2", {}, "🗂️ Per area")));
    const ag = el("div", { class: "grid cards" });
    for (const a of DB.aree) {
      const nVol = new Set(DB.assegnazioni
        .filter((x) => a.postazioni.some((p) => p.id === x.postazioneId))
        .map((x) => x.volontarioId)).size;
      ag.append(el("div", { class: "card glass", style: "cursor:pointer",
        onclick: () => setView("postazioni") },
        el("h3", {}, a.nome),
        el("div", { class: "stat" }, nVol, el("small", {}, " volontari")),
        el("div", { class: "tags", style: "color:var(--text-dim);font-size:.8rem" },
          a.postazioni.map((p) => p.nome).join(" · "))));
    }
    perArea.append(ag);
    wrap.append(perArea);
    return wrap;
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
  function viewVolontari() {
    const wrap = el("div", { class: "section glass" });
    const head = el("div", { class: "head" },
      el("h2", {}, "👥 Volontari"),
      el("span", { class: "pill" }, DB.volontari.length + " totali"),
      el("input", {
        class: "search", placeholder: "🔎 Cerca volontario…", value: STATE.search,
        oninput: (e) => { STATE.search = e.target.value; refreshVList(); },
      }),
      el("button", { class: "btn primary", onclick: () => editVolontario(null) }, "➕ Aggiungi"));
    wrap.append(head);
    wrap.append(el("div", { class: "vlist", id: "vlist" }));
    refreshVListInto(wrap);
    return wrap;
  }
  function refreshVList() { refreshVListInto(document); }
  function refreshVListInto(root) {
    const list = root.querySelector ? root.querySelector("#vlist") : $("#vlist");
    if (!list) return;
    list.innerHTML = "";
    const q = STATE.search.trim().toLowerCase();
    const vols = DB.volontari
      .filter((v) => v.nome.toLowerCase().includes(q))
      .sort((a, b) => a.nome.localeCompare(b.nome, "it"));
    if (!vols.length) { list.append(el("div", { class: "empty-state" }, "Nessun volontario trovato.")); return; }
    for (const v of vols) {
      const ass = assegByVol(v.id);
      const presenze = ass.reduce((s, a) => s + countP(a.giorni), 0);
      const row = el("div", { class: "vrow" },
        el("div", { class: "avatar" }, initials(v.nome)),
        el("div", { class: "meta", style: "cursor:pointer", onclick: () => personDetail(v.id) },
          el("div", { class: "nm" }, v.nome),
          el("div", { class: "tags" }, `${ass.length} postazioni · ${presenze} presenze`)),
        el("div", { class: "acts" },
          el("button", { class: "btn sm", title: "Modifica", onclick: () => editVolontario(v.id) }, "✏️"),
          el("button", { class: "btn sm danger", title: "Elimina", onclick: () => removeVolontario(v.id) }, "🗑️")));
      list.append(row);
    }
  }

  function editVolontario(id) {
    const v = id ? volById(id) : null;
    const assigned = new Set((id ? assegByVol(id) : []).map((a) => a.postazioneId));
    const nameInput = el("input", { value: v ? v.nome : "", placeholder: "Nome e cognome" });
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
      const wanted = new Set([...checks.querySelectorAll("input:checked")].map((c) => c.dataset.pos));
      // rimuovi deselezionate
      DB.assegnazioni = DB.assegnazioni.filter(
        (a) => !(a.volontarioId === vol.id && !wanted.has(a.postazioneId)));
      // aggiungi nuove
      for (const posId of wanted) {
        if (!DB.assegnazioni.some((a) => a.volontarioId === vol.id && a.postazioneId === posId)) {
          const giorni = {};
          for (const d of DB.festa.date) giorni[d] = "P";
          DB.assegnazioni.push({ volontarioId: vol.id, postazioneId: posId, giorni });
        }
      }
      save(); closeModal(); render(); toast(id ? "Volontario aggiornato" : "Volontario aggiunto");
    }
  }

  function removeVolontario(id) {
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
            "📍 " + (info ? info.nome : "?")));
        });
      } else if (altrove.length) {
        slot.append(el("span", { class: "chip", style: "color:var(--l)" }, "altra locazione"));
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
    for (const a of DB.aree) {
      const sec = el("div", { class: "section glass" },
        el("div", { class: "head" }, el("h2", {}, "🗂️ " + a.nome),
          el("span", { class: "pill" }, a.postazioni.length + " postazioni")));
      for (const p of a.postazioni) sec.append(postazioneBlock(p));
      wrap.append(sec);
    }
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
    DB.festa.label.forEach((l) => thead.append(el("th", {}, l)));
    thead.append(el("th", {}, "Tot"));
    table.append(el("thead", {}, thead));

    const tbody = el("tbody", {});
    for (const a of ass) {
      const v = volById(a.volontarioId);
      const tr = el("tr", {});
      const nameTd = el("td", { class: "name" },
        el("span", { style: "cursor:pointer", onclick: () => personDetail(v.id) }, v.nome),
        el("button", { class: "rmx", title: "Rimuovi da questa postazione",
          onclick: () => removeAssegnazione(a) }, "×"));
      tr.append(nameTd);
      DB.festa.date.forEach((d) => {
        const btn = el("button", { class: "cellbtn " + a.giorni[d], title: STATO_LABEL[a.giorni[d]] }, a.giorni[d]);
        btn.addEventListener("click", () => {
          a.giorni[d] = nextStato(a.giorni[d]);
          btn.className = "cellbtn " + a.giorni[d];
          btn.textContent = a.giorni[d];
          btn.title = STATO_LABEL[a.giorni[d]];
          totCell.textContent = countP(a.giorni);
          save();
        });
        tr.append(el("td", {}, btn));
      });
      const totCell = el("td", { class: "tot" }, String(countP(a.giorni)));
      tr.append(totCell);
      tbody.append(tr);
    }
    table.append(tbody);
    block.append(el("div", { class: "tablewrap" }, table));
    return block;
  }
  function removeAssegnazione(a) {
    const v = volById(a.volontarioId), info = posInfo(a.postazioneId);
    if (!confirm(`Rimuovere ${v.nome} da "${info.nome}"?`)) return;
    DB.assegnazioni = DB.assegnazioni.filter((x) => x !== a);
    save(); render(); toast("Rimosso");
  }
  function assegnaModal(posId) {
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
      DB.assegnazioni.push({ volontarioId: sel.value, postazioneId: posId, giorni });
      save(); closeModal(); render(); gotoPostazione(posId); toast("Assegnato");
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
    for (const a of DB.aree) {
      const sec = el("div", { class: "section glass" },
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
    }
    return wrap;
  }

  /* ============ stampa A5 (una sezione per foglio) ============ */
  function buildPrint() {
    const area = $("#printArea");
    area.innerHTML = "";
    const range = `${DB.festa.label[0]} – ${DB.festa.label[DB.festa.label.length - 1]} luglio 2026`;
    for (const a of DB.aree) {
      const page = el("div", { class: "p-day" });
      page.append(el("div", { class: "p-head" },
        el("h1", {}, DB.festa.nome + " · " + a.nome),
        el("div", { class: "d" }, range + "  (lun 6 escluso)")));
      for (const p of a.postazioni) {
        const ass = assegByPos(p.id).slice()
          .sort((x, y) => volById(x.volontarioId).nome.localeCompare(volById(y.volontarioId).nome, "it"));
        page.append(el("div", { class: "p-pos-title" }, p.nome));
        if (!ass.length) { page.append(el("div", { class: "p-empty" }, "—")); continue; }
        const t = el("table", { class: "p-grid" });
        const hr = el("tr", {}, el("th", { class: "pn" }, "Volontario"));
        DB.festa.label.forEach((l) => hr.append(el("th", {}, l.replace(/\D+/g, ""))));
        t.append(el("thead", {}, hr));
        const tb = el("tbody", {});
        for (const x of ass) {
          const tr = el("tr", {}, el("td", { class: "pn" }, volById(x.volontarioId).nome));
          DB.festa.date.forEach((dd) => {
            const s = x.giorni[dd];
            tr.append(el("td", { class: "c" + s }, s === "A" ? "" : s));
          });
          tb.append(tr);
        }
        t.append(tb);
        page.append(t);
      }
      area.append(page);
    }
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

  /* ============ render principale ============ */
  function render() {
    $("#festaName").textContent = DB.festa.nome;
    $("#festaSub").textContent = "2–12 luglio 2026 · lun 6 escluso";
    document.querySelectorAll(".tab").forEach((t) =>
      t.classList.toggle("active", t.dataset.view === STATE.view));
    const v = $("#view");
    v.innerHTML = "";
    if (STATE.view === "dashboard") v.append(viewDashboard());
    else if (STATE.view === "volontari") v.append(viewVolontari());
    else if (STATE.view === "postazioni") v.append(viewPostazioni());
    else if (STATE.view === "giorno") v.append(viewGiorno());
  }

  /* ============ wiring header / login ============ */
  function wireChrome() {
    document.querySelectorAll(".tab").forEach((t) =>
      t.addEventListener("click", () => setView(t.dataset.view)));
    $("#btnExport").addEventListener("click", exportJSON);
    $("#btnPrint").addEventListener("click", buildPrint);
    $("#btnImport").addEventListener("click", () => $("#fileInput").click());
    $("#fileInput").addEventListener("change", (e) => {
      if (e.target.files[0]) importJSON(e.target.files[0]);
      e.target.value = "";
    });
    // bottone logout
    const lock = el("button", { class: "btn", title: "Blocca",
      onclick: () => { sessionStorage.removeItem(SESS_KEY); location.reload(); } }, "🔒");
    $(".topbar").append(lock);
  }

  function startApp() {
    const saved = localStorage.getItem(LS_KEY);
    DB = saved ? normalize(JSON.parse(saved)) : normalize(window.__SEED_DECRYPTED);
    if (!saved) save();
    delete window.__SEED_DECRYPTED;
    document.querySelector(".app").style.display = "";
    wireChrome();
    render();
  }

  function showLogin(errMsg) {
    const app = document.querySelector(".app");
    app.style.display = "none";
    let root = document.getElementById("loginRoot");
    if (!root) { root = el("div", { id: "loginRoot" }); document.body.append(root); }
    const pw = el("input", { type: "password", placeholder: "Password", autofocus: true });
    const box = el("div", { class: "login glass" },
      el("div", { class: "login-emoji" }, "🎪🔒"),
      el("h2", {}, "Festa in Rocca 2026"),
      el("p", { class: "sub" }, "Inserisci la password per accedere ai dati."),
      el("div", { class: "field" }, pw),
      errMsg ? el("div", { class: "login-err" }, errMsg) : null,
      el("button", { class: "btn primary", id: "loginBtn" }, "Entra"));
    root.innerHTML = "";
    root.append(box);
    pw.focus();
    const submit = async () => {
      const btn = document.getElementById("loginBtn");
      btn.disabled = true; btn.textContent = "Sblocco…";
      try {
        const seed = await decryptSeed(pw.value);
        window.__SEED_DECRYPTED = seed;
        sessionStorage.setItem(SESS_KEY, "1");
        root.remove();
        startApp();
      } catch (e) {
        btn.disabled = false; btn.textContent = "Entra";
        showLogin("Password errata. Riprova.");
      }
    };
    pw.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    box.querySelector("#loginBtn").addEventListener("click", submit);
  }

  /* ============ boot ============ */
  function boot() {
    if (!window.SEED_ENC) { document.body.innerHTML = "<p style='padding:40px'>Dati cifrati non trovati (seed.enc.js).</p>"; return; }
    if (sessionStorage.getItem(SESS_KEY) && localStorage.getItem(LS_KEY)) {
      // già sbloccato in questa sessione e dati locali presenti
      startApp();
    } else {
      showLogin();
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

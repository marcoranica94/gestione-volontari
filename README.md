# 🎪 Gestione Volontari · Festa in Rocca 2026

Piccola web-app (HTML/CSS/JS puro, **nessun build**) per gestire i volontari della
Festa in Rocca, **2–12 luglio 2026** (lunedì 6 escluso).

Funziona aprendo `index.html` nel browser oppure online su GitHub Pages.

## Cosa fa

- **Panoramica**: numeri chiave + copertura per giorno + riepilogo per area.
- **Volontari**: cerca, aggiungi, modifica, elimina. Clic su un nome → dettaglio
  con *dov'è ogni giorno* (clic sulla postazione per saltarci).
- **Postazioni**: per ogni area (Pulizia · Cucina · Clienti) la griglia
  volontari × 10 giorni. Clic su una cella per ciclare **P → A → L**:
  - 🟢 **P** = Presente · 🔴 **A** = Assente · 🟡 **L** = Altra locazione
- **Per giorno**: scegli il giorno e vedi chi è presente in ogni postazione.
- **Stampa A5**: 3 fogli (una sezione per foglio), orizzontale, da appendere.
- **Importa / Esporta** i dati in JSON.

## 🔒 Password e privacy (importante)

GitHub Pages serve **solo file statici**: non esistono "variabili segrete" lato
server. Per questo i dati **non** sono in chiaro nel repo: sono **cifrati con
AES-256** (`seed.enc.js`) e si sbloccano con la password all'apertura. Senza
password il file dei dati è illeggibile, anche scaricandolo direttamente.

> I file in chiaro (`data.plain.json`, `seed.js`, `Turni.xlsx`) sono in
> `.gitignore` e **non vengono pubblicati**. Restano solo sul tuo PC.

⚠️ Nota onesta: chi conosce la password può vedere i dati. È una protezione
reale contro accessi casuali, non un sistema multi-utente con account.

## Come salvare le modifiche

Le modifiche fatte nell'app si salvano nel **browser locale** (localStorage):
sono tue, su quel dispositivo, e **non si sincronizzano** automaticamente tra
persone. Per condividere una versione aggiornata:

1. nell'app premi **💾 Esporta** → ottieni `festa-rocca-2026.json`;
2. (opzionale, per aggiornare la baseline pubblica) rigenera i dati cifrati:
   ```bash
   cp festa-rocca-2026.json data.plain.json
   node build-seed.mjs 'LA_TUA_PASSWORD'   # rigenera seed.enc.js
   git commit -am "aggiorna dati" && git push
   ```

## Rigenerare i dati cifrati

```bash
node build-seed.mjs 'LA_TUA_PASSWORD'   # legge data.plain.json -> scrive seed.enc.js
```

## Deploy su GitHub Pages

Il workflow `.github/workflows/deploy.yml` pubblica la root del repo a ogni push
su `main`. Su GitHub: **Settings → Pages → Source: GitHub Actions**.

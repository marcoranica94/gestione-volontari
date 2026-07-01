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
- **Stampa A5**: 3 pagine A5 orizzontali, una per area, con colori di area e stato.
- **Importa / Esporta** i dati in JSON.

## Privacy

GitHub Pages serve **solo file statici**: non esistono "variabili segrete" lato
server. Il sito non richiede piu' password all'apertura.

> I file in chiaro (`data.plain.json`, `seed.js`, `Turni.xlsx`) sono in
> `.gitignore` e **non vengono pubblicati**. Restano solo sul tuo PC.

⚠️ Nota onesta: i dati salvati su Supabase sono leggibili da chi ha accesso al
progetto Supabase. GitHub Pages resta statico, ma Supabase diventa il database
centrale.

## Come salvare le modifiche

Le modifiche fatte nell'app si salvano nel **browser locale** (localStorage) e,
se Supabase è configurato, anche nel **cloud**. Il sito resta statico su GitHub
Pages, ma i dati aggiornati non dipendono più dal push del repo.

Export/import restano disponibili come backup:

1. nell'app premi **💾 Esporta** → ottieni `festa-rocca-2026.json`;
2. (opzionale, per aggiornare la baseline pubblica) rigenera i dati cifrati:
   ```bash
   cp festa-rocca-2026.json data.plain.json
   node build-seed.mjs 'LA_TUA_PASSWORD'   # rigenera seed.enc.js
   git commit -am "aggiorna dati" && git push
   ```

## Supabase

La chiave publishable/anon può stare nel frontend. Non inserire mai una
`service_role_key` nel sito.

Nel progetto Supabase crea la tabella e le policy:

```sql
create table if not exists public.app_state (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

create policy "read app state"
on public.app_state
for select
using (id = 'main');

create policy "insert app state"
on public.app_state
for insert
with check (id = 'main');

create policy "update app state"
on public.app_state
for update
using (id = 'main')
with check (id = 'main');
```

I dati salvati in `payload` sono JSON leggibile. Chi ha accesso al progetto
Supabase può vedere i volontari e le assegnazioni.

## Rigenerare i dati cifrati

```bash
node build-seed.mjs 'LA_TUA_PASSWORD'   # legge data.plain.json -> scrive seed.enc.js
```

## Deploy su GitHub Pages

Il workflow `.github/workflows/deploy.yml` pubblica la root del repo a ogni push
su `main`. Su GitHub: **Settings → Pages → Source: GitHub Actions**.

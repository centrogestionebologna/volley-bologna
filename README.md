# Volley Bologna Community

Webapp per la community di pallavolisti di Bologna: match, iscrizioni con lista riserve,
gruppi con chat, chat generale stile WhatsApp, reputazione degli organizzatori e pannello admin.

Stack: **React + Vite** · **Firebase Auth (Google)** · **Cloud Firestore** · **Cloudflare Workers**
(asset statici) · **Cloudflare Workers + Cron Triggers**.

Nessun servizio a pagamento obbligatorio, nessun pagamento in-app: tutto rientra nei piani gratuiti.

> **Nessuna modalità demo.** L'app usa solo Firebase: senza configurazione mostra una schermata
> di setup e non permette di entrare. Non esiste alcun fallback su `localStorage`.

---

## 1. Configurazione (obbligatoria, una volta sola)

1. Crea un progetto su [console.firebase.google.com](https://console.firebase.google.com) (piano Spark, gratuito).
2. **Authentication → Sign-in method → Google**: abilita e imposta l'email di supporto.
3. **Authentication → Settings → Authorized domains**: aggiungi `localhost` e il dominio
   `<progetto>.pages.dev` (o il dominio custom del deploy).
4. **Firestore Database**: crea il database in modalità *production*, location `eur3` (Europa).
5. **Impostazioni progetto → Le tue app → Web**: registra l'app e copia la config.
6. Copia `.env.example` in `.env.local` e compila:

```bash
cp .env.example .env.local
```

```dotenv
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=tizio.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=tizio
VITE_FIREBASE_STORAGE_BUCKET=tizio.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

Le variabili `VITE_*` sono pubbliche per definizione: la sicurezza sta nelle regole Firestore,
non nella segretezza della config.

7. Pubblica regole e indici:

```bash
npm install -g firebase-tools   # oppure npx firebase-tools
firebase login
firebase use --add              # seleziona il tuo progetto
firebase deploy --only firestore:rules,firestore:indexes
```

`firestore.rules` applica: campi privati (nome, cognome, email, telefono) leggibili solo dal
proprietario e dall'admin, nickname pubblici, scritture validate per match/iscrizioni/chat,
ban e mute gestiti solo dall'admin, segnalazioni non cancellabili dagli utenti.

### Primo admin

Il primo amministratore va creato a mano, perché le regole consentono di scrivere in `admins/`
solo a chi è già admin:

1. accedi una volta con Google: l'app crea automaticamente `users/{uid}` e `publicProfiles/{uid}`;
2. apri **Profilo** e premi **Copia ID** (è il tuo UID);
3. apri Firebase Console → Firestore → collezione `admins` → **Aggiungi documento** con **ID = UID**;
   nel progetto attuale: [console Firestore → admins](https://console.firebase.google.com/project/volley-bologna/firestore/data/~2Fadmins);
4. campi consigliati: `uid` (string), `name` (string), `createdAt` (timestamp); basta comunque che il documento esista;
5. ricarica l'app: compare la voce **Amministrazione** nella sidebar.

Da quel momento i ruoli si gestiscono dalla dashboard (**Utenti → Admin**; su mobile si apre da **Profilo → Admin**).

---

## 2. Avvio in locale

```bash
npm install
cp .env.example .env.local   # compila le VITE_FIREBASE_*
npm run dev
```

Senza `.env.local` la pagina mostra la schermata **“Collega Volley Bologna Community a Firebase”**
con l'elenco delle variabili mancanti: è il comportamento previsto, non un errore.

Build e anteprima della build:

```bash
npm run build
npm run preview
```

---

## 3. Struttura del progetto

```
public/
  community-logo.png     logo della community (favicon e interfaccia)
src/
  config.js              env Firebase, controllo config, limiti prodotto (retention 30gg, offerte 30min)
  backend.js             unico backend: Cloud Firestore (null se manca la config)
  main.jsx               bootstrap: SetupScreen se manca la config, altrimenti Router + AuthProvider
  App.jsx                route e guardie di autenticazione
  auth/AuthProvider.jsx  sessione Google + bootstrap profilo
  store/
    base.js              interfaccia comune dello store, filtri, ordinamenti
    firestoreAdapter.js  adapter Firestore (onSnapshot, transazioni, serverTimestamp)
  services/
    profiles.js          profilo, nickname, verifica identità, ruoli
    matches.js           match, iscrizioni, lista riserve, offerte 30 min
    groups.js            gruppi pubblici/privati, richieste, ban
    chat.js              messaggi, reply, edit, delete, segnalazioni, moderazione
    reputation.js        liste affidabili per organizzatore, valutazioni
    moderation.js        parole vietate, segnalazioni, ban, mute
    maintenance.js       pulizia chat e pubblicazione match ricorrenti
  components/            shell, chat, card match, UI kit, countdown, emoji picker,
                         Logo, SetupScreen
  pages/                 Login, Home, Match, Gruppi, Chat, Profilo, Admin, Organizer
  lib/                   formattazione date, hook, hashing inviti
worker/
  src/index.js           cron: offerte riserve scadute, pulizia 30gg, match ricorrenti
  src/firestore.js       client Firestore REST con service account (JWT RS256)
firestore.rules          regole di sicurezza
firestore.indexes.json   indici compositi
firebase.json            config CLI Firebase
wrangler.jsonc           hosting della SPA su Cloudflare Workers
```

---

## 4. Come funzionano le parti delicate

### Iscrizioni e riserve (niente doppie prenotazioni)

Ogni iscrizione è un documento in `matches/{id}/registrations/{uid}` con `seq` = timestamp server.
La conferma avviene in una **transazione**: si rileggono i contatori del match e, se i posti sono
esauriti, l'iscrizione nasce già come `waitlist` con il `seq` successivo. Ordinamento cronologico
garantito dal timestamp del server, non dall'orologio del client.

### Offerta del posto alla riserva (30 minuti)

Quando un iscritto si ritira, il primo in lista riserva riceve `status: "offered"` con
`pendingOffer` sul match e `offerExpiresAt = now + 30 min`. La UI mostra un countdown con
*Conferma* / *Rinuncia*. Se scade, il Worker cron (`*/10 * * * *`) passa l'offerta alla riserva
successiva; anche il client, al primo render, liquida le offerte già scadute.

### Chat

- solo testo ed emoji, risposte annidate a un livello (`replyTo` con snapshot del testo);
- modifica riservata all'autore, con etichetta **Modificato** e testo originale conservato per l'admin;
- eliminazione soft: il messaggio resta come *"Questo messaggio è stato eliminato"* (l'autore vede
  il proprio testo in grigio, gli altri solo l'avviso);
- filtro parole vietate applicato lato client prima dell'invio (la lista è gestita dall'admin);
  ban, silenziamento e cancellazione restano garantiti dalle regole Firestore, non dal client;
- segnalazione messaggio → coda admin;
- retention 30 giorni applicata dal Worker.

### Reputazione

L'organizzatore mantiene `organizers/{uid}/trusted/{userId}`. Gli utenti affidabili sono
evidenziati in verde nelle liste iscritti e nelle card match; il conteggio delle valutazioni è
pubblico, le contestazioni sono visibili solo all'organizzatore e all'admin.

### Match ricorrenti

`recurringMatches/{id}` descrive giorno, ora, offset settimanale e template del match.
Il cron crea il match della settimana se non esiste, con `sourceRecurringId`.
Dalla pagina **Organizza** si attiva/disattiva la ricorrenza.

---

## 5. Cloudflare Worker (cron)

```bash
cd worker
npm install
npx wrangler login
```

Imposta il project id in `worker/wrangler.toml` (`FIREBASE_PROJECT_ID`) e i secret:

```bash
npx wrangler secret put FIREBASE_CLIENT_EMAIL   # service account Firebase
npx wrangler secret put FIREBASE_PRIVATE_KEY    # chiave privata (con \n escapati)
npx wrangler secret put MAINTENANCE_SECRET      # token per chiamate manuali
```

Service account: Firebase Console → Impostazioni progetto → Service account → *Genera nuova chiave privata*.
Il worker usa l'API REST di Firestore con un JWT firmato RS256 (nessun SDK Node, gira nel runtime Workers).

Deploy e test:

```bash
npx wrangler deploy
curl "https://volley-bologna-cron.<account>.workers.dev/run?key=$MAINTENANCE_SECRET" -X POST
```

C'è **un solo trigger**, ogni 10 minuti; le tre manutenzioni sono distribuite per ora di Roma
dentro lo stesso giro:

| Cron (UTC) | Azione |
| --- | --- |
| `*/10 * * * *` | offerte riserve scadute → passa alla riserva successiva |
| `*/10 * * * *`, fascia 03:xx Roma | pulizia messaggi chat più vecchi di 30 giorni |
| `*/10 * * * *`, fascia 05:xx Roma | pubblicazione dei match ricorrenti della settimana |

Endpoint manuali: `GET /health`, `POST /run?key=…` (tutte le manutenzioni, `force`).
`GET /` restituisce la descrizione del servizio.

---

## 6. Deploy su Cloudflare Workers

L'app è una SPA di soli file statici: la serve un Worker senza logica, configurato in
[wrangler.jsonc](wrangler.jsonc).

1. **Workers & Pages → Create → Workers → Connect to Git** e seleziona il repository.
2. Build command: `npm run build` · Deploy command: `npx wrangler deploy`.
3. Environment variables: le stesse `VITE_FIREBASE_*` del file `.env.local` (servono in build,
   perché Vite le incorpora nel bundle: se le aggiungi dopo, rilancia un deploy).
4. Dopo il primo deploy aggiungi `https://volley-bologna.<account>.workers.dev` ai domini
   autorizzati di Firebase (Authentication → Settings → Authorized domains).

Il routing SPA è gestito da `assets.not_found_handling: "single-page-application"` in
`wrangler.jsonc`: ogni route sconosciuta (es. `/match/abc`) restituisce `index.html`.

Non usare un file `public/_redirects` con `/* /index.html 200`: su Workers quella regola
viene rifiutata con *Infinite loop detected in this rule* (errore 100324), perché il file finisce
in `dist/` e viene letto come redirect reale. Il fallback va tenuto solo nella configurazione
Wrangler, come già fatto.

In locale il deploy si prova con `npm run deploy`; per vedere il sito servito da Wrangler
prima di pubblicare: `npm run build && npx wrangler dev`.

---

## 7. Limiti dei piani gratuiti

| Servizio | Limite gratuito | Uso previsto |
| --- | --- | --- |
| Firebase Auth | 50k MAU (Google) | ampiamente sufficiente |
| Firestore Spark | 50k letture/giorno, 20k scritture/giorno, 1 GiB | chat con paginazione 40 messaggi, listener solo sulle schermate aperte |
| Cloudflare Workers (asset statici) | richieste incluse nel piano, asset serviti da edge | hosting della SPA |
| Cloudflare Workers | 100k richieste/giorno | cron ogni 10 min ≈ 4.3k richieste/mese |

Accorgimenti già applicati: paginazione dei messaggi, listener per-match invece che globali,
retention 30 giorni sulla chat, nessun upload di immagini (solo testo/emoji), indici compositi
mirati per evitare scansioni complete.

---

## 8. Comandi

```bash
npm run dev            # dev server Vite
npm run build          # build di produzione in dist/
npm run preview        # anteprima della build
npm run worker:dev     # wrangler dev per il worker cron
npm run worker:deploy  # deploy del worker
```

---

## 9. Logo

Il logo della community è in [public/community-logo.png](public/community-logo.png) e viene usato in
sidebar, login, splash, hero della home e come favicon.

Per sostituirlo, salva il nuovo file in `public/community-logo.png` (oppure imposta
`VITE_LOGO_URL` in `.env.local` e nelle env di build su Cloudflare) e rifai il build.

---

## 10. Collaudo

Con un progetto Firebase reale:

- [ ] Login Google, logout e persistenza della sessione
- [ ] Creazione del profilo al primo accesso (`users` + `publicProfiles`)
- [ ] Match: creazione, iscrizione, match pieno → lista riserva
- [ ] Ritiro di un iscritto → offerta alla prima riserva con countdown 30 min
- [ ] Conferma offerta → posto assegnato, oppure scadenza → riserva successiva
- [ ] Chat: invio, risposta, modifica con etichetta *Modificato*, eliminazione soft
- [ ] Segnalazione messaggio e parola vietata
- [ ] Gruppi pubblici/privati, richiesta di accesso, accesso negato per i bannati
- [ ] Promozione del primo admin e dashboard di amministrazione
- [ ] Cron del worker in produzione

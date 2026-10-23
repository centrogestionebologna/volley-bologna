# Volley Bologna Community

Webapp per la community di pallavolisti di Bologna: match, iscrizioni con lista riserve,
gruppi con chat, chat generale stile WhatsApp, reputazione degli organizzatori e pannello admin.

Stack: **React + Vite** · **Firebase Auth (Google)** · **Cloud Firestore** · **Cloudflare Pages** · **Cloudflare Workers + Cron Triggers**.
Nessun servizio a pagamento obbligatorio, nessun pagamento in-app: tutto rientra nei piani gratuiti.

---

## 1. Avvio rapido (modalità demo, zero configurazione)

```bash
npm install
npm run dev
```

Senza variabili d'ambiente l'app parte in **modalità demo**: i dati vivono in `localStorage`
tramite un adapter che espone la stessa interfaccia di Firestore, quindi si possono provare
tutti i flussi (login finto, match, riserve, chat, gruppi, admin) senza creare un progetto Firebase.

Account demo disponibili nella pagina di login:

| Utente | Ruolo |
| --- | --- |
| Adriano | Admin della piattaforma |
| Giulia Ferri | Organizzatrice |
| Marco Bellini | Giocatore |
| Sara Neri | Giocatrice |

Per forzare la demo anche con Firebase configurato: `VITE_DEMO_MODE=true`.

Per resettare i dati demo: dalla pagina Profilo → *Reset dati demo* (o svuota il `localStorage`).

---

## 2. Configurazione Firebase

1. Crea un progetto su [console.firebase.google.com](https://console.firebase.google.com) (piano Spark, gratuito).
2. **Authentication → Sign-in method → Google**: abilita e imposta l'email di supporto.
3. **Authentication → Settings → Authorized domains**: aggiungi `localhost` e il dominio
   `<progetto>.pages.dev` (e l'eventuale dominio custom).
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

### Deploy di regole e indici

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

L'admin iniziale è **Adriano**. Dopo il primo login con Google:

1. apri Firestore → collezione `users` → documento con il tuo uid;
2. imposta `role: "admin"` e `nickname: "Adriano"`;
3. ricarica l'app: compare la voce **Admin** nella sidebar.

Da quel momento i ruoli si gestiscono dalla dashboard (Impostazioni → *Promuovi admin*).

---

## 3. Struttura del progetto

```
src/
  config.js              costanti, env, limiti prodotto (retention 30gg, offerte 30min)
  backend.js             sceglie adapter Firestore o demo in base alla config
  auth/AuthProvider.jsx  sessione Google + bootstrap profilo
  store/
    base.js              interfaccia comune dello store
    firestoreAdapter.js  adapter Firestore (onSnapshot, transazioni, serverTimestamp)
    localAdapter.js      adapter demo su localStorage, stessa semantica
  services/
    profiles.js          profilo, nickname, verifica identità, ruoli
    matches.js           match, iscrizioni, lista riserve, offerte 30 min
    groups.js            gruppi pubblici/privati, richieste, ban
    chat.js              messaggi, reply, edit, delete, segnalazioni, moderazione
    reputation.js        liste affidabili per organizzatore, valutazioni
    moderation.js        parole vietate, segnalazioni, ban, mute
    maintenance.js       pulizia chat e pubblicazione match ricorrenti
  components/            shell, chat, card match, UI kit, countdown, emoji picker
  pages/                 Login, Home, Match, Gruppi, Chat, Profilo, Admin, Organizer
worker/
  src/index.js           cron: offerte riserve scadute, pulizia 30gg, match ricorrenti
  src/firestore.js       client Firestore REST con service account (JWT RS256)
firestore.rules          regole di sicurezza
firestore.indexes.json   indici compositi
firebase.json            config CLI Firebase
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
- retention 30 giorni applicata dal Worker (e da `maintenance.js` in demo).

### Reputazione

L'organizzatore mantiene `organizers/{uid}/trusted/{userId}`. Gli utenti affidabili sono
evidenziati in verde nelle liste iscritti e nelle card match; il conteggio delle valutazioni è
pubblico, le contestazioni sono visibili solo all'organizzatore e all'admin.

### Match ricorrenti

`recurringMatches/{id}` descrive giorno, ora, offset settimanale e template del match.
Il cron delle 05:xx UTC crea il match della settimana se non esiste, con `sourceRecurringId`.
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
curl -X POST https://volley-bologna-cron.<account>.workers.dev/run \
  -H "Authorization: Bearer $MAINTENANCE_SECRET"
```

Trigger configurati (`worker/wrangler.toml`):

| Cron (UTC) | Azione |
| --- | --- |
| `*/10 * * * *` | offerte riserve scadute → passa alla riserva successiva |
| `0 3 * * *` | pulizia messaggi chat più vecchi di 30 giorni |
| `0 5 * * *` | pubblicazione dei match ricorrenti della settimana |

Endpoint manuali: `POST /run` (tutte le manutenzioni), `POST /expire-offers`, `POST /purge-chat`,
`POST /publish-recurring`, `GET /health`.

---

## 6. Deploy su Cloudflare Pages

1. **Workers & Pages → Create → Pages → Connect to Git** (o *Direct Upload*).
2. Build command: `npm run build` · Output directory: `dist`.
3. Environment variables: le stesse `VITE_FIREBASE_*` del file `.env.local`.
4. Dopo il primo deploy aggiungi `https://<progetto>.pages.dev` ai domini autorizzati Firebase.

`vite.config.js` non richiede configurazioni particolari: l'app è una SPA, quindi imposta
un fallback su `index.html`. Con *Direct Upload* crea un file `_redirects` in `public/` con
`/* /index.html 200` (con il deploy da Git il fallback SPA è gestito da Pages).

---

## 7. Limiti dei piani gratuiti

| Servizio | Limite gratuito | Uso previsto |
| --- | --- | --- |
| Firebase Auth | 50k MAU (Google) | ampiamente sufficiente |
| Firestore Spark | 50k letture/giorno, 20k scritture/giorno, 1 GiB | chat con paginazione 40 messaggi, listener solo sulle schermate aperte |
| Cloudflare Pages | 500 build/mese, banda illimitata | deploy da Git |
| Cloudflare Workers | 100k richieste/giorno | cron ogni 10 min ≈ 4.3k richieste/mese |

Accorgimenti già applicati: paginazione dei messaggi, listener per-match invece che globali,
retention 30 giorni sulla chat, nessun upload di immagini (solo testo/emoji), indici compositi
mirati per evitare scansioni complete.

---

## 8. Comandi

```bash
npm run dev            # dev server Vite (demo se mancano le env)
npm run build          # build di produzione in dist/
npm run preview        # anteprima della build
npm run worker:dev     # wrangler dev per il worker cron
npm run worker:deploy  # deploy del worker
```

## 9. Checklist di collaudo

- [x] Login demo con i quattro profili, logout e persistenza della sessione
- [x] Match: creazione, iscrizione, match pieno → lista riserva
- [x] Ritiro di un iscritto → offerta alla prima riserva con countdown 30 min
- [x] Conferma offerta → posto assegnato, oppure scadenza → riserva successiva
- [x] Chat: invio, risposta, modifica con etichetta *Modificato*, eliminazione soft
- [x] Segnalazione messaggio e parola vietata
- [x] Gruppi pubblici/privati, richiesta di accesso, accesso negato per i bannati
- [x] Reputazione: utente affidabile evidenziato in verde
- [x] Admin: statistiche, segnalazioni, parole vietate, ban/silenzia, verifica identità
- [ ] Da verificare con un progetto Firebase reale: regole, indici e cron in produzione

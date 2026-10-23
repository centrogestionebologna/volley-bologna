/**
 * Dati di esempio per la modalità demo (nessun Firebase configurato).
 * Le date sono relative al primo avvio, così i match restano futuri.
 */

import { dateKey, timeKey } from '../lib/format';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function at(now, dayOffset, hour, minute = 0) {
  const d = new Date(now);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

function registration(uid, nickname, status, seq, createdAt) {
  return {
    uid,
    nickname,
    status,
    seq,
    createdAt,
    confirmedAt: status === 'confirmed' ? createdAt : null,
    offerExpiresAt: null,
  };
}

export function buildSeed(now = Date.now()) {
  const docs = {};

  const users = [
    {
      uid: 'demo-adriano',
      nickname: 'Adriano',
      realName: 'Adriano',
      surname: 'Bianchi',
      email: 'adriano.bianchi@example.com',
      phone: '+39 335 1122334',
      verified: true,
      verificationStatus: 'verified',
      bio: 'Admin della community e organizzatore all’Arcoveggio.',
      photoURL: '',
      createdAt: now - 240 * DAY,
    },
    {
      uid: 'demo-giulia',
      nickname: 'Giulia',
      realName: 'Giulia',
      surname: 'Ferrari',
      email: 'giulia.ferrari@example.com',
      phone: '+39 340 5566778',
      verified: true,
      verificationStatus: 'verified',
      bio: 'Organizzo a Corticella e al Parco Talon. Schiacciatrice, ex serie C.',
      photoURL: '',
      createdAt: now - 180 * DAY,
    },
    {
      uid: 'demo-marco',
      nickname: 'Marco',
      realName: 'Marco',
      surname: 'Rossi',
      email: 'marco.rossi@example.com',
      phone: '+39 347 9988776',
      verified: false,
      verificationStatus: 'requested',
      bio: 'Alzatore in cerca di squadra fissa.',
      photoURL: '',
      createdAt: now - 90 * DAY,
    },
    {
      uid: 'demo-sara',
      nickname: 'Sara',
      realName: 'Sara',
      surname: 'Conti',
      email: 'sara.conti@example.com',
      phone: '+39 333 4455667',
      verified: true,
      verificationStatus: 'verified',
      bio: 'Libero, universitaria. Sempre in cerca di beach volley.',
      photoURL: '',
      createdAt: now - 60 * DAY,
    },
    {
      uid: 'demo-luca',
      nickname: 'LucaPallavolo',
      realName: 'Luca',
      surname: 'Bianchi',
      email: 'luca.bianchi@example.com',
      phone: '+39 366 1234567',
      verified: false,
      verificationStatus: 'none',
      bio: 'Over 30, gioco per divertirmi.',
      photoURL: '',
      createdAt: now - 25 * DAY,
    },
    {
      uid: 'demo-elena',
      nickname: 'Elena',
      realName: 'Elena',
      surname: 'Ricci',
      email: 'elena.ricci@example.com',
      phone: '+39 320 7654321',
      verified: false,
      verificationStatus: 'submitted',
      bio: 'Centrale, appena arrivata a Bologna.',
      photoURL: '',
      createdAt: now - 12 * DAY,
    },
  ];

  for (const user of users) {
    docs[`users/${user.uid}`] = {
      uid: user.uid,
      email: user.email,
      realName: user.realName,
      surname: user.surname,
      phone: user.phone,
      nickname: user.nickname,
      verified: user.verified,
      verificationStatus: user.verificationStatus,
      verificationNote: '',
      banned: false,
      silencedUntil: null,
      createdAt: user.createdAt,
      updatedAt: user.createdAt,
    };
    docs[`publicProfiles/${user.uid}`] = {
      uid: user.uid,
      nickname: user.nickname,
      photoURL: user.photoURL,
      bio: user.bio,
      verified: user.verified,
      createdAt: user.createdAt,
    };
  }

  docs['admins/demo-adriano'] = { uid: 'demo-adriano', name: 'Adriano', createdAt: now - 240 * DAY };

  docs['settings/moderation'] = {
    bannedWords: ['idiota', 'cretino', 'vaffanculo', 'merda', 'stronzo'],
    updatedAt: now - 10 * DAY,
  };

  // ── Match futuri ───────────────────────────────────────────────────────────
  const matches = [
    {
      id: 'match-corticella',
      title: 'Volley serale a Corticella',
      sport: 'indoor',
      date: at(now, 3, 21, 0) > now ? at(now, 3, 21, 0) : at(now, 3, 21, 0) + 7 * DAY,
      gym: 'Palestra Corticella',
      zone: 'Bologna Nord',
      cost: 8,
      level: 'intermedio',
      maxPlayers: 12,
      ageBand: 'universitari',
      deadlineHours: 6,
      description:
        'Due ore di gioco, si fa rotazione. Portate la maglia bianca e quella scura. Doccia negli spogliatoi.',
      organizerId: 'demo-giulia',
      organizerNickname: 'Giulia',
      confirmedCount: 9,
      waitlistCount: 0,
      registrationSeq: 9,
      pendingOffer: null,
      pendingOfferUid: null,
      status: 'open',
      recurringId: 'recurring-corticella',
    },
    {
      id: 'match-talon',
      title: 'Beach volley al Parco Talon',
      sport: 'beach',
      date: at(now, 2, 10, 0),
      gym: 'Campi da beach Parco Talon',
      zone: 'Casalecchio / Talon',
      cost: 5,
      level: 'principiante',
      maxPlayers: 8,
      ageBand: 'liceo',
      deadlineHours: 12,
      description:
        '4 vs 4 misto, livello amichevole. Campo 2 prenotato a nome Giulia. Chi arriva prima monta la rete!',
      organizerId: 'demo-giulia',
      organizerNickname: 'Giulia',
      confirmedCount: 7,
      waitlistCount: 2,
      registrationSeq: 9,
      pendingOffer: {
        uid: 'demo-marco',
        nickname: 'Marco',
        seq: 8,
        expiresAt: now + 18 * MINUTE,
      },
      pendingOfferUid: 'demo-marco',
      status: 'open',
      recurringId: null,
    },
    {
      id: 'match-arcoveggio',
      title: 'Torneo 6vs6 Over 30',
      sport: 'indoor',
      date: at(now, 5, 20, 30),
      gym: 'Palestra Arcoveggio',
      zone: 'Bologna Nord',
      cost: 10,
      level: 'avanzato',
      maxPlayers: 10,
      ageBand: 'over30',
      deadlineHours: 24,
      description:
        'Partita a punteggio, arbitraggio leggero. Serve esperienza di gioco di squadra.',
      organizerId: 'demo-adriano',
      organizerNickname: 'Adriano',
      confirmedCount: 6,
      waitlistCount: 0,
      registrationSeq: 6,
      pendingOffer: null,
      pendingOfferUid: null,
      status: 'open',
      recurringId: null,
    },
    {
      id: 'match-savena',
      title: 'Misto principianti Savena',
      sport: 'indoor',
      date: at(now, 6, 19, 0),
      gym: 'Palestra Savena',
      zone: 'Bologna Est',
      cost: 6,
      level: 'principiante',
      maxPlayers: 14,
      ageBand: 'liceo',
      deadlineHours: 4,
      description: 'Serata per chi inizia o riprende. Nessun giudizio, solo divertimento.',
      organizerId: 'demo-giulia',
      organizerNickname: 'Giulia',
      confirmedCount: 4,
      waitlistCount: 0,
      registrationSeq: 4,
      pendingOffer: null,
      pendingOfferUid: null,
      status: 'open',
      recurringId: null,
    },
  ];

  for (const match of matches) {
    const { id, date, ...data } = match;
    docs[`matches/${id}`] = {
      ...data,
      startsAt: date,
      date: dateKey(date),
      time: timeKey(date),
      deadlineAt: date - data.deadlineHours * HOUR,
      createdAt: now - 8 * DAY,
      updatedAt: now - 2 * DAY,
    };
  }

  const registrationsByMatch = {
    'match-corticella': [
      ['demo-giulia', 'Giulia', 'confirmed'],
      ['demo-sara', 'Sara', 'confirmed'],
      ['demo-luca', 'LucaPallavolo', 'confirmed'],
      ['demo-elena', 'Elena', 'confirmed'],
      ['demo-adriano', 'Adriano', 'confirmed'],
    ],
    'match-talon': [
      ['demo-giulia', 'Giulia', 'confirmed'],
      ['demo-sara', 'Sara', 'confirmed'],
      ['demo-luca', 'LucaPallavolo', 'confirmed'],
      ['demo-elena', 'Elena', 'confirmed'],
    ],
    'match-arcoveggio': [
      ['demo-adriano', 'Adriano', 'confirmed'],
      ['demo-luca', 'LucaPallavolo', 'confirmed'],
      ['demo-elena', 'Elena', 'confirmed'],
    ],
    'match-savena': [
      ['demo-giulia', 'Giulia', 'confirmed'],
      ['demo-sara', 'Sara', 'confirmed'],
    ],
  };

  // Iscritti "fantasma" per riempire i posti (community reale, profili non tutti presenti in demo).
  const ghosts = {
    'match-corticella': ['Andrea', 'Martina', 'Fede', 'Chiara'],
    'match-talon': ['Andrea', 'Martina', 'Fede'],
    'match-arcoveggio': ['Andrea', 'Martina', 'Fede'],
    'match-savena': ['Andrea', 'Martina'],
  };

  let seq = 1;
  for (const [matchId, rows] of Object.entries(registrationsByMatch)) {
    for (const [uid, nickname, status] of rows) {
      docs[`matches/${matchId}/registrations/${uid}`] = registration(
        uid,
        nickname,
        status,
        seq++,
        now - 5 * DAY + seq * MINUTE
      );
    }
    for (const nickname of ghosts[matchId] || []) {
      const uid = `ghost-${matchId}-${nickname.toLowerCase()}`;
      docs[`matches/${matchId}/registrations/${uid}`] = registration(
        uid,
        nickname,
        'confirmed',
        seq++,
        now - 4 * DAY + seq * MINUTE
      );
    }
  }

  docs['matches/match-talon/registrations/demo-marco'] = {
    ...registration('demo-marco', 'Marco', 'offered', 8, now - 4 * DAY),
    offerExpiresAt: now + 18 * MINUTE,
  };
  docs['matches/match-talon/registrations/ghost-talon-chiara'] = registration(
    'ghost-talon-chiara',
    'Chiara',
    'waitlist',
    9,
    now - 3 * DAY
  );

  // ── Gruppi ─────────────────────────────────────────────────────────────────
  const groups = [
    {
      id: 'group-tutti',
      name: 'Volley Bologna — tutti i livelli',
      description:
        'Il gruppo storico della community: annunci, cerchiamo giocatori, chiacchiere e organizzazione dei match.',
      visibility: 'public',
      ownerId: 'demo-giulia',
      ownerNickname: 'Giulia',
      memberCount: 5,
      pendingCount: 0,
      bannedUids: [],
      createdAt: now - 180 * DAY,
    },
    {
      id: 'group-under25',
      name: 'Under 25 Arcoveggio',
      description: 'Gruppo per ragazzi e ragazze under 25 che giocano all’Arcoveggio e dintorni.',
      visibility: 'public',
      ownerId: 'demo-adriano',
      ownerNickname: 'Adriano',
      memberCount: 2,
      pendingCount: 0,
      bannedUids: [],
      createdAt: now - 120 * DAY,
    },
    {
      id: 'group-beach',
      name: 'Beach Estate Bologna',
      description: 'Gruppo privato: tornei beach, weekend a Rimini e allenamenti al Talon.',
      visibility: 'private',
      ownerId: 'demo-giulia',
      ownerNickname: 'Giulia',
      memberCount: 2,
      pendingCount: 1,
      bannedUids: [],
      createdAt: now - 40 * DAY,
    },
  ];

  for (const group of groups) {
    const { id, ...data } = group;
    docs[`groups/${id}`] = data;
  }

  docs['groupSecrets/group-beach'] = {
    ownerId: 'demo-giulia',
    // sha256("BEACH2026")
    inviteHash: 'e2133d5d06ac51ac912858c7f4ed71b1dc3b9e076920eaf746abf36086a76798',
    updatedAt: now - 40 * DAY,
  };

  const groupMembers = {
    'group-tutti': [
      ['demo-giulia', 'Giulia', 'owner', 'active'],
      ['demo-marco', 'Marco', 'member', 'active'],
      ['demo-sara', 'Sara', 'member', 'active'],
      ['demo-luca', 'LucaPallavolo', 'member', 'active'],
      ['demo-adriano', 'Adriano', 'member', 'active'],
    ],
    'group-under25': [
      ['demo-adriano', 'Adriano', 'owner', 'active'],
      ['demo-luca', 'LucaPallavolo', 'member', 'active'],
    ],
    'group-beach': [
      ['demo-giulia', 'Giulia', 'owner', 'active'],
      ['demo-sara', 'Sara', 'member', 'active'],
      ['demo-marco', 'Marco', 'member', 'pending'],
    ],
  };

  for (const [groupId, rows] of Object.entries(groupMembers)) {
    for (const [uid, nickname, role, status] of rows) {
      docs[`groups/${groupId}/members/${uid}`] = {
        uid,
        nickname,
        role,
        status,
        joinedAt: now - 30 * DAY,
      };
    }
  }

  // ── Chat generale ──────────────────────────────────────────────────────────
  const chat = [
    ['msg-1', 'demo-giulia', 'Giulia', 'Ciao a tutti! Ho appena pubblicato il match di martedì a Corticella, mancano 3 posti 🏐', -26 * HOUR, {}],
    ['msg-2', 'demo-marco', 'Marco', 'Ci sono! Livello intermedio giusto?', -25 * HOUR, { replyTo: { id: 'msg-1', nickname: 'Giulia', text: 'Ciao a tutti! Ho appena pubblicato il match di martedì a Corticella, mancano 3 posti 🏐' } }],
    ['msg-3', 'demo-giulia', 'Giulia', 'Esatto, intermedio. Se porti un amico meglio ancora 😄', -24 * HOUR, {}],
    ['msg-4', 'demo-sara', 'Sara', 'Qualcuno va al beach sabato? Io ho prenotato il campo 2!', -8 * HOUR, {}],
    ['msg-5', 'demo-luca', 'LucaPallavolo', 'Io ci sarei, ma dipende dall’orario di lavoro', -7 * HOUR, {}],
    ['msg-6', 'demo-elena', 'Elena', 'Ciao! Mi sono appena iscritta, mi chiamo Elena. Gioco da 4 anni come centrale 😊', -3 * HOUR, {}],
    ['msg-7', 'demo-giulia', 'Giulia', 'Benvenuta Elena! Ti aspettiamo in campo 💪', -2 * HOUR, { edited: true }],
    ['msg-8', 'demo-marco', 'Marco', '', -90 * MINUTE, { deleted: true }],
  ];

  for (const [id, authorId, authorNickname, text, offset, extra] of chat) {
    docs[`chats/general/messages/${id}`] = {
      authorId,
      authorNickname,
      text,
      createdAt: now + offset,
      editedAt: extra.edited ? now + offset + 5 * MINUTE : null,
      deleted: Boolean(extra.deleted),
      deletedAt: extra.deleted ? now + offset + 10 * MINUTE : null,
      replyTo: extra.replyTo || null,
    };
  }

  const groupChat = [
    ['gmsg-1', 'demo-giulia', 'Giulia', 'Benvenuti nel gruppo! Presentatevi con ruolo e livello 🙌', -30 * HOUR],
    ['gmsg-2', 'demo-sara', 'Sara', 'Sara, libero, gioco da 6 anni. Cerco squadra per il campionato UISP.', -28 * HOUR],
    ['gmsg-3', 'demo-luca', 'LucaPallavolo', 'Luca, schiacciatore così così 😅 ci vediamo in campo!', -26 * HOUR],
  ];

  for (const [id, authorId, authorNickname, text, offset] of groupChat) {
    docs[`groups/group-tutti/messages/${id}`] = {
      authorId,
      authorNickname,
      text,
      createdAt: now + offset,
      editedAt: null,
      deleted: false,
      replyTo: null,
    };
  }

  // ── Reputazione (liste private degli organizzatori) ────────────────────────
  docs['organizers/demo-giulia/trusted/demo-sara'] = {
    userId: 'demo-sara',
    nickname: 'Sara',
    note: 'Sempre puntuale, mai un buco.',
    createdAt: now - 20 * DAY,
  };
  docs['organizers/demo-giulia/trusted/demo-adriano'] = {
    userId: 'demo-adriano',
    nickname: 'Adriano',
    note: 'Affidabile, aiuta anche a montare la rete.',
    createdAt: now - 15 * DAY,
  };
  docs['organizers/demo-giulia/ratings/demo-sara'] = {
    userId: 'demo-sara',
    nickname: 'Sara',
    score: 5,
    note: 'Ottima giocatrice di squadra.',
    createdAt: now - 20 * DAY,
  };
  docs['organizers/demo-giulia/ratings/demo-marco'] = {
    userId: 'demo-marco',
    nickname: 'Marco',
    score: 3,
    note: 'Ha disdetto all’ultimo una volta.',
    createdAt: now - 10 * DAY,
  };
  docs['organizers/demo-giulia/ratings/demo-luca'] = {
    userId: 'demo-luca',
    nickname: 'LucaPallavolo',
    score: 4,
    note: '',
    createdAt: now - 9 * DAY,
  };

  // ── Segnalazioni e contestazioni ───────────────────────────────────────────
  docs['reports/report-demo-1'] = {
    type: 'message',
    targetId: 'msg-8',
    chatPath: 'chats/general/messages',
    targetUserId: 'demo-marco',
    targetNickname: 'Marco',
    messageText: 'Messaggio eliminato dall’autore',
    reporterId: 'demo-luca',
    reporterNickname: 'LucaPallavolo',
    reason: 'Linguaggio aggressivo verso un altro utente.',
    status: 'open',
    createdAt: now - 4 * HOUR,
    resolvedAt: null,
    resolution: '',
  };

  docs['disputes/dispute-demo-1'] = {
    organizerId: 'demo-giulia',
    organizerNickname: 'Giulia',
    targetUserId: 'demo-marco',
    targetNickname: 'Marco',
    matchId: 'match-talon',
    description: 'Iscritto e non presentato senza avvisare, ci ha lasciato in 7.',
    status: 'open',
    createdAt: now - 2 * DAY,
  };

  // ── Match ricorrente ───────────────────────────────────────────────────────
  docs['recurringMatches/recurring-corticella'] = {
    organizerId: 'demo-giulia',
    organizerNickname: 'Giulia',
    title: 'Volley serale a Corticella',
    sport: 'indoor',
    weekday: 2,
    time: '21:00',
    gym: 'Palestra Corticella',
    zone: 'Bologna Nord',
    cost: 8,
    level: 'intermedio',
    maxPlayers: 12,
    ageBand: 'universitari',
    deadlineHours: 6,
    description:
      'Due ore di gioco, si fa rotazione. Portate la maglia bianca e quella scura. Doccia negli spogliatoi.',
    active: true,
    lastPublishedDate: null,
    createdAt: now - 30 * DAY,
  };

  void HOUR;
  return docs;
}

export const DEMO_ACCOUNTS = [
  {
    uid: 'demo-adriano',
    name: 'Adriano',
    role: 'Admin',
    email: 'adriano.bianchi@example.com',
    description: 'Vede dashboard, segnalazioni e moderazione completa.',
  },
  {
    uid: 'demo-giulia',
    name: 'Giulia',
    role: 'Organizzatrice',
    email: 'giulia.ferrari@example.com',
    description: 'Gestisce match, gruppi, liste riserve e reputazione.',
  },
  {
    uid: 'demo-marco',
    name: 'Marco',
    role: 'Giocatore',
    email: 'marco.rossi@example.com',
    description: 'Ha un posto riservato in scadenza al Talon: prova a confermarlo.',
  },
];

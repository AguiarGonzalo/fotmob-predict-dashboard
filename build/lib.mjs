// lib.mjs — Construcción del snapshot del dashboard a partir de la API de
// FotMob Predict + las predicciones SSR del DOM de cada perfil.
//
// FUENTES (todas dinámicas, nada hardcodeado → sobrevive a partidos nuevos):
//   - /api/leagueDetails  → jugadores: { id, name, points, topScoreCount(exactos), rank }
//   - /api/matches        → fixtures + resultados: { matchId, homeTeam, awayTeam, startTime,
//                            homeTeamFinalScore, awayTeamFinalScore }
//   - /api/liveMatches    → ids de partidos en vivo (opcional, para el estado "live")
//   - DOM del perfil       → string de tokens '~' por jugador con sus predicciones
//
// Fórmula de puntaje (validada): exacto=3, acertar ganador/empate con marcador
// distinto=2, errar=0.

export const SCORING = { exact: 3, outcome: 2, miss: 0 };

// EN -> ES para mostrar. Si un equipo no está, se cae al nombre en inglés.
export const ES = {
  'USA': 'EE. UU.', 'Australia': 'Australia', 'Mexico': 'México', 'South Korea': 'Corea del Sur',
  'Canada': 'Canadá', 'Qatar': 'Catar', 'Switzerland': 'Suiza', 'Bosnia and Herzegovina': 'Bosnia y Herzegovina',
  'Czechia': 'Chequia', 'South Africa': 'Sudáfrica', 'Uzbekistan': 'Uzbekistán', 'Colombia': 'Colombia',
  'Ghana': 'Ghana', 'Panama': 'Panamá', 'England': 'Inglaterra', 'Croatia': 'Croacia',
  'Portugal': 'Portugal', 'DR Congo': 'R. D. del Congo', 'Austria': 'Austria', 'Jordan': 'Jordania',
  'Argentina': 'Argentina', 'Algeria': 'Argelia', 'Iraq': 'Irak', 'Norway': 'Noruega',
  'France': 'Francia', 'Senegal': 'Senegal', 'Iran': 'Irán', 'New Zealand': 'Nueva Zelanda',
  'Saudi Arabia': 'Arabia Saudí', 'Uruguay': 'Uruguay', 'Belgium': 'Bélgica', 'Egypt': 'Egipto',
  'Spain': 'España', 'Cape Verde': 'Cabo Verde', 'Sweden': 'Suecia', 'Tunisia': 'Túnez',
  'Ivory Coast': 'Costa de Marfil', 'Ecuador': 'Ecuador', 'Netherlands': 'Países Bajos', 'Japan': 'Japón',
  'Germany': 'Alemania', 'Curacao': 'Curazao', 'Turkiye': 'Turquía', 'Haiti': 'Haití',
  'Scotland': 'Escocia', 'Brazil': 'Brasil', 'Morocco': 'Marruecos', 'Paraguay': 'Paraguay',
};

export function teamEs(en) {
  return ES[en] || en;
}

export const isNum = (s) => typeof s === 'string' && /^\d+$/.test(s);

export function pointsFor(ph, pa, ah, aa) {
  if (ph == null || pa == null || ah == null || aa == null) return 0;
  if (ph === ah && pa === aa) return SCORING.exact;
  if (Math.sign(ph - pa) === Math.sign(ah - aa)) return SCORING.outcome;
  return SCORING.miss;
}

const pairKey = (home, away) => `${home}|||${away}`;

// Parsea el string de tokens '~' del bloque del perfil en predicciones,
// usando el conjunto de nombres de equipo como anclas (independiente del orden).
// Estructura por partido: home ~ [hScore] ~ away ~ [aScore] ~ [badge]
export function parseProfileTokens(str, teamNameSet) {
  const t = str.split('~');
  const posIdx = t.indexOf('Posición');
  const headerOk = posIdx >= 1;
  const meta = {
    rank: headerOk ? Number(t[0]) : null,
    name: headerOk ? t[posIdx + 1] : null,
    points: headerOk ? Number(t[posIdx + 2]) : null,
    exacts: headerOk ? Number(t[posIdx + 3]) : null,
  };
  let p = headerOk ? posIdx + 4 : 0;
  const preds = [];
  while (p < t.length) {
    if (!teamNameSet.has(t[p])) { p++; continue; } // anclar al próximo equipo
    const home = t[p++];
    const ph = isNum(t[p]) ? Number(t[p++]) : null;
    if (!teamNameSet.has(t[p])) continue; // malformado: reanclamos en el while
    const away = t[p++];
    const pa = isNum(t[p]) ? Number(t[p++]) : null;
    const badge = isNum(t[p]) ? Number(t[p++]) : null;
    preds.push({ home, away, ph, pa, badge });
  }
  return { meta, preds };
}

// Construye el snapshot completo.
// Args:
//   leagueDetails:     JSON de /api/leagueDetails
//   matchesApi:        JSON de /api/matches
//   profileTokensById: { profileId: rawTokenString }
//   updatedAt:         ISO string
//   target:            nombre del jugador a destacar (head-to-head)
//   liveMatchIds:      (opcional) array de matchId en vivo
export function buildSnapshot({
  leagueDetails,
  matchesApi,
  profileTokensById,
  updatedAt,
  target = 'Gonzalo Aguiar',
  liveMatchIds = [],
}) {
  const liveSet = new Set((liveMatchIds || []).map(String));
  const members = leagueDetails.league.members; // [{id,name,points,topScoreCount,rank}]
  const memberById = new Map(members.map((m) => [String(m.id), m]));

  // ---- Fixtures desde la API (orden cronológico) ----
  const fixtures = matchesApi.matches
    .map((m) => {
      const hs = m.homeTeamFinalScore;
      const as = m.awayTeamFinalScore;
      const finished = hs != null && as != null;
      const id = String(m.matchId);
      return {
        matchId: id,
        home: m.homeTeam.name,
        away: m.awayTeam.name,
        date: m.startTime,
        day: String(m.startTime).slice(0, 10),
        result: finished ? { h: hs, a: as } : null,
        status: finished ? 'finished' : liveSet.has(id) ? 'live' : 'upcoming',
      };
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const teamNameSet = new Set();
  for (const f of fixtures) { teamNameSet.add(f.home); teamNameSet.add(f.away); }
  const fixtureByPair = new Map(fixtures.map((f) => [pairKey(f.home, f.away), f]));
  const finishedFixtures = fixtures.filter((f) => f.result);
  const finishedCount = finishedFixtures.length;

  // ---- Predicciones por jugador (parseadas del DOM), mapeadas a matchId ----
  // predsByMember: Map<memberName, Map<matchId, {ph,pa,pts}>>
  const predsByMember = new Map();
  for (const [id, tokenStr] of Object.entries(profileTokensById)) {
    const member = memberById.get(String(id));
    if (!member || !tokenStr) continue;
    const { preds } = parseProfileTokens(tokenStr, teamNameSet);
    const byMatch = new Map();
    for (const pr of preds) {
      const fx = fixtureByPair.get(pairKey(pr.home, pr.away));
      if (!fx) continue; // predicción de un partido que no está en la API (raro)
      const pts = fx.result ? pointsFor(pr.ph, pr.pa, fx.result.h, fx.result.a) : null;
      byMatch.set(fx.matchId, { ph: pr.ph, pa: pr.pa, pts });
    }
    predsByMember.set(member.name, byMatch);
  }

  // ---- Validación: la fórmula reproduce el total/exactos de la API ----
  const validation = members.map((m) => {
    const bm = predsByMember.get(m.name) || new Map();
    let sum = 0, exacts = 0;
    for (const f of finishedFixtures) {
      const pr = bm.get(f.matchId);
      if (!pr || pr.pts == null) continue;
      sum += pr.pts;
      if (pr.pts === SCORING.exact) exacts++;
    }
    return {
      name: m.name, calcPts: sum, apiPts: m.points,
      calcExacts: exacts, apiExacts: m.topScoreCount,
      ok: sum === m.points && exacts === m.topScoreCount,
    };
  });

  // ---- players (orden por rank; total/exactos AUTORITATIVOS de la API) ----
  const players = members
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((m) => ({
      id: String(m.id),
      name: m.name,
      rank: m.rank,
      points: m.points,
      exacts: m.topScoreCount,
      avg: finishedCount ? Number((m.points / finishedCount).toFixed(2)) : 0,
      isTarget: m.name === target,
    }));
  const playerNames = players.map((p) => p.name);

  // ---- matches (con predicciones de cada jugador) ----
  // Construimos todos, pero para el dashboard mostramos solo los relevantes:
  // terminados / en vivo, o próximos que algún jugador ya predijo (descarta las
  // llaves de eliminación con equipos por definir que nadie predijo todavía).
  const allMatches = fixtures.map((f, idx) => {
    const predictions = {};
    for (const name of playerNames) {
      const pr = (predsByMember.get(name) || new Map()).get(f.matchId);
      predictions[name] = pr
        ? { ph: pr.ph, pa: pr.pa, pts: pr.pts }
        : { ph: null, pa: null, pts: f.result ? 0 : null };
    }
    return {
      id: idx,
      matchId: f.matchId,
      date: f.date,
      status: f.status,
      home: f.home,
      away: f.away,
      homeEs: teamEs(f.home),
      awayEs: teamEs(f.away),
      result: f.result,
      predictions,
    };
  });
  const matchIndexById = new Map(allMatches.map((m) => [m.matchId, m.id]));
  const matches = allMatches.filter(
    (m) => m.status !== 'upcoming' || Object.values(m.predictions).some((p) => p.ph != null)
  );

  // ---- race: acumulado por día (solo partidos terminados) ----
  const days = [...new Set(finishedFixtures.map((f) => f.day))].sort();
  const cum = Object.fromEntries(playerNames.map((n) => [n, 0]));
  const race = days.map((day) => {
    for (const f of finishedFixtures) {
      if (f.day !== day) continue;
      for (const name of playerNames) {
        const pr = (predsByMember.get(name) || new Map()).get(f.matchId);
        if (pr && pr.pts != null) cum[name] += pr.pts;
      }
    }
    const ranking = playerNames
      .map((name) => ({ name, cum: cum[name] }))
      .sort((a, b) => b.cum - a.cum)
      .map((r, i) => ({ ...r, pos: i + 1 }));
    return { date: day, ranking };
  });

  // ---- head-to-head: target vs cada rival (partidos terminados) ----
  const targetMap = predsByMember.get(target) || new Map();
  const headToHead = players
    .filter((p) => p.name !== target)
    .map((p) => {
      const rivalMap = predsByMember.get(p.name) || new Map();
      let tPts = 0, rPts = 0;
      const byMatch = [];
      for (const f of finishedFixtures) {
        const tp = targetMap.get(f.matchId)?.pts ?? 0;
        const rp = rivalMap.get(f.matchId)?.pts ?? 0;
        tPts += tp; rPts += rp;
        byMatch.push({
          id: matchIndexById.get(f.matchId), home: f.home, away: f.away,
          targetPts: tp, rivalPts: rp,
        });
      }
      return { name: p.name, targetPts: tPts, rivalPts: rPts, diff: tPts - rPts, byMatch };
    });

  return {
    updatedAt,
    league: {
      id: 196754,
      game: 772026,
      name: leagueDetails.league.leagueName,
      code: leagueDetails.league.joinCode,
    },
    scoring: SCORING,
    target,
    finishedCount,
    teamsEs: ES,
    players,
    matches,
    race,
    headToHead,
    validation,
  };
}

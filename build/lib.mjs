// lib.mjs — Lógica reutilizable de parseo, validación y construcción del snapshot
// de FotMob Predict. Compartido por build/compute.mjs (datos crudos hardcodeados)
// y por el scraper (mapa { profileId: rawString } extraído en vivo).
//
// Fórmula validada (contra kevin=38/4 y thomas=34/6, reproduce total y exactos):
//   resultado exacto = 3 · acertar ganador/empate con marcador distinto = 2 · errar = 0
//
// Los strings crudos vienen del extractor que corre en la página del perfil:
//   tokens de texto del bloque del perfil, unidos por '~'.

// ---------------------------------------------------------------------------
// Fixtures en el orden EXACTO del perfil (idéntico para todos los jugadores).
//   res = [home, away] real; null si no terminó. date ISO. Nombres en inglés
//   (como los da el perfil) + display en español.
// ---------------------------------------------------------------------------
export const FIXTURES = [
  { h: 'USA', a: 'Australia', res: null, date: '2026-06-19', status: 'live' },
  { h: 'Mexico', a: 'South Korea', res: [1, 0], date: '2026-06-19' },
  { h: 'Canada', a: 'Qatar', res: [6, 0], date: '2026-06-19' },
  { h: 'Switzerland', a: 'Bosnia and Herzegovina', res: [4, 1], date: '2026-06-18' },
  { h: 'Czechia', a: 'South Africa', res: [1, 1], date: '2026-06-18' },
  { h: 'Uzbekistan', a: 'Colombia', res: [1, 3], date: '2026-06-18' },
  { h: 'Ghana', a: 'Panama', res: [1, 0], date: '2026-06-18' },
  { h: 'England', a: 'Croatia', res: [4, 2], date: '2026-06-17' },
  { h: 'Portugal', a: 'DR Congo', res: [1, 1], date: '2026-06-17' },
  { h: 'Austria', a: 'Jordan', res: [3, 1], date: '2026-06-17' },
  { h: 'Argentina', a: 'Algeria', res: [3, 0], date: '2026-06-17' },
  { h: 'Iraq', a: 'Norway', res: [1, 4], date: '2026-06-17' },
  { h: 'France', a: 'Senegal', res: [3, 1], date: '2026-06-16' },
  { h: 'Iran', a: 'New Zealand', res: [2, 2], date: '2026-06-16' },
  { h: 'Saudi Arabia', a: 'Uruguay', res: [1, 1], date: '2026-06-16' },
  { h: 'Belgium', a: 'Egypt', res: [1, 1], date: '2026-06-15' },
  { h: 'Spain', a: 'Cape Verde', res: [0, 0], date: '2026-06-15' },
  { h: 'Sweden', a: 'Tunisia', res: [5, 1], date: '2026-06-15' },
  { h: 'Ivory Coast', a: 'Ecuador', res: [1, 0], date: '2026-06-15' },
  { h: 'Netherlands', a: 'Japan', res: [2, 2], date: '2026-06-14' },
  { h: 'Germany', a: 'Curacao', res: [7, 1], date: '2026-06-14' },
  { h: 'Australia', a: 'Turkiye', res: [2, 0], date: '2026-06-14' },
  { h: 'Haiti', a: 'Scotland', res: [0, 1], date: '2026-06-14' },
  { h: 'Brazil', a: 'Morocco', res: [1, 1], date: '2026-06-14' },
  { h: 'Qatar', a: 'Switzerland', res: [1, 1], date: '2026-06-13' },
  { h: 'USA', a: 'Paraguay', res: [4, 1], date: '2026-06-13' },
  { h: 'Canada', a: 'Bosnia and Herzegovina', res: [1, 1], date: '2026-06-12' },
  { h: 'South Korea', a: 'Czechia', res: [2, 1], date: '2026-06-12' },
  { h: 'Mexico', a: 'South Africa', res: [2, 0], date: '2026-06-11' },
];

// EN -> ES (display)
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

export const SCORING = { exact: 3, outcome: 2, miss: 0 };
export const TARGET = 'Gonzalo Aguiar'; // jugador del head-to-head

// ---------------------------------------------------------------------------
// Parser alineado por fixtures (los nombres de equipo son anclas únicas)
// ---------------------------------------------------------------------------
export const isNum = (s) => /^\d+$/.test(s);

export function parsePlayer(id, str) {
  const t = str.split('~');
  const meta = { id, rank: +t[0], name: t[2], points: +t[3], exacts: +t[4] };
  let p = 5;
  const preds = [];
  for (const fx of FIXTURES) {
    if (t[p] !== fx.h) throw new Error(`[${meta.name}] esperaba home ${fx.h}, vino "${t[p]}" en idx ${p}`);
    p++;
    const ph = isNum(t[p]) ? +t[p++] : null;
    if (t[p] !== fx.a) throw new Error(`[${meta.name}] esperaba away ${fx.a}, vino "${t[p]}" en idx ${p}`);
    p++;
    const pa = isNum(t[p]) ? +t[p++] : null;
    const badge = isNum(t[p]) ? +t[p++] : null;
    preds.push({ h: fx.h, a: fx.a, ph, pa, badge });
  }
  if (p !== t.length) throw new Error(`[${meta.name}] sobran tokens: parseados ${p}/${t.length}`);
  return { meta, preds };
}

export function pointsFor(ph, pa, ah, aa) {
  if (ph == null || pa == null) return 0;
  if (ph === ah && pa === aa) return SCORING.exact;
  if (Math.sign(ph - pa) === Math.sign(ah - aa)) return SCORING.outcome;
  return SCORING.miss;
}

// ---------------------------------------------------------------------------
// buildSnapshot — recibe el mapa { profileId: rawString } y el updatedAt, y
// devuelve el objeto snapshot COMPLETO. No genera fechas adentro: usa el
// updatedAt que recibe por parámetro.
// ---------------------------------------------------------------------------
export function buildSnapshot(rawMap, { updatedAt }) {
  // 1) Parsear todos los jugadores
  const players = Object.entries(rawMap).map(([id, str]) => parsePlayer(id, str));

  const predByPlayer = new Map(players.map((pp) => [pp.meta.name, pp.preds]));

  // matches: cada fixture con las predicciones de todos + puntos
  const matches = FIXTURES.map((fx, i) => {
    const predictions = {};
    for (const { meta, preds } of players) {
      const pr = preds[i];
      predictions[meta.name] = {
        ph: pr.ph, pa: pr.pa,
        pts: fx.res ? pointsFor(pr.ph, pr.pa, fx.res[0], fx.res[1]) : null,
      };
    }
    return {
      id: i, date: fx.date, status: fx.res ? 'finished' : (fx.status || 'upcoming'),
      home: fx.h, away: fx.a, homeEs: ES[fx.h], awayEs: ES[fx.a],
      result: fx.res ? { h: fx.res[0], a: fx.res[1] } : null,
      predictions,
    };
  });

  // race: acumulado por fecha (solo partidos terminados)
  const finishedDates = [...new Set(FIXTURES.filter((f) => f.res).map((f) => f.date))].sort();
  const cum = Object.fromEntries(players.map((p) => [p.meta.name, 0]));
  const race = finishedDates.map((date) => {
    FIXTURES.forEach((fx, i) => {
      if (fx.res && fx.date === date) {
        for (const { meta, preds } of players) {
          cum[meta.name] += pointsFor(preds[i].ph, preds[i].pa, fx.res[0], fx.res[1]);
        }
      }
    });
    const ranking = Object.entries(cum)
      .map(([name, c]) => ({ name, cum: c }))
      .sort((a, b) => b.cum - a.cum)
      .map((r, idx) => ({ ...r, pos: idx + 1 }));
    return { date, ranking };
  });

  // head-to-head: TARGET vs cada rival, partido a partido (terminados)
  const targetPreds = predByPlayer.get(TARGET);
  const headToHead = players
    .filter((p) => p.meta.name !== TARGET)
    .map(({ meta, preds }) => {
      let tPts = 0, rPts = 0;
      const byMatch = [];
      FIXTURES.forEach((fx, i) => {
        if (!fx.res) return;
        const tp = pointsFor(targetPreds[i].ph, targetPreds[i].pa, fx.res[0], fx.res[1]);
        const rp = pointsFor(preds[i].ph, preds[i].pa, fx.res[0], fx.res[1]);
        tPts += tp; rPts += rp;
        byMatch.push({ id: i, home: fx.h, away: fx.a, targetPts: tp, rivalPts: rp });
      });
      return { name: meta.name, targetPts: tPts, rivalPts: rPts, diff: tPts - rPts, byMatch };
    });

  // players con stats extra
  const finishedCount = FIXTURES.filter((f) => f.res).length;
  const playersOut = players
    .map(({ meta }) => ({
      id: meta.id, name: meta.name, rank: meta.rank,
      points: meta.points, exacts: meta.exacts,
      avg: +(meta.points / finishedCount).toFixed(2),
      isTarget: meta.name === TARGET,
    }))
    .sort((a, b) => a.rank - b.rank);

  return {
    updatedAt,
    league: { id: 196754, game: 772026, name: 'Torneo hamburguesa #2', code: 'BWGUFFMR' },
    scoring: SCORING,
    target: TARGET,
    finishedCount,
    teamsEs: ES,
    players: playersOut,
    matches,
    race,
    headToHead,
  };
}

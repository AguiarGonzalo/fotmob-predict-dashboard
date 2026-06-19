// scrape.mjs — Scraper headless de FotMob Predict (basado en la API + DOM SSR).
//
// Flujo:
//   1. Abre la liga con la sesión guardada.
//   2. Captura los JSON de la API: /api/leagueDetails (jugadores), /api/matches
//      (fixtures + resultados), /api/liveMatches (en vivo), /api/user (nombre del
//      dueño → target del head-to-head).
//   3. Por cada jugador (profileId de leagueDetails), navega DIRECTO a
//      ?profileId=<id> y corre el extractor de página para sacar el string de
//      tokens '~' con sus predicciones (que vienen SSR en el DOM).
//   4. Delega todo el armado a buildSnapshot() de ../../build/lib.mjs.
//
// Nada hardcodeado: fixtures, resultados y jugadores salen de la API en vivo, así
// que sobrevive a los partidos nuevos a lo largo del torneo.
//
// Sesión: process.env.FOTMOB_SESSION (base64) o scraper/.auth/storageState.json.
// Salidas: data/snapshot.json (sobrescrito) y data/history.jsonl (append).
// Exit codes: 0 ok · 1 error · 2 SESSION_EXPIRED (el CI lo detecta).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildSnapshot } from '../../build/lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRAPER_DIR = path.resolve(__dirname, '..');
const ROOT = path.resolve(SCRAPER_DIR, '..');
const AUTH_FILE = path.join(SCRAPER_DIR, '.auth', 'storageState.json');
const DATA_DIR = path.join(ROOT, 'data');
const SNAPSHOT_FILE = path.join(DATA_DIR, 'snapshot.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.jsonl');

const GAME = '772026';
const LEAGUE = '196754';
const leagueUrl = (profileId) =>
  `https://predict-auth.fotmob.com/es/${GAME}?leagueId=${LEAGUE}&tab=leagues` +
  (profileId ? `&profileId=${profileId}` : '');

// Extractor de página: junta los nodos de texto del bloque del perfil con '~'.
const EXTRACT = () => {
  const all = [...document.querySelectorAll('*')];
  const posEl = all.find(
    (e) => e.children.length === 0 && e.textContent.trim() === 'Posición'
  );
  if (!posEl) return null;
  let block = posEl;
  while (block && !/Australia|Qatar|Brazil|France|Spain|Mexico/.test(block.textContent)) {
    block = block.parentElement;
  }
  if (!block) return null;
  const tokens = [];
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) { const t = c.textContent.trim(); if (t) tokens.push(t); }
      else if (c.nodeType === 1) walk(c);
    }
  };
  walk(block);
  return tokens.join('~');
};

function resolveStorageState() {
  if (process.env.FOTMOB_SESSION) {
    let json;
    try {
      json = Buffer.from(process.env.FOTMOB_SESSION, 'base64').toString('utf8');
      JSON.parse(json);
    } catch (e) {
      throw new Error(`FOTMOB_SESSION no es un base64 de storageState válido: ${e.message}`);
    }
    const tmp = path.join(os.tmpdir(), `fotmob-session-${process.pid}.json`);
    fs.writeFileSync(tmp, json);
    return { path: tmp, cleanup: () => { try { fs.unlinkSync(tmp); } catch {} } };
  }
  if (fs.existsSync(AUTH_FILE)) return { path: AUTH_FILE, cleanup: () => {} };
  throw new Error('falta sesion: corre `npm run seed` (o definí el secreto FOTMOB_SESSION).');
}

async function isSignedOut(page) {
  try {
    return await page.getByText(/Sign in to FotMob Predict/i).first().isVisible({ timeout: 4000 });
  } catch {
    return false;
  }
}

async function main() {
  const session = resolveStorageState();
  const nowIso = new Date().toISOString();
  const browser = await chromium.launch({ headless: true });
  let exitCode = 0;

  try {
    const context = await browser.newContext({ storageState: session.path });
    const page = await context.newPage();

    console.log(`→ Abriendo la liga…`);
    await page.goto(leagueUrl(), { waitUntil: 'networkidle' });

    if (await isSignedOut(page)) {
      console.error('SESSION_EXPIRED');
      console.error('La sesión de FotMob caducó. Re-seedeá con `npm run seed` y actualizá FOTMOB_SESSION.');
      await context.close(); await browser.close(); session.cleanup();
      process.exit(2);
    }

    // Traer la API FRESCA (cache-bust) desde la página. El capturado pasivo puede
    // venir cacheado/SSR y quedar atrasado (p. ej. partidos recién terminados).
    const api = await page.evaluate(async () => {
      const bust = Date.now();
      const get = async (u) => {
        try { const r = await fetch(u, { cache: 'no-store' }); return r.ok ? await r.json() : null; }
        catch { return null; }
      };
      const [leagueDetails, matches, live, session] = await Promise.all([
        get(`/api/leagueDetails?game=772026&id=196754&period=total&_=${bust}`),
        get(`/api/matches?game=772026&_=${bust}`),
        get(`/api/liveMatches?game=772026&_=${bust}`),
        get(`/api/auth/session?_=${bust}`),
      ]);
      return { leagueDetails, matches, live, userName: session && session.user ? session.user.name : null };
    });
    if (!api.leagueDetails || !api.matches) {
      throw new Error(`no pude traer la API (leagueDetails=${!!api.leagueDetails}, matches=${!!api.matches})`);
    }

    const members = api.leagueDetails.league.members;
    console.log(`→ Jugadores en la liga: ${members.length} (${members.map((m) => m.name).join(', ')})`);

    // Por cada jugador, navegar directo a su perfil y extraer las predicciones.
    const profileTokensById = {};
    for (const m of members) {
      const id = String(m.id);
      await page.goto(leagueUrl(id), { waitUntil: 'networkidle' });
      // Esperar el bloque del perfil (header "Posición").
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('*')].some(
          (e) => e.children.length === 0 && e.textContent.trim() === 'Posición'
        );
      }, null, { timeout: 15000 }).catch(() => {});

      let raw = null;
      for (let i = 0; i < 12 && !raw; i++) {
        raw = await page.evaluate(EXTRACT);
        if (!raw) await page.waitForTimeout(500);
      }
      if (!raw) { console.warn(`  ⚠ ${m.name}: no pude extraer predicciones`); continue; }
      profileTokensById[id] = raw;
      console.log(`  ✓ ${m.name}`);
    }

    const liveIds = Array.isArray(api.live) ? api.live.map((x) => String(x.id)) : [];
    const snapshot = buildSnapshot({
      leagueDetails: api.leagueDetails,
      matchesApi: api.matches,
      profileTokensById,
      updatedAt: nowIso,
      target: api.userName || 'Gonzalo Aguiar',
      liveMatchIds: liveIds,
    });

    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));
    const histLine = {
      ts: nowIso,
      standings: snapshot.players.map((p) => ({ name: p.name, points: p.points, rank: p.rank })),
    };
    fs.appendFileSync(HISTORY_FILE, JSON.stringify(histLine) + '\n');

    // Resumen + validación.
    console.log(
      `\n📦 snapshot.json: ${snapshot.players.length} jugadores · ` +
      `${snapshot.matches.length} partidos (${snapshot.finishedCount} terminados) · ` +
      `${snapshot.race.length} fechas`
    );
    for (const v of snapshot.validation) {
      console.log(
        `${v.ok ? '✅' : '⚠️ '} ${v.name.padEnd(16)} ` +
        `calc=${v.calcPts}/${v.calcExacts}  api=${v.apiPts}/${v.apiExacts}`
      );
    }
    const bad = snapshot.validation.filter((v) => !v.ok);
    if (bad.length) {
      console.warn(`\n⚠️  ${bad.length} jugador(es) no validan (posible cambio en el DOM). ` +
        `Los puntos de la tabla igual son los de la API; revisá el parseo de predicciones.`);
    } else {
      console.log('\n✅ Todos validan: la fórmula reproduce los totales de la API.');
    }
  } catch (err) {
    console.error('❌ Falló el scrape:', err && err.stack ? err.stack : err);
    exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
    session.cleanup();
  }
  process.exit(exitCode);
}

main();

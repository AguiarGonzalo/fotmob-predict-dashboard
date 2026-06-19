// scrape.mjs — Scraper headless de FotMob Predict.
//
// Reproduce EN VIVO la extracción que validamos a mano: abre la liga, descubre
// dinámicamente los 6 jugadores de la clasificación, abre el perfil de cada uno,
// corre el extractor de página (EXTRACTOR_FN) para obtener su rawString, y arma
// el mapa { profileId: rawString }. Después delega TODO el parseo y la
// construcción del snapshot a buildSnapshot() de ../../build/lib.mjs (misma
// lógica compartida que usa build/compute.mjs con datos hardcodeados).
//
// Sesión:
//   - process.env.FOTMOB_SESSION (base64 del storageState.json) si existe, o
//   - scraper/.auth/storageState.json en disco.
//   Si no hay ninguna → error claro pidiendo `npm run seed`.
//
// Salidas:
//   - data/snapshot.json  (snapshot completo, sobrescrito)
//   - data/history.jsonl  (una línea por corrida, append)
//
// Códigos de salida:
//   0  ok
//   1  error genérico (sesión faltante, parseo, etc.)
//   2  SESSION_EXPIRED → la sesión caducó, hay que re-seedear (el CI lo detecta)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildSnapshot } from '../../build/lib.mjs';
import { EXTRACTOR_FN } from './extract.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRAPER_DIR = path.resolve(__dirname, '..');           // .../scraper
const ROOT = path.resolve(SCRAPER_DIR, '..');                // .../fotmob-predict-dashboard
const AUTH_FILE = path.join(SCRAPER_DIR, '.auth', 'storageState.json');
const DATA_DIR = path.join(ROOT, 'data');
const SNAPSHOT_FILE = path.join(DATA_DIR, 'snapshot.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.jsonl');

const LEAGUE_URL =
  'https://predict-auth.fotmob.com/es/772026?leagueId=196754&tab=leagues';

const EXPECTED_PLAYERS = 6;

// ---------------------------------------------------------------------------
// Resolver el storageState a usar. Devuelve { path, cleanup } donde cleanup()
// borra el archivo temporal si lo creamos a partir del secreto base64.
// ---------------------------------------------------------------------------
function resolveStorageState() {
  if (process.env.FOTMOB_SESSION) {
    let json;
    try {
      json = Buffer.from(process.env.FOTMOB_SESSION, 'base64').toString('utf8');
      JSON.parse(json); // validar que sea storageState válido
    } catch (e) {
      throw new Error(
        `FOTMOB_SESSION no es un base64 de un storageState.json válido: ${e.message}`
      );
    }
    const tmp = path.join(
      os.tmpdir(),
      `fotmob-session-${process.pid}-${Date.now()}.json`
    );
    fs.writeFileSync(tmp, json);
    return { path: tmp, cleanup: () => { try { fs.unlinkSync(tmp); } catch {} } };
  }

  if (fs.existsSync(AUTH_FILE)) {
    return { path: AUTH_FILE, cleanup: () => {} };
  }

  throw new Error(
    'falta sesion: corre `npm run seed` (o definí el secreto FOTMOB_SESSION).'
  );
}

// ---------------------------------------------------------------------------
// Detectar el diálogo de "Sign in to FotMob Predict" (sesión caducada).
// ---------------------------------------------------------------------------
async function isSignedOut(page) {
  // El modal de login muestra el título "Sign in to FotMob Predict". Probamos
  // por texto (robusto a cambios de markup) con un timeout corto.
  try {
    const locator = page.getByText(/Sign in to FotMob Predict/i).first();
    return await locator.isVisible({ timeout: 4000 });
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Capturar el profileId desde la URL actual (?...&profileId=XXXX).
// ---------------------------------------------------------------------------
function profileIdFromUrl(url) {
  try {
    return new URL(url).searchParams.get('profileId');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Localizar las filas de la clasificación (los 6 jugadores). Devuelve un
// locator de filas. Probamos varios selectores y nos quedamos con el primero
// que dé exactamente la cantidad esperada de filas con nombre.
// ---------------------------------------------------------------------------
async function findStandingRows(page) {
  // La fila de cada jugador es clickeable y contiene su nombre. Anclamos en la
  // palabra "Posición" del header para acotar la tabla de clasificación, y
  // tomamos los hermanos/filas siguientes. Como el markup de FotMob no es
  // estable, intentamos por roles y por estructura.
  const candidates = [
    () => page.getByRole('row'),
    () => page.locator('[data-testid*="leaderboard" i] [role="row"]'),
    () => page.locator('li:has-text("Posición") ~ li'),
    () => page.locator('table tbody tr'),
  ];

  for (const make of candidates) {
    const loc = make();
    const count = await loc.count().catch(() => 0);
    if (count >= EXPECTED_PLAYERS) return loc;
  }

  // Fallback: cualquier elemento clickeable bajo el panel de leagues.
  return page.locator('[tab="leagues"] [role="button"], [role="listitem"]');
}

// ---------------------------------------------------------------------------
// Cerrar el perfil abierto (botón X). Tolerante: si no encuentra X, navega
// atrás quitando profileId de la URL.
// ---------------------------------------------------------------------------
async function closeProfile(page) {
  const closeSelectors = [
    page.getByRole('button', { name: /close|cerrar/i }),
    page.locator('button[aria-label*="close" i]'),
    page.locator('button[aria-label*="cerrar" i]'),
    page.locator('[data-testid*="close" i]'),
  ];
  for (const loc of closeSelectors) {
    const btn = loc.first();
    if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(400);
      if (!profileIdFromUrl(page.url())) return;
    }
  }
  // Fallback: navegar a la URL de la liga sin profileId.
  await page.goto(LEAGUE_URL, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(400);
}

// ---------------------------------------------------------------------------
// Abrir el perfil de una fila y devolver { profileId, raw }.
// ---------------------------------------------------------------------------
async function extractRow(page, row) {
  await row.scrollIntoViewIfNeeded().catch(() => {});
  await row.click();

  // Esperar a que la URL incorpore profileId.
  await page
    .waitForFunction(() => new URL(location.href).searchParams.has('profileId'), null, {
      timeout: 15000,
    })
    .catch(() => {});

  const profileId = profileIdFromUrl(page.url());
  if (!profileId) {
    throw new Error('no apareció profileId en la URL tras clickear la fila');
  }

  // Esperar a que el bloque del perfil esté cargado: el header "Posición" + el
  // extractor devolviendo algo no nulo (poll hasta timeout).
  let raw = null;
  await page
    .waitForFunction(
      () => {
        const all = [...document.querySelectorAll('*')];
        const posEl = all.find(
          (e) => e.children.length === 0 && e.textContent.trim() === 'Posición'
        );
        return !!posEl;
      },
      null,
      { timeout: 15000 }
    )
    .catch(() => {});

  // Reintentar el extractor unas veces por si el bloque sigue hidratando.
  for (let i = 0; i < 10 && !raw; i++) {
    raw = await page.evaluate(EXTRACTOR_FN);
    if (!raw) await page.waitForTimeout(500);
  }

  if (!raw) {
    throw new Error(`el extractor devolvió null para profileId=${profileId}`);
  }

  return { profileId, raw };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const session = resolveStorageState();
  const nowIso = new Date().toISOString();

  const browser = await chromium.launch({ headless: true });
  let exitCode = 0;
  try {
    const context = await browser.newContext({ storageState: session.path });
    const page = await context.newPage();

    console.log(`→ Navegando a ${LEAGUE_URL}`);
    await page.goto(LEAGUE_URL, { waitUntil: 'networkidle' });

    if (await isSignedOut(page)) {
      console.error('SESSION_EXPIRED');
      console.error(
        'La sesión de FotMob caducó. Re-seedeá con `npm run seed` y actualizá el secreto FOTMOB_SESSION.'
      );
      await context.close();
      await browser.close();
      session.cleanup();
      process.exit(2);
    }

    // Esperar a que aparezca la tabla de clasificación.
    await page
      .getByText('Posición', { exact: true })
      .first()
      .waitFor({ state: 'visible', timeout: 20000 })
      .catch(() => {});

    const rows = await findStandingRows(page);
    const rowCount = await rows.count();
    console.log(`→ Filas de clasificación detectadas: ${rowCount}`);
    if (rowCount < EXPECTED_PLAYERS) {
      throw new Error(
        `esperaba al menos ${EXPECTED_PLAYERS} jugadores en la clasificación, hallé ${rowCount}`
      );
    }

    // Recorremos las primeras EXPECTED_PLAYERS filas EN ORDEN. Re-resolvemos el
    // locator de filas en cada iteración por si el DOM se re-renderizó al
    // cerrar el perfil anterior.
    const rawMap = {};
    for (let i = 0; i < EXPECTED_PLAYERS; i++) {
      const freshRows = await findStandingRows(page);
      const row = freshRows.nth(i);
      console.log(`→ Abriendo perfil de la fila ${i + 1}/${EXPECTED_PLAYERS}…`);
      const { profileId, raw } = await extractRow(page, row);
      if (rawMap[profileId]) {
        console.warn(`  ⚠ profileId repetido (${profileId}); lo sobrescribo`);
      }
      rawMap[profileId] = raw;
      console.log(`  ✓ profileId=${profileId} (${raw.length} chars)`);
      await closeProfile(page);
    }

    const got = Object.keys(rawMap).length;
    if (got < EXPECTED_PLAYERS) {
      throw new Error(
        `solo capturé ${got}/${EXPECTED_PLAYERS} perfiles únicos`
      );
    }

    // Construir el snapshot con la lógica compartida.
    const snapshot = buildSnapshot(rawMap, { updatedAt: nowIso });

    // Escribir snapshot.json
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));

    // Append a history.jsonl
    const standings = snapshot.players.map((p) => ({
      name: p.name,
      points: p.points,
      rank: p.rank,
    }));
    fs.appendFileSync(
      HISTORY_FILE,
      JSON.stringify({ ts: nowIso, standings }) + '\n'
    );

    // Resumen
    console.log('\n── Resumen ─────────────────────────────────────────');
    console.log(`updatedAt:      ${snapshot.updatedAt}`);
    console.log(`jugadores:      ${snapshot.players.length}`);
    console.log(`partidos:       ${snapshot.matches.length}`);
    console.log(`terminados:     ${snapshot.finishedCount}`);
    console.log(`fechas carrera: ${snapshot.race.length}`);
    console.log('clasificación:');
    for (const p of snapshot.players) {
      console.log(
        `  ${String(p.rank).padStart(2)}. ${p.name.padEnd(18)} ${p.points} pts (${p.exacts} exactos)`
      );
    }
    console.log(`\n📦 Escrito ${SNAPSHOT_FILE}`);
    console.log(`📈 Appendado ${HISTORY_FILE}`);

    await context.close();
  } catch (err) {
    console.error('❌ Falló el scrape:', err && err.stack ? err.stack : err);
    exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
    session.cleanup();
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error('❌ Error fatal:', err && err.stack ? err.stack : err);
  process.exit(1);
});

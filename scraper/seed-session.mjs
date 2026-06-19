// seed-session.mjs — Crea/renueva la sesión de FotMob Predict de forma MANUAL.
//
// Abre un Chrome VISIBLE en modo "no-automatizado" (usa el Chrome real del
// sistema y desactiva los flags que Google detecta), te lleva a la liga, y vos
// te logueás con Google en esa ventana. Cuando ya ves la liga, volvés a la
// terminal y apretás Enter: el script guarda el storageState (cookies +
// localStorage) en scraper/.auth/storageState.json y además imprime su base64
// para que lo pegues en el secreto FOTMOB_SESSION (GitHub Actions / CI).
//
// Por qué así: Google bloquea el OAuth en navegadores controlados por
// automatización ("This browser or app may not be secure"). Usar el Chrome real
// (channel:'chrome'), un perfil persistente y desactivar --enable-automation /
// AutomationControlled hace que la ventana parezca un Chrome normal y el login
// funcione. El scraper headless después solo reusa las cookies, no vuelve a
// loguearse, así que ese bloqueo no lo afecta.
//
// El script NO maneja credenciales: solo vos te logueás en la ventana.
//
// Uso:
//   cd scraper && npm run seed          (o, desde la raíz: npm run seed)

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.join(__dirname, '.auth');
const PROFILE_DIR = path.join(AUTH_DIR, 'chrome-profile'); // perfil persistente (gitignored vía .auth/)
const AUTH_FILE = path.join(AUTH_DIR, 'storageState.json');

const SEED_URL = 'https://predict-auth.fotmob.com/es/772026?leagueId=196754';

function waitForEnter(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  console.log('→ Abriendo Chrome (real, modo no-automatizado)…');
  // launchPersistentContext + channel:'chrome' + sin flags de automatización:
  // la ventana parece un Chrome normal, así Google permite el login.
  let context;
  try {
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: false,
      channel: 'chrome',
      viewport: null,
      args: ['--disable-blink-features=AutomationControlled', '--start-maximized'],
      ignoreDefaultArgs: ['--enable-automation'],
    });
  } catch (e) {
    console.error(
      '\n❌ No pude abrir el Chrome del sistema (channel:"chrome").\n' +
      '   Asegurate de tener Google Chrome instalado. Detalle:\n   ' +
      (e && e.message ? e.message : e) + '\n'
    );
    process.exit(1);
  }

  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(SEED_URL, { waitUntil: 'domcontentloaded' });

    console.log(
      '\nLogueate con Google (bklocura@gmail.com) en la ventana que se abrió.\n' +
      'Cuando YA VEAS la liga "Torneo hamburguesa #2", volvé a la terminal y apretá Enter.\n'
    );
    await waitForEnter('Presioná Enter cuando estés logueado y veas la liga… ');

    fs.mkdirSync(AUTH_DIR, { recursive: true });
    await context.storageState({ path: AUTH_FILE });
    console.log(`\n✓ Sesión guardada en ${AUTH_FILE}`);

    const b64 = fs.readFileSync(AUTH_FILE).toString('base64');
    console.log(
      '\n── FOTMOB_SESSION (base64) ─────────────────────────────────────────'
    );
    console.log('Pegá esto como secreto FOTMOB_SESSION en tu CI:\n');
    console.log(b64);
    console.log(
      '────────────────────────────────────────────────────────────────────\n'
    );
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error('❌ Error en seed-session:', err && err.stack ? err.stack : err);
  process.exit(1);
});

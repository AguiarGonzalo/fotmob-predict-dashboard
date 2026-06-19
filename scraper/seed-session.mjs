// seed-session.mjs — Crea/renueva la sesión de FotMob Predict de forma MANUAL.
//
// Abre un Chromium VISIBLE (headed), te lleva a la liga, y vos te logueás con
// Google en esa ventana. Cuando ya ves la liga, volvés a la terminal y apretás
// Enter: el script guarda el storageState (cookies + localStorage) en
// scraper/.auth/storageState.json y además imprime su base64 para que lo pegues
// en el secreto FOTMOB_SESSION (GitHub Actions / CI).
//
// El script NO maneja credenciales: solo vos te logueás en la ventana.
//
// Vive dentro de scraper/ para que resuelva `playwright` desde scraper/node_modules.
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
  console.log('→ Abriendo Chromium (ventana visible)…');
  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(SEED_URL, { waitUntil: 'domcontentloaded' });

    console.log(
      '\nLogueate con Google y cuando veas la liga volve a la terminal y apreta Enter\n'
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

    await context.close();
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error('❌ Error en seed-session:', err && err.stack ? err.stack : err);
  process.exit(1);
});

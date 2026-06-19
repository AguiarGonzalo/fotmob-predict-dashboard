// compute.mjs — Parsea las predicciones crudas de FotMob Predict, valida la
// fórmula de puntaje contra los totales reales y emite data/snapshot.json.
//
// La lógica de parseo, validación y construcción vive en ./lib.mjs (compartida
// con el scraper). Acá solo viven los datos crudos de los 6 jugadores y el
// arnés de validación + escritura de archivos.
//
// Fórmula validada (contra kevin=38/4 y thomas=34/6, reproduce total y exactos):
//   resultado exacto = 3 · acertar ganador/empate con marcador distinto = 2 · errar = 0
//
// Los strings crudos vienen del extractor que corre en la página del perfil:
//   tokens de texto del bloque del perfil, unidos por '~'.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES, SCORING, parsePlayer, pointsFor, buildSnapshot } from './lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Datos crudos: un string por jugador (extraídos en vivo el 2026-06-19)
// ---------------------------------------------------------------------------
const RAW = {
  '2_100513976122918931166': "1~Posición~kevin~38~4~USA~2~Australia~0~Mexico~3~South Korea~0~2~Canada~2~Qatar~1~2~Switzerland~1~Bosnia and Herzegovina~1~0~Czechia~1~South Africa~1~3~Uzbekistan~1~Colombia~2~2~Ghana~1~Panama~1~0~England~1~Croatia~1~0~Portugal~3~DR Congo~0~0~Austria~1~Jordan~0~2~Argentina~3~Algeria~1~2~Iraq~0~Norway~2~2~France~3~Senegal~0~2~Iran~0~New Zealand~1~0~Saudi Arabia~0~Uruguay~1~0~Belgium~2~Egypt~1~0~Spain~5~Cape Verde~0~0~Sweden~2~Tunisia~1~2~Ivory Coast~1~Ecuador~0~3~Netherlands~2~Japan~1~0~Germany~8~Curacao~0~2~Australia~0~Turkiye~1~0~Haiti~0~Scotland~2~2~Brazil~1~Morocco~1~3~Qatar~0~Switzerland~3~0~USA~3~Paraguay~0~2~Canada~1~Bosnia and Herzegovina~1~3~South Korea~2~Czechia~0~2~Mexico~1~South Africa~0~2",
  '2_108825978723927201255': "2~Posición~thomas fridman~34~6~USA~2~Australia~1~Mexico~1~South Korea~1~0~Canada~2~Qatar~0~2~Switzerland~1~Bosnia and Herzegovina~1~0~Czechia~2~South Africa~0~0~Uzbekistan~1~Colombia~3~3~Ghana~2~Panama~0~2~England~1~Croatia~1~0~Portugal~3~DR Congo~1~0~Austria~2~Jordan~0~2~Argentina~2~Algeria~0~2~Iraq~0~Norway~3~2~France~3~Senegal~1~3~Iran~1~New Zealand~0~0~Saudi Arabia~0~Uruguay~2~0~Belgium~1~Egypt~1~3~Spain~5~Cape Verde~0~0~Sweden~2~Tunisia~1~2~Ivory Coast~0~Ecuador~1~0~Netherlands~2~Japan~1~0~Germany~5~Curacao~0~2~Australia~1~Turkiye~2~0~Haiti~0~Scotland~2~2~Brazil~1~Morocco~1~3~Qatar~0~Switzerland~3~0~USA~1~Paraguay~2~0~Canada~0~Bosnia and Herzegovina~1~0~South Korea~2~Czechia~1~3~Mexico~2~South Africa~0~3",
  '2_114073492760604569894': "3~Posición~Maayan Golan~32~2~USA~2~Australia~0~Mexico~1~South Korea~2~0~Canada~2~Qatar~0~2~Switzerland~1~Bosnia and Herzegovina~0~2~Czechia~1~South Africa~0~0~Uzbekistan~1~Colombia~2~2~Ghana~1~Panama~1~0~England~2~Croatia~1~2~Portugal~1~DR Congo~0~0~Austria~1~Jordan~0~2~Argentina~3~Algeria~0~3~Iraq~0~Norway~2~2~France~2~Senegal~0~2~Iran~1~New Zealand~1~2~Saudi Arabia~2~Uruguay~1~0~Belgium~2~Egypt~1~0~Spain~2~Cape Verde~0~0~Sweden~1~Tunisia~0~2~Ivory Coast~0~Ecuador~1~0~Netherlands~2~Japan~0~0~Germany~3~Curacao~0~2~Australia~1~Turkiye~0~2~Haiti~0~Scotland~1~3~Brazil~2~Morocco~0~0~Qatar~0~Switzerland~1~0~USA~2~Paraguay~1~2~Canada~2~Bosnia and Herzegovina~0~0~South Korea~2~Czechia~0~2~Mexico~South Africa",
  '2_110807909424767304523': "4~Posición~sapir vabshet~31~3~USA~1~Australia~1~Mexico~1~South Korea~0~3~Canada~2~Qatar~1~2~Switzerland~Bosnia and Herzegovina~Czechia~0~South Africa~0~2~Uzbekistan~0~Colombia~2~2~Ghana~1~Panama~1~0~England~0~Croatia~1~0~Portugal~2~DR Congo~1~0~Austria~2~Jordan~0~2~Argentina~2~Algeria~1~2~Iraq~0~Norway~3~2~France~3~Senegal~1~3~Iran~0~New Zealand~0~2~Saudi Arabia~1~Uruguay~3~0~Belgium~1~Egypt~0~0~Spain~2~Cape Verde~0~0~Sweden~2~Tunisia~1~2~Ivory Coast~0~Ecuador~1~0~Netherlands~1~Japan~1~2~Germany~3~Curacao~0~2~Australia~0~Turkiye~0~0~Haiti~0~Scotland~1~3~Brazil~2~Morocco~0~0~Qatar~0~Switzerland~2~0~USA~2~Paraguay~0~2~Canada~1~Bosnia and Herzegovina~0~0~South Korea~0~Czechia~0~0~Mexico~South Africa",
  '2_109384509403978234765': "5~Posición~Lorena Brofman~30~2~USA~2~Australia~1~Mexico~2~South Korea~1~2~Canada~1~Qatar~0~2~Switzerland~2~Bosnia and Herzegovina~1~2~Czechia~2~South Africa~1~0~Uzbekistan~0~Colombia~2~2~Ghana~1~Panama~0~3~England~2~Croatia~1~2~Portugal~2~DR Congo~0~0~Austria~1~Jordan~0~2~Argentina~3~Algeria~0~3~Iraq~0~Norway~1~2~France~3~Senegal~2~2~Iran~0~New Zealand~1~0~Saudi Arabia~1~Uruguay~2~0~Belgium~3~Egypt~1~0~Spain~3~Cape Verde~0~0~Sweden~2~Tunisia~0~2~Ivory Coast~0~Ecuador~2~0~Netherlands~2~Japan~1~0~Germany~2~Curacao~0~2~Australia~1~Turkiye~2~0~Haiti~1~Scotland~1~0~Brazil~3~Morocco~2~0~Qatar~1~Switzerland~2~0~USA~1~Paraguay~1~0~Canada~1~Bosnia and Herzegovina~0~0~South Korea~2~Czechia~0~2~Mexico~2~South Africa~1~2",
  '2_112563509372036390748': "6~Posición~Gonzalo Aguiar~29~1~USA~3~Australia~1~Mexico~2~South Korea~1~2~Canada~2~Qatar~1~2~Switzerland~1~Bosnia and Herzegovina~2~0~Czechia~2~South Africa~0~0~Uzbekistan~0~Colombia~2~2~Ghana~0~Panama~2~0~England~2~Croatia~1~2~Portugal~4~DR Congo~0~0~Austria~2~Jordan~0~2~Argentina~4~Algeria~1~2~Iraq~0~Norway~3~2~France~2~Senegal~0~2~Iran~2~New Zealand~0~0~Saudi Arabia~1~Uruguay~1~3~Belgium~2~Egypt~1~0~Spain~3~Cape Verde~0~0~Sweden~2~Tunisia~0~2~Ivory Coast~0~Ecuador~1~0~Netherlands~2~Japan~1~0~Germany~5~Curacao~0~2~Australia~1~Turkiye~2~0~Haiti~0~Scotland~2~2~Brazil~3~Morocco~0~0~Qatar~0~Switzerland~2~0~USA~1~Paraguay~1~0~Canada~3~Bosnia and Herzegovina~1~0~South Korea~2~Czechia~0~2~Mexico~1~South Africa~0~2",
};

// ---------------------------------------------------------------------------
// Validación: la fórmula reproduce totales y exactos (check por jugador)
// ---------------------------------------------------------------------------
const players = Object.entries(RAW).map(([id, str]) => parsePlayer(id, str));

let ok = true;
for (const { meta, preds } of players) {
  let sum = 0, exacts = 0, badgeSum = 0;
  preds.forEach((pr, i) => {
    const fx = FIXTURES[i];
    if (!fx.res) return; // partido sin terminar
    const pts = pointsFor(pr.ph, pr.pa, fx.res[0], fx.res[1]);
    sum += pts;
    if (pts === SCORING.exact) exacts++;
    if (pr.badge != null) {
      badgeSum += pr.badge;
      if (pr.badge !== pts) {
        console.warn(`  ⚠ ${meta.name} ${fx.h}-${fx.a}: badge ${pr.badge} ≠ fórmula ${pts}`);
      }
    }
  });
  const totOk = sum === meta.points;
  const exOk = exacts === meta.exacts;
  if (!totOk || !exOk) ok = false;
  console.log(
    `${totOk && exOk ? '✅' : '❌'} ${meta.name.padEnd(16)} ` +
    `fórmula=${sum} (real ${meta.points})  exactos=${exacts} (real ${meta.exacts})  badges=${badgeSum}`
  );
}
console.log(ok ? '\n✅ TODOS validan: la fórmula reproduce totales y exactos.\n' : '\n❌ Hay discrepancias.\n');

// ---------------------------------------------------------------------------
// Construir snapshot.json (vía lib) y escribir archivos
// ---------------------------------------------------------------------------
const snapshot = buildSnapshot(RAW, {
  updatedAt: process.env.SNAPSHOT_TS || '2026-06-19T22:10:00Z',
});

fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'data', 'snapshot.json'), JSON.stringify(snapshot, null, 2));
fs.mkdirSync(path.join(ROOT, 'data', 'raw'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'data', 'raw', 'predictions.json'), JSON.stringify(RAW, null, 2));
console.log(`📦 Escrito data/snapshot.json (${snapshot.matches.length} partidos, ${snapshot.players.length} jugadores, ${snapshot.race.length} fechas en la carrera)`);

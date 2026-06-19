# FotMob Predict Dashboard

Tablero de la quiniela de **FotMob Predict**: scrapea las predicciones de un
grupo de jugadores, calcula el puntaje con la fórmula oficial del juego y publica
un dashboard estático que se actualiza solo cada 3 horas.

---

## Qué es

FotMob tiene un juego de pronósticos (*Predict*) donde cada jugador carga el
marcador exacto de los partidos de un torneo. FotMob muestra un ranking, pero
no deja exportar nada ni ver la carrera puesto a puesto a lo largo del torneo.

Este proyecto resuelve eso:

- Un **scraper** entra a los perfiles de los jugadores y lee sus predicciones.
- Un **cálculo** aplica la fórmula de puntaje y arma un `snapshot.json`.
- Un **dashboard estático** (HTML/JS, sin backend) lee ese JSON y muestra el
  ranking, el head-to-head y la carrera a lo largo del torneo.

Todo corre gratis en **GitHub Actions** (el scraper) y **GitHub Pages** (el
dashboard). No hay servidor que mantener.

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│  GitHub Actions — cron cada 3 h (.github/workflows/scrape.yml)    │
│                                                                   │
│   Playwright + Chromium                                           │
│   usa la sesión guardada en el secreto FOTMOB_SESSION             │
│        │                                                          │
│        ▼                                                          │
│   scraper/src/scrape.mjs  ──►  data/snapshot.json                 │
│                                data/history.jsonl  (append-only)  │
│        │                                                          │
│        ▼  commit + push si cambiaron                              │
│   deploy web/ + data/  ──►  GitHub Pages                          │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
              Dashboard estático (web/) lee ./data/snapshot.json
```

Piezas del repo:

| Carpeta / archivo            | Qué hace                                                        |
| ---------------------------- | -------------------------------------------------------------- |
| `scraper/src/scrape.mjs`     | Scraper Playwright: trae la API (`/api/matches`, `/api/leagueDetails`) y las predicciones del DOM. |
| `scraper/seed-session.mjs`   | Login manual una vez → guarda la sesión y su base64.            |
| `build/lib.mjs`              | `buildSnapshot()`: arma el snapshot desde la API + predicciones y valida la fórmula. |
| `web/`                       | Dashboard estático (lo que se publica en Pages).               |
| `data/snapshot.json`         | Estado actual: ranking, partidos, carrera, head-to-head.       |
| `data/history.jsonl`         | Historial append-only (una línea por scrape).                  |
| `.github/workflows/scrape.yml` | El cron que scrapea cada 3 h.                                 |
| `.github/workflows/deploy.yml` | Publica el dashboard en Pages (en cada push y a mano).       |

---

## La fórmula de puntaje

Por cada partido **ya terminado**, cada jugador suma según qué tan cerca estuvo
del marcador real:

| Caso                                                                    | Puntos |
| ----------------------------------------------------------------------- | :----: |
| **Resultado exacto** — acertó el marcador completo (ej. predijo 2-1, salió 2-1) | **3** |
| **Resultado** — acertó ganador/empate pero con otro marcador (ej. predijo 2-0, salió 1-0) | **2** |
| **Error** — falló el resultado                                          | **0**  |

Los partidos que todavía no se jugaron no suman ni restan.

En código (`build/lib.mjs`):

```js
export const SCORING = { exact: 3, outcome: 2, miss: 0 };

export function pointsFor(ph, pa, ah, aa) {
  if (ph === ah && pa === aa) return SCORING.exact;             // marcador exacto → 3
  if (Math.sign(ph - pa) === Math.sign(ah - aa)) return SCORING.outcome; // mismo resultado → 2
  return SCORING.miss;                                          // error → 0
}
```

> La fórmula está **validada en cada corrida**: el scraper reproduce los totales y
> la cantidad de exactos que la API de FotMob muestra para cada jugador, y avisa con
> ⚠️ si alguno no cuadra (posible cambio en el reparto de puntos o en el DOM).

---

## Cómo ponerlo en marcha (paso a paso)

### (a) Crear el repo **privado** y subir esto

El repo **tiene que ser privado**: la sesión de FotMob vive en un secreto y, aunque
GitHub cifra los secretos, mantener el repo privado reduce la superficie de riesgo.

```bash
# desde /Users/gonzaloaguier/Documents/fotmob-predict-dashboard
git init
git add .
git commit -m "init: fotmob predict dashboard"
gh repo create fotmob-predict-dashboard --private --source=. --push
```

### (b) Sembrar la sesión local con `npm run seed`

El scraper necesita estar logueado en FotMob. Primero instalá sus dependencias
(una sola vez), después te logueás **una vez** con Google en tu máquina y el
comando exporta esa sesión a base64:

```bash
# 1) Instalar dependencias del scraper (Playwright + el navegador), una sola vez:
cd scraper && npm install && npx playwright install chromium && cd ..

# 2) Sembrar la sesión (desde la raíz del proyecto):
npm run seed
```

Se abre un navegador, entrás con tu cuenta de Google a FotMob, y cuando termina
imprime un **string base64** largo en la terminal. Eso es tu sesión.

### (c) Pegar la sesión en el secreto `FOTMOB_SESSION`

En GitHub: **Settings → Secrets and variables → Actions → New repository secret**

- **Name:** `FOTMOB_SESSION`
- **Secret:** pegá el base64 del paso (b)

### (d) Activar GitHub Pages

En GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

(El workflow ya hace el deploy con `actions/deploy-pages`; solo hay que decirle a
Pages que la fuente es Actions, no una rama.)

### (e) El cron corre solo cada 3 horas

A partir de ahí no tenés que hacer nada: el workflow `scrape` corre cada 3 horas,
scrapea, recalcula el `snapshot.json`, lo commitea si cambió y republica el
dashboard. Podés forzar una corrida cuando quieras desde **Actions → scrape →
Run workflow**.

### (f) Re-seed (~1 vez por mes)

Las sesiones de FotMob caducan cada tanto (más o menos una vez al mes). Cuando
pase, el scraper sale con **código 2 (SESSION_EXPIRED)** y el workflow te abre
automáticamente un **issue** titulado *"Re-seed de la sesión de FotMob necesario"*.

Cuando lo veas, repetí los pasos **(b)** y **(c)**: `npm run seed`, copiás el
nuevo base64, lo pegás en `FOTMOB_SESSION`, corrés el workflow a mano para
verificar y cerrás el issue.

---

## Ver el dashboard localmente

El dashboard es estático y lee `./data/snapshot.json` por fetch, así que necesita
servirse por HTTP (abrir el HTML con `file://` no le deja hacer el fetch).

Desde la raíz del proyecto:

```bash
# opción 1 (Node)
npm run serve        # o: npx serve .

# opción 2 (Python)
python3 -m http.server
```

Después abrí en el navegador la carpeta `web/`, por ejemplo:

- con `npx serve .` → http://localhost:3000/web/
- con `python3 -m http.server` → http://localhost:8000/web/

---

## Nota honesta de seguridad y uso

- **La sesión vive en un secreto del repo.** GitHub cifra los secretos y no los
  expone en logs, pero cualquiera con acceso de escritura al repo podría llegar a
  exfiltrarla vía un workflow modificado. Mantener el **repo privado** y no darle
  acceso a terceros es la mitigación principal. La sesión es solo de FotMob (no es
  tu cuenta de Google completa), pero igual tratala como una credencial.

- **Automatizar scraping no está oficialmente avalado por los Términos de Servicio
  de FotMob.** Este proyecto es de **uso personal** y corre a **baja frecuencia**
  (cada 3 h) justamente para no molestar a su infraestructura. No lo uses para
  redistribuir datos ni a escala. Si FotMob ofrece una API oficial, preferila.

---

## Comandos útiles

| Comando            | Qué hace                                                        |
| ------------------ | -------------------------------------------------------------- |
| `npm run scrape`   | Scrapea en vivo (usa la sesión local), regenera `snapshot.json` y valida la fórmula. |
| `npm run serve`    | Sirve el proyecto para ver el dashboard local (`/web/`).       |
| `npm run seed`     | Re-siembra la sesión de FotMob y exporta el base64 (paso b/f). |

# FotMob Predict — Scraper

Scraper headless con Playwright que reproduce en vivo la extracción de datos de
FotMob Predict. Descubre dinámicamente los jugadores de la liga, abre el perfil
de cada uno, extrae el bloque de predicciones y construye `../data/snapshot.json`
reusando la lógica compartida en `../build/lib.mjs`.

## Instalación

Desde `scraper/`:

```bash
npm i
npx playwright install chromium
```

> `npm i` instala la dependencia `playwright`. `npx playwright install chromium`
> baja el binario del navegador (necesario una sola vez por máquina/CI).

## Sesión (login manual, una vez)

El login es manual: vos te logueás con Google en una ventana visible y el script
guarda la sesión. No se manejan credenciales en el código.

```bash
npm run seed
```

Esto abre Chromium visible en la liga. Cuando ves la liga, volvés a la terminal
y apretás Enter. Se guarda `scraper/.auth/storageState.json` y se imprime su
**base64**, que podés pegar como secreto `FOTMOB_SESSION` en tu CI.

## Correr el scrape

```bash
npm run scrape
```

Orden de resolución de sesión:

1. `process.env.FOTMOB_SESSION` (base64 del `storageState.json`) si está definido.
2. `scraper/.auth/storageState.json` en disco.
3. Si no hay ninguna → error: `falta sesion: corre npm run seed`.

Salidas:

- `../data/snapshot.json` — snapshot completo (sobrescrito).
- `../data/history.jsonl` — una línea por corrida (append).

Códigos de salida:

- `0` ok.
- `1` error genérico (sesión faltante, parseo, etc.).
- `2` `SESSION_EXPIRED` — la sesión caducó; re-seedeá y actualizá `FOTMOB_SESSION`.
```

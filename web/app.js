/* ============================================================
   Torneo hamburguesa #2 — Dashboard FotMob Predict
   Vanilla JS. Carga ../data/snapshot.json y renderiza 4 vistas.
   Todo en español (argentino). Resalta SIEMPRE al jugador objetivo.
   ============================================================ */

"use strict";

/* Estado global del snapshot (se llena tras el fetch). */
let DATA = null;

/* ---------- Utilidades ---------- */

/** Escapa texto para insertarlo seguro como HTML. */
function esc(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Nombre del equipo en español, con fallback al original. */
function teamEs(en) {
  return (DATA.teamsEs && DATA.teamsEs[en]) || en;
}

/** ¿Es este nombre el del jugador objetivo (Gonzalo)? */
function isTarget(name) {
  return name === DATA.target;
}

/** Formatea una fecha ISO (updatedAt) a algo legible en es-AR. */
function fmtUpdated(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return new Intl.DateTimeFormat("es-AR", {
    day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit",
  }).format(d);
}

/** Formatea "YYYY-MM-DD" a un encabezado de fecha legible. */
function fmtDateHeading(ymd) {
  // Se construye con hora fija para evitar corrimientos de zona horaria.
  const d = new Date(ymd + "T12:00:00");
  if (isNaN(d)) return ymd;
  const s = new Intl.DateTimeFormat("es-AR", {
    weekday: "long", day: "numeric", month: "long",
  }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1); // capitaliza el día
}

/** Devuelve "ph-pa" o "—" si el jugador no predijo. */
function fmtGuess(p) {
  if (!p || p.ph == null || p.pa == null) return null;
  return `${p.ph}-${p.pa}`;
}

/** Clase CSS según puntos obtenidos (dorado=3, teal=2, gris=0, pendiente=null). */
function ptsClass(pts) {
  if (pts == null) return "pending";
  if (pts === 3) return "p3";
  if (pts === 2) return "p2";
  return "p0";
}

/* ============================================================
   VISTA 1 — TABLA / CLASIFICACIÓN
   ============================================================ */
function renderTabla() {
  const players = DATA.players; // ya viene ordenado por rank
  const leader = players[0] ? players[0].points : 1;
  const maxPts = Math.max(leader, 1); // evita dividir por cero

  const rows = players.map((p) => {
    const pct = Math.round((p.points / maxPts) * 100);
    const target = p.isTarget;
    const tag = target
      ? '<span class="s-tag">vos</span>'
      : "";
    // Insignia de exactos solo si tiene al menos uno.
    const exactBadge = p.exacts > 0
      ? `<span class="badge-exact" title="Marcadores exactos (3 pts)">★ ${p.exacts} exacto${p.exacts === 1 ? "" : "s"}</span>`
      : `<span class="s-meta-dim">sin exactos</span>`;

    return `
      <div class="srow rank-${p.rank} ${target ? "is-target" : ""}" style="--pct:${pct}%">
        <div class="bar"></div>
        <div class="s-rank">${p.rank}</div>
        <div class="s-main">
          <div class="s-name">${esc(p.name)} ${tag}</div>
          <div class="s-meta">
            ${exactBadge}
            <span class="s-avg" title="Promedio de puntos por partido">${p.avg.toFixed(2)} pts/part.</span>
          </div>
        </div>
        <div class="s-points">
          <span class="pts">${p.points}</span>
          <span class="lbl">puntos</span>
        </div>
      </div>`;
  }).join("");

  document.getElementById("view-tabla").innerHTML = `
    <div class="section-head">
      <h2>Clasificación</h2>
      <span class="hint">${DATA.finishedCount} partidos jugados · ${players.length} jugadores</span>
    </div>
    <div class="standings">${rows}</div>`;
}

/* ============================================================
   VISTA 2 — POR PARTIDO
   ============================================================ */
function renderPartidos() {
  // Orden por fecha desc; dentro de la misma fecha, los terminados según id.
  // Los live/upcoming quedan arriba de su fecha (id menor = más reciente).
  const order = { live: 0, upcoming: 1, finished: 2 };
  const matches = [...DATA.matches].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1; // fecha desc
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return a.id - b.id;
  });

  // Orden de jugadores dentro de cada partido = orden de la tabla (rank).
  const playerOrder = DATA.players.map((p) => p.name);

  let html = "";
  let lastDate = null;

  for (const m of matches) {
    if (m.date !== lastDate) {
      html += `<div class="match-group-date">${esc(fmtDateHeading(m.date))}</div>`;
      lastDate = m.date;
    }

    // Marcador / estado.
    let scoreOrPill;
    if (m.status === "finished" && m.result) {
      scoreOrPill = `<span class="score">${m.result.h} – ${m.result.a}</span>`;
    } else if (m.status === "live") {
      scoreOrPill = `<span class="status-pill live">En vivo</span>`;
    } else {
      scoreOrPill = `<span class="status-pill upcoming">Por jugar</span>`;
    }

    // Grilla de predicciones de cada jugador.
    const preds = playerOrder.map((name) => {
      const p = m.predictions[name];
      const guess = fmtGuess(p);
      const guessHtml = guess
        ? `<span class="pred-guess">${guess}</span>`
        : `<span class="pred-guess empty">—</span>`;
      const pts = p ? p.pts : null;
      const ptsHtml = pts == null
        ? `<span class="pts-badge pending">·</span>`
        : `<span class="pts-badge ${ptsClass(pts)}">+${pts}</span>`;
      return `
        <div class="pred ${isTarget(name) ? "is-target" : ""}">
          <div class="pred-name">${esc(name)}</div>
          <div class="pred-row">${guessHtml}${ptsHtml}</div>
        </div>`;
    }).join("");

    html += `
      <article class="match">
        <div class="match-top">
          <div class="match-teams">
            <span class="team home">${esc(teamEs(m.home))}</span>
            ${scoreOrPill}
            <span class="team away">${esc(teamEs(m.away))}</span>
          </div>
        </div>
        <div class="preds">${preds}</div>
      </article>`;
  }

  document.getElementById("view-partidos").innerHTML = `
    <div class="section-head">
      <h2>Partido por partido</h2>
      <span class="hint">dorado = exacto · teal = resultado</span>
    </div>
    ${html}`;
}

/* ============================================================
   VISTA 3 — HEAD-TO-HEAD
   ============================================================ */
function renderH2H() {
  const cards = DATA.headToHead.map((h) => {
    const diff = h.diff;
    const diffClass = diff > 0 ? "win" : diff < 0 ? "lose" : "tie";
    const diffLabel = diff > 0 ? `+${diff}` : `${diff}`;
    const diffWord = diff > 0 ? "Gonzalo arriba" : diff < 0 ? "Gonzalo abajo" : "Empate";

    // Conteo de partidos donde sacó / cedió / empató puntos.
    let won = 0, lost = 0, tied = 0;
    for (const bm of h.byMatch) {
      if (bm.targetPts > bm.rivalPts) won++;
      else if (bm.targetPts < bm.rivalPts) lost++;
      else tied++;
    }

    // Filas del desglose: solo partidos donde hubo diferencia (más útil),
    // ordenados por magnitud de la diferencia.
    const diffRows = h.byMatch
      .map((bm) => ({ ...bm, d: bm.targetPts - bm.rivalPts }))
      .filter((bm) => bm.d !== 0)
      .sort((a, b) => Math.abs(b.d) - Math.abs(a.d) || b.id - a.id)
      .map((bm) => {
        const cls = bm.d > 0 ? "up" : "down";
        const sign = bm.d > 0 ? `+${bm.d}` : `${bm.d}`;
        return `
          <div class="h2h-mrow">
            <span class="fix">${esc(teamEs(bm.home))} – ${esc(teamEs(bm.away))}</span>
            <span class="raw">${bm.targetPts} vs ${bm.rivalPts}</span>
            <span class="delta ${cls}">${sign}</span>
          </div>`;
      }).join("");

    return `
      <div class="h2h-card">
        <div class="h2h-head">
          <div class="h2h-side target">
            <span class="who">Gonzalo</span>
            <span class="sc">${h.targetPts}</span>
          </div>
          <div class="h2h-mid">
            <span class="h2h-vs">VS</span>
            <span class="h2h-diff ${diffClass}" title="${diffWord}">${diffLabel}</span>
          </div>
          <div class="h2h-side">
            <span class="who">${esc(h.name)}</span>
            <span class="sc">${h.rivalPts}</span>
          </div>
        </div>
        <div class="h2h-summary">
          <span class="pill w">Le ganó en <b>${won}</b></span>
          <span class="pill l">Le cedió en <b>${lost}</b></span>
          <span class="pill">Empató en <b>${tied}</b></span>
        </div>
        <details class="h2h-details">
          <summary>Ver dónde se sacó la diferencia (${diffRows ? won + lost : 0} partidos)</summary>
          <div class="h2h-matches">
            ${diffRows || '<div class="h2h-mrow"><span class="fix">Sin diferencias: empataron en todos los partidos.</span></div>'}
          </div>
        </details>
      </div>`;
  }).join("");

  document.getElementById("view-h2h").innerHTML = `
    <div class="section-head">
      <h2>Head-to-head</h2>
      <span class="hint">Gonzalo vs cada rival</span>
    </div>
    <div class="h2h-intro">
      Comparación directa de <strong>Gonzalo</strong> contra cada rival, partido a partido.
      El número grande es el puntaje acumulado de cada uno; el chip del medio es la diferencia
      (<span class="teal">verde</span> si Gonzalo está arriba, <span style="color:var(--red)">rojo</span> si está abajo).
    </div>
    ${cards}`;
}

/* ============================================================
   VISTA 4 — CARRERA (bump chart con ECharts)
   ============================================================ */
let raceChart = null;

/** Paleta estable por jugador (orden = ranking de la tabla). */
function racePalette() {
  // Colores diferenciables; Gonzalo usa el teal de marca.
  const colors = ["#f5c518", "#a78bfa", "#60a5fa", "#fb923c", "#f472b6", "#34d399"];
  const map = {};
  DATA.players.forEach((p, i) => {
    map[p.name] = p.isTarget ? "#2dd4bf" : colors[i % colors.length];
  });
  return map;
}

function renderCarrera() {
  const race = DATA.race;
  const dates = race.map((r) => fmtDateHeadingShort(r.date));
  const names = DATA.players.map((p) => p.name);
  const colorOf = racePalette();
  const nPlayers = names.length;

  // Construye el contenedor del gráfico (la sección arranca vacía en el HTML).
  const view = document.getElementById("view-carrera");
  if (!view.querySelector("#raceChart")) {
    view.innerHTML = `
      <div class="section-head">
        <h2>Carrera por el título</h2>
        <span class="hint">posición fecha por fecha</span>
      </div>
      <div class="race-wrap">
        <div id="raceChart" role="img" aria-label="Evolución de posiciones por fecha"></div>
        <p class="race-note">
          Eje vertical = puesto (1° arriba). La línea más gruesa en
          <span class="teal">teal</span> es la de Gonzalo. Pasá el cursor sobre una fecha
          para ver el puntaje acumulado de cada jugador.
        </p>
      </div>`;
  }

  // Para cada jugador: serie de posiciones y de acumulado (para el tooltip).
  const cumByDate = {}; // name -> [cum por fecha]
  names.forEach((n) => (cumByDate[n] = []));

  const series = names.map((name) => {
    const posData = race.map((snap) => {
      const entry = snap.ranking.find((e) => e.name === name);
      cumByDate[name].push(entry ? entry.cum : null);
      return entry ? entry.pos : null;
    });

    const target = isTarget(name);
    return {
      name,
      type: "line",
      data: posData,
      symbol: "circle",
      symbolSize: target ? 11 : 8,
      lineStyle: {
        width: target ? 5 : 2.5,
        color: colorOf[name],
        shadowBlur: target ? 10 : 0,
        shadowColor: target ? "rgba(45,212,191,0.6)" : "transparent",
      },
      itemStyle: { color: colorOf[name], borderColor: "#0b0b0f", borderWidth: 2 },
      label: {
        // Etiqueta con el nombre solo en el extremo derecho (última fecha).
        show: true,
        position: "right",
        formatter: (pt) =>
          pt.dataIndex === dates.length - 1 ? abbrev(name) : "",
        color: colorOf[name],
        fontWeight: target ? 800 : 600,
        fontSize: 11,
      },
      emphasis: { focus: "series", lineStyle: { width: target ? 6 : 4 } },
      z: target ? 10 : 1,
      connectNulls: true,
    };
  });

  const option = {
    backgroundColor: "transparent",
    color: names.map((n) => colorOf[n]),
    grid: { left: 8, right: 78, top: 44, bottom: 28, containLabel: true },
    tooltip: {
      trigger: "axis",
      backgroundColor: "#1c1c26",
      borderColor: "#2a2a37",
      textStyle: { color: "#f1f1f5", fontSize: 12 },
      formatter: (params) => {
        const idx = params[0].dataIndex;
        // Ordena por posición (mejor arriba) en esa fecha.
        const sorted = [...params]
          .filter((p) => p.data != null)
          .sort((a, b) => a.data - b.data);
        let out = `<b>${dates[idx]}</b><br/>`;
        for (const p of sorted) {
          const cum = cumByDate[p.seriesName][idx];
          const dot = `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${p.color};margin-right:6px"></span>`;
          const me = isTarget(p.seriesName) ? "font-weight:800;color:#2dd4bf" : "";
          out += `${dot}<span style="${me}">${p.data}° ${esc(p.seriesName)}</span> · <b>${cum}</b> pts<br/>`;
        }
        return out;
      },
    },
    legend: {
      data: names.map((n) => ({
        name: n,
        textStyle: { color: isTarget(n) ? "#2dd4bf" : "#9a9aae", fontWeight: isTarget(n) ? 800 : 500 },
      })),
      top: 6,
      type: "scroll",
      icon: "roundRect",
      itemWidth: 16,
      itemHeight: 4,
      textStyle: { color: "#9a9aae" },
    },
    xAxis: {
      type: "category",
      data: dates,
      boundaryGap: false,
      axisLine: { lineStyle: { color: "#2a2a37" } },
      axisLabel: { color: "#9a9aae", fontSize: 11 },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      inverse: true,            // pos 1 arriba
      min: 1,
      max: nPlayers,
      interval: 1,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: "rgba(42,42,55,0.6)" } },
      axisLabel: { color: "#9a9aae", formatter: (v) => `${v}°` },
    },
    series,
  };

  const el = document.getElementById("raceChart");
  if (!raceChart) raceChart = echarts.init(el, null, { renderer: "canvas" });
  raceChart.setOption(option);
  raceChart.resize();
}

/** Fecha corta "dd/mm" para el eje X. */
function fmtDateHeadingShort(ymd) {
  const [, m, d] = ymd.split("-");
  return `${d}/${m}`;
}

/** Abrevia el nombre para la etiqueta del extremo del gráfico. */
function abbrev(name) {
  const first = name.trim().split(/\s+/)[0];
  return first.length > 10 ? first.slice(0, 9) + "…" : first;
}

/* ============================================================
   NAVEGACIÓN POR TABS
   ============================================================ */
function setupTabs() {
  const tabs = document.querySelectorAll(".tab");
  const views = {
    tabla: document.getElementById("view-tabla"),
    partidos: document.getElementById("view-partidos"),
    h2h: document.getElementById("view-h2h"),
    carrera: document.getElementById("view-carrera"),
  };

  let carreraRendered = false;

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const view = tab.dataset.view;

      tabs.forEach((t) => {
        const active = t === tab;
        t.classList.toggle("is-active", active);
        t.setAttribute("aria-selected", active ? "true" : "false");
      });

      Object.entries(views).forEach(([key, el]) => {
        el.hidden = key !== view;
      });

      // El bump chart se renderiza la primera vez que se abre su pestaña
      // (ECharts necesita que el contenedor sea visible para medir bien).
      if (view === "carrera") {
        if (!carreraRendered) {
          renderCarrera();
          carreraRendered = true;
        } else if (raceChart) {
          raceChart.resize();
        }
      }
    });
  });

  // Reajusta el gráfico al cambiar el tamaño de la ventana.
  window.addEventListener("resize", () => {
    if (raceChart) raceChart.resize();
  });
}

/* ============================================================
   BOOTSTRAP — carga de datos y render inicial
   ============================================================ */
function fillHeader() {
  document.getElementById("leagueName").textContent = DATA.league.name;
  document.getElementById("leagueCode").textContent = DATA.league.code;
  document.getElementById("updatedAt").textContent =
    "actualizado " + fmtUpdated(DATA.updatedAt);
  document.title = `${DATA.league.name} — FotMob Predict`;
}

function showState(msg, isError) {
  const el = document.getElementById("state");
  el.hidden = false;
  el.textContent = msg;
  el.classList.toggle("error", !!isError);
  document.querySelectorAll(".view").forEach((v) => (v.hidden = true));
}

async function init() {
  try {
    const res = await fetch("../data/snapshot.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DATA = await res.json();

    fillHeader();
    renderTabla();
    renderPartidos();
    renderH2H();
    // Carrera se renderiza al abrir su pestaña (ver setupTabs).
    setupTabs();
  } catch (err) {
    console.error("No se pudo cargar el snapshot:", err);
    showState(
      "No se pudieron cargar los datos (../data/snapshot.json). " +
      "Serví el dashboard desde un servidor web (no abriendo el archivo directo) para que el fetch funcione.",
      true
    );
  }
}

document.addEventListener("DOMContentLoaded", init);

// extract.mjs — La función de página que corre DENTRO del navegador (page.evaluate)
// sobre el bloque del perfil ya abierto, y devuelve los nodos de texto unidos por '~'.
//
// Se exporta como STRING porque Playwright la serializa para inyectarla en la
// página (no puede ver el scope del módulo). El string es el cuerpo exacto que
// ya probamos a mano en la consola del navegador.
//
// Cómo funciona:
//   1. Busca el nodo hoja cuyo texto es exactamente "Posición" (con tilde sobre
//      la segunda 'o', tal como lo renderiza la página en español). Ese es el
//      header de la tabla de predicciones del perfil.
//   2. Sube por el DOM hasta el ancestro que ya contiene el primer y el último
//      partido del torneo (Australia / Qatar aparecen en los fixtures), o sea el
//      contenedor completo del perfil.
//   3. Recorre ese bloque en orden DOM y junta todos los nodos de texto no
//      vacíos con '~'. El resultado es el rawString que consume parsePlayer/
//      buildSnapshot en ../../build/lib.mjs.
//
// IMPORTANTE: el texto buscado es la palabra "Posición" con tilde. Si FotMob
// cambia el idioma o el copy, ajustar este literal.

export const EXTRACTOR_FN = `() => {
  const all = [...document.querySelectorAll('*')];
  const posEl = all.find(e => e.children.length === 0 && e.textContent.trim() === 'Posición');
  if (!posEl) return null;
  let block = posEl;
  while (block && !/Australia|Qatar/.test(block.textContent)) block = block.parentElement;
  const tokens = [];
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) {
        const t = c.textContent.trim();
        if (t) tokens.push(t);
      } else if (c.nodeType === 1) {
        walk(c);
      }
    }
  };
  walk(block);
  return tokens.join('~');
}`;

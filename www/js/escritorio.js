/* CampControl en el ordenador: activa el diseño de escritorio (css/escritorio.css) en pantallas grandes.
   Dentro de la APK no hace nada. */
(() => {
  if (nativo()) return;
  const grande = matchMedia('(min-width: 1100px)');
  const esPC = () => document.body.classList.contains('pc');

  /* ---------- Menú lateral: marca, accesos de la finca y atajos ---------- */
  const nav = $('nav');
  nav.insertAdjacentHTML('afterbegin', '<div class="pc-brand"><span class="dot"></span>CampControl</div>');
  const ICO = {
    mEquipo: '<path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c.5-3.5 3-5.5 6-5.5s5.5 2 6 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.8 3 2.6 3.3 5.2"/>',
    mHist: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    mInforme: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/>',
    mExport: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    mImport: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
    mCuenta: '<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>'
  };
  const NOM = { mEquipo: 'Equipo', mHist: 'Historial', mInforme: 'Informes', mExport: 'Exportar copia', mImport: 'Importar copia', mCuenta: 'Sincronización' };
  nav.insertAdjacentHTML('beforeend', '<div class="pc-sec">Finca</div>');
  const enlaces = Object.keys(ICO).map(id => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pc-link'; b.dataset.m = id;
    b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICO[id]}</svg>${NOM[id]}`;
    b.onclick = e => { e.stopPropagation(); $('#' + id).click(); };
    nav.appendChild(b); return b;
  });
  const copiarOcultos = () => enlaces.forEach(b => { b.hidden = $('#' + b.dataset.m).hidden; });
  new MutationObserver(copiarOcultos).observe($('#menu'), { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  copiarOcultos();
  nav.insertAdjacentHTML('beforeend', `<div class="pc-pie"><span><kbd>/</kbd>Buscar incidencia</span><span><kbd>N</kbd>Nueva incidencia</span><span><kbd>Esc</kbd>Cerrar ventana</span></div>`);

  /* ---------- Resumen encima de la lista ---------- */
  const stats = document.createElement('div'); stats.className = 'pc-stats';
  $('#listView').prepend(stats);
  function pintarResumen() {
    const t = vivos('inc');
    const n = { todas: t.length, pendiente: t.filter(i => i.estado === 'pendiente').length, revisar: t.filter(paraRevisar).length, resuelta: t.filter(i => i.estado === 'resuelta').length };
    const caja = (k, txt, cls = '') => `<button type="button" class="${cls}" data-v="${k}" aria-pressed="${filt.estado === k}"><b>${n[k]}</b><span>${txt}</span></button>`;
    stats.innerHTML = caja('todas', 'Total') + caja('pendiente', 'Pendientes') + caja('revisar', 'Para revisar', 'rv') + caja('resuelta', 'Resueltas', 'ok');
  }
  stats.addEventListener('click', e => { const b = e.target.closest('button'); if (b) setEstadoFiltro(b.dataset.v); });

  /* ---------- Lista y mapa a la vez ---------- */
  const vistaMovil = vista;
  vista = v => {
    if (esPC() && v === 'lista') v = 'mapa';
    vistaMovil(v);
    const junto = esPC() && v === 'mapa';
    document.body.classList.toggle('split', junto);
    if (junto) { $('#listView').hidden = false; renderInc(); }
    setTimeout(() => map.invalidateSize(), 60);
  };
  const renderIncMovil = renderInc;
  renderInc = () => { renderIncMovil(); if (esPC()) { pintarResumen(); marcarSel(); } };

  /* Tarjeta elegida resaltada mientras su punto está abierto en el mapa */
  let selId = null;
  const irAMovil = irA;
  irA = it => { selId = it.id; irAMovil(it); setTimeout(marcarSel, 0); };
  function marcarSel() {
    const orden = [...$$('#cards .card')];
    orden.forEach(c => c.classList.toggle('sel', !!selId && c.dataset.id === selId));
  }
  map.on('popupclose', () => { selId = null; marcarSel(); });
  // Las tarjetas no llevan id: se lo ponemos al crearlas
  new MutationObserver(() => {
    if (!esPC()) return;
    const v = [...$$('#cards .card')];
    const ids = visiblesOrdenados();
    v.forEach((c, i) => { if (ids[i]) c.dataset.id = ids[i]; });
    marcarSel();
  }).observe($('#cards'), { childList: true });
  function visiblesOrdenados() {
    const orden = filt.estado === 'revisar'
      ? (a, b) => a.revisar.localeCompare(b.revisar)
      : (a, b) => (b.fecha || '').localeCompare(a.fecha || '') || (b.creado || 0) - (a.creado || 0);
    return [...visibles()].sort(orden).map(i => i.id);
  }

  /* ---------- Pantalla de entrada ---------- */
  $('#bvSub').insertAdjacentHTML('afterend', `<ul class="pc-ventajas">
    <li><span><b>Mapa y lista a la vez</b>Todas las incidencias de la finca a un lado y su sitio exacto en el mapa al otro.</span></li>
    <li><span><b>Fotos y vídeos en grande</b>Revisa con calma lo que tu equipo ha apuntado en el campo.</span></li>
    <li><span><b>Informes y copias</b>Saca el informe en Excel o PDF y guarda copias de seguridad desde el ordenador.</span></li>
  </ul>`);

  /* ---------- Atajos de teclado ---------- */
  document.addEventListener('keydown', e => {
    if (!esPC() || e.ctrlKey || e.metaKey || e.altKey) return;
    const escribiendo = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    const abierto = $$('.sheet').some(s => !s.hidden) || !$('#bienv').hidden || !$('#viewer').hidden;
    if (escribiendo || abierto) return;
    if (e.key === '/') { e.preventDefault(); vista('mapa'); $('#q').focus(); }
    else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); $('#btnNew').click(); }
  });

  /* Nueva incidencia: en el ordenador abre la ficha sin lanzar la cámara; las fotos se añaden desde ella */
  const nuevaMovil = $('#btnNew').onclick;
  const nuevaPC = () => { vista('mapa'); abrirForm(null); destinoMedia = { arr: ed.fotos, pintar: () => pintarMedia($('#photos'), ed.fotos) }; };

  /* En la entrada, "solo en este móvil" pasa a "solo en este ordenador" */
  const bvLocal = $('#bvLocal');
  const textoLocal = () => { if (esPC() && /móvil/.test(bvLocal.textContent)) bvLocal.textContent = bvLocal.textContent.replace('móvil', 'ordenador'); };
  new MutationObserver(textoLocal).observe(bvLocal, { childList: true, characterData: true, subtree: true });

  /* ---------- Encender o apagar según el ancho ---------- */
  const lblNueva = $('#btnNew span'), txtMovil = lblNueva.textContent;
  function aplicar() {
    const on = grande.matches;
    document.body.classList.toggle('pc', on);
    lblNueva.textContent = on ? 'Nueva incidencia' : txtMovil;
    $('#btnNew').onclick = on ? nuevaPC : nuevaMovil;
    if (on) textoLocal(); else bvLocal.textContent = bvLocal.textContent.replace('ordenador', 'móvil');
    if (!on) { document.body.classList.remove('split'); vistaMovil(vistaActual); }
    else vista(vistaActual === 'lista' ? 'mapa' : vistaActual);
  }
  grande.addEventListener('change', aplicar);
  aplicar();
})();

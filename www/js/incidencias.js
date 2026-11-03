/* Incidencias: mapa, lista, ficha, seguimiento y recordatorios */
const TIPOS = {
  plaga: { n: 'Plaga', c: '#e8590c' },
  enfermedad: { n: 'Enfermedad', c: '#c2255c' },
  riego: { n: 'Riego / goteo', c: '#1c7ed6' },
  poda: { n: 'Poda', c: '#2f9e44' },
  abonado: { n: 'Abonado / carencia', c: '#a07400' },
  rotura: { n: 'Rotura / daño', c: '#7048e8' },
  replantar: { n: 'Marra / replantar', c: '#0c8599' },
  otro: { n: 'Otro', c: '#495057' }
};
const tipoDe = it => TIPOS[it.tipo] || TIPOS.otro;
const nombreParcela = id => porId('parcelas', id)?.nombre || '';
const paraRevisar = it => it.estado === 'pendiente' && !!it.revisar && it.revisar <= today();
const ubicTxt = it => [nombreParcela(it.parcela), it.fila && `Fila ${it.fila}`, it.arbol && `Árbol ${it.arbol}`].filter(Boolean).join(' · ');
const todaMedia = it => [...(it.fotos || []), ...(it.seguimiento || []).flatMap(s => s.fotos || [])];
const ultimaNota = it => [...(it.seguimiento || [])].sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '')).pop() || null;
function badgeRevisar(it) {
  if (it.estado !== 'pendiente' || !it.revisar) return '';
  const d = diasHasta(it.revisar);
  if (d < 0) return `<span class="badge danger">${ICON_BELL}Revisión atrasada (${fmtCorta(it.revisar)})</span>`;
  if (d === 0) return `<span class="badge danger">${ICON_BELL}Revisar hoy</span>`;
  return `<span class="badge warn">${ICON_BELL}Revisar ${cuandoTxt(it.revisar)}</span>`;
}

/* ---------- Filtros ---------- */
const filt = { q: '', tipos: new Set(), estado: 'todas', parcela: '' };
function visibles() {
  const q = filt.q.trim().toLowerCase();
  return vivos('inc').filter(it =>
    (!q || [it.titulo, it.desc, ...(it.seguimiento || []).map(s => s.texto)].join(' ').toLowerCase().includes(q)) &&
    (!filt.tipos.size || filt.tipos.has(it.tipo)) &&
    (!filt.parcela || (filt.parcela === '-' ? !porId('parcelas', it.parcela) : it.parcela === filt.parcela)) &&
    (filt.estado === 'todas' || (filt.estado === 'revisar' ? paraRevisar(it) : it.estado === filt.estado)));
}
function buildFiltros() {
  const row = $('#tipoChips');
  Object.entries(TIPOS).forEach(([k, t]) => {
    const b = document.createElement('button'); b.className = 'f-chip'; b.style.setProperty('--c', t.c);
    b.setAttribute('aria-pressed', 'false'); b.innerHTML = `<i></i>${t.n}`;
    b.onclick = () => { filt.tipos.has(k) ? filt.tipos.delete(k) : filt.tipos.add(k); b.setAttribute('aria-pressed', filt.tipos.has(k)); renderInc(); };
    row.appendChild(b);
    $('#fTipo').insertAdjacentHTML('beforeend', `<option value="${k}">${t.n}</option>`);
  });
  $('#estadoSeg').addEventListener('click', e => { const v = e.target.dataset.v; if (v) setEstadoFiltro(v); });
  $('#q').addEventListener('input', e => { filt.q = e.target.value; renderInc(); });
  $('#fParcFilt').onchange = e => { filt.parcela = e.target.value; renderInc(); };
}
function setEstadoFiltro(v) {
  filt.estado = v;
  $$('#estadoSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v));
  renderInc();
}
function opcionesParcela(sel, { todas, ninguna, valor }) {
  const ps = vivos('parcelas').sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  sel.innerHTML = (todas ? `<option value="">${todas}</option>` : '') + (ninguna ? `<option value="${todas ? '-' : ''}">${ninguna}</option>` : '') +
    ps.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('');
  sel.value = valor ?? '';
  if (sel.value !== (valor ?? '')) sel.value = '';
}

/* ---------- Mapa ---------- */
const pinIcon = it => L.divIcon({
  className: '', iconSize: [30, 30], iconAnchor: [4, 30], popupAnchor: [11, -28],
  html: `<span class="pinw"><span class="pin ${it.estado === 'resuelta' ? 'done' : ''}" style="--c:${tipoDe(it).c}"></span>${paraRevisar(it) ? '<b class="due"></b>' : ''}</span>`
});

function popupEl(it) {
  const t = tipoDe(it), media = todaMedia(it), nota = ultimaNota(it), ub = ubicTxt(it), nn = (it.seguimiento || []).length;
  const el = document.createElement('div'); el.className = 'pop';
  el.innerHTML = `${media.length ? `<div class="gal"><div class="track">${media.map((m, i) => `<button class="m" data-i="${i}" aria-label="Ver ${isVid(m) ? 'vídeo' : 'foto'} ${i + 1}">${mediaHtml(m)}</button>`).join('')}</div>
      ${media.length > 1 ? `<button class="nav prev" aria-label="Anterior">‹</button><button class="nav next" aria-label="Siguiente">›</button><span class="n">1 / ${media.length}</span>` : ''}</div>` : ''}
    <h3>${esc(it.titulo)}</h3>
    <div class="meta"><span class="chip" style="--c:${t.c}"><i></i>${t.n}</span><span>${fmtDate(it.fecha)}</span><span class="state ${it.estado}">${it.estado}</span></div>
    ${ub ? `<div class="ubic">${esc(ub)}</div>` : ''}
    ${badgeRevisar(it)}
    ${it.desc ? `<p>${esc(it.desc)}</p>` : ''}
    ${nota ? `<div class="last"><span><b>${fmtCorta(nota.fecha)}${nn > 1 ? ` (${nn} notas)` : ''}:</b> ${esc(nota.texto || 'solo fotos')}</span></div>` : ''}
    <div class="row"><button class="btn sm" data-a="edit">Editar</button>
    <button class="btn sm" data-a="nota">+ Nota</button>
    <button class="btn sm" data-a="toggle">${it.estado === 'resuelta' ? 'Reabrir' : 'Resuelta'}</button></div>`;
  const track = $('.track', el);
  if (track) {
    const idx = () => Math.round(track.scrollLeft / track.clientWidth);
    const flechas = () => {
      const i = idx(), pv = $('.prev', el), nx = $('.next', el), n = $('.n', el);
      if (n) n.textContent = `${i + 1} / ${media.length}`; if (pv) pv.hidden = i === 0; if (nx) nx.hidden = i === media.length - 1;
    };
    track.addEventListener('scroll', flechas, { passive: true }); setTimeout(flechas, 0);
    $('.prev', el)?.addEventListener('click', ev => { ev.stopPropagation(); track.scrollTo({ left: Math.max(0, idx() - 1) * track.clientWidth, behavior: 'smooth' }); });
    $('.next', el)?.addEventListener('click', ev => { ev.stopPropagation(); track.scrollTo({ left: Math.min(media.length - 1, idx() + 1) * track.clientWidth, behavior: 'smooth' }); });
    $$('.m', track).forEach(m => m.addEventListener('click', () => verMedia(media, +m.dataset.i)));
  }
  el.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    const actual = porId('inc', it.id); if (!actual) return;
    if (a === 'edit') { map.closePopup(); abrirForm(actual); }
    if (a === 'nota') { map.closePopup(); notaRapida(actual); }
    if (a === 'toggle') {
      const rec = { ...actual, estado: actual.estado === 'resuelta' ? 'pendiente' : 'resuelta' };
      if (rec.estado === 'resuelta') rec.revisar = null;
      await guardar('inc', rec); renderInc(); Notif.reprogramar();
      toast(rec.estado === 'resuelta' ? 'Marcada como resuelta' : 'Reabierta');
    }
  });
  return el;
}

function renderInc() {
  const v = visibles(), total = vivos('inc');
  markers.clearLayers();
  v.forEach(it => {
    const m = L.marker([it.lat, it.lng], { icon: pinIcon(it) }).bindPopup(() => popupEl(porId('inc', it.id) || it), { maxWidth: 280, minWidth: 236 });
    m.itemId = it.id; markers.addLayer(m);
  });
  $('#count').textContent = v.length === total.length ? `${total.length} incidencias` : `${v.length} de ${total.length}`;
  const due = total.filter(paraRevisar).length;
  $('#duePill').hidden = !due; $('#dueN').textContent = due;
  opcionesParcela($('#fParcFilt'), { todas: 'Todas las parcelas', ninguna: 'Sin parcela', valor: filt.parcela });
  renderLista(v, total.length);
}

function renderLista(v, total) {
  const box = $('#cards');
  if (!total) { box.innerHTML = '<div class="empty"><strong>Aún no hay incidencias</strong>Pulsa el botón naranja de la cámara junto a un naranjo para registrar la primera.</div>'; return; }
  if (!v.length) {
    box.innerHTML = filt.estado === 'revisar'
      ? '<div class="empty"><strong>Nada que revisar hoy</strong>Cuando una incidencia llegue a su fecha de revisión aparecerá aquí.</div>'
      : '<div class="empty"><strong>Nada coincide con el filtro</strong>Prueba con otra búsqueda o quita algún filtro.</div>';
    return;
  }
  box.innerHTML = '';
  const orden = filt.estado === 'revisar'
    ? (a, b) => a.revisar.localeCompare(b.revisar)
    : (a, b) => (b.fecha || '').localeCompare(a.fecha || '') || (b.creado || 0) - (a.creado || 0);
  [...v].sort(orden).forEach(it => {
    const t = tipoDe(it), media = todaMedia(it), ub = ubicTxt(it), nn = (it.seguimiento || []).length;
    const b = document.createElement('button'); b.className = 'card'; b.style.setProperty('--c', t.c);
    b.innerHTML = `${media[0] ? `<span class="thw">${mediaHtml(media[0], 'th')}</span>` : `<span class="th">${ICON_CAM}</span>`}
      <span class="body"><h3>${esc(it.titulo)}</h3>
      <span class="meta"><span class="chip"><i></i>${t.n}</span><span>${fmtDate(it.fecha)}</span><span class="state ${it.estado}">${it.estado}</span></span>
      ${ub ? `<span class="small">${esc(ub)}</span>` : ''}
      ${badgeRevisar(it)}
      ${it._sync && typeof Sync !== 'undefined' && Sync.conectado() ? `<span class="badge ${Sync.error(it.id) ? 'danger' : 'muted'}">${Sync.error(it.id) ? 'No se ha podido subir' : 'Pendiente de subir'}</span>` : ''}
      ${it.desc ? `<p>${esc(it.desc)}</p>` : ''}
      ${media.length > 1 || nn ? `<span class="small">${[media.length > 1 || media.some(isVid) ? cuentaMedia(media) : '', nn ? `${nn} nota${nn > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ')}</span>` : ''}</span>`;
    b.addEventListener('click', () => irA(it));
    box.appendChild(b);
  });
}

function irA(it) {
  vista('mapa');
  if (!map.hasLayer(markers)) markers.addTo(map);
  const abrir = () => markers.eachLayer(m => { if (m.itemId === it.id) m.openPopup(); });
  setTimeout(() => {
    let hay = false; markers.eachLayer(m => { if (m.itemId === it.id) hay = true; });
    if (!hay) { filt.q = ''; filt.tipos.clear(); filt.parcela = ''; $('#q').value = ''; $$('#tipoChips .f-chip').forEach(b => b.setAttribute('aria-pressed', 'false')); setEstadoFiltro('todas'); }
    map.flyTo([it.lat, it.lng], Math.max(map.getZoom(), 19), { duration: .6 });
    map.once('moveend', abrir);
  }, 80);
}

/* ---------- Ficha de incidencia ---------- */
let ed = null, pintarRevForm = null;
function parcelaDe(lat, lng) {
  const ps = vivos('parcelas').filter(p => p.puntos?.length >= 3 && dentro(lat, lng, p.puntos));
  ps.sort((a, b) => areaHa(a.puntos) - areaHa(b.puntos));
  return ps[0]?.id || '';
}
function abrirForm(it) {
  ed = it
    ? { ...it, fotos: [...(it.fotos || [])], seguimiento: (it.seguimiento || []).map(s => ({ ...s, fotos: [...(s.fotos || [])] })), nuevo: false, parcelaManual: true }
    : { id: uid(), titulo: '', tipo: 'plaga', estado: 'pendiente', fecha: today(), desc: '', fotos: [], seguimiento: [], parcela: '', fila: '', arbol: '', revisar: null, lat: null, lng: null, acc: null, nuevo: true, parcelaManual: false };
  $('#formTitle').textContent = ed.nuevo ? 'Nueva incidencia' : 'Editar incidencia';
  $('#fTitulo').value = ed.titulo; $('#fTipo').value = ed.tipo; $('#fEstado').value = ed.estado; $('#fFecha').value = ed.fecha;
  $('#fDesc').value = ed.desc; $('#fFila').value = ed.fila || ''; $('#fArbol').value = ed.arbol || '';
  pintarParcelaForm();
  pintarRevForm = selectorRevisar($('#fRevisar'), () => ed.revisar, v => ed.revisar = v);
  $('#btnDelete').hidden = ed.nuevo;
  pintarMedia($('#photos'), ed.fotos); pintarSeguimiento(); pintarCoords();
  $('#sheet').hidden = false; $('#sheet .panel').scrollTop = 0;
  if (ed.nuevo) tomarGps();
}
function cerrarForm() { $('#sheet').hidden = true; ed = null; }
function pintarParcelaForm() {
  opcionesParcela($('#fParcela'), { ninguna: 'Sin parcela', valor: ed.parcela });
  const hay = vivos('parcelas').length;
  $('#fParcHint').textContent = !hay ? 'Dibuja tus parcelas en la pestaña Parcelas para que se asignen solas.'
    : !ed.parcelaManual && ed.lat != null ? (ed.parcela ? 'Asignada por la ubicación' : 'La ubicación no cae dentro de ninguna parcela') : '';
}
$('#fParcela').onchange = e => { if (!ed) return; ed.parcela = e.target.value; ed.parcelaManual = true; $('#fParcHint').textContent = ''; };
function autoParcela() { if (ed && !ed.parcelaManual && ed.lat != null) { ed.parcela = parcelaDe(ed.lat, ed.lng); pintarParcelaForm(); } }
function pintarCoords() {
  const el = $('#fCoords');
  if (ed.lat == null) { el.textContent = 'Sin ubicación todavía'; el.classList.add('none'); return; }
  el.classList.remove('none');
  el.textContent = `${ed.lat.toFixed(6)}, ${ed.lng.toFixed(6)}${ed.acc ? `  ·  precisión ±${Math.round(ed.acc)} m` : '  ·  elegida en el mapa'}`;
}
async function tomarGps() {
  const target = ed;
  $('#fCoords').textContent = 'Buscando GPS…'; $('#fCoords').classList.remove('none');
  const r = await mejorPosicion((c, err) => {
    if (ed !== target) return;
    if (!c) { $('#fCoords').textContent = err ? errGps(err) : 'GPS no disponible: elige en el mapa'; $('#fCoords').classList.add('none'); return; }
    ed.lat = c.latitude; ed.lng = c.longitude; ed.acc = c.accuracy; pintarCoords(); autoParcela();
  });
  if (!r && ed === target && ed.lat == null) { $('#fCoords').textContent = 'No se pudo obtener el GPS: elige en el mapa'; $('#fCoords').classList.add('none'); }
}
$('#btnGps').onclick = tomarGps;
$('#btnCancel').onclick = cerrarForm;
$('#btnNew').onclick = () => { vista('mapa'); abrirForm(null); destinoMedia = { arr: ed.fotos, pintar: () => pintarMedia($('#photos'), ed.fotos) }; $('#inCam').click(); };

/* Elegir el punto en el mapa */
$('#btnPick').onclick = () => {
  if (enDibujo()) return;
  $('#sheet').hidden = true; vista('mapa'); $('#pickBanner').hidden = false;
  if (ed.lat != null) map.setView([ed.lat, ed.lng], Math.max(map.getZoom(), 19));
  map.getContainer().style.cursor = 'crosshair';
  map.once('click', ev => {
    ed.lat = ev.latlng.lat; ed.lng = ev.latlng.lng; ed.acc = null;
    const pm = L.marker(ev.latlng, { icon: pinIcon(ed) }).addTo(map);
    setTimeout(() => pm.remove(), 1200);
    salirPick(); pintarCoords(); autoParcela();
  });
};
function salirPick() { $('#pickBanner').hidden = true; map.getContainer().style.cursor = ''; if (ed) $('#sheet').hidden = false; }
$('#pickCancel').onclick = () => { map.off('click'); salirPick(); };

$('#form').addEventListener('submit', async e => {
  e.preventDefault();
  if (ed.lat == null) { toast('Falta la ubicación: usa el GPS o elígela en el mapa'); return; }
  ed.tipo = $('#fTipo').value; ed.estado = $('#fEstado').value; ed.fecha = $('#fFecha').value || today();
  ed.desc = $('#fDesc').value.trim(); ed.fila = $('#fFila').value.trim(); ed.arbol = $('#fArbol').value.trim();
  if (ed.estado === 'resuelta') ed.revisar = null;
  ed.titulo = $('#fTitulo').value.trim() || [TIPOS[ed.tipo].n, ed.fila && `fila ${ed.fila}`, ed.arbol && `árbol ${ed.arbol}`].filter(Boolean).join(' · ') + (ed.fila || ed.arbol ? '' : ` · ${fmtCorta(ed.fecha)}`);
  const nuevo = ed.nuevo; const rec = { ...ed }; delete rec.nuevo; delete rec.parcelaManual;
  try {
    await guardar('inc', rec);
    cerrarForm(); renderInc(); renderSiVisible(); Notif.reprogramar();
    toast(nuevo ? 'Incidencia guardada' : 'Cambios guardados');
    if (nuevo) { map.setView([rec.lat, rec.lng], Math.max(map.getZoom(), 18)); navigator.storage?.persist?.(); }
  } catch (err) { toast('No se pudo guardar. ¿Queda espacio en el móvil?'); }
});

$('#btnDelete').onclick = async () => {
  const it = porId('inc', ed?.id); if (!it) return;
  if (!(await confirmar(`Se borrará "${it.titulo}" con sus fotos y notas. No se puede deshacer.`, { titulo: 'Borrar incidencia' }))) return;
  await eliminar('inc', it); map.closePopup(); cerrarForm(); renderInc(); renderSiVisible(); Notif.reprogramar(); toast('Incidencia borrada');
};

/* ---------- Seguimiento ---------- */
function pintarSeguimiento() {
  const box = $('#fSeg'), lista = [...ed.seguimiento].sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
  $('#fSegWrap').hidden = ed.nuevo && !lista.length;
  box.hidden = !lista.length;
  box.innerHTML = '';
  lista.forEach(s => {
    const e = document.createElement('div'); e.className = 'e';
    e.innerHTML = `<div class="h"><b>${fmtDate(s.fecha)}</b>${s.autor ? `<span>· ${esc(s.autor)}</span>` : ''}<button type="button" class="x">Quitar</button></div>
      ${s.texto ? `<p>${esc(s.texto)}</p>` : ''}
      ${s.fotos?.length ? `<div class="thumbs">${s.fotos.map((m, i) => `<button type="button" data-i="${i}">${mediaHtml(m)}</button>`).join('')}</div>` : ''}`;
    $$('.thumbs button', e).forEach(b => b.onclick = () => verMedia(s.fotos, +b.dataset.i));
    $('.x', e).onclick = async () => {
      if (!(await confirmar('Se quitará esta nota y sus fotos al guardar la incidencia.', { titulo: 'Quitar nota', ok: 'Quitar' }))) return;
      ed.seguimiento = ed.seguimiento.filter(x => x.id !== s.id); pintarSeguimiento();
    };
    box.appendChild(e);
  });
}
$('#fSegAdd').onclick = () => abrirSeg({ titulo: $('#fTitulo').value || 'esta incidencia', estado: $('#fEstado').value, revisar: ed.revisar }, (nota, estado, revisar) => {
  ed.seguimiento.push(nota); ed.estado = estado; $('#fEstado').value = estado; ed.revisar = revisar;
  pintarRevForm?.(); pintarSeguimiento();
});

let seg = null, pintarRevSeg = null;
function abrirSeg(base, onSave) {
  seg = { fotos: [], revisar: base.revisar && base.revisar > today() ? base.revisar : null, onSave };
  $('#segFor').textContent = base.titulo;
  $('#segFecha').value = today(); $('#segTexto').value = ''; $('#segEstado').value = base.estado || 'pendiente';
  pintarMedia($('#segPhotos'), seg.fotos);
  pintarRevSeg = selectorRevisar($('#segRevisar'), () => seg.revisar, v => seg.revisar = v);
  $('#segRevWrap').hidden = $('#segEstado').value === 'resuelta';
  $('#segSheet').hidden = false; $('#segSheet .panel').scrollTop = 0;
  setTimeout(() => $('#segTexto').focus(), 150);
}
$('#segEstado').onchange = e => { $('#segRevWrap').hidden = e.target.value === 'resuelta'; };
$('#segCancel').onclick = () => { $('#segSheet').hidden = true; seg = null; };
$('#segForm').addEventListener('submit', e => {
  e.preventDefault();
  const texto = $('#segTexto').value.trim();
  if (!texto && !seg.fotos.length) { toast('Escribe algo o añade una foto'); return; }
  const estado = $('#segEstado').value;
  const nota = { id: uid(), fecha: $('#segFecha').value || today(), texto, fotos: seg.fotos, autor: autorActual() };
  const fn = seg.onSave; $('#segSheet').hidden = true;
  fn(nota, estado, estado === 'resuelta' ? null : seg.revisar); seg = null;
});
function notaRapida(it) {
  abrirSeg(it, async (nota, estado, revisar) => {
    const rec = { ...porId('inc', it.id) };
    rec.seguimiento = [...(rec.seguimiento || []), nota]; rec.estado = estado; rec.revisar = revisar;
    await guardar('inc', rec); renderInc(); Notif.reprogramar();
    toast(estado === 'resuelta' ? 'Nota guardada y marcada como resuelta' : 'Nota guardada');
  });
}
const autorActual = () => { try { return localStorage.getItem('autor') || ''; } catch (e) { return ''; } };

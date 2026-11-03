/* Parcelas: dibujo en el mapa, superficie, incidencias y plazo de seguridad */
const COLORES = ['#f59f00', '#e8590c', '#2f9e44', '#1c7ed6', '#ae3ec9', '#0c8599', '#e64980', '#868e96'];
const VARIEDADES = ['Navelina', 'Navel Lane Late', 'Navel Powell', 'Salustiana', 'Valencia Late', 'Chislett', 'Barnfield', 'Clemenules', 'Oronules', 'Nadorcott', 'Ortanique', 'Tango'];
$('#variedades').innerHTML = VARIEDADES.map(v => `<option value="${v}">`).join('');

function renderParcLayer() {
  parcLayer.clearLayers();
  vivos('parcelas').forEach(p => {
    if (!(p.puntos?.length >= 3)) return;
    L.polygon(p.puntos, { color: p.color, weight: 2.5, fillOpacity: .12, interactive: false })
      .bindTooltip(esc(p.nombre), { permanent: true, direction: 'center', className: 'plabel', interactive: false })
      .addTo(parcLayer);
  });
}

/* Hasta cuándo no se puede recoger (plazo de seguridad del último tratamiento) */
function plazoParcela(id) {
  let mejor = null;
  vivos('trat').forEach(t => {
    if (t.parcelas?.length && !t.parcelas.includes(id)) return;
    const desde = recogerDesde(t);
    if (desde && (!mejor || desde > mejor.desde)) mejor = { desde, t };
  });
  return mejor && mejor.desde > today() ? mejor : null;
}
function ultimoTrat(id) {
  return vivos('trat').filter(t => !t.parcelas?.length || t.parcelas.includes(id)).sort((a, b) => b.fecha.localeCompare(a.fecha))[0] || null;
}

function renderParc() {
  const ps = vivos('parcelas').sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const total = ps.reduce((s, p) => s + areaHa(p.puntos), 0);
  $('#parcSummary').innerHTML = ps.length
    ? `<span class="small">${ps.length} parcela${ps.length > 1 ? 's' : ''} · ${fmtHa(total)} en total</span>` : '';
  const box = $('#parcCards');
  if (!ps.length) {
    box.innerHTML = `<div class="empty"><strong>Aún no hay parcelas</strong>Pulsa «Nueva parcela» y toca sus esquinas en el mapa, o recórrelas a pie usando «GPS aquí» en cada esquina.</div>`;
    return;
  }
  box.innerHTML = '';
  ps.forEach(p => {
    const inc = vivos('inc').filter(i => i.parcela === p.id);
    const pend = inc.filter(i => i.estado === 'pendiente').length, rev = inc.filter(paraRevisar).length;
    const ps_ = plazoParcela(p.id), ut = ultimoTrat(p.id);
    const el = document.createElement('div'); el.className = 'box';
    el.innerHTML = `<div class="top"><span class="sw" style="--c:${p.color}"></span>
        <div class="grow"><h3>${esc(p.nombre)}</h3><div class="small">${[p.variedad, fmtHa(areaHa(p.puntos))].filter(Boolean).map(esc).join(' · ')}</div></div>
        <button class="btn sm" data-a="edit">Editar</button></div>
      <div class="stats"><div><b>${pend}</b><span>Pendientes</span></div><div><b>${rev}</b><span>Por revisar</span></div><div><b>${inc.length}</b><span>Total</span></div></div>
      ${ps_ ? `<span class="badge danger">No recoger hasta el ${fmtCorta(ps_.desde)} (${esc(ps_.t.producto)})</span>` : `<span class="badge ok">Se puede recoger: sin plazo de seguridad pendiente</span>`}
      ${ut ? `<div class="small">Último tratamiento: ${fmtCorta(ut.fecha)} · ${esc(ut.producto)}</div>` : '<div class="small">Sin tratamientos registrados</div>'}
      ${p.notas ? `<div class="small">${esc(p.notas)}</div>` : ''}
      <div class="row"><button class="btn sm" data-a="mapa">Ver en el mapa</button><button class="btn sm" data-a="inc">Ver incidencias</button></div>`;
    el.addEventListener('click', e => {
      const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
      if (a === 'edit') abrirParcForm(p);
      if (a === 'mapa') { vista('mapa'); if (!map.hasLayer(parcLayer)) parcLayer.addTo(map); setTimeout(() => map.fitBounds(L.latLngBounds(p.puntos), { padding: [40, 40], maxZoom: 19 }), 80); }
      if (a === 'inc') { filt.parcela = p.id; setEstadoFiltro('todas'); vista('lista'); }
    });
    box.appendChild(el);
  });
}

/* ---------- Dibujar ---------- */
let draw = null;
const enDibujo = () => !!draw;
function empezarDibujo(base) {
  $('#parcSheet').hidden = true; vista('mapa');
  draw = {
    base, pts: [],
    poly: L.polygon([], { color: '#ffd43b', weight: 3, dashArray: '6 6', fillOpacity: .18, interactive: false }).addTo(map),
    marks: L.layerGroup().addTo(map)
  };
  $('#drawBanner').hidden = false; $('#camaras').hidden = true; map.getContainer().style.cursor = 'crosshair';
  map.on('click', clickDibujo);
  if (base?.puntos?.length) map.fitBounds(L.latLngBounds(base.puntos), { padding: [40, 40], maxZoom: 19 });
  pintarDibujo();
}
function clickDibujo(e) { draw.pts.push([e.latlng.lat, e.latlng.lng]); pintarDibujo(); }
function pintarDibujo() {
  const n = draw.pts.length;
  draw.poly.setLatLngs(draw.pts);
  draw.marks.clearLayers();
  draw.pts.forEach(p => L.marker(p, { icon: L.divIcon({ className: '', html: '<div class="vtx"></div>', iconSize: [16, 16] }), interactive: false }).addTo(draw.marks));
  $('#drawTxt').textContent = n === 0 ? 'Toca las esquinas de la parcela en el mapa'
    : n < 3 ? `${n} esquina${n > 1 ? 's' : ''}. Faltan al menos ${3 - n}.`
    : `${n} esquinas · ${fmtHa(areaHa(draw.pts))}`;
  $('#drawUndo').disabled = !n; $('#drawOk').disabled = n < 3;
}
function salirDibujo() {
  map.off('click', clickDibujo); draw.poly.remove(); draw.marks.remove();
  $('#drawBanner').hidden = true; $('#camaras').hidden = vistaActual !== 'mapa' && vistaActual !== 'lista'; map.getContainer().style.cursor = '';
  const d = draw; draw = null; return d;
}
$('#drawUndo').onclick = () => { draw.pts.pop(); pintarDibujo(); };
$('#drawCancel').onclick = () => { const d = salirDibujo(); if (d.base?.id) abrirParcForm(porId('parcelas', d.base.id)); };
$('#drawOk').onclick = () => { const d = salirDibujo(); abrirParcForm({ ...(d.base || {}), puntos: d.pts }, true); };
$('#drawGps').onclick = async () => {
  const btn = $('#drawGps'); btn.disabled = true; btn.textContent = 'Buscando…';
  const c = await mejorPosicion(null, { segundos: 15, objetivo: 5 });
  btn.disabled = false; btn.textContent = 'GPS aquí';
  if (!draw) return;
  if (!c) { toast('No se pudo obtener el GPS'); return; }
  draw.pts.push([c.latitude, c.longitude]); pintarDibujo();
  map.setView([c.latitude, c.longitude], Math.max(map.getZoom(), 18));
  toast(`Esquina añadida (±${Math.round(c.accuracy)} m)`);
};
$('#btnNewParc').onclick = () => empezarDibujo(null);

/* ---------- Ficha de parcela ---------- */
let pe = null;
function abrirParcForm(p, recienDibujada = false) {
  const usados = vivos('parcelas').map(x => x.color);
  pe = { id: uid(), nombre: '', variedad: '', notas: '', color: COLORES.find(c => !usados.includes(c)) || COLORES[0], puntos: [], ...p };
  const existe = !!porId('parcelas', pe.id);
  $('#parcTitle').textContent = existe ? 'Editar parcela' : 'Nueva parcela';
  $('#pNombre').value = pe.nombre; $('#pVariedad').value = pe.variedad || ''; $('#pNotas').value = pe.notas || '';
  $('#pArea').textContent = `Superficie: ${fmtHa(areaHa(pe.puntos))} · ${pe.puntos.length} esquinas${recienDibujada && existe ? ' (nuevo dibujo)' : ''}`;
  $('#pBorrar').hidden = !existe; $('#pRedibujar').hidden = !existe;
  pintarColores();
  $('#parcSheet').hidden = false;
  if (!existe) setTimeout(() => $('#pNombre').focus(), 150);
}
function pintarColores() {
  $('#pColors').innerHTML = COLORES.map(c => `<button type="button" style="--c:${c}" data-c="${c}" aria-label="Color" aria-pressed="${c === pe.color}"></button>`).join('');
  $$('#pColors button').forEach(b => b.onclick = () => { pe.color = b.dataset.c; pintarColores(); });
}
$('#pCancel').onclick = () => { $('#parcSheet').hidden = true; pe = null; };
$('#pRedibujar').onclick = () => { pe.nombre = $('#pNombre').value; pe.variedad = $('#pVariedad').value; pe.notas = $('#pNotas').value; empezarDibujo(pe); };
$('#pBorrar').onclick = async () => {
  const p = porId('parcelas', pe.id); if (!p) return;
  const n = vivos('inc').filter(i => i.parcela === p.id).length;
  if (!(await confirmar(`Se borrará la parcela "${p.nombre}".${n ? ` Sus ${n} incidencias se conservan, pero quedarán sin parcela.` : ''}`, { titulo: 'Borrar parcela' }))) return;
  await eliminar('parcelas', p);
  for (const it of vivos('inc').filter(i => i.parcela === p.id)) await guardar('inc', { ...it, parcela: '' });
  $('#parcSheet').hidden = true; pe = null; renderTodo(); toast('Parcela borrada');
};
$('#parcForm').addEventListener('submit', async e => {
  e.preventDefault();
  const nombre = $('#pNombre').value.trim();
  if (!nombre) { toast('Ponle un nombre a la parcela'); $('#pNombre').focus(); return; }
  const nueva = !porId('parcelas', pe.id);
  const rec = { id: pe.id, nombre, variedad: $('#pVariedad').value.trim(), notas: $('#pNotas').value.trim(), color: pe.color, puntos: pe.puntos, creado: pe.creado };
  await guardar('parcelas', rec);
  // Asigna esta parcela a las incidencias que caen dentro y no tienen parcela
  let n = 0;
  for (const it of vivos('inc')) if (!it.parcela && it.lat != null && dentro(it.lat, it.lng, rec.puntos)) { await guardar('inc', { ...it, parcela: rec.id }); n++; }
  $('#parcSheet').hidden = true; pe = null; renderTodo();
  toast(nueva ? `Parcela guardada${n ? ` · ${n} incidencias asignadas` : ''}` : 'Cambios guardados');
});

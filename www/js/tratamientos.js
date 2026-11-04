/* Tratamientos: registro tipo cuaderno de campo y plazo de seguridad */
const UNIDADES = ['L/ha', 'kg/ha', 'cc/hL', 'g/hL', 'L/hL', '%', 'L total', 'kg total'];
$('#tUnidad').innerHTML = UNIDADES.map(u => `<option>${u}</option>`).join('');
const recogerDesde = t => num(t.plazo) > 0 ? addDays(t.fecha, num(t.plazo)) : null;
const parcelasTxt = t => t.parcelas?.length ? (t.parcelas.map(nombreParcela).filter(Boolean).join(', ') || 'Parcela borrada') : 'Toda la finca';
const dosisTxt = t => [t.dosis && `${t.dosis} ${t.unidad || ''}`.trim(), t.caldo && `caldo ${fmtNum(num(t.caldo), 0)} L`].filter(Boolean).join(' · ');
let tratFiltro = '';

function renderTrat() {
  // Resumen: parcelas en plazo de seguridad
  const bloqueadas = [];
  const ps = vivos('parcelas');
  if (ps.length) ps.forEach(p => { const r = plazoParcela(p.id); if (r) bloqueadas.push({ nombre: p.nombre, ...r }); });
  else { let m = null; vivos('trat').forEach(t => { const d = recogerDesde(t); if (d && d > today() && (!m || d > m.desde)) m = { desde: d, t }; }); if (m) bloqueadas.push({ nombre: 'Toda la finca', ...m }); }
  bloqueadas.sort((a, b) => b.desde.localeCompare(a.desde));
  $('#psBox').innerHTML = vivos('trat').length
    ? (bloqueadas.length
      ? `<div class="ps-list">${bloqueadas.map(b => `<span class="badge danger">No recoger en ${esc(b.nombre)} hasta el ${fmtCorta(b.desde)} · ${esc(b.t.producto)}</span>`).join('')}</div>`
      : '<span class="badge ok">Ninguna parcela está en plazo de seguridad</span>')
    : '';

  const sel = $('#tratFilt');
  opcionesParcela(sel, { todas: 'Todas las parcelas', valor: tratFiltro });
  sel.parentElement.hidden = !ps.length;

  const lista = vivos('trat').filter(t => !tratFiltro || !t.parcelas?.length || t.parcelas.includes(tratFiltro))
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.creado || 0) - (a.creado || 0));
  const box = $('#tratCards');
  if (!lista.length) {
    box.innerHTML = '<div class="empty"><strong>Sin tratamientos registrados</strong>Apunta cada tratamiento con su producto, dosis y plazo de seguridad. La app te dirá cuándo se puede recoger.</div>';
    return;
  }
  box.innerHTML = '';
  lista.forEach(t => {
    const desde = recogerDesde(t);
    const el = document.createElement('div'); el.className = 'box';
    el.innerHTML = `<div class="top"><div class="grow"><div class="small">${fmtDate(t.fecha)}</div><h3>${esc(t.producto || (t.recorrido ? 'Recorrido sin completar' : 'Sin producto'))}</h3></div>
        <button class="btn sm" data-a="edit">Editar</button></div>
      ${dosisTxt(t) || t.materia ? `<div class="small">${[t.materia, dosisTxt(t)].filter(Boolean).map(esc).join(' · ')}</div>` : ''}
      <div class="pchips">${t.parcelas?.length
        ? t.parcelas.map(id => { const p = porId('parcelas', id); return `<span class="tag" style="--c:${p?.color || '#999'}"><i></i>${esc(p?.nombre || 'Parcela borrada')}</span>`; }).join('')
        : '<span class="tag" style="--c:#999"><i></i>Toda la finca</span>'}</div>
      ${t.motivo ? `<div class="small">Motivo: ${esc(t.motivo)}</div>` : ''}
      ${desde ? (desde > today() ? `<span class="badge danger">No recoger hasta el ${fmtCorta(desde)}</span>` : `<span class="badge muted">Plazo de seguridad cumplido el ${fmtCorta(desde)}</span>`) : ''}
      ${t.recorrido ? `<div class="small">${t.recorrido.estado === 'activo' ? '<span class="badge warn">Recorrido en curso</span> ' : ''}Recorrido: ${esc(Rec.resumen(t.recorrido))}</div>` : ''}
      ${t.borrador && t.recorrido?.estado !== 'activo' ? '<span class="badge warn">Falta apuntar producto y dosis</span>' : ''}
      <div class="row">${t.recorrido ? '<button class="btn sm" data-a="ver">Ver recorrido</button>' : ''}<button class="btn sm" data-a="rep">Repetir hoy</button></div>`;
    el.addEventListener('click', e => {
      const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
      if (a === 'edit') abrirTratForm(t);
      if (a === 'ver') Rec.ver(t);
      if (a === 'rep') { const { id, creado, actualizado, _sync, recorrido, borrador, ...resto } = t; abrirTratForm({ ...resto, fecha: today(), aplicador: aplicadorDefecto() || t.aplicador }, true); }
    });
    box.appendChild(el);
  });
}
$('#tratFilt').onchange = e => { tratFiltro = e.target.value; renderTrat(); };

/* ---------- Ficha ---------- */
let te = null;
const aplicadorDefecto = () => { try { return localStorage.getItem('aplicador') || ''; } catch (e) { return ''; } };
function abrirTratForm(t, copia = false) {
  te = { id: uid(), fecha: today(), parcelas: [], producto: '', materia: '', dosis: '', unidad: 'L/ha', caldo: '', plazo: '', motivo: '', aplicador: aplicadorDefecto(), notas: '', ...t };
  if (copia) te.id = uid();
  const existe = !!porId('trat', te.id);
  $('#tratTitle').textContent = existe ? 'Editar tratamiento' : copia ? 'Repetir tratamiento' : 'Nuevo tratamiento';
  for (const k of ['fecha', 'producto', 'materia', 'dosis', 'caldo', 'plazo', 'motivo', 'aplicador', 'notas'])
    $('#t' + k[0].toUpperCase() + k.slice(1)).value = te[k] ?? '';
  $('#tUnidad').value = te.unidad || 'L/ha';
  $('#tProdList').innerHTML = [...new Set(vivos('trat').map(x => x.producto).filter(Boolean))].map(p => `<option value="${esc(p)}">`).join('');
  $('#tBorrar').hidden = !existe;
  pintarParcTrat(); calcRecoger();
  $('#tratSheet').hidden = false; $('#tratSheet .panel').scrollTop = 0;
}
function pintarParcTrat() {
  const ps = vivos('parcelas').sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  te.parcelas = te.parcelas.filter(id => ps.some(p => p.id === id));
  $('#tParcelas').innerHTML = `<button type="button" class="pchip" data-id="" aria-pressed="${!te.parcelas.length}">Toda la finca</button>` +
    ps.map(p => `<button type="button" class="pchip" style="--c:${p.color}" data-id="${p.id}" aria-pressed="${te.parcelas.includes(p.id)}"><i></i>${esc(p.nombre)}</button>`).join('');
  const ha = te.parcelas.length ? te.parcelas.reduce((s, id) => s + areaHa(porId('parcelas', id)?.puntos), 0) : ps.reduce((s, p) => s + areaHa(p.puntos), 0);
  $('#tParcHint').textContent = !ps.length ? 'Si dibujas parcelas podrás elegir cuáles se tratan.' : ha ? `Superficie tratada: ${fmtHa(ha)}` : '';
  $$('#tParcelas .pchip').forEach(b => b.onclick = () => {
    const id = b.dataset.id;
    if (!id) te.parcelas = [];
    else te.parcelas = te.parcelas.includes(id) ? te.parcelas.filter(x => x !== id) : [...te.parcelas, id];
    pintarParcTrat();
  });
}
function calcRecoger() {
  const f = $('#tFecha').value || today(), pz = num($('#tPlazo').value);
  const d = pz > 0 ? addDays(f, pz) : null;
  $('#tRecoger').innerHTML = d
    ? (d > today() ? `Se podrá recoger a partir del <b>${fmtDate(d)}</b> (${diasHasta(d)} días)` : `Plazo de seguridad cumplido el <b>${fmtDate(d)}</b>`)
    : 'Pon el plazo de seguridad (lo indica la etiqueta del producto) para saber cuándo se puede recoger.';
}
$('#tFecha').oninput = calcRecoger; $('#tPlazo').oninput = calcRecoger;
$('#tProducto').onchange = e => {
  // Rellena con lo usado la última vez con ese producto
  const prev = vivos('trat').filter(x => x.producto?.toLowerCase() === e.target.value.trim().toLowerCase()).sort((a, b) => b.fecha.localeCompare(a.fecha))[0];
  if (!prev) return;
  if (!$('#tMateria').value) $('#tMateria').value = prev.materia || '';
  if (!$('#tDosis').value) { $('#tDosis').value = prev.dosis || ''; $('#tUnidad').value = prev.unidad || 'L/ha'; }
  if (!$('#tPlazo').value) $('#tPlazo').value = prev.plazo || '';
  if (!$('#tMotivo').value) $('#tMotivo').value = prev.motivo || '';
  calcRecoger();
};
$('#tCancel').onclick = () => { $('#tratSheet').hidden = true; te = null; };
$('#tBorrar').onclick = async () => {
  const t = porId('trat', te.id); if (!t) return;
  if (!(await confirmar(`Se borrará el tratamiento con "${t.producto}" del ${fmtCorta(t.fecha)}.`, { titulo: 'Borrar tratamiento' }))) return;
  await eliminar('trat', t); $('#tratSheet').hidden = true; te = null; renderTrat(); renderSiVisible(); toast('Tratamiento borrado');
};
$('#tratForm').addEventListener('submit', async e => {
  e.preventDefault();
  const producto = $('#tProducto').value.trim();
  if (!producto) { toast('Escribe el nombre del producto'); $('#tProducto').focus(); return; }
  const rec = {
    id: te.id, creado: te.creado, fecha: $('#tFecha').value || today(), parcelas: te.parcelas, producto,
    materia: $('#tMateria').value.trim(), dosis: $('#tDosis').value.trim(), unidad: $('#tUnidad').value,
    caldo: $('#tCaldo').value.trim(), plazo: $('#tPlazo').value.trim(), motivo: $('#tMotivo').value.trim(),
    aplicador: $('#tAplicador').value.trim(), notas: $('#tNotas').value.trim()
  };
  if (te.recorrido) rec.recorrido = (porId('trat', te.id) || te).recorrido;
  try { if (rec.aplicador) localStorage.setItem('aplicador', rec.aplicador); } catch (err) {}
  const nuevo = !porId('trat', rec.id);
  await guardar('trat', rec); $('#tratSheet').hidden = true; te = null; renderTrat(); renderSiVisible();
  toast(nuevo ? 'Tratamiento guardado' : 'Cambios guardados');
});
$('#btnNewTrat').onclick = () => abrirTratForm({});

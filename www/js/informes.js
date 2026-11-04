/* Informes en Excel y PDF (las librerías se cargan solo al usarlas) */
const cargarScript = src => new Promise((res, rej) => {
  if ($(`script[src="${src}"]`)) return res();
  const s = document.createElement('script'); s.src = src; s.onload = res;
  s.onerror = () => rej(new Error('No se pudo cargar ' + src)); document.head.appendChild(s);
});

function abrirInforme() {
  $('#menu').hidden = true;
  const y = new Date().getFullYear();
  if (!$('#iDesde').value) $('#iDesde').value = `${y}-01-01`;
  if (!$('#iHasta').value) $('#iHasta').value = today();
  opcionesParcela($('#iParcela'), { todas: 'Todas las parcelas', valor: $('#iParcela').value });
  $('#iParcela').parentElement.hidden = !vivos('parcelas').length;
  resumenInforme(); $('#infSheet').hidden = false;
}
function datosInforme() {
  const desde = $('#iDesde').value || '0000-01-01', hasta = $('#iHasta').value || '9999-12-31', pid = $('#iParcela').value;
  const enRango = f => f >= desde && f <= hasta;
  const trat = vivos('trat').filter(t => enRango(t.fecha) && (!pid || !t.parcelas?.length || t.parcelas.includes(pid))).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const inc = vivos('inc').filter(i => (!pid || i.parcela === pid) && (enRango(i.fecha) || (i.seguimiento || []).some(s => enRango(s.fecha)))).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const seg = inc.flatMap(i => (i.seguimiento || []).filter(s => enRango(s.fecha)).map(s => ({ i, s }))).sort((a, b) => a.s.fecha.localeCompare(b.s.fecha));
  const parc = vivos('parcelas').filter(p => !pid || p.id === pid).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return { desde, hasta, pid, trat, inc, seg, parc };
}
function resumenInforme() {
  const d = datosInforme();
  $('#iResumen').textContent = [plural(d.trat.length, 'tratamiento', 'tratamientos'), plural(d.inc.length, 'incidencia', 'incidencias'), plural(d.seg.length, 'nota', 'notas'), plural(d.parc.length, 'parcela', 'parcelas')].join(' · ');
}
['iDesde', 'iHasta', 'iParcela'].forEach(id => $('#' + id).addEventListener('change', resumenInforme));
$('#iCancel').onclick = () => $('#infSheet').hidden = true;
$('#mInforme').onclick = abrirInforme;

/* Fechas como fecha real y números como número, para poder ordenar y sumar en Excel */
const F = s => s ? new Date(s + 'T12:00:00') : '';
const N = v => { const n = num(v); return n == null ? (v || '') : n; };
function tablasInforme(d) {
  const T = [];
  const sup = t => { const ids = t.parcelas?.length ? t.parcelas : vivos('parcelas').map(p => p.id); const ha = ids.reduce((s, id) => s + areaHa(porId('parcelas', id)?.puntos), 0); return ha ? +ha.toFixed(2) : ''; };
  if ($('#iTrat').checked) T.push({
    hoja: 'Tratamientos', titulo: 'Tratamientos fitosanitarios y abonados',
    cab: ['Fecha', 'Parcela(s)', 'Sup. (ha)', 'Producto', 'Materia activa', 'Dosis', 'Unidad', 'Caldo (L)', 'Plaga / motivo', 'P. seg. (días)', 'Recoger desde', 'Aplicador', 'Notas'],
    filas: d.trat.map(t => [F(t.fecha), parcelasTxt(t), sup(t), t.producto, t.materia, N(t.dosis), t.unidad, N(t.caldo), t.motivo, N(t.plazo), F(recogerDesde(t)), t.aplicador, t.notas]),
    anchos: [11, 20, 8, 20, 18, 7, 8, 9, 16, 8, 12, 14, 26]
  });
  if ($('#iInc').checked) T.push({
    hoja: 'Incidencias', titulo: 'Incidencias',
    cab: ['Fecha', 'Título', 'Tipo', 'Estado', 'Parcela', 'Fila', 'Árbol', 'Descripción', 'Revisar', 'Notas', 'Fotos/vídeos', 'Latitud', 'Longitud'],
    filas: d.inc.map(i => [F(i.fecha), i.titulo, tipoDe(i).n, i.estado, nombreParcela(i.parcela), N(i.fila), N(i.arbol), i.desc, i.estado === 'pendiente' ? F(i.revisar) : '', (i.seguimiento || []).length, todaMedia(i).length, +i.lat.toFixed(6), +i.lng.toFixed(6)]),
    anchos: [11, 26, 14, 10, 16, 6, 6, 36, 11, 6, 8, 11, 11]
  });
  if ($('#iSeg').checked) T.push({
    hoja: 'Seguimiento', titulo: 'Notas de seguimiento',
    cab: ['Fecha', 'Incidencia', 'Parcela', 'Fila', 'Árbol', 'Nota', 'Autor', 'Fotos/vídeos'],
    filas: d.seg.map(({ i, s }) => [F(s.fecha), i.titulo, nombreParcela(i.parcela), N(i.fila), N(i.arbol), s.texto, s.autor || '', (s.fotos || []).length]),
    anchos: [11, 26, 16, 6, 6, 50, 12, 8]
  });
  if ($('#iParc').checked && d.parc.length) T.push({
    hoja: 'Parcelas', titulo: 'Parcelas',
    cab: ['Parcela', 'Variedad', 'Superficie (ha)', 'Inc. pendientes', 'Inc. totales', 'Último tratamiento', 'No recoger hasta', 'Notas'],
    filas: d.parc.map(p => {
      const inc = vivos('inc').filter(i => i.parcela === p.id), ut = ultimoTrat(p.id), ps = plazoParcela(p.id);
      return [p.nombre, p.variedad, +areaHa(p.puntos).toFixed(2), inc.filter(i => i.estado === 'pendiente').length, inc.length,
        ut ? `${fmtDMY(ut.fecha)} · ${ut.producto}` : '', ps ? F(ps.desde) : '', p.notas];
    }),
    anchos: [20, 16, 12, 12, 10, 26, 14, 36]
  });
  return T;
}
const nombreInforme = (d, ext) => {
  const p = d.pid ? '-' + (nombreParcela(d.pid) || 'parcela').toLowerCase().replace(/[^a-z0-9ñáéíóú]+/gi, '-') : '';
  return `informe-campcontrol${p}-${d.desde}_${d.hasta}.${ext}`;
};

async function informeExcel() {
  const d = datosInforme(), T = tablasInforme(d);
  if (!T.length) return toast('Marca al menos una sección');
  toast('Preparando Excel…');
  try {
    await cargarScript('lib/xlsx.full.min.js');
    const wb = XLSX.utils.book_new();
    T.forEach(t => {
      const ws = XLSX.utils.aoa_to_sheet([t.cab, ...t.filas], { cellDates: true, dateNF: 'dd/mm/yyyy' });
      ws['!cols'] = t.anchos.map(w => ({ wch: w }));
      ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(1, t.filas.length), c: t.cab.length - 1 } }) };
      XLSX.utils.book_append_sheet(wb, ws, t.hoja);
    });
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    $('#infSheet').hidden = true;
    await guardarArchivo(nombreInforme(d, 'xlsx'), new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'Informe en Excel guardado');
  } catch (e) { toast('No se pudo crear el Excel: ' + (e?.message || e)); }
}

async function informePdf() {
  const d = datosInforme(), T = tablasInforme(d);
  if (!T.length) return toast('Marca al menos una sección');
  toast('Preparando PDF…');
  try {
    await cargarScript('lib/jspdf.umd.min.js');
    await cargarScript('lib/jspdf.plugin.autotable.min.js');
    const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    doc.setFillColor(31, 61, 43); doc.rect(0, 0, W, 22, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text(`${Finca.actual?.local ? 'CampControl' : Finca.actual?.nombre || 'CampControl'} · Informe`, 12, 14);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text(`Del ${fmtDMY(d.desde)} al ${fmtDMY(d.hasta)}${d.pid ? ' · ' + nombreParcela(d.pid) : ''}`, W - 12, 14, { align: 'right' });
    doc.setTextColor(27, 42, 31);
    let y = 32;
    T.forEach(t => {
      if (y > 170) { doc.addPage(); y = 18; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(`${t.titulo} (${t.filas.length})`, 12, y);
      doc.autoTable({
        startY: y + 3, head: [t.cab], body: t.filas.length ? t.filas.map(r => r.map(v => v instanceof Date ? fmtDMY(isoLocal(v)) : typeof v === 'number' ? fmtNum(v, 6) : (v ?? ''))) : [[{ content: 'Sin registros en este periodo', colSpan: t.cab.length }]],
        margin: { left: 12, right: 12 }, styles: { fontSize: 7.5, cellPadding: 1.6, overflow: 'linebreak', valign: 'top' },
        headStyles: { fillColor: [31, 61, 43], textColor: 255, fontStyle: 'bold' }, alternateRowStyles: { fillColor: [243, 245, 239] }
      });
      y = doc.lastAutoTable.finalY + 10;
    });
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i); doc.setFontSize(8); doc.setTextColor(110);
      doc.text(`Generado el ${fmtDMY(today())} · Página ${i} de ${n}`, W - 12, doc.internal.pageSize.getHeight() - 7, { align: 'right' });
    }
    $('#infSheet').hidden = true;
    await guardarArchivo(nombreInforme(d, 'pdf'), doc.output('blob'), 'Informe en PDF guardado');
  } catch (e) { toast('No se pudo crear el PDF: ' + (e?.message || e)); }
}
$('#iExcel').onclick = informeExcel;
$('#iPdf').onclick = informePdf;

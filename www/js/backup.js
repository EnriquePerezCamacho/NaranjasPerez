/* Copia de seguridad por trozos (una línea JSON por registro; fotos y vídeos en trozos de ~750 KB).
   Así nunca se carga en memoria un texto gigante y la app no se cierra. */
const TROZO = 3 * 196608;
async function escritorCopia(nombre) {
  const FS = plugin('Filesystem');
  if (!FS) { const partes = []; return { add: async t => { partes.push(t); }, fin: async () => ({ blob: new Blob(partes, { type: 'application/x-ndjson' }) }) }; }
  let dir = 'DOCUMENTS', ruta = `CampControl/${nombre}`, empezado = false, buf = '';
  try { await FS.requestPermissions?.(); } catch (e) {}
  const escribir = async t => {
    if (!empezado) { await FS.writeFile({ path: ruta, data: t, directory: dir, encoding: 'utf8', recursive: true }); empezado = true; }
    else await FS.appendFile({ path: ruta, data: t, directory: dir, encoding: 'utf8' });
  };
  const volcar = async () => {
    const t = buf; buf = '';
    try { await escribir(t); }
    catch (err) { if (empezado || dir === 'CACHE') throw err; dir = 'CACHE'; ruta = nombre; await escribir(t); }
  };
  return {
    add: async t => { buf += t; if (buf.length >= 512 * 1024) await volcar(); },
    fin: async () => { if (buf) await volcar(); const u = await FS.getUri({ path: ruta, directory: dir }); return { uri: u.uri, dir }; }
  };
}
const refMedia = m => ({ id: m.id, type: m.type, size: m.size, path: m.path });
const sinSync = ({ _sync, ...r }) => r;

let exportando = false;
$('#mExport').onclick = async () => {
  if (exportando) return; exportando = true; $('#menu').hidden = true;
  const nombre = `campcontrol-${(Finca.actual?.nombre || 'finca').toLowerCase().replace(/[^a-z0-9ñ]+/gi, '-')}-${today()}-${new Date().toTimeString().slice(0, 5).replace(':', '')}.json`;
  try {
    const w = await escritorCopia(nombre), inc = vivos('inc');
    let bytes = 0;
    await w.add(JSON.stringify({ t: 'meta', app: 'campcontrol', finca: Finca.actual?.nombre || '', version: 3, exportado: new Date().toISOString(), n: inc.length }) + '\n');
    for (const p of vivos('parcelas')) await w.add(JSON.stringify({ t: 'parcela', rec: sinSync(p) }) + '\n');
    for (const t of vivos('trat')) await w.add(JSON.stringify({ t: 'trat', rec: sinSync(t) }) + '\n');
    for (let k = 0; k < inc.length; k++) {
      const it = inc[k];
      toast(`Guardando copia… ${k + 1} de ${inc.length}`);
      const rec = { ...sinSync(it), fotos: (it.fotos || []).map(refMedia), seguimiento: (it.seguimiento || []).map(s => ({ ...s, fotos: (s.fotos || []).map(refMedia) })) };
      await w.add(JSON.stringify({ t: 'item', item: rec }) + '\n');
      for (const m of todaMedia(it)) {
        const b = mBlob(m); if (!b) continue; bytes += b.size;
        for (let o = 0; o < b.size; o += TROZO) await w.add(JSON.stringify({ t: 'part', m: m.id, d: await blobB64(b.slice(o, o + TROZO)) }) + '\n');
      }
    }
    await w.add(JSON.stringify({ t: 'fin' }) + '\n');
    const r = await w.fin();
    if (r.blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(r.blob); a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); toast('Copia descargada'); }
    else avisoArchivo({ uri: r.uri, dir: r.dir, nombre, titulo: 'Copia de seguridad guardada', detalle: [plural(inc.length, 'incidencia', 'incidencias'), plural(vivos('parcelas').length, 'parcela', 'parcelas'), plural(vivos('trat').length, 'tratamiento', 'tratamientos'), bytes ? `${fmtMB(bytes)} de fotos y vídeos` : 'sin fotos'].join(' · ') });
  } catch (err) { toast('No se pudo guardar la copia: ' + (err?.message || 'error desconocido'), 5000); }
  finally { exportando = false; }
};

$('#mImport').onclick = () => { $('#menu').hidden = true; $('#inImport').click(); };
$('#inImport').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const cab = await f.slice(0, 120).text();
    const n = cab.includes('"t":"meta"') ? await importarLineas(f) : await importarV1(f);
    await cargar(); renderTodo(); encuadrar(false); Notif.reprogramar();
    toast(`Copia importada: ${n.inc} incidencias${n.parc ? `, ${n.parc} parcelas` : ''}${n.trat ? `, ${n.trat} tratamientos` : ''}`, 4000);
  } catch (err) { console.error(err); toast('Ese archivo no es una copia válida de CampControl', 4000); }
};
/* Solo sustituye un registro si el de la copia es igual o más reciente */
async function fusionar(k, rec) {
  const ya = S[k].find(x => x.id === rec.id);
  if (ya && (ya.actualizado || 0) > (rec.actualizado || 0)) return false;
  rec._sync = 1; await DB.put(k, rec); return true;
}
async function importarLineas(f) {
  const dec = new TextDecoder(); const n = { inc: 0, parc: 0, trat: 0 };
  let resto = '', actual = null, ok = false, version = 2;
  const cerrar = async () => {
    if (!actual) return;
    const { item, partes } = actual; actual = null;
    if (version >= 3) {
      const poner = arr => (arr || []).map(m => partes.has(m.id) ? { ...m, blob: new Blob(partes.get(m.id), { type: m.type }) } : (m.path ? m : null)).filter(Boolean);
      item.fotos = poner(item.fotos); item.seguimiento = (item.seguimiento || []).map(s => ({ ...s, fotos: poner(s.fotos) }));
    } else {
      item.fotos = (item._media || []).map((m, i) => mkMedia(new Blob(partes.get(i) || [], { type: m.type })));
      delete item._media;
    }
    if (await fusionar('inc', normalizarInc(item).it)) n.inc++;
  };
  const linea = async l => {
    if (!l.trim()) return;
    const o = JSON.parse(l);
    if (o.t === 'meta') { ok = true; version = o.version || 2; }
    else if (o.t === 'parcela') { if (await fusionar('parcelas', o.rec)) n.parc++; }
    else if (o.t === 'trat') { if (await fusionar('trat', o.rec)) n.trat++; }
    else if (o.t === 'item') {
      await cerrar();
      if (typeof o.item?.lat === 'number' && typeof o.item?.lng === 'number') actual = { item: version >= 3 ? o.item : { ...o.item, _media: o.media || [] }, partes: new Map() };
    } else if (o.t === 'part' && actual) {
      const key = version >= 3 ? o.m : (o.id === actual.item.id ? o.i : null);
      if (key == null) return;
      if (!actual.partes.has(key)) actual.partes.set(key, []);
      actual.partes.get(key).push(b64Bytes(o.d));
    }
  };
  const PASO = 4 * 1048576;
  for (let off = 0; off < f.size; off += PASO) {
    toast(`Importando… ${Math.min(100, Math.round(off / f.size * 100))} %`);
    resto += dec.decode(await f.slice(off, off + PASO).arrayBuffer(), { stream: true });
    const ls = resto.split('\n'); resto = ls.pop();
    for (const l of ls) await linea(l);
  }
  resto += dec.decode(); await linea(resto); await cerrar();
  if (!ok) throw new Error('formato');
  return n;
}
async function importarV1(f) {
  const data = JSON.parse(await f.text());
  if (!Array.isArray(data.items)) throw new Error('formato');
  const n = { inc: 0, parc: 0, trat: 0 };
  for (const it of data.items) {
    if (typeof it.lat !== 'number' || typeof it.lng !== 'number') continue;
    it.fotos = await Promise.all((it.fotos || []).map(d => fetch(d).then(r => r.blob())));
    if (await fusionar('inc', normalizarInc(it).it)) n.inc++;
  }
  return n;
}

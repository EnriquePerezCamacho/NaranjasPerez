/* Utilidades comunes */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nativo = () => !!window.Capacitor?.isNativePlatform?.();
const plugin = n => nativo() ? window.Capacitor.Plugins?.[n] || null : null;

/* Fechas en formato AAAA-MM-DD, siempre en hora local */
const isoLocal = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
const today = () => isoLocal(new Date());
const addDays = (s, n) => { const d = new Date(s + 'T12:00'); d.setDate(d.getDate() + Number(n)); return isoLocal(d); };
const diasHasta = s => Math.round((new Date(s + 'T12:00') - new Date(today() + 'T12:00')) / 864e5);
const fmtDate = s => s ? new Date(s + 'T12:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const fmtCorta = s => {
  if (!s) return '';
  const d = new Date(s + 'T12:00'), o = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
  return d.toLocaleDateString('es-ES', o);
};
const fmtDMY = s => s ? s.split('-').reverse().join('/') : '';
const cuandoTxt = s => { const d = diasHasta(s); return d === 0 ? 'hoy' : d === 1 ? 'mañana' : d === -1 ? 'ayer' : `el ${fmtCorta(s)}`; };
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : null; };
const fmtNum = (n, d = 2) => n == null ? '' : n.toLocaleString('es-ES', { maximumFractionDigits: d });
const hashId = s => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return (Math.abs(h) % 2000000000) + 1; };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, ms);
}

/* Confirmación dentro de la app (sin diálogos del sistema) */
function confirmar(texto, { titulo = '¿Seguro?', ok = 'Borrar' } = {}) {
  return new Promise(res => {
    $('#cfTitle').textContent = titulo; $('#cfText').textContent = texto; $('#cfYes').textContent = ok;
    const fin = v => { $('#confirm').hidden = true; $('#cfYes').onclick = $('#cfNo').onclick = null; res(v); };
    $('#cfYes').onclick = () => fin(true); $('#cfNo').onclick = () => fin(false);
    $('#confirm').onclick = e => { if (e.target.id === 'confirm') fin(false); };
    $('#confirm').hidden = false;
  });
}

/* ---------- Fotos y vídeos ----------
   Cada archivo es { id, type, size, blob } (y "path" cuando se sincroniza). */
const mkMedia = blob => ({ id: uid(), type: blob.type || 'image/jpeg', size: blob.size, blob });
const mBlob = m => m instanceof Blob ? m : (m?.blob || null);
const isVid = m => ((m instanceof Blob ? m.type : m?.type) || '').startsWith('video/');
const urlFor = (() => {
  const cache = new WeakMap();
  return m => { const b = mBlob(m); if (!b) return ''; let u = cache.get(b); if (!u) { u = URL.createObjectURL(b); cache.set(b, u); } return u; };
})();
const mediaHtml = (m, cls = '') => !mBlob(m)
  ? `<span class="nomedia ${cls}">${m?.path ? 'Sin descargar' : 'En el otro móvil'}</span>`
  : isVid(m)
    ? `<video class="${cls}" src="${urlFor(m)}#t=0.1" preload="metadata" muted playsinline></video><span class="play"><span>▶</span></span>`
    : `<img class="${cls}" src="${urlFor(m)}" alt="">`;
const cuentaMedia = arr => {
  const v = arr.filter(isVid).length, f = arr.length - v;
  return [f ? `${f} foto${f > 1 ? 's' : ''}` : '', v ? `${v} vídeo${v > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
};
async function comprimir(file, max = 1600, q = 0.8) {
  let img = null;
  try { img = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) {}
  if (!img) img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', q));
}
const blobB64 = b => new Promise((res, rej) => {
  const f = new FileReader();
  f.onload = () => { const s = String(f.result); res(s.slice(s.indexOf(',') + 1)); };
  f.onerror = () => rej(f.error); f.readAsDataURL(b);
});
const b64Bytes = s => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
const fmtMB = n => n > 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

/* Selector de fotos/vídeos reutilizable: pinta miniaturas + botones Foto / Vídeo / Galería */
const ICON_CAM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
const ICON_VID = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3z"/></svg>';
const ICON_GAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>';
const ICON_BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>';
let destinoMedia = null; // { arr, pintar }
function pintarMedia(box, arr) {
  const pintar = () => pintarMedia(box, arr);
  box.innerHTML = '';
  arr.forEach((m, i) => {
    const d = document.createElement('div'); d.className = 'ph';
    d.innerHTML = `${mediaHtml(m)}<button type="button" class="x" aria-label="Quitar">✕</button>`;
    d.onclick = () => verMedia(arr, i);
    d.querySelector('.x').onclick = ev => { ev.stopPropagation(); arr.splice(i, 1); pintar(); };
    box.appendChild(d);
  });
  box.insertAdjacentHTML('beforeend',
    `<button type="button" class="add-ph" data-in="inCam">${ICON_CAM}Foto</button>` +
    `<button type="button" class="add-ph" data-in="inVid">${ICON_VID}Vídeo</button>` +
    `<button type="button" class="add-ph" data-in="inGal">${ICON_GAL}Galería</button>`);
  $$('.add-ph', box).forEach(b => b.onclick = () => { destinoMedia = { arr, pintar }; $('#' + b.dataset.in).click(); });
}
async function anadirArchivos(files) {
  const d = destinoMedia; if (!d) return;
  for (const f of files) {
    if (isVid(f)) {
      if (f.size > 200 * 1048576) { toast('Vídeo demasiado grande (máx. 200 MB). Graba uno más corto.'); continue; }
      d.arr.push(mkMedia(f));
      if (f.size > 50 * 1048576) toast(`Vídeo de ${fmtMB(f.size)}: se guarda en este móvil, pero es demasiado grande para compartirlo (máx. 50 MB)`, 5000);
      continue;
    }
    try { d.arr.push(mkMedia(await comprimir(f))); } catch (e) { toast('No se pudo leer una de las fotos'); }
  }
  d.pintar();
}
['inCam', 'inVid', 'inGal'].forEach(id => $('#' + id).onchange = e => { anadirArchivos([...e.target.files]); e.target.value = ''; });

/* Visor a pantalla completa */
let vList = [], vIdx = 0;
function verMedia(list, i) { vList = list; vIdx = i; pintarVisor(); $('#viewer').hidden = false; }
function pintarVisor() {
  const m = vList[vIdx], st = $('#viewerStage');
  st.innerHTML = !mBlob(m) ? (m?.path
      ? `<div style="color:#fff;text-align:center;display:grid;gap:12px">Este archivo aún no está en el móvil${m?.size ? ` (${fmtMB(m.size)})` : ''}.<button class="btn" id="vBajar">Descargar</button></div>`
      : `<div style="color:#fff;text-align:center;max-width:300px">Este vídeo pesa más de 50 MB y solo está en el móvil que lo grabó.</div>`)
    : isVid(m) ? `<video src="${urlFor(m)}" controls autoplay playsinline></video>` : `<img src="${urlFor(m)}" alt="">`;
  $('#vBajar')?.addEventListener('click', async e => {
    e.stopPropagation(); e.target.disabled = true; e.target.textContent = 'Descargando…';
    const ok = typeof Sync !== 'undefined' && await Sync.descargarUno(m);
    if (ok) { pintarVisor(); renderInc(); } else { e.target.disabled = false; e.target.textContent = 'Reintentar'; toast('No se pudo descargar. ¿Hay conexión?'); }
  });
  const many = vList.length > 1;
  $('#vPrev').hidden = !many || vIdx === 0; $('#vNext').hidden = !many || vIdx === vList.length - 1;
  $('#vCount').textContent = many ? `${vIdx + 1} / ${vList.length}` : '';
}
function cerrarVisor() { $('#viewerStage').innerHTML = ''; $('#viewer').hidden = true; }
const moverVisor = d => { const n = vIdx + d; if (n >= 0 && n < vList.length) { vIdx = n; pintarVisor(); } };
$('#vPrev').onclick = e => { e.stopPropagation(); moverVisor(-1); };
$('#vNext').onclick = e => { e.stopPropagation(); moverVisor(1); };
$('#vClose').onclick = cerrarVisor;
$('#viewer').addEventListener('click', e => { if (e.target.id === 'viewer' || e.target.id === 'viewerStage') cerrarVisor(); });
let vTx = null;
$('#viewer').addEventListener('touchstart', e => { vTx = e.touches[0].clientX; }, { passive: true });
$('#viewer').addEventListener('touchend', e => { if (vTx == null) return; const dx = e.changedTouches[0].clientX - vTx; vTx = null; if (Math.abs(dx) > 50) moverVisor(dx < 0 ? 1 : -1); });

/* Selector de fecha de revisión: No / 3 días / 1 semana / 2 semanas / 1 mes / otra fecha */
function selectorRevisar(box, get, set) {
  const opts = [['', 'No'], [3, '3 días'], [7, '1 semana'], [14, '2 semanas'], [30, '1 mes']];
  const pintar = () => {
    const v = get();
    box.innerHTML = `<div class="pick-row">${opts.map(([d, l]) =>
      `<button type="button" class="pchip" data-d="${d}" aria-pressed="${d === '' ? !v : v === addDays(today(), d)}">${l}</button>`).join('')}</div>
      <input type="date" class="dinput" aria-label="Otra fecha" value="${v || ''}" min="${today()}">
      ${v ? `<span class="hint">Te avisará ${cuandoTxt(v)} a las 9:00</span>` : ''}`;
    $$('.pchip', box).forEach(b => b.onclick = () => { set(b.dataset.d === '' ? null : addDays(today(), +b.dataset.d)); pintar(); });
    $('.dinput', box).onchange = e => { set(e.target.value || null); pintar(); };
  };
  pintar();
  return pintar;
}

/* Guardar un archivo (informe, copia): en la APK va a Documentos/LasLargas y se puede compartir */
async function guardarArchivo(nombre, blob, titulo = 'Archivo guardado') {
  const FS = plugin('Filesystem');
  if (!FS) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove(); toast('Archivo descargado'); return;
  }
  const data = await blobB64(blob);
  let r, dir = 'DOCUMENTS';
  try { await FS.requestPermissions?.(); } catch (e) {}
  try { r = await FS.writeFile({ path: `LasLargas/${nombre}`, data, directory: dir, recursive: true }); }
  catch (e) { dir = 'CACHE'; r = await FS.writeFile({ path: nombre, data, directory: dir }); }
  avisoArchivo({ uri: r.uri, dir, nombre, titulo, detalle: fmtMB(blob.size) });
}
function avisoArchivo({ uri, dir, nombre, titulo, detalle }) {
  $('#foTitle').textContent = titulo;
  $('#foText').innerHTML = dir === 'DOCUMENTS'
    ? `Guardado en <b>Documentos › LasLargas</b> del móvil.<br><span class="hint">${esc(nombre)} · ${esc(detalle)}</span>`
    : `Archivo listo (${esc(detalle)}). Compártelo para guardarlo en Drive, WhatsApp o el correo.`;
  $('#fileOk').hidden = false;
  $('#foShare').onclick = async () => {
    try { await plugin('Share').share({ title: nombre, files: [uri] }); }
    catch (err) { if (!/cancel/i.test(String(err?.message))) toast('No se pudo abrir compartir'); }
  };
}
$('#foClose').onclick = () => $('#fileOk').hidden = true;

/* Geometría de parcelas */
const areaHa = pts => {
  if (!pts || pts.length < 3) return 0;
  const R = 6378137, rad = Math.PI / 180; let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
    a += (p2[1] - p1[1]) * rad * (2 + Math.sin(p1[0] * rad) + Math.sin(p2[0] * rad));
  }
  return Math.abs(a * R * R / 2) / 10000;
};
const dentro = (lat, lng, pts) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [yi, xi] = pts[i], [yj, xj] = pts[j];
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) c = !c;
  }
  return c;
};
const fmtHa = ha => `${fmtNum(ha, ha < 10 ? 2 : 1)} ha`;

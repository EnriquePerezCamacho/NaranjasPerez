/* Sincronización entre móviles con Supabase.
   - Todo se guarda primero en el móvil; se sube y se baja cuando hay conexión.
   - Tabla "registros": una fila por incidencia, parcela o tratamiento (datos en JSON).
   - Fotos y vídeos en el almacenamiento "media", carpeta = id de la incidencia.
   - Si los dos editan lo mismo, gana el último cambio guardado. */
const Sync = (() => {
  const ls = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const lsSet = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} };
  const cfg = () => ({ url: (ls('sbUrl') || window.LL_CONFIG?.url || '').trim().replace(/\/+$/, ''), key: (ls('sbKey') || window.LL_CONFIG?.key || '').trim() });
  let sb = null, sbFirma = '', ocupado = false, otraVez = false, bajando = false, ultima = 0, ultimoError = '', usuario = null;

  /* Ninguna petición puede quedarse colgada: 30 s, o más si sube un archivo grande (mín. ~25 KB/s) */
  function fetchConLimite(url, opts = {}) {
    const b = opts.body, tam = b && typeof b.size === 'number' ? b.size : (typeof b === 'string' ? b.length : 0);
    const ms = 30000 + tam / 25;
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    opts.signal?.addEventListener?.('abort', () => ctl.abort());
    return fetch(url, { ...opts, signal: ctl.signal }).finally(() => clearTimeout(t));
  }
  async function cliente() {
    const { url, key } = cfg(); if (!url || !key) return null;
    if (sb && sbFirma === url + key) return sb;
    await cargarScript('lib/supabase.js');
    sb = window.supabase.createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'll-auth' },
      global: { fetch: fetchConLimite }
    });
    sbFirma = url + key; return sb;
  }
  async function sesion() {
    const c = await cliente(); if (!c) return null;
    const { data } = await c.auth.getSession();
    usuario = data?.session?.user || null; return data?.session || null;
  }

  /* ---------- Estado en la cabecera ---------- */
  function punto(e) {
    const d = $('#syncDot'), sin = e === 'off';
    $('#syncOff').hidden = !sin || !(cfg().url && cfg().key); d.hidden = sin;
    d.className = 'sync-dot ' + (e === 'busy' ? 'busy' : e === 'ok' ? 'ok' : e === 'err' ? 'err' : '');
    d.title = e === 'ok' ? 'Sincronizado' : e === 'busy' ? 'Sincronizando…' : e === 'err' ? 'Error de sincronización' : '';
  }
  const pendientes = () => ['inc', 'parcelas', 'trat'].reduce((n, k) => n + S[k].filter(r => r._sync).length, 0);

  /* ---------- Subir ---------- */
  const MAX_SUBIDA = 50 * 1048576; // límite por archivo del plan gratuito de Supabase
  const ref = m => ({ id: m.id, type: m.type, size: m.size, path: m.path || null, soloLocal: !!m.soloLocal });
  function limpio(k, r) {
    const { _sync, borrado, ...d } = r;
    if (k === 'inc') { d.fotos = (r.fotos || []).map(ref); d.seguimiento = (r.seguimiento || []).map(s => ({ ...s, fotos: (s.fotos || []).map(ref) })); }
    return d;
  }
  const errores = new Map(); // id -> motivo del último fallo
  const nombreError = m => /abort/i.test(m) ? 'La subida tardó demasiado (conexión lenta)' : /fetch|network/i.test(m) ? 'Sin conexión con el servidor' : m;
  const mediaPendiente = it => !it.borrado && todaMedia(it).some(m => !m.path && m.blob && !m.soloLocal && m.blob.size <= MAX_SUBIDA);
  async function subirMedia(c, it) {
    let cambio = false;
    for (const m of todaMedia(it)) {
      if (m.path || !m.blob) continue;
      if (m.blob.size > MAX_SUBIDA) { if (!m.soloLocal) { m.soloLocal = true; cambio = true; } continue; }
      const ext = ((m.type || '').split('/')[1] || 'bin').replace('jpeg', 'jpg').replace('quicktime', 'mov').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'bin';
      const path = `${it.id}/${m.id}.${ext}`;
      const { error } = await c.storage.from('media').upload(path, m.blob, { contentType: m.type || 'application/octet-stream', upsert: true });
      if (error) throw new Error('Subiendo fotos: ' + error.message);
      m.path = path; cambio = true;
    }
    return cambio;
  }
  const fila = (k, r) => ({ tabla: k, id: r.id, datos: r.borrado ? null : limpio(k, r), borrado: !!r.borrado, actualizado: r.actualizado || Date.now(), autor: ls('autor') || usuario?.email || null });
  async function enviarFilas(c, k, lote) {
    // Primero en bloque; si el bloque falla, uno a uno para que un registro malo no frene a los demás
    const { error } = await c.from('registros').upsert(lote.map(r => fila(k, r)), { onConflict: 'tabla,id' });
    if (!error) return lote;
    if (/fetch|network|abort/i.test(error.message) || /JWT|auth/i.test(error.message)) throw new Error(error.message);
    const ok = [];
    for (const r of lote) {
      const { error: e1 } = await c.from('registros').upsert([fila(k, r)], { onConflict: 'tabla,id' });
      if (e1) errores.set(r.id, e1.message); else ok.push(r);
    }
    return ok;
  }
  async function marcarSubido(k, r) {
    const cur = S[k].find(x => x.id === r.id);
    if (!cur || cur.actualizado !== r.actualizado) return;
    if (k === 'inc' && mediaPendiente(cur)) return; // se queda pendiente hasta que suban sus fotos
    cur._sync = 0; errores.delete(r.id); await DB.put(k, cur);
  }
  async function subir(c) {
    // Los vídeos de más de 50 MB se quedan en este móvil: se marca antes de enviar los datos
    for (const it of S.inc.filter(r => r._sync && !r.borrado)) {
      let ch = false; todaMedia(it).forEach(m => { if (!m.path && m.blob && m.blob.size > MAX_SUBIDA && !m.soloLocal) { m.soloLocal = true; ch = true; } });
      if (ch) await DB.put('inc', it);
    }
    // 1) Los datos (rápido): así las incidencias llegan aunque sus fotos tarden
    for (const k of ['parcelas', 'trat', 'inc']) {
      const sucios = S[k].filter(r => r._sync);
      for (let i = 0; i < sucios.length; i += 50) {
        const enviados = await enviarFilas(c, k, sucios.slice(i, i + 50));
        for (const r of enviados) { await marcarSubido(k, r); if (k === 'inc' && r.borrado) borrarArchivos(c, r.id); }
      }
    }
    // 2) Las fotos y vídeos, de uno en uno; si uno falla se pasa al siguiente
    let fallos = 0;
    for (const it of S.inc.filter(r => r._sync && !r.borrado)) {
      try {
        if (await subirMedia(c, it)) {
          await DB.put('inc', it);
          const { error } = await c.from('registros').upsert([fila('inc', it)], { onConflict: 'tabla,id' });
          if (error) throw new Error(error.message);
        }
        await marcarSubido('inc', it);
      } catch (e) {
        fallos++; errores.set(it.id, nombreError(e?.message || String(e)));
        if (/JWT|auth/i.test(e?.message || '')) throw e;
      }
    }
    if (fallos) throw new Error(`${fallos} incidencia${fallos > 1 ? 's' : ''} con fotos o vídeos sin subir (se reintentará)`);
  }
  async function borrarArchivos(c, id) {
    try {
      const { data } = await c.storage.from('media').list(id);
      if (data?.length) await c.storage.from('media').remove(data.map(f => `${id}/${f.name}`));
    } catch (e) {}
  }

  /* ---------- Bajar ---------- */
  async function aplicar(row) {
    const k = row.tabla; if (!S[k]) return false;
    const local = S[k].find(x => x.id === row.id);
    if (local && (local.actualizado || 0) > Number(row.actualizado)) return false;
    if (local && (local.actualizado || 0) === Number(row.actualizado)) {
      // Misma versión: solo pueden haber llegado rutas de fotos que antes faltaban
      if (k !== 'inc' || local.borrado || !row.datos) return false;
      const rem = new Map(); [...(row.datos.fotos || []), ...(row.datos.seguimiento || []).flatMap(s => s.fotos || [])].forEach(m => rem.set(m.id, m));
      let cambio = false;
      todaMedia(local).forEach(m => {
        const r = rem.get(m.id); if (!r) return;
        if (!m.path && r.path) { m.path = r.path; cambio = true; }
        if (!m.soloLocal && r.soloLocal && !m.blob) { m.soloLocal = true; cambio = true; }
      });
      if (cambio) await DB.put(k, local);
      return false;
    }
    let rec;
    if (row.borrado || !row.datos) rec = { id: row.id, borrado: true, actualizado: Number(row.actualizado), _sync: 0 };
    else {
      rec = { ...row.datos, id: row.id, actualizado: Number(row.actualizado), _sync: 0 };
      if (k === 'inc') {
        const blobs = new Map();
        if (local && !local.borrado) todaMedia(local).forEach(m => { if (m.blob) blobs.set(m.id, m.blob); });
        const poner = arr => (arr || []).map(m => ({ ...m, blob: blobs.get(m.id) || null }));
        rec.fotos = poner(rec.fotos); rec.seguimiento = (rec.seguimiento || []).map(s => ({ ...s, fotos: poner(s.fotos) }));
        rec = normalizarInc(rec).it; rec._sync = 0;
      }
    }
    await DB.put(k, rec);
    const i = S[k].findIndex(x => x.id === row.id); i >= 0 ? S[k][i] = rec : S[k].push(rec);
    return true;
  }
  async function bajar(c) {
    let cursor = (await DB.getMeta('sbCursor')) || '1970-01-01T00:00:00.000Z', n = 0;
    const desde = new Date(new Date(cursor).getTime() - 120000).toISOString(); // margen por si llegan desordenados
    for (let from = 0; ; from += 500) {
      const { data, error } = await c.from('registros').select('*').gt('servidor', desde).order('servidor', { ascending: true }).range(from, from + 499);
      if (error) throw new Error(error.message);
      for (const row of data) { if (await aplicar(row)) n++; if (row.servidor > cursor) cursor = row.servidor; }
      if (data.length < 500) break;
    }
    await DB.setMeta('sbCursor', cursor);
    return n;
  }
  async function bajarArchivo(c, m, it) {
    const { data, error } = await c.storage.from('media').download(m.path);
    if (error || !data) return false;
    m.blob = data.type ? data : new Blob([data], { type: m.type });
    await DB.put('inc', it); return true;
  }
  async function bajarFotos(c) {
    if (bajando) return; bajando = true; let n = 0;
    try {
      for (const it of vivos('inc')) for (const m of todaMedia(it)) {
        if (m.blob || !m.path || (m.size || 0) > 30 * 1048576) continue;
        if (await bajarArchivo(c, m, it)) { n++; if (n % 6 === 0) renderInc(); }
      }
    } finally { bajando = false; }
    if (n) { renderInc(); renderSiVisible(); }
  }

  /* ---------- Ciclo ---------- */
  async function sincronizar(manual = false) {
    if (ocupado) { otraVez = true; return; }
    const c = await cliente().catch(() => null); if (!c) { punto('off'); return; }
    if (!(await sesion())) { punto('off'); if (manual) abrir(); return; }
    if (!navigator.onLine) { punto('err'); ultimoError = 'Sin conexión'; if (manual) toast('Sin conexión: se sincronizará cuando vuelva'); return; }
    ocupado = true; punto('busy');
    try {
      await subir(c);
      const n = await bajar(c);
      if (n) { renderTodo(); Notif.reprogramar(); }
      ultima = Date.now(); ultimoError = ''; punto('ok');
      if (manual) toast(n ? `Sincronizado: ${n} cambio${n > 1 ? 's' : ''} recibido${n > 1 ? 's' : ''}` : 'Sincronizado: todo al día');
      bajarFotos(c);
    } catch (e) {
      const m = e?.message || String(e);
      ultimoError = /registros|PGRST205|relation .* does not exist|schema cache/i.test(m) ? 'Falta preparar el servidor (las tablas de Supabase)'
        : /bucket|not found/i.test(m) && /foto/i.test(m) ? 'Falta preparar el servidor (el almacenamiento de fotos)'
        : nombreError(m);
      punto('err');
      if (manual) toast('No se pudo sincronizar: ' + ultimoError, 5000);
    } finally {
      ocupado = false; pintarEstado(); if (vistaActual === 'lista') renderInc();
      if (otraVez) { otraVez = false; setTimeout(() => sincronizar(), 1500); }
    }
  }
  const pronto = debounce(() => sincronizar(), 3000);

  async function descargarUno(m) {
    const c = await cliente(); if (!c || !m.path) return false;
    const it = vivos('inc').find(i => todaMedia(i).some(x => x.id === m.id)); if (!it) return false;
    const real = todaMedia(it).find(x => x.id === m.id);
    const ok = await bajarArchivo(c, real, it); if (ok) m.blob = real.blob;
    return ok;
  }

  /* ---------- Pantalla de sincronización ---------- */
  function pintarEstado() {
    if ($('#syncSheet').hidden) return;
    const { url, key } = cfg(), p = pendientes();
    $('#syServer').open = !(url && key);
    $('#syUrl').value = url; $('#syKey').value = key;
    $('#syNombre').value = ls('autor');
    const dentro = !!usuario;
    $('#syLogin').hidden = dentro; $('#sySalir').hidden = !dentro;
    $('#syOk').textContent = dentro ? 'Sincronizar ahora' : 'Entrar';
    $('#syCerrar').textContent = dentro ? 'Cerrar' : 'Ahora no';
    $('#syTitle').textContent = dentro ? 'Compartir con otro móvil' : 'Entra para compartir los datos';
    $('#syEstado').innerHTML = !dentro
      ? (url && key ? '<b>Este móvil todavía no comparte nada.</b><br>Entra con el correo y la contraseña que creaste en Supabase. Desde ese momento lo que apuntes aquí le llegará al otro móvil, y lo del otro te llegará a ti.' : 'Faltan los datos del servidor.')
      : `Conectado como <b>${esc(usuario.email)}</b><br>` +
        (ocupado ? 'Sincronizando…' : ultimoError ? `<span style="color:var(--danger)">Último intento: ${esc(ultimoError)}</span>` : ultima ? `Última sincronización: ${new Date(ultima).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}` : 'Aún no se ha sincronizado') +
        `<br><span class="hint">${p ? `${p} cambio${p > 1 ? 's' : ''} pendiente${p > 1 ? 's' : ''} de subir` : 'Nada pendiente de subir'}</span>`;
    const lista = dentro ? ['inc', 'parcelas', 'trat'].flatMap(k => S[k].filter(r => r._sync).map(r => ({ k, r }))) : [];
    $('#syPend').hidden = !lista.length;
    $('#syPend').innerHTML = lista.length ? `<b>Pendiente de subir</b>` + lista.slice(0, 12).map(({ k, r }) => {
      const nom = r.borrado ? 'Borrado' : k === 'inc' ? r.titulo : k === 'parcelas' ? 'Parcela: ' + r.nombre : 'Tratamiento: ' + r.producto;
      const mot = errores.get(r.id) || (k === 'inc' && mediaPendiente(r) ? 'Faltan fotos o vídeos por subir' : 'En espera');
      return `<div class="small">• ${esc(nom || 'Sin título')} <span style="color:${errores.has(r.id) ? 'var(--danger)' : 'var(--muted)'}">— ${esc(mot)}</span></div>`;
    }).join('') + (lista.length > 12 ? `<div class="small">y ${lista.length - 12} más…</div>` : '') : '';
    $('#syArreglar').hidden = !dentro;
  }
  async function abrir() {
    $('#menu').hidden = true; $('#syncSheet').hidden = false;
    await sesion().catch(() => null); pintarEstado();
  }
  $('#mCuenta').onclick = abrir;
  $('#syncDot').onclick = abrir;
  $('#syncOff').onclick = abrir;
  $('#syReenviar').onclick = async () => {
    if (!(await confirmar('Se volverá a enviar todo lo que hay en este móvil. Úsalo si el otro móvil no ve alguna incidencia. Puede tardar si hay muchas fotos.', { titulo: 'Reenviar todo', ok: 'Reenviar' }))) return;
    for (const k of ['inc', 'parcelas', 'trat']) { S[k].forEach(r => r._sync = 1); await DB.putMany(k, S[k]); }
    toast('Reenviando todo…'); await sincronizar(true);
  };
  $('#syRecibir').onclick = async () => {
    await DB.setMeta('sbCursor', null); toast('Pidiendo todo al servidor…'); await sincronizar(true);
  };
  $('#syCerrar').onclick = () => { lsSet('autor', $('#syNombre').value.trim()); $('#syncSheet').hidden = true; };
  $('#sySalir').onclick = async () => {
    if (!(await confirmar('Los datos se quedan en este móvil, pero dejarán de compartirse hasta que vuelvas a entrar.', { titulo: 'Cerrar sesión', ok: 'Cerrar sesión' }))) return;
    try { await (await cliente())?.auth.signOut(); } catch (e) {}
    usuario = null; punto('off'); pintarEstado();
  };
  $('#syncForm').addEventListener('submit', async e => {
    e.preventDefault();
    lsSet('autor', $('#syNombre').value.trim());
    if (usuario) { await sincronizar(true); return; }
    const url = $('#syUrl').value.trim(), key = $('#syKey').value.trim(), email = $('#syEmail').value.trim(), pass = $('#syPass').value;
    if (!/^https?:\/\/.+/.test(url) || key.length < 20) { toast('Revisa la dirección y la clave del servidor'); $('#syServer').open = true; return; }
    if (!email || !pass) { toast('Escribe tu correo y contraseña'); return; }
    if (!$('#syNombre').value.trim()) { toast('Escribe tu nombre (sale en las notas)'); $('#syNombre').focus(); return; }
    if (url !== (window.LL_CONFIG?.url || '')) lsSet('sbUrl', url); else lsSet('sbUrl', '');
    if (key !== (window.LL_CONFIG?.key || '')) lsSet('sbKey', key); else lsSet('sbKey', '');
    const btn = $('#syOk'); btn.disabled = true; btn.textContent = 'Entrando…';
    try {
      const c = await cliente();
      const { data, error } = await c.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
      usuario = data.user; $('#syPass').value = '';
      toast('Sesión iniciada. Sincronizando…'); pintarEstado();
      await sincronizar(true);
    } catch (err) {
      const m = String(err?.message || err);
      toast(/invalid login/i.test(m) ? 'Correo o contraseña incorrectos' : /fetch|network/i.test(m) ? 'No se pudo conectar con el servidor' : 'No se pudo entrar: ' + m, 5000);
    } finally { btn.disabled = false; pintarEstado(); }
  });

  async function init() {
    alCambiar.push(() => { pronto(); });
    window.addEventListener('online', () => sincronizar());
    setInterval(() => { if (document.visibilityState === 'visible') sincronizar(); }, 90000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sincronizar(); });
    plugin('App')?.addListener('appStateChange', s => { if (s.isActive) sincronizar(); });
    const { url, key } = cfg();
    if (!(url && key)) return;
    let dentro = false;
    try { dentro = !!(await sesion()); } catch (e) {}
    if (dentro) { punto('ok'); sincronizar(); return; }
    punto('off');
    // Primera vez sin cuenta: se abre la pantalla de entrar. Si pulsa "Ahora no", no vuelve a salir sola (queda el aviso arriba).
    if (!ls('syncPreguntado')) { lsSet('syncPreguntado', '1'); abrir(); }
  }
  return { init, sincronizar, abrir, descargarUno, pendientes, conectado: () => !!usuario, error: id => errores.get(id) };
})();

/* Sincronización entre móviles con Supabase.
   - Todo se guarda primero en el móvil; se sube y se baja cuando hay conexión.
   - Tabla "registros": una fila por incidencia, parcela o tratamiento (datos en JSON).
   - Cada fila lleva el id de su finca; el servidor solo deja ver y tocar las fincas de las que eres miembro.
   - Fotos y vídeos en el almacenamiento "media", carpeta = id de la finca / id de la incidencia.
   - Si los dos editan lo mismo, gana el último cambio guardado. */
const Sync = (() => {
  const ls = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const lsSet = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} };
  const cfg = () => ({ url: (ls('sbUrl') || window.LL_CONFIG?.url || '').trim().replace(/\/+$/, ''), key: (ls('sbKey') || window.LL_CONFIG?.key || '').trim() });
  let sb = null, sbFirma = '', ocupado = false, otraVez = false, bajando = false, ultima = 0, ultimoError = '', usuario = null;

  /* Ninguna petición puede quedarse colgada: 30 s, o más si sube un archivo grande (mín. ~25 KB/s) */
  function fetchConLimite(url, opts = {}) {
    const b = opts.body, tam = b && typeof b.size === 'number' ? b.size : (typeof b === 'string' ? b.length : 0);
    const u = String(url), descarga = /\/storage\/v1\/object\//.test(u) && (!opts.method || opts.method === 'GET');
    const ms = descarga ? 600000 : 30000 + tam / 25;
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
    $('#syncOff').textContent = usuario ? 'Elegir finca' : 'Sin conectar';
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
  const nombreError = m => /abort/i.test(m) ? 'La subida tardó demasiado (conexión lenta)' : /fetch|network/i.test(m) ? 'Sin conexión con el servidor' : /row-level security|42501|permission denied/i.test(m) ? 'Sin permiso en esta finca (¿te han quitado del equipo?)' : m;
  const mediaPendiente = it => !it.borrado && todaMedia(it).some(m => !m.path && m.blob && !m.soloLocal && m.blob.size <= MAX_SUBIDA);
  async function subirMedia(c, it) {
    let cambio = false;
    for (const m of todaMedia(it)) {
      if (m.path || !m.blob) continue;
      if (m.blob.size > MAX_SUBIDA) { if (!m.soloLocal) { m.soloLocal = true; cambio = true; } continue; }
      const ext = ((m.type || '').split('/')[1] || 'bin').replace('jpeg', 'jpg').replace('quicktime', 'mov').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'bin';
      const path = `${Finca.id()}/${it.id}/${m.id}.${ext}`;
      const { error } = await c.storage.from('media').upload(path, m.blob, { contentType: m.type || 'application/octet-stream', upsert: true });
      if (error) throw new Error('Subiendo fotos: ' + error.message);
      m.path = path; cambio = true;
    }
    return cambio;
  }
  const fila = (k, r) => ({ finca_id: Finca.id(), tabla: k, id: r.id, datos: r.borrado ? null : limpio(k, r), borrado: !!r.borrado, actualizado: r.actualizado || Date.now(), autor: ls('autor') || usuario?.email || null });
  const CONFLICTO = { onConflict: 'finca_id,tabla,id' };
  async function enviarFilas(c, k, lote) {
    // Primero en bloque; si el bloque falla, uno a uno para que un registro malo no frene a los demás
    const { error } = await c.from('registros').upsert(lote.map(r => fila(k, r)), CONFLICTO);
    if (!error) return lote;
    if (/fetch|network|abort/i.test(error.message) || /JWT|auth/i.test(error.message)) throw new Error(error.message);
    const ok = [];
    for (const r of lote) {
      const { error: e1 } = await c.from('registros').upsert([fila(k, r)], CONFLICTO);
      if (e1) errores.set(r.id, nombreError(e1.message)); else ok.push(r);
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
    const llegaron = new Set();
    for (const k of ['parcelas', 'trat', 'inc']) {
      const sucios = S[k].filter(r => r._sync);
      for (let i = 0; i < sucios.length; i += 50) {
        const enviados = await enviarFilas(c, k, sucios.slice(i, i + 50));
        for (const r of enviados) { llegaron.add(k + ':' + r.id); await marcarSubido(k, r); } // las fotos de lo borrado se conservan para poder recuperarlo
      }
    }
    // 2) Las fotos y vídeos, de uno en uno; si uno falla se pasa al siguiente
    let fallos = 0;
    for (const it of S.inc.filter(r => r._sync && !r.borrado && llegaron.has('inc:' + r.id))) {
      try {
        if (await subirMedia(c, it)) {
          await DB.put('inc', it);
          const { error } = await c.from('registros').upsert([fila('inc', it)], CONFLICTO);
          if (error) throw new Error(error.message);
        }
        await marcarSubido('inc', it);
      } catch (e) {
        fallos++; errores.set(it.id, nombreError(e?.message || String(e)));
        if (/JWT|auth/i.test(e?.message || '')) throw e;
      }
    }
    const sinSubir = ['parcelas', 'trat', 'inc'].reduce((n, k) => n + S[k].filter(r => r._sync && !llegaron.has(k + ':' + r.id)).length, 0);
    if (sinSubir) return `${plural(sinSubir, 'cambio', 'cambios')} sin poder enviar (se reintentará)`;
    return fallos ? `${fallos} incidencia${fallos > 1 ? 's' : ''} con fotos o vídeos sin subir (se reintentará)` : '';
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
      const { data, error } = await c.from('registros').select('*').eq('finca_id', Finca.id()).gt('servidor', desde).order('servidor', { ascending: true }).range(from, from + 499);
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
      // primero las fotos (pequeñas), luego los vídeos
      const lista = vivos('inc').flatMap(it => todaMedia(it).filter(m => !m.blob && m.path).map(m => ({ it, m })))
        .sort((a, b) => (isVid(a.m) - isVid(b.m)) || ((a.m.size || 0) - (b.m.size || 0)));
      for (const { it, m } of lista) {
        if (!navigator.onLine || !usuario) break;
        const actual = porId('inc', it.id); if (!actual) continue;
        const real = todaMedia(actual).find(x => x.id === m.id); if (!real || real.blob) continue;
        try { if (await bajarArchivo(c, real, actual)) { n++; if (n % 4 === 0) renderInc(); } } catch (e) {}
      }
    } finally { bajando = false; }
    if (n) {
      renderInc(); renderSiVisible();
      if (!$('#viewer').hidden && $('#vBajar')) { const cur = vList[vIdx], r = vivos('inc').flatMap(todaMedia).find(x => x.id === cur?.id); if (r?.blob) { cur.blob = r.blob; pintarVisor(); } }
    }
  }

  /* ---------- Ciclo ---------- */
  async function sincronizar(manual = false) {
    if (ocupado) { otraVez = true; return; }
    const c = await cliente().catch(() => null); if (!c) { punto('off'); return; }
    if (!(await sesion()) || !Finca.id()) { punto('off'); if (manual) Cuenta.abrir(); return; }
    if (!navigator.onLine) { punto('err'); ultimoError = 'Sin conexión'; if (manual) toast('Sin conexión: se sincronizará cuando vuelva'); return; }
    ocupado = true; punto('busy');
    try {
      let aviso = await subir(c);
      if ([...errores.values()].some(m => /Sin permiso/.test(m))) {
        // ¿sigue siendo miembro?
        const { data } = await c.rpc('mis_fincas');
        if (data && !data.some(f => f.id === Finca.id())) {
          ultimoError = `Ya no formas parte de «${Finca.actual.nombre}»`; punto('err');
          toast(`Ya no formas parte de «${Finca.actual.nombre}». Elige otra finca`, 6000); Cuenta.abrir(); return;
        }
      }
      const n = await bajar(c);
      if (n) { renderTodo(); Notif.reprogramar(); }
      bajarFotos(c); // descarga automática de fotos y vídeos del otro móvil, siempre
      ultima = Date.now(); ultimoError = aviso; punto(aviso ? 'err' : 'ok');
      if (manual) toast(aviso ? 'Sincronizado, pero ' + aviso.charAt(0).toLowerCase() + aviso.slice(1) : n ? `Sincronizado: ${n} cambio${n > 1 ? 's' : ''} recibido${n > 1 ? 's' : ''}` : 'Sincronizado: todo al día', aviso ? 5000 : 2600);
    } catch (e) {
      const m = e?.message || String(e);
      ultimoError = /finca_id|registros|PGRST20|relation .* does not exist|schema cache|function/i.test(m) ? 'Falta actualizar el servidor (multifinca.sql)'
        : /row-level security|permission|violates/i.test(m) ? 'Ya no eres miembro de esta finca o no tienes permiso'
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
    const p = pendientes(), f = Finca.actual;
    $('#syNombre').value = ls('autor');
    $('#syEstado').innerHTML = !usuario || !Finca.id()
      ? '<b>Este móvil no comparte nada.</b><br>Entra con tu cuenta y elige una finca para compartir los datos con tu equipo.'
      : `Finca <b>${esc(f.nombre)}</b> · ${f.rol === 'dueno' ? 'dueño' : 'trabajador'}<br>Cuenta <b>${esc(usuario.email)}</b><br>` +
        (ocupado ? 'Sincronizando…' : ultimoError ? `<span style="color:var(--danger)">Último intento: ${esc(ultimoError)}</span>` : ultima ? `Última sincronización: ${new Date(ultima).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}` : 'Aún no se ha sincronizado') +
        `<br><span class="hint">${p ? `${p} cambio${p > 1 ? 's' : ''} pendiente${p > 1 ? 's' : ''} de subir` : 'Nada pendiente de subir'}</span>`;
    const dentro = !!usuario && !!Finca.id();
    const lista = dentro ? ['inc', 'parcelas', 'trat'].flatMap(k => S[k].filter(r => r._sync).map(r => ({ k, r }))) : [];
    $('#syPend').hidden = !lista.length;
    $('#syPend').innerHTML = lista.length ? `<b>Pendiente de subir</b>` + lista.slice(0, 12).map(({ k, r }) => {
      const nom = r.borrado ? 'Borrado' : k === 'inc' ? r.titulo : k === 'parcelas' ? 'Parcela: ' + r.nombre : 'Tratamiento: ' + (r.producto || 'recorrido');
      const mot = errores.get(r.id) || (k === 'inc' && mediaPendiente(r) ? 'Faltan fotos o vídeos por subir' : 'En espera');
      return `<div class="small">• ${esc(nom || 'Sin título')} <span style="color:${errores.has(r.id) ? 'var(--danger)' : 'var(--muted)'}">— ${esc(mot)}</span></div>`;
    }).join('') + (lista.length > 12 ? `<div class="small">y ${lista.length - 12} más…</div>` : '') : '';
    $('#syArreglar').hidden = !dentro; $('#syOk').hidden = !dentro;
    $('#sySalir').hidden = !usuario; $('#syEntrar').hidden = !!usuario && !!Finca.id();
    $('#syEntrar').textContent = usuario ? 'Elegir finca' : 'Entrar o crear cuenta';
  }
  async function abrir() {
    $('#menu').hidden = true; $('#syncSheet').hidden = false;
    await sesion().catch(() => null); pintarEstado();
  }
  $('#mCuenta').onclick = abrir;
  $('#syncDot').onclick = abrir;
  $('#syncOff').onclick = () => Cuenta.abrir();
  $('#syEntrar').onclick = () => { $('#syncSheet').hidden = true; Cuenta.abrir(); };
  $('#syReenviar').onclick = async () => {
    if (!(await confirmar('Se volverá a enviar todo lo que hay en este móvil. Úsalo si a otro miembro le falta algo. Puede tardar si hay muchas fotos.', { titulo: 'Reenviar todo', ok: 'Reenviar' }))) return;
    for (const k of ['inc', 'parcelas', 'trat']) { S[k].forEach(r => r._sync = 1); await DB.putMany(k, S[k]); }
    toast('Reenviando todo…'); await sincronizar(true);
  };
  $('#syRecibir').onclick = async () => {
    await DB.setMeta('sbCursor', null); toast('Pidiendo todo al servidor…'); await sincronizar(true);
  };
  const guardarNombre = () => {
    const n = $('#syNombre').value.trim(); if (n === ls('autor')) return;
    lsSet('autor', n);
    if (Finca.id()) cliente().then(async c => { await c?.rpc('mi_nombre', { f: Finca.id(), p_nombre: n }); }).catch(() => {});
  };
  $('#syCerrar').onclick = () => { guardarNombre(); $('#syncSheet').hidden = true; };
  $('#syncForm').addEventListener('submit', async e => { e.preventDefault(); guardarNombre(); await sincronizar(true); });
  $('#sySalir').onclick = () => Cuenta.salir();

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
    if (dentro && Finca.id()) { punto('ok'); sincronizar(); } else punto('off');
  }
  return { init, sincronizar, abrir, descargarUno, pendientes, cliente, sesion, punto,
    usuario: () => usuario, setUsuario: u => { usuario = u; }, conectado: () => !!usuario && !!Finca.id(), error: id => errores.get(id) };
})();

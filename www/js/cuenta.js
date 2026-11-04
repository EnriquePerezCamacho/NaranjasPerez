/* Cuentas, fincas, equipo e historial */
const Cuenta = (() => {
  const ls = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const lsSet = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} };
  let modo = 'entrar', fincas = [];

  const mensaje = e => {
    const m = String(e?.message || e || '');
    if (/invalid login/i.test(m)) return 'Correo o contraseña incorrectos';
    if (/already registered|already been registered/i.test(m)) return 'Ya hay una cuenta con ese correo. Entra con ella';
    if (/at least 6|password should/i.test(m)) return 'La contraseña tiene que tener al menos 6 caracteres';
    if (/not confirmed/i.test(m)) return 'Confirma tu correo: te hemos enviado un enlace';
    if (/signups not allowed|signup.*disabled/i.test(m)) return 'El registro de cuentas nuevas está desactivado en el servidor';
    if (/valid email|invalid.*email|unable to validate email/i.test(m)) return 'Ese correo no es válido';
    if (/could not find the function|PGRST202|schema cache/i.test(m)) return 'El servidor aún no está actualizado para fincas (falta multifinca.sql)';
    if (/rate limit|too many/i.test(m)) return 'Demasiados intentos. Espera un poco y vuelve a probar';
    if (/fetch|network|abort/i.test(m)) return 'No se pudo conectar con el servidor. ¿Hay internet?';
    return m;
  };
  const cliente = () => Sync.cliente();

  /* ---------- Cabecera y menú ---------- */
  function pintarCabecera() {
    $('#fincaNom').textContent = Finca.local() ? 'CampControl' : Finca.actual.nombre;
    $('#mEquipo').hidden = Finca.local();
    $('#mHist').hidden = Finca.local() || !Finca.esDueno();
  }

  /* ---------- Bienvenida ---------- */
  function paso(p) {
    $('#bienv').hidden = false;
    $('#bvEntrar').hidden = p !== 'entrar';
    $('#bvFincas').hidden = p !== 'fincas';
    $('#bvLocal').textContent = Finca.actual ? 'Volver' : 'Usar sin cuenta (solo en este móvil)';
    $('#bvMsg').textContent = '';
  }
  function cerrar() { $('#bienv').hidden = true; }
  function setModo(m) {
    modo = m;
    $$('#bvModo button').forEach(b => b.setAttribute('aria-pressed', b.dataset.m === m));
    $('#bvNomWrap').hidden = m !== 'crear';
    $('#bvOk').textContent = m === 'crear' ? 'Crear cuenta' : 'Entrar';
    $('#bvPass').autocomplete = m === 'crear' ? 'new-password' : 'current-password';
  }
  $$('#bvModo button').forEach(b => b.onclick = () => setModo(b.dataset.m));

  async function abrir() {
    $('#menu').hidden = true;
    let ses = null;
    try { ses = await Sync.sesion(); } catch (e) {}
    if (!ses) { setModo('entrar'); paso('entrar'); return; }
    paso('fincas'); await cargarFincas();
  }

  $('#bvEntrar').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#bvEmail').value.trim(), pass = $('#bvPass').value, nom = $('#bvNom').value.trim();
    if (!email || !pass) { $('#bvMsg').textContent = 'Escribe tu correo y tu contraseña'; return; }
    if (modo === 'crear' && !nom) { $('#bvMsg').textContent = 'Escribe tu nombre: es el que verá tu equipo'; $('#bvNom').focus(); return; }
    const btn = $('#bvOk'); btn.disabled = true; btn.textContent = modo === 'crear' ? 'Creando…' : 'Entrando…';
    try {
      const c = await cliente(); if (!c) throw new Error('Falta configurar el servidor');
      let r;
      if (modo === 'crear') {
        r = await c.auth.signUp({ email, password: pass, options: { data: { nombre: nom } } });
        if (r.error) throw r.error;
        if (!r.data.session) { setModo('entrar'); $('#bvMsg').textContent = 'Cuenta creada. Revisa tu correo para confirmarla y después entra.'; return; }
        lsSet('autor', nom);
      } else {
        r = await c.auth.signInWithPassword({ email, password: pass });
        if (r.error) throw r.error;
        if (!ls('autor')) lsSet('autor', r.data.user?.user_metadata?.nombre || email.split('@')[0]);
      }
      Sync.setUsuario(r.data.user); $('#bvPass').value = '';
      paso('fincas'); await cargarFincas(true);
    } catch (err) { $('#bvMsg').textContent = mensaje(err); }
    finally { btn.disabled = false; setModo(modo); }
  });

  async function cargarFincas(auto = false) {
    const box = $('#bvLista'); box.innerHTML = '<p class="small">Cargando tus fincas…</p>';
    $('#bvHola').textContent = ls('autor') ? `Hola, ${ls('autor')}` : 'Tus fincas';
    try {
      const c = await cliente();
      const { data, error } = await c.rpc('mis_fincas');
      if (error) throw error;
      fincas = data || [];
    } catch (err) { box.innerHTML = `<p class="small" style="color:var(--danger)">${esc(mensaje(err))}</p>`; return; }
    if (!fincas.length) { box.innerHTML = '<p class="small">Todavía no estás en ninguna finca. Únete con el código que te dé el dueño o crea la tuya.</p>'; return; }
    // Recién entrado y con una sola finca: se entra directamente
    if (auto && fincas.length === 1 && !Finca.id()) { await elegir(fincas[0]); return; }
    box.innerHTML = '';
    fincas.forEach(f => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'fcard';
      b.setAttribute('aria-current', Finca.id() === f.id);
      b.innerHTML = `<span class="grow"><b>${esc(f.nombre)}</b><span class="small">${plural(Number(f.miembros), 'persona', 'personas')}</span></span>
        <span class="rol ${f.rol}">${f.rol === 'dueno' ? 'Dueño' : 'Trabajador'}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg>`;
      b.onclick = () => elegir(f);
      box.appendChild(b);
    });
  }

  async function elegir(f) {
    if (Finca.id() === f.id) { Finca.set({ id: f.id, nombre: f.nombre, rol: f.rol }); pintarCabecera(); cerrar(); return; }
    // Datos que había en el móvil antes de usar fincas
    const ant = await BaseLocal.cuenta(Finca.LOCAL);
    if (ant.n && !ant.migrado) {
      const ok = await confirmar(`Este móvil tiene datos de antes de usar fincas (${plural(ant.inc, 'incidencia', 'incidencias')} y más). ¿Pasarlos a «${f.nombre}»? Los verá todo su equipo.`, { titulo: 'Datos de este móvil', ok: 'Pasarlos' });
      if (ok) { toast('Pasando los datos…', 8000); await BaseLocal.copiar(Finca.LOCAL, 'cc-' + f.id); }
    }
    Finca.set({ id: f.id, nombre: f.nombre, rol: f.rol });
    if (ls('autor')) { try { await (await cliente())?.rpc('mi_nombre', { f: f.id, p_nombre: ls('autor') }); } catch (e) {} }
    location.reload();
  }

  $('#bvUnirse').onclick = async () => {
    const cod = $('#bvCodigo').value.trim(); if (!cod) { toast('Escribe el código'); return; }
    const b = $('#bvUnirse'); b.disabled = true;
    try {
      const { data, error } = await (await cliente()).rpc('unirse_finca', { p_codigo: cod, p_mi_nombre: ls('autor') });
      if (error) throw error;
      toast(`Te has unido a «${data.nombre}»`);
      await elegir({ id: data.id, nombre: data.nombre, rol: 'trabajador' });
    } catch (err) { toast(mensaje(err), 5000); }
    finally { b.disabled = false; }
  };
  $('#bvCrear').onclick = async () => {
    const nom = $('#bvNueva').value.trim(); if (!nom) { toast('Escribe el nombre de la finca'); $('#bvNueva').focus(); return; }
    const b = $('#bvCrear'); b.disabled = true;
    try {
      const { data, error } = await (await cliente()).rpc('crear_finca', { p_nombre: nom, p_mi_nombre: ls('autor') });
      if (error) throw error;
      toast(`Finca «${nom}» creada`);
      await elegir({ id: data, nombre: nom, rol: 'dueno' });
    } catch (err) { toast(mensaje(err), 5000); }
    finally { b.disabled = false; }
  };
  $('#bvLocal').onclick = () => {
    if (!Finca.actual) Finca.set({ id: 'local', nombre: 'Este móvil', rol: 'dueno', local: true });
    cerrar(); pintarCabecera();
  };
  $('#bvSalir').onclick = () => salir();

  async function salir() {
    const p = Finca.id() ? Sync.pendientes() : 0;
    if (!(await confirmar(p ? `Hay ${plural(p, 'cambio', 'cambios')} sin enviar todavía. Si cierras sesión no se enviarán hasta que vuelvas a entrar.` : 'Cerrarás sesión en este móvil. Los datos de la finca siguen en el servidor.', { titulo: 'Cerrar sesión', ok: 'Cerrar sesión' }))) return;
    try { await (await cliente())?.auth.signOut(); } catch (e) {}
    Sync.setUsuario(null); Finca.set(null); location.reload();
  }

  /* ---------- Equipo ---------- */
  let equipo = [];
  async function abrirEquipo() {
    $('#menu').hidden = true;
    if (Finca.local()) { toast('Primero entra con tu cuenta y elige una finca'); abrir(); return; }
    $('#equipoSheet').hidden = false;
    $('#eqTitulo').textContent = Finca.actual.nombre;
    $('#eqLista').innerHTML = '<p class="small">Cargando…</p>';
    await pintarEquipo();
  }
  async function pintarEquipo() {
    const c = await cliente(), yo = Sync.usuario()?.id, f = Finca.id();
    try {
      const { data, error } = await c.from('miembros').select('user_id,rol,nombre,email,unido').eq('finca_id', f).order('unido');
      if (error) throw error;
      equipo = data || [];
    } catch (err) { $('#eqLista').innerHTML = `<p class="small" style="color:var(--danger)">${esc(mensaje(err))}</p>`; return; }
    // mi rol puede haber cambiado
    const mio = equipo.find(m => m.user_id === yo);
    if (!mio) { toast('Ya no eres miembro de esta finca'); Finca.set(null); location.reload(); return; }
    if (mio.rol !== Finca.actual.rol) { Finca.set({ ...Finca.actual, rol: mio.rol }); pintarCabecera(); }
    const dueno = mio.rol === 'dueno';
    $('#eqCodigoBox').hidden = !dueno; $('#eqRenombrar').hidden = !dueno;
    $('#eqSalir').hidden = false;
    if (dueno) {
      try { const { data } = await c.rpc('codigo_finca', { f }); $('#eqCodigo').textContent = data || '······'; } catch (e) {}
    }
    const nDuenos = equipo.filter(m => m.rol === 'dueno').length;
    $('#eqLista').innerHTML = `<span class="lbl">${plural(equipo.length, 'persona', 'personas')} en la finca</span>`;
    equipo.forEach(m => {
      const el = document.createElement('div'); el.className = 'miembro';
      const yoMismo = m.user_id === yo;
      el.innerHTML = `<div style="min-width:0"><b>${esc(m.nombre || m.email?.split('@')[0] || 'Sin nombre')}${yoMismo ? ' (tú)' : ''}</b><div class="small" style="overflow-wrap:anywhere">${esc(m.email || '')}</div></div>
        <span class="rol ${m.rol}">${m.rol === 'dueno' ? 'Dueño' : 'Trabajador'}</span>
        ${dueno && !yoMismo ? `<div class="acc">
          <button class="btn sm" data-a="rol">${m.rol === 'dueno' ? 'Pasar a trabajador' : 'Hacer dueño'}</button>
          <button class="btn sm danger" data-a="quitar">Quitar de la finca</button></div>` : ''}
        ${dueno && yoMismo && nDuenos > 1 ? `<div class="acc"><button class="btn sm" data-a="rol">Pasar a trabajador</button></div>` : ''}`;
      el.addEventListener('click', async e => {
        const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
        const nombre = m.nombre || m.email;
        try {
          if (a === 'rol') {
            const nuevo = m.rol === 'dueno' ? 'trabajador' : 'dueno';
            if (!(await confirmar(nuevo === 'dueno' ? `${nombre} podrá gestionar el equipo y ver el historial.` : `${nombre} dejará de ver el historial y de gestionar el equipo.`, { titulo: nuevo === 'dueno' ? 'Hacer dueño' : 'Pasar a trabajador', ok: 'Cambiar' }))) return;
            const { error } = await c.rpc('cambiar_rol', { f, u: m.user_id, p_rol: nuevo }); if (error) throw error;
          }
          if (a === 'quitar') {
            if (!(await confirmar(`${nombre} dejará de ver y de poder tocar los datos de la finca. Lo que haya apuntado se queda.`, { titulo: 'Quitar de la finca', ok: 'Quitar' }))) return;
            const { error } = await c.rpc('quitar_miembro', { f, u: m.user_id }); if (error) throw error;
          }
          await pintarEquipo();
        } catch (err) { toast(mensaje(err), 5000); }
      });
      $('#eqLista').appendChild(el);
    });
    $('#eqInfo').textContent = dueno ? 'Todos pueden añadir, cambiar y borrar. Solo los dueños gestionan el equipo y ven el historial.' : 'Si necesitas algo del equipo, habla con el dueño de la finca.';
  }
  const textoInvitacion = () => `Únete a la finca «${Finca.actual.nombre}» en CampControl con este código: ${$('#eqCodigo').textContent}`;
  $('#eqCopiar').onclick = async () => {
    try { await navigator.clipboard.writeText($('#eqCodigo').textContent); toast('Código copiado'); }
    catch (e) { const r = document.createRange(); r.selectNodeContents($('#eqCodigo')); getSelection().removeAllRanges(); getSelection().addRange(r); toast('Mantén pulsado para copiar'); }
  };
  $('#eqCompartir').onclick = async () => {
    try {
      const Sh = plugin('Share');
      if (Sh) await Sh.share({ title: 'Invitación a CampControl', text: textoInvitacion() });
      else if (navigator.share) await navigator.share({ text: textoInvitacion() });
      else { await navigator.clipboard.writeText(textoInvitacion()); toast('Invitación copiada: pégala en WhatsApp'); }
    } catch (e) { if (!/cancel|abort/i.test(String(e?.message || e))) toast('No se pudo compartir'); }
  };
  $('#eqRenovar').onclick = async () => {
    if (!(await confirmar('El código anterior dejará de servir. Quien ya está en la finca sigue dentro.', { titulo: 'Cambiar código', ok: 'Cambiar' }))) return;
    try { const { data, error } = await (await cliente()).rpc('codigo_finca', { f: Finca.id(), renovar: true }); if (error) throw error; $('#eqCodigo').textContent = data; toast('Código cambiado'); }
    catch (err) { toast(mensaje(err), 5000); }
  };
  function renombrar() {
    const h = $('#eqTitulo'); if (h.querySelector('input')) return;
    h.innerHTML = `<input class="dinput" id="eqNuevoNom" maxlength="60" value="${esc(Finca.actual.nombre)}" style="font-size:1rem">`;
    const inp = $('#eqNuevoNom'); inp.focus(); inp.select();
    $('#eqRenombrar').textContent = 'Guardar';
    $('#eqRenombrar').onclick = async () => {
      const n = inp.value.trim(); if (!n) return;
      try {
        const { error } = await (await cliente()).rpc('renombrar_finca', { f: Finca.id(), p_nombre: n }); if (error) throw error;
        Finca.set({ ...Finca.actual, nombre: n }); pintarCabecera(); toast('Nombre cambiado');
      } catch (err) { toast(mensaje(err), 5000); }
      h.textContent = Finca.actual.nombre; $('#eqRenombrar').textContent = 'Cambiar nombre'; $('#eqRenombrar').onclick = renombrar;
    };
  }
  $('#eqRenombrar').onclick = renombrar;
  const renombrarInicial = renombrar;
  $('#eqCerrar').onclick = () => { $('#equipoSheet').hidden = true; $('#eqTitulo').textContent = Finca.actual?.nombre || ''; $('#eqRenombrar').textContent = 'Cambiar nombre'; $('#eqRenombrar').onclick = renombrarInicial; };
  $('#eqSalir').onclick = async () => {
    if (!(await confirmar(`Dejarás de ver los datos de «${Finca.actual.nombre}». Para volver necesitarás un código nuevo.`, { titulo: 'Salir de la finca', ok: 'Salir' }))) return;
    try {
      const { error } = await (await cliente()).rpc('quitar_miembro', { f: Finca.id(), u: Sync.usuario()?.id }); if (error) throw error;
      Finca.set(null); location.reload();
    } catch (err) { toast(mensaje(err), 5000); }
  };

  /* ---------- Historial ---------- */
  const VERBO = { crear: 'añadió', editar: 'cambió', borrar: 'borró', restaurar: 'recuperó' };
  const ICONO = { crear: '+', editar: '✎', borrar: '✕', restaurar: '↺' };
  const QUE = { inc: 'la incidencia', trat: 'el tratamiento', parcelas: 'la parcela' };
  const CAMPOS = {
    inc: { titulo: 'Título', tipo: 'Tipo', estado: 'Estado', fecha: 'Fecha', desc: 'Qué le ocurre', parcela: 'Parcela', fila: 'Fila', arbol: 'Árbol', revisar: 'Revisar el', fotos: 'Fotos y vídeos', seguimiento: 'Notas de seguimiento', lat: 'Ubicación' },
    trat: { fecha: 'Fecha', producto: 'Producto', materia: 'Materia activa', dosis: 'Dosis', unidad: 'Unidad', caldo: 'Caldo (L)', plazo: 'Plazo de seguridad (días)', motivo: 'Motivo', aplicador: 'Aplicador', parcelas: 'Parcelas', notas: 'Notas', recorrido: 'Recorrido' },
    parcelas: { nombre: 'Nombre', variedad: 'Variedad', notas: 'Notas', color: 'Color', puntos: 'Forma' }
  };
  function valor(tabla, k, d) {
    const v = d?.[k];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '—';
    if (k === 'tipo') return TIPOS[v]?.n || v;
    if (k === 'fecha' || k === 'revisar') return fmtDate(v);
    if (k === 'parcela') return nombreParcela(v) || 'Parcela borrada';
    if (k === 'parcelas') return v.map(id => nombreParcela(id) || 'Parcela borrada').join(', ');
    if (k === 'fotos') return cuentaMedia(v) || '—';
    if (k === 'seguimiento') return plural(v.length, 'nota', 'notas') + (v.length ? `: «${String(v.at(-1).texto || 'solo fotos').slice(0, 80)}»` : '');
    if (k === 'lat') return `${Number(d.lat).toFixed(5)}, ${Number(d.lng).toFixed(5)}`;
    if (k === 'puntos') return `${v.length} esquinas · ${fmtHa(areaHa(v))}`;
    if (k === 'recorrido') return typeof Rec !== 'undefined' && v.puntos ? Rec.resumen(v) : (v.paradas ? plural(v.paradas.length, 'parada', 'paradas') : 'sí');
    if (k === 'color') return `<span class="sw" style="display:inline-block;width:14px;height:14px;border-radius:4px;background:${esc(v)};vertical-align:-2px"></span>`;
    return esc(String(v));
  }
  let hFiltro = { persona: '', accion: '' }, hDesde = 0, hTodos = [];
  async function abrirHist() {
    $('#menu').hidden = true;
    if (Finca.local() || !Finca.esDueno()) { toast('El historial solo lo ven los dueños de la finca'); return; }
    vista('hist');
    // personas para el filtro
    try {
      const { data } = await (await cliente()).from('miembros').select('user_id,nombre,email').eq('finca_id', Finca.id());
      $('#hvPersona').innerHTML = '<option value="">Todas las personas</option>' + (data || []).map(m => `<option value="${m.user_id}">${esc(m.nombre || m.email)}</option>`).join('');
      $('#hvPersona').value = hFiltro.persona;
    } catch (e) {}
    await cargarHist(true);
  }
  async function cargarHist(reset) {
    if (reset) { hDesde = 0; hTodos = []; $('#hvLista').innerHTML = '<p class="small">Cargando…</p>'; }
    try {
      let q = (await cliente()).from('historial').select('*').eq('finca_id', Finca.id()).order('cuando', { ascending: false }).range(hDesde, hDesde + 49);
      if (hFiltro.persona) q = q.eq('usuario', hFiltro.persona);
      if (hFiltro.accion === 'crear') q = q.in('accion', ['crear', 'restaurar']);
      else if (hFiltro.accion) q = q.eq('accion', hFiltro.accion);
      const { data, error } = await q; if (error) throw error;
      hTodos = hTodos.concat(data || []); hDesde += (data || []).length;
      $('#hvMas').hidden = (data || []).length < 50;
    } catch (err) { $('#hvLista').innerHTML = `<p class="small" style="color:var(--danger)">${esc(mensaje(err))}</p>`; return; }
    pintarHist();
  }
  function diaTxt(d) {
    const s = isoLocal(d), dd = diasHasta(s);
    return dd === 0 ? 'Hoy' : dd === -1 ? 'Ayer' : new Date(d).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  function pintarHist() {
    const box = $('#hvLista'); box.innerHTML = '';
    if (!hTodos.length) { box.innerHTML = '<div class="empty"><strong>Sin cambios</strong>Aquí aparecerá cada vez que alguien añada, cambie o borre algo.</div>'; return; }
    let dia = '';
    hTodos.forEach(h => {
      const d = diaTxt(h.cuando); if (d !== dia) { dia = d; box.insertAdjacentHTML('beforeend', `<div class="hdia">${esc(d)}</div>`); }
      const b = document.createElement('button'); b.className = 'hitem';
      b.innerHTML = `<span class="ic ${h.accion}">${ICONO[h.accion]}</span>
        <span class="tx"><b>${esc(h.usuario_nombre || 'Alguien')}</b> ${VERBO[h.accion]} ${QUE[h.tabla] || ''} «${esc(h.titulo || 'sin título')}»</span>
        <span class="hora">${new Date(h.cuando).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>`;
      b.onclick = () => verCambio(h);
      box.appendChild(b);
    });
  }
  function verCambio(h) {
    const campos = CAMPOS[h.tabla] || {};
    $('#hsTitulo').textContent = `${VERBO[h.accion][0].toUpperCase() + VERBO[h.accion].slice(1)} ${QUE[h.tabla] || ''}`.trim();
    $('#hsQuien').textContent = `${h.usuario_nombre || 'Alguien'} · ${new Date(h.cuando).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
    let html = '';
    if (h.accion === 'editar' && h.antes && h.despues) {
      const cambios = Object.keys(campos).filter(k => {
        if (k === 'lat') return h.antes.lat !== h.despues.lat || h.antes.lng !== h.despues.lng;
        return JSON.stringify(h.antes[k] ?? null) !== JSON.stringify(h.despues[k] ?? null) && !(k === 'recorrido');
      });
      html = cambios.length ? `<div class="difs">${cambios.map(k => `<div class="dif"><div class="k">${campos[k]}</div><div class="a">${valor(h.tabla, k, h.antes)}</div><div class="b">${valor(h.tabla, k, h.despues)}</div></div>`).join('')}</div>`
        : '<p class="small">Cambios en datos internos (por ejemplo, fotos que terminaron de subir o un recorrido grabándose).</p>';
    } else {
      const d = h.accion === 'borrar' ? h.antes : h.despues;
      const ks = Object.keys(campos).filter(k => valor(h.tabla, k, d) !== '—');
      html = d ? `<div class="difs">${ks.map(k => `<div class="dif"><div class="k">${campos[k]}</div><div>${valor(h.tabla, k, d)}</div></div>`).join('')}</div>` : '<p class="small">Sin detalles.</p>';
    }
    $('#hsCambios').innerHTML = html;
    const sigueBorrado = !porId(h.tabla, h.registro_id);
    $('#hsRestaurar').hidden = !(h.accion === 'borrar' && h.antes && sigueBorrado);
    $('#hsRestaurar').onclick = () => restaurar(h);
    $('#histSheet').hidden = false;
  }
  async function restaurar(h) {
    let rec = { ...h.antes, id: h.registro_id };
    delete rec._sync;
    if (h.tabla === 'inc') {
      const poner = arr => (arr || []).map(m => ({ ...m, blob: null }));
      rec.fotos = poner(rec.fotos); rec.seguimiento = (rec.seguimiento || []).map(s => ({ ...s, fotos: poner(s.fotos) }));
      rec = normalizarInc(rec).it;
    }
    await guardar(h.tabla, rec);
    $('#histSheet').hidden = true; renderTodo(); Notif.reprogramar();
    toast('Recuperado. Las fotos se descargarán en un momento', 4000);
    Sync.sincronizar(); setTimeout(() => cargarHist(true), 2500);
  }
  $('#hsCerrar').onclick = () => { $('#histSheet').hidden = true; };
  $('#hvVolver').onclick = () => vista('mapa');
  $('#hvMas').onclick = () => cargarHist(false);
  $('#hvPersona').onchange = e => { hFiltro.persona = e.target.value; cargarHist(true); };
  $('#hvAccion').addEventListener('click', e => {
    const v = e.target.dataset.v; if (v === undefined) return; hFiltro.accion = v;
    $$('#hvAccion button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v)); cargarHist(true);
  });

  /* ---------- Botones ---------- */
  $('#fincaBtn').onclick = () => abrir();
  $('#mFincas').onclick = () => abrir();
  $('#mEquipo').onclick = abrirEquipo;
  $('#mHist').onclick = abrirHist;

  async function init() {
    pintarCabecera();
    if (Finca.actual) return;
    // Sin finca elegida: si ya hay sesión (versión anterior) se buscan sus fincas; si no, bienvenida
    let ses = null;
    try { ses = await Sync.sesion(); } catch (e) {}
    if (ses) { paso('fincas'); await cargarFincas(true); }
    else { setModo('entrar'); paso('entrar'); }
  }
  return { init, abrir, salir, pintarCabecera };
})();

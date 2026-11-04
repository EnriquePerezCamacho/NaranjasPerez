/* Recorrido con el tractor.
   - Dibuja una línea por donde vas tratando.
   - «Se acabó el producto» marca una parada; mientras vas a cargar la línea sale discontinua.
   - Al volver, una flecha y la distancia te llevan a la parada; «Seguir tratando» continúa la línea.
   - Se guarda dentro de un tratamiento (campo "recorrido"), así se sincroniza y queda en el cuaderno de campo.
   Puntos: [lat, lng, hora(ms), 1 = tratando | 0 = sin producto] */
const Rec = (() => {
  const ls = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const lsSet = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} };
  const capa = L.layerGroup().addTo(map);       // recorrido que se está grabando
  const capaVer = L.layerGroup().addTo(map);    // recorrido antiguo que se está consultando
  let rec = null, watch = null, wake = null, tractor = null, guia = null, linea = null, lineaFlag = null;
  let seguir = true, ultimoLocal = 0, ultimoSync = 0, pos = null, rumbo = null;
  const COL_TRAT = () => document.body.classList.contains('noche') ? '#ffd43b' : '#ff7a00';
  const COL_SIN = '#74c0fc';

  const activo = () => !!rec && rec.recorrido?.estado === 'activo';
  const R = () => rec.recorrido;
  const ll = p => L.latLng(p[0], p[1]);
  const metros = (a, b) => ll(a).distanceTo(ll(b));
  const rumboEntre = (a, b) => {
    const r = Math.PI / 180, y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r);
    const x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  };
  const fmtKm = m => m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2).replace('.', ',')} km`;
  const fmtDur = ms => { const m = Math.max(0, Math.round(ms / 60000)); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h`; };

  function estadisticas(r) {
    let trat = 0, total = 0;
    for (let i = 1; i < r.puntos.length; i++) {
      const a = r.puntos[i - 1], b = r.puntos[i], d = metros(a, b);
      total += d; if (a[3] && b[3]) trat += d;
    }
    const ini = r.puntos[0]?.[2] || r.inicio, fin = r.fin || r.puntos.at(-1)?.[2] || ini;
    return { trat, total, ha: r.ancho ? trat * num(r.ancho) / 10000 : 0, dur: fin - ini, paradas: r.paradas.length };
  }
  const resumen = r => { const e = estadisticas(r); return [`${fmtKm(e.trat)} tratados`, e.ha ? `≈ ${fmtNum(e.ha, 2)} ha` : '', plural(e.paradas, 'parada', 'paradas')].filter(Boolean).join(' · '); };

  /* ---------- Dibujo ---------- */
  const iconoParada = (n, hora) => L.divIcon({ className: '', iconSize: [34, 34], iconAnchor: [17, 17],
    html: `<div class="rec-parada"><b>${n}</b><span>${hora}</span></div>` });
  const iconoInicio = L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11], html: '<div class="rec-ini"></div>' });
  function dibujar(r, grupo) {
    grupo.clearLayers();
    let tramo = [], flag = null;
    const cerrar = () => { if (tramo.length > 1) L.polyline(tramo, flag ? { color: COL_TRAT(), weight: 7, opacity: .9 } : { color: COL_SIN, weight: 4, dashArray: '8 9', opacity: .95 }).addTo(grupo); };
    r.puntos.forEach(p => {
      if (flag !== null && p[3] !== flag) { cerrar(); tramo = [tramo.at(-1)]; }
      flag = p[3]; tramo.push([p[0], p[1]]);
    });
    cerrar();
    if (r.puntos[0]) L.marker(ll(r.puntos[0]), { icon: iconoInicio, interactive: false }).addTo(grupo);
    r.paradas.forEach(pa => L.marker([pa.lat, pa.lng], { icon: iconoParada(pa.n, new Date(pa.ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })), zIndexOffset: 900 })
      .bindTooltip(`Parada ${pa.n}: se acabó el producto`, { direction: 'top' }).addTo(grupo));
    return grupo;
  }
  // Para no redibujar todo en cada punto: se alarga la última línea
  function alargar(p) {
    if (!linea || lineaFlag !== p[3]) {
      const prev = R().puntos.at(-2);
      linea = L.polyline(prev ? [[prev[0], prev[1]]] : [], p[3] ? { color: COL_TRAT(), weight: 7, opacity: .9 } : { color: COL_SIN, weight: 4, dashArray: '8 9', opacity: .95 }).addTo(capa);
      lineaFlag = p[3];
    }
    linea.addLatLng([p[0], p[1]]);
  }

  /* ---------- Panel ---------- */
  function pintarPanel() {
    if (!activo()) return;
    const r = R(), e = estadisticas(r);
    $('#recEstado').innerHTML = r.tratando ? '<i class="on"></i>Tratando' : '<i class="off"></i>Sin producto';
    $('#recStats').textContent = [fmtKm(e.trat), e.ha ? `≈ ${fmtNum(e.ha, 2)} ha` : '', fmtDur(Date.now() - (r.puntos[0]?.[2] || r.inicio))].filter(Boolean).join(' · ');
    $('#recAcabado').hidden = !r.tratando; $('#recSeguir').hidden = r.tratando;
    const pa = r.paradas.at(-1);
    const verGuia = !r.tratando && pa && pos;
    $('#recGuia').hidden = !verGuia;
    if (verGuia) {
      const d = metros(pos, [pa.lat, pa.lng]);
      $('#recDist').textContent = d < 8 ? 'Estás en la parada' : fmtKm(d);
      $('#recGuiaTxt').textContent = d < 8 ? `Parada ${pa.n}: pulsa «Seguir tratando»` : `hasta la parada ${pa.n} (donde se acabó)`;
      $('#recFlecha').style.transform = `rotate(${rumboEntre(pos, [pa.lat, pa.lng])}deg)`;
      $('#recFlecha').style.visibility = d < 8 ? 'hidden' : 'visible';
    }
    $('#recGps').textContent = pos ? `GPS ±${Math.round(pos[4])} m` : 'Buscando GPS…';
    $('#recCentrar').setAttribute('aria-pressed', seguir);
  }
  function mostrarUI() {
    const enMapa = vistaActual === 'mapa', on = activo();
    $('#recPanel').hidden = !on || !enMapa;
    $('#recChip').hidden = !on || enMapa;
    for (const id of ['btnFit', 'btnLocate', 'btnTractor']) $('#' + id).hidden = on || !enMapa;
    if (on) $('#camaras').hidden = true;
    document.body.classList.toggle('grabando', on && enMapa);
    $('#verBanner').classList.toggle('fuera', !enMapa);
  }

  /* ---------- GPS ---------- */
  function onPos(p) {
    const c = p.coords, ahora = Date.now();
    if (c.accuracy > 35 && pos) return; // lectura mala
    const nuevo = [+c.latitude.toFixed(6), +c.longitude.toFixed(6), ahora, R().tratando ? 1 : 0, c.accuracy];
    const ult = R().puntos.at(-1);
    if (ult && pos) { // saltos imposibles (más de 25 m/s)
      const d = metros(ult, nuevo), dt = Math.max(1, (ahora - ult[2]) / 1000);
      if (d / dt > 25 && d > 60) return;
    }
    if (c.heading != null && !isNaN(c.heading) && (c.speed || 0) > .6) rumbo = c.heading;
    else if (pos && metros(pos, nuevo) > 3) rumbo = rumboEntre(pos, nuevo);
    pos = nuevo;
    if (!tractor) tractor = L.marker(ll(pos), { icon: L.divIcon({ className: '', iconSize: [40, 40], iconAnchor: [20, 20], html: '<div class="rec-tractor"><svg viewBox="0 0 24 24"><path d="M12 2 20 21 12 16 4 21z"/></svg></div>' }), zIndexOffset: 1000, interactive: false }).addTo(map);
    tractor.setLatLng(ll(pos));
    const el = tractor.getElement()?.querySelector('svg'); if (el && rumbo != null) el.style.transform = `rotate(${rumbo}deg)`;
    if (!ult || metros(ult, pos) >= 3 || ult[3] !== pos[3]) {
      R().puntos.push(pos.slice(0, 4)); alargar(pos);
    }
    // línea de ayuda hasta la parada
    const pa = R().paradas.at(-1);
    if (!R().tratando && pa) { if (!guia) guia = L.polyline([], { color: '#fff', weight: 2, dashArray: '2 8', opacity: .9 }).addTo(capa); guia.setLatLngs([ll(pos), [pa.lat, pa.lng]]); }
    else if (guia) { guia.remove(); guia = null; }
    if (seguir) map.panTo(ll(pos), { animate: true, duration: .5 });
    pintarPanel();
    if (ahora - ultimoLocal > 10000) { ultimoLocal = ahora; DB.put('trat', rec).catch(() => {}); }
    if (ahora - ultimoSync > 120000) { ultimoSync = ahora; guardarRec(); }
  }
  function arrancarGps() {
    if (watch != null || !navigator.geolocation) return;
    watch = navigator.geolocation.watchPosition(onPos, err => { $('#recGps').textContent = errGps(err); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  }
  function pararGps() { if (watch != null) navigator.geolocation.clearWatch(watch); watch = null; }

  /* Pantalla siempre encendida mientras se graba */
  async function pedirPantalla() {
    if (!activo() || wake || !navigator.wakeLock) return;
    try { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } catch (e) {}
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pedirPantalla(); });

  async function guardarRec() { if (!rec) return; const r = { ...rec }; rec = await guardar('trat', r); }

  /* ---------- Acciones ---------- */
  function noche(on) {
    document.body.classList.toggle('noche', on); lsSet('noche', on ? '1' : '0');
    $('#recNoche').setAttribute('aria-pressed', on);
    if (activo()) { dibujar(R(), capa); linea = null; guia = null; }
  }
  async function empezar(continuar) {
    const ancho = $('#rAncho').value.trim(); lsSet('ancho', ancho);
    $('#recSheet').hidden = true; capaVer.clearLayers(); $('#verBanner').hidden = true;
    if (continuar) {
      rec = porId('trat', continuar); R().estado = 'activo'; R().tratando = true; delete R().fin;
      if (ancho) R().ancho = ancho;
    } else {
      rec = { id: uid(), fecha: today(), parcelas: [], producto: '', materia: '', dosis: '', unidad: 'L/ha', caldo: '', plazo: '', motivo: '',
        aplicador: aplicadorDefecto(), notas: '', borrador: true,
        recorrido: { estado: 'activo', inicio: Date.now(), ancho, tratando: true, puntos: [], paradas: [] } };
    }
    await guardarRec(); lsSet('recActivo', rec.id);
    noche($('#rNoche').checked);
    linea = null; guia = null; dibujar(R(), capa);
    seguir = true; vista('mapa'); map.setZoom(Math.max(map.getZoom(), 19));
    arrancarGps(); pedirPantalla(); mostrarUI(); pintarPanel(); renderTrat();
    toast(continuar ? 'Recorrido reanudado' : 'Recorrido empezado: ya se va dibujando por donde pasas', 4000);
  }
  async function acabado() {
    if (!pos) { toast('Todavía no hay señal GPS'); return; }
    const n = R().paradas.length + 1;
    R().puntos.push([pos[0], pos[1], Date.now(), 1]);
    R().paradas.push({ n, lat: pos[0], lng: pos[1], ts: Date.now() });
    R().tratando = false; R().puntos.push([pos[0], pos[1], Date.now() + 1, 0]);
    dibujar(R(), capa); linea = null; guia = null;
    await guardarRec(); pintarPanel();
    toast(`Parada ${n} marcada. Ve a cargar: al volver, la flecha te lleva aquí`, 5000);
  }
  async function seguirTratando() {
    const pa = R().paradas.at(-1);
    const d = pa && pos ? metros(pos, [pa.lat, pa.lng]) : 0;
    if (d > 30 && !(await confirmar(`Estás a ${fmtKm(d)} de donde se acabó el producto. ¿Seguir tratando desde aquí?`, { titulo: 'Seguir tratando', ok: 'Seguir desde aquí' }))) return;
    R().tratando = true;
    if (pos) R().puntos.push([pos[0], pos[1], Date.now(), 1]);
    if (guia) { guia.remove(); guia = null; }
    dibujar(R(), capa); linea = null;
    await guardarRec(); pintarPanel(); toast('Seguimos tratando');
  }
  async function terminar() {
    if (!(await confirmar('Se termina el recorrido y se abre el tratamiento para apuntar el producto, la dosis y el plazo de seguridad.', { titulo: 'Terminar recorrido', ok: 'Terminar' }))) return;
    pararGps(); try { await wake?.release(); } catch (e) {} wake = null;
    R().estado = 'fin'; R().fin = Date.now(); R().tratando = false;
    // parcelas por las que se ha tratado
    const tr = R().puntos.filter(p => p[3]);
    const ps = vivos('parcelas').filter(p => p.puntos?.length >= 3 && tr.filter(q => dentro(q[0], q[1], p.puntos)).length >= Math.max(3, tr.length * .05)).map(p => p.id);
    if (!rec.parcelas?.length && ps.length) rec.parcelas = ps;
    await guardarRec(); lsSet('recActivo', '');
    const t = rec; rec = null; capa.clearLayers(); tractor?.remove(); tractor = null; linea = null; guia = null; pos = null;
    document.body.classList.remove('noche');
    mostrarUI(); vista('mapa'); ver(t, false);
    abrirTratForm(t);
    toast(`Recorrido terminado: ${resumen(t.recorrido)}`, 5000);
  }

  /* ---------- Consultar un recorrido guardado ---------- */
  function ver(t, irMapa = true) {
    if (!t?.recorrido?.puntos?.length) { toast('Este tratamiento no tiene recorrido'); return; }
    dibujar(t.recorrido, capaVer);
    $('#verTxt').textContent = `${fmtCorta(t.fecha)} · ${t.producto || 'Sin producto'} · ${resumen(t.recorrido)}`;
    $('#verBanner').hidden = false;
    if (irMapa) vista('mapa');
    setTimeout(() => map.fitBounds(L.latLngBounds(t.recorrido.puntos.map(p => [p[0], p[1]])), { padding: [50, 50], maxZoom: 19 }), 120);
  }
  $('#verCerrar').onclick = () => { capaVer.clearLayers(); $('#verBanner').hidden = true; };

  /* ---------- Pantalla de inicio ---------- */
  function abrirInicio() {
    if (activo()) { vista('mapa'); return; }
    const h = new Date().getHours();
    $('#rAncho').value = ls('ancho') || '6';
    $('#rNoche').checked = ls('noche') ? ls('noche') === '1' : (h >= 20 || h < 7);
    const pend = vivos('trat').filter(t => t.recorrido && t.recorrido.estado !== 'fin' || (t.recorrido && t.fecha === today() && t.borrador))
      .sort((a, b) => (b.recorrido.inicio || 0) - (a.recorrido.inicio || 0)).slice(0, 3);
    $('#rCont').innerHTML = pend.map(t => `<button type="button" class="btn" data-id="${t.id}">Continuar el del ${fmtCorta(t.fecha)} · ${esc(resumen(t.recorrido))}</button>`).join('');
    $('#rContWrap').hidden = !pend.length;
    $$('#rCont button').forEach(b => b.onclick = () => empezar(b.dataset.id));
    $('#recSheet').hidden = false;
  }

  /* ---------- Botones ---------- */
  $('#btnTractor').onclick = abrirInicio;
  $('#recChip').onclick = () => vista('mapa');
  $('#rEmpezar').onclick = () => empezar(null);
  $('#rCancelar').onclick = () => { $('#recSheet').hidden = true; };
  $('#recAcabado').onclick = acabado;
  $('#recSeguir').onclick = seguirTratando;
  $('#recFin').onclick = terminar;
  $('#recNoche').onclick = () => noche(!document.body.classList.contains('noche'));
  $('#recCentrar').onclick = () => { seguir = !seguir; if (seguir && pos) map.panTo(ll(pos)); pintarPanel(); };
  map.on('dragstart', () => { if (activo() && seguir) { seguir = false; pintarPanel(); } });

  /* Si la app se cerró en mitad de un recorrido, se recupera al abrir */
  function recuperar() {
    const id = ls('recActivo'); if (!id) return;
    const t = porId('trat', id);
    if (!t?.recorrido || t.recorrido.estado !== 'activo') { lsSet('recActivo', ''); return; }
    rec = t; noche(ls('noche') === '1');
    dibujar(R(), capa); linea = null;
    arrancarGps(); pedirPantalla(); mostrarUI(); pintarPanel();
    toast('Recorrido en curso recuperado', 4000);
  }

  return { activo, mostrarUI, recuperar, ver, resumen, abrirInicio };
})();

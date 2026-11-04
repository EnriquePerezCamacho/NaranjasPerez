/* Navegación, menú y arranque */
const VISTAS = { mapa: null, lista: '#listView', parcelas: '#parcView', trat: '#tratView', hist: '#histView' };
let vistaActual = 'mapa';
function vista(v) {
  vistaActual = v;
  for (const [k, sel] of Object.entries(VISTAS)) if (sel) $(sel).hidden = k !== v;
  $$('nav button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v));
  $('#camaras').hidden = !(v === 'mapa' || v === 'lista');
  $('#btnFit').hidden = $('#btnLocate').hidden = $('#btnTractor').hidden = v !== 'mapa';
  Rec.mostrarUI();
  if (v === 'mapa') setTimeout(() => map.invalidateSize(), 50);
  if (v === 'lista') renderInc();
  if (v === 'parcelas') renderParc();
  if (v === 'trat') renderTrat();
}
$$('nav button').forEach(b => b.onclick = () => vista(b.dataset.v));
function renderSiVisible() { if (vistaActual === 'parcelas') renderParc(); if (vistaActual === 'trat') renderTrat(); }
function renderTodo() { renderParcLayer(); renderInc(); renderSiVisible(); }

$('#duePill').onclick = () => { setEstadoFiltro('revisar'); vista('lista'); };
$('#btnMenu').onclick = e => { e.stopPropagation(); $('#menu').hidden = !$('#menu').hidden; };
document.addEventListener('click', e => { if (!$('#menu').contains(e.target)) $('#menu').hidden = true; });
$('#mFit').onclick = () => { $('#menu').hidden = true; vista('mapa'); encuadrar(); };
$$('.sheet').forEach(s => s.addEventListener('click', e => {
  if (e.target !== s || s.id === 'confirm') return;
  if (s.id === 'sheet') cerrarForm(); else s.hidden = true;
}));

/* Botón "atrás" de Android: cierra lo que esté abierto antes de salir */
function atras() {
  if (!$('#viewer').hidden) return cerrarVisor(), true;
  if (!$('#bienv').hidden && Finca.actual) return $('#bvLocal').click(), true;
  if (!$('#confirm').hidden) return $('#cfNo').click(), true;
  for (const id of ['fileOk', 'histSheet', 'equipoSheet', 'recSheet', 'syncSheet', 'infSheet', 'segSheet', 'tratSheet', 'parcSheet']) if (!$('#' + id).hidden) return $('#' + id).hidden = true, true;
  if (!$('#sheet').hidden) return cerrarForm(), true;
  if (enDibujo()) return $('#drawCancel').click(), true;
  if (!$('#pickBanner').hidden) return $('#pickCancel').click(), true;
  if (!$('#menu').hidden) return $('#menu').hidden = true, true;
  if (map._popup && map.hasLayer(map._popup)) return map.closePopup(), true;
  if (vistaActual !== 'mapa') return vista('mapa'), true;
  return false;
}
document.addEventListener('keydown', e => {
  if (!$('#viewer').hidden && e.key === 'ArrowLeft') moverVisor(-1);
  if (!$('#viewer').hidden && e.key === 'ArrowRight') moverVisor(1);
  if (e.key === 'Escape') atras();
});

(async function arrancar() {
  buildFiltros();
  plugin('App')?.addListener('backButton', () => { if (!atras()) plugin('App').minimizeApp(); });
  try { await cargar(); }
  catch (e) { toast('No se pudo abrir el almacenamiento del móvil'); console.error(e); }
  renderTodo();
  encuadrar(false);
  Notif.init(); Notif.reprogramar();
  Sync.init();
  Cuenta.init();
  Rec.recuperar();
  (async () => { let v = ''; try { v = (await plugin('App')?.getInfo())?.version || ''; } catch (e) {} $('#mVer').textContent = 'CampControl' + (v ? ' · versión ' + v : ''); })();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !nativo()) navigator.serviceWorker.register('sw.js').catch(() => {});
})();

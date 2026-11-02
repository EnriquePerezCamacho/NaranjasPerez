/* Mapa, capas y posición */
const map = L.map('map', { zoomControl: false, maxZoom: 21 }).setView([37.61, -5.83], 14);
const tl = (url, o) => L.tileLayer(url, Object.assign({ maxZoom: 21, maxNativeZoom: 19 }, o));
const capas = {
  'Satélite (Esri)': tl('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Imágenes © Esri' }),
  'Ortofoto PNOA (IGN)': tl('https://www.ign.es/wmts/pnoa-ma?service=WMTS&request=GetTile&version=1.0.0&format=image/jpeg&layer=OI.OrthoimageCoverage&style=default&tilematrixset=GoogleMapsCompatible&tilematrix={z}&tilerow={y}&tilecol={x}', { maxNativeZoom: 20, attribution: 'PNOA © IGN España' }),
  'Híbrido (satélite + nombres)': L.layerGroup([
    tl('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Imágenes © Esri' }),
    tl('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'),
    tl('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}')
  ]),
  'Callejero (OpenStreetMap)': tl('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }),
  'Topográfico': tl('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { subdomains: 'abc', maxNativeZoom: 17, attribution: '© OpenTopoMap' })
};
const markers = L.featureGroup().addTo(map);
const parcLayer = L.featureGroup().addTo(map);
const extras = {
  'Mis parcelas': parcLayer,
  'Incidencias': markers,
  'Parcelas del Catastro': L.tileLayer.wms('https://ovc.catastro.meh.es/Cartografia/WMS/ServidorWMS.aspx', { layers: 'Catastro', format: 'image/png', transparent: true, maxZoom: 21, attribution: 'DG Catastro' })
};
let capaInicial = 'Satélite (Esri)';
try { const g = localStorage.getItem('capa'); if (g && capas[g]) capaInicial = g; } catch (e) {}
capas[capaInicial].addTo(map);
map.on('baselayerchange', e => { try { localStorage.setItem('capa', e.name); } catch (er) {} });
L.control.layers(capas, extras, { position: 'topright' }).addTo(map);
L.control.zoom({ position: 'topleft' }).addTo(map);
L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
const zoomClase = () => map.getContainer().classList.toggle('zoom-lo', map.getZoom() < 15);
map.on('zoomend', zoomClase); zoomClase();

function encuadrar(aviso = true) {
  const b = L.latLngBounds([]);
  if (map.hasLayer(markers) && markers.getLayers().length) b.extend(markers.getBounds());
  if (map.hasLayer(parcLayer) && parcLayer.getLayers().length) b.extend(parcLayer.getBounds());
  if (b.isValid()) map.fitBounds(b, { padding: [50, 50], maxZoom: 19 });
  else if (aviso) toast('Todavía no hay nada que mostrar en el mapa');
}

/* Seguir mi posición */
const errGps = e => e.code === 1 ? 'Permite el acceso a la ubicación en los ajustes del móvil' : 'No se pudo obtener la posición GPS';
let watchId = null, meMarker = null, meCircle = null, firstFix = false;
$('#btnLocate').onclick = () => {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId); watchId = null; meMarker?.remove(); meCircle?.remove(); meMarker = meCircle = null;
    $('#btnLocate').setAttribute('aria-pressed', 'false'); return;
  }
  if (!navigator.geolocation) return toast('Este dispositivo no tiene GPS disponible');
  firstFix = true; $('#btnLocate').setAttribute('aria-pressed', 'true');
  watchId = navigator.geolocation.watchPosition(p => {
    const ll = [p.coords.latitude, p.coords.longitude];
    if (!meMarker) {
      meMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18] }), interactive: false }).addTo(map);
      meCircle = L.circle(ll, { radius: p.coords.accuracy, color: '#1c7ed6', weight: 1, fillOpacity: .1, interactive: false }).addTo(map);
    } else { meMarker.setLatLng(ll); meCircle.setLatLng(ll).setRadius(p.coords.accuracy); }
    if (firstFix) { map.setView(ll, Math.max(map.getZoom(), 18)); firstFix = false; }
  }, err => { toast(errGps(err)); $('#btnLocate').click(); }, { enableHighAccuracy: true, maximumAge: 2000 });
};
$('#btnFit').onclick = () => encuadrar();

/* Pide la mejor posición en unos segundos (para fotos y esquinas de parcela) */
function mejorPosicion(onUpdate, { segundos = 20, objetivo = 6 } = {}) {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    let best = null, n = 0, fin = false;
    const terminar = () => { if (fin) return; fin = true; navigator.geolocation.clearWatch(id); clearTimeout(t); res(best); };
    const id = navigator.geolocation.watchPosition(p => {
      n++;
      if (!best || p.coords.accuracy < best.accuracy) { best = p.coords; onUpdate?.(best); }
      if (best.accuracy <= objetivo || n >= 8) terminar();
    }, err => { if (!best) onUpdate?.(null, err); terminar(); }, { enableHighAccuracy: true, maximumAge: 0, timeout: segundos * 1000 });
    const t = setTimeout(terminar, segundos * 1000);
  });
}

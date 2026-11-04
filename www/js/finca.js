/* Finca actual. Cada finca guarda sus datos en el móvil por separado (base local "cc-<id>").
   Sin finca elegida (o "usar sin cuenta") se usa la base de siempre, "mi-naranjal", que solo está en este móvil. */
const Finca = (() => {
  let actual = null;
  try { actual = JSON.parse(localStorage.getItem('finca') || 'null'); } catch (e) {}
  const LOCAL = 'mi-naranjal';
  return {
    get actual() { return actual; },
    id: () => (actual && !actual.local ? actual.id : null),
    local: () => !actual || !!actual.local,
    esDueno: () => !actual || !!actual.local || actual.rol === 'dueno',
    dbNombre: () => (actual && !actual.local ? 'cc-' + actual.id : LOCAL),
    LOCAL,
    set(f) {
      actual = f;
      try { f ? localStorage.setItem('finca', JSON.stringify(f)) : localStorage.removeItem('finca'); } catch (e) {}
    }
  };
})();

/* Leer y copiar una base local entera (para pasar los datos de antes a una finca) */
const BaseLocal = {
  abrir(nombre) {
    return new Promise((res, rej) => {
      const r = indexedDB.open(nombre, 2);
      r.onupgradeneeded = () => {
        const db = r.result;
        for (const s of ['inc', 'parcelas', 'trat']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  },
  async leer(nombre) {
    const db = await this.abrir(nombre);
    const get = (s, fn) => new Promise((res, rej) => { const q = fn(db.transaction(s).objectStore(s)); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const out = { inc: await get('inc', s => s.getAll()), parcelas: await get('parcelas', s => s.getAll()), trat: await get('trat', s => s.getAll()), migrado: await get('meta', s => s.get('migradoA')) };
    db.close(); return out;
  },
  async cuenta(nombre) {
    try { const d = await this.leer(nombre); return { n: d.inc.filter(x => !x.borrado).length + d.parcelas.filter(x => !x.borrado).length + d.trat.filter(x => !x.borrado).length, inc: d.inc.filter(x => !x.borrado).length, migrado: d.migrado }; }
    catch (e) { return { n: 0, inc: 0 }; }
  },
  async copiar(origen, destino) {
    const d = await this.leer(origen);
    const db = await this.abrir(destino);
    await new Promise((res, rej) => {
      const t = db.transaction(['inc', 'parcelas', 'trat'], 'readwrite');
      for (const k of ['inc', 'parcelas', 'trat']) d[k].forEach(r => t.objectStore(k).put({ ...r, _sync: 1 }));
      t.oncomplete = res; t.onerror = () => rej(t.error);
    });
    db.close();
    const o = await this.abrir(origen);
    await new Promise(res => { const t = o.transaction('meta', 'readwrite'); t.objectStore('meta').put(destino, 'migradoA'); t.oncomplete = res; t.onerror = res; });
    o.close();
  }
};

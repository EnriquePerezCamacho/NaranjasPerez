/* Almacenamiento en el propio móvil (IndexedDB).
   Cada registro lleva "actualizado" y "_sync" (pendiente de subir) para poder sincronizar.
   Los borrados se guardan como marca { id, borrado:true } para que se borren también en el otro móvil. */
const DB = (() => {
  let p;
  const open = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open(Finca.dbNombre(), 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const s of ['inc', 'parcelas', 'trat']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => toast('Cierra otras ventanas de la app para actualizarla');
  }));
  const tx = async (store, mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode); const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req && 'result' in req ? req.result : undefined);
      t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  };
  return {
    all: s => tx(s, 'readonly', st => st.getAll()),
    put: (s, o) => tx(s, 'readwrite', st => st.put(o)),
    putMany: (s, arr) => tx(s, 'readwrite', st => { arr.forEach(o => st.put(o)); return null; }),
    del: (s, id) => tx(s, 'readwrite', st => st.delete(id)),
    getMeta: k => tx('meta', 'readonly', st => st.get(k)),
    setMeta: (k, v) => tx('meta', 'readwrite', st => st.put(v, k)),
  };
})();

const S = { inc: [], parcelas: [], trat: [] };
const vivos = k => S[k].filter(x => !x.borrado);
const porId = (k, id) => S[k].find(x => x.id === id && !x.borrado) || null;

/* Pone al día registros antiguos (fotos como Blob sueltos, sin campos nuevos) */
function normalizarInc(it) {
  let cambio = false;
  const fix = arr => (arr || []).map(m => { if (m instanceof Blob) { cambio = true; return mkMedia(m); } return m; });
  if (it.borrado) return { it, cambio };
  const fotos = fix(it.fotos);
  const seguimiento = (it.seguimiento || []).map(s => ({ ...s, fotos: fix(s.fotos) }));
  for (const k of ['parcela', 'fila', 'arbol']) if (it[k] == null) { it[k] = ''; cambio = true; }
  if (it.revisar === undefined) { it.revisar = null; cambio = true; }
  if (!it.seguimiento) cambio = true;
  if (!it.actualizado) { it.actualizado = it.editado || it.creado || Date.now(); it._sync = 1; cambio = true; }
  return { it: { ...it, fotos, seguimiento }, cambio };
}

async function cargar() {
  const [inc, parcelas, trat] = await Promise.all([DB.all('inc'), DB.all('parcelas'), DB.all('trat')]);
  const arreglar = [];
  S.inc = inc.map(x => { const { it, cambio } = normalizarInc(x); if (cambio) arreglar.push(it); return it; });
  S.parcelas = parcelas; S.trat = trat;
  if (arreglar.length) await DB.putMany('inc', arreglar);
}

const alCambiar = []; // otros módulos (sincronización) se enganchan aquí
const nombreMio = () => { try { return localStorage.getItem('autor') || ''; } catch (e) { return ''; } };
async function guardar(k, rec) {
  rec.actualizado = Date.now(); rec._sync = 1;
  const yo = nombreMio();
  if (yo) { rec.editadoPor = yo; if (!rec.creadoPor) rec.creadoPor = yo; }
  if (!rec.creado) rec.creado = rec.actualizado;
  await DB.put(k, rec);
  const i = S[k].findIndex(x => x.id === rec.id); i >= 0 ? S[k][i] = rec : S[k].push(rec);
  alCambiar.forEach(f => f(k, rec));
  return rec;
}
async function eliminar(k, rec) {
  const marca = { id: rec.id, borrado: true, actualizado: Date.now(), _sync: 1 };
  await DB.put(k, marca);
  const i = S[k].findIndex(x => x.id === rec.id); if (i >= 0) S[k][i] = marca;
  alCambiar.forEach(f => f(k, marca));
}

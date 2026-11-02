/* Avisos en el móvil para revisar incidencias (solo en la APK) */
const Notif = (() => {
  const LN = () => plugin('LocalNotifications');
  let pedido = false;
  async function permiso() {
    const L = LN(); if (!L) return false;
    try {
      let r = await L.checkPermissions();
      if (r.display !== 'granted' && !pedido) { pedido = true; r = await L.requestPermissions(); }
      return r.display === 'granted';
    } catch (e) { return false; }
  }
  async function reprogramar() {
    const L = LN(); if (!L) return;
    try {
      const pend = await L.getPending();
      if (pend.notifications?.length) await L.cancel({ notifications: pend.notifications.map(n => ({ id: n.id })) });
      const ahora = Date.now() + 60000;
      const lista = vivos('inc')
        .filter(it => it.estado === 'pendiente' && it.revisar)
        .map(it => ({ it, at: new Date(it.revisar + 'T09:00:00') }))
        .filter(x => x.at.getTime() > ahora);
      if (!lista.length || !(await permiso())) return;
      await L.schedule({
        notifications: lista.slice(0, 60).map(({ it, at }) => ({
          id: hashId(it.id),
          title: 'Revisar: ' + (it.titulo || 'naranjo'),
          body: [ubicTxt(it), it.desc].filter(Boolean).join(' · ').slice(0, 140) || 'Toca para verlo en el mapa',
          schedule: { at },
          extra: { id: it.id }
        }))
      });
    } catch (e) { console.warn('Avisos:', e); }
  }
  function init() {
    const L = LN(); if (!L) return;
    L.addListener('localNotificationActionPerformed', a => {
      const it = porId('inc', a?.notification?.extra?.id);
      if (it) setTimeout(() => irA(it), 300);
    });
  }
  return { init, reprogramar: debounce(reprogramar, 800), permiso };
})();

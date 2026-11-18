/* ===== Configuración ===== */
const CONFIG = {
  repo: "EnriquePerezCamacho/NaranjasPerez",
  apkUrl: "https://github.com/EnriquePerezCamacho/NaranjasPerez/releases/latest/download/fincapunte.apk",
  email: "enriqueperezcamacho2001@gmail.com"
};
/* ========================= */
document.querySelectorAll(".js-apk").forEach(a => { a.href = CONFIG.apkUrl; a.rel = "noopener"; });
document.querySelectorAll(".js-mail").forEach(a => { a.href = "mailto:" + CONFIG.email; a.textContent = CONFIG.email; });

const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
/* Contador de descargas: lo cuenta GitHub con cada APK descargada */
(async () => {
  if (!document.querySelector(".js-dl-total")) return;
  try {
    const r = await fetch(`https://api.github.com/repos/${CONFIG.repo}/releases?per_page=100`, { headers: { Accept: "application/vnd.github+json" } });
    if (!r.ok) return;
    const rel = (await r.json()).filter(x => !x.draft);
    let resumen = {};
    try { resumen = await (await fetch("cambios.json")).json(); } catch (_) {}
    const cambioDe = x => resumen[x.tag_name] || ((x.body || "").match(/^Cambios:\s*(.+)$/m) || [])[1] || "";
    const filas = rel.map(x => ({
      ver: (x.name || x.tag_name).replace(/^(FincApunte|CampControl|Las Largas|Mi Naranjal)\s*/i, "") || x.tag_name,
      cambio: cambioDe(x),
      fecha: new Date(x.published_at),
      n: x.assets.filter(a => a.name.endsWith(".apk")).reduce((s, a) => s + a.download_count, 0)
    }));
    if (!filas.length) return;
    const total = filas.reduce((s, f) => s + f.n, 0);
    const fmt = d => d.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
    document.querySelectorAll(".js-dl-total").forEach(e => e.textContent = total.toLocaleString("es-ES"));
    const $ = s => document.querySelector(s);
    if ($(".js-dl-ver")) $(".js-dl-ver").textContent = filas[0].ver;
    if ($(".js-dl-fecha")) $(".js-dl-fecha").textContent = "última versión · " + fmt(filas[0].fecha);
    if ($(".js-dl-tabla")) $(".js-dl-tabla").innerHTML = filas.map(f => `<tr><td><b>${f.ver}</b><small>${fmt(f.fecha)}</small></td><td>${esc(f.cambio)}</td><td>${f.n}</td></tr>`).join("");
    if ($("#descargas")) $("#descargas").hidden = false;
    if ($(".js-dl-hero")) $(".js-dl-hero").hidden = false;
  } catch (e) { /* sin conexión con GitHub: se queda oculto */ }
})();

/* Formulario de opiniones (Netlify Forms) */
const form = document.getElementById("formOpinion");
if (form) form.addEventListener("submit", async e => {
  e.preventDefault();
  const btn = document.getElementById("fEnviar"), ok = document.getElementById("fOk"), err = document.getElementById("fErr");
  ok.hidden = err.hidden = true; btn.disabled = true; btn.textContent = "Enviando…";
  try {
    const r = await fetch("/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(new FormData(form)).toString() });
    if (!r.ok) throw new Error(r.status);
    form.reset(); ok.hidden = false;
  } catch (_) { err.hidden = false; }
  btn.disabled = false; btn.textContent = "Enviar mensaje";
});
document.getElementById("year").textContent = new Date().getFullYear();

/* Enlaces antiguos a secciones de la portada (#instalar, #contacto…) llevan a su página nueva */
(() => {
  const nuevas = { ordenador: "funciones.html#ordenador", funciones: "funciones.html#funciones", probar: "precio.html#probar",
    precio: "precio.html", instalar: "instalar.html", preguntas: "preguntas.html", contacto: "contacto.html" };
  const h = location.hash.slice(1);
  if (document.body.dataset.pagina === "inicio" && nuevas[h]) location.replace(nuevas[h]);
})();

# CampControl

App de campo para fincas: incidencias con foto/vídeo geolocalizadas, seguimiento con avisos, parcelas, tratamientos con plazo de seguridad, recorridos con el tractor, informes Excel/PDF. Varias fincas, con dueños y trabajadores, e historial de cambios para el dueño.

## Descargar la APK
https://github.com/EnriquePerezCamacho/NaranjasPerez/releases/latest/download/campcontrol.apk

Cada `git push` a `main` compila una APK nueva (firmada siempre con la misma llave de `firma/`, para poder instalar encima sin perder datos).

## Servidor (Supabase)
1. SQL Editor: ejecutar `supabase/instalar.sql` (solo la primera vez) y después `supabase/multifinca.sql`.
2. Authentication → Sign In / Providers → Email: activar **Allow new users to sign up**. Mientras no haya un servidor de correo propio, desactivar **Confirm email**.
3. Project Settings → API: la URL y la clave publicable van en `www/js/config.js`.

### Modelo
- `fincas` (con código de invitación), `miembros` (rol `dueno` / `trabajador`), `registros` (una fila por incidencia, parcela o tratamiento, con `finca_id`), `historial` (lo escribe un trigger; solo lo leen los dueños).
- Seguridad por filas: cada usuario solo ve y modifica las fincas de las que es miembro. Fotos en `media/<finca>/<incidencia>/<archivo>`.

## Estructura
- `www/` la app (HTML, CSS y JS sin compilar). `www/js/`: `cuenta` (cuentas, fincas, equipo, historial), `sync`, `incidencias`, `parcelas`, `tratamientos`, `recorrido`, `informes`, `backup`…
- `supabase/` scripts del servidor.
- `.github/workflows/apk.yml` compilación de la APK con Capacitor.

# Las Largas

App para registrar incidencias de los naranjos con foto o vídeo geolocalizado, seguimiento con recordatorios, parcelas, tratamientos con plazo de seguridad, informes en Excel/PDF y sincronización entre móviles.

## Descargar la APK
Siempre la última versión:
https://github.com/EnriquePerezCamacho/NaranjasPerez/releases/latest/download/las-largas.apk

Cada `git push` a `main` compila una APK nueva (pestaña **Actions**) y la publica en **Releases**.

## Compartir datos entre móviles (Supabase, gratis)
1. Crea un proyecto en https://supabase.com (región West EU o Central EU).
2. **SQL Editor → New query**: pega el contenido de `supabase/instalar.sql` y pulsa **Run**.
3. **Authentication → Users → Add user → Create new user**: crea un usuario por persona (correo + contraseña) y marca *Auto Confirm User*.
4. **Authentication → Sign In / Providers → Email**: desactiva *Allow new users to sign up* para que nadie más pueda crear cuentas.
5. **Project Settings → API**: copia *Project URL* y la clave *anon public*. Ponlas en `www/js/config.js` (o escríbelas en la app, en ⋮ → Compartir con otro móvil → Datos del servidor).
6. En cada móvil: ⋮ → **Compartir con otro móvil** → tu nombre, correo y contraseña → **Entrar**.

Límites del plan gratuito: 500 MB de base de datos y 1 GB de fotos/vídeos; cada archivo máximo 50 MB (los vídeos más grandes se quedan solo en el móvil que los grabó). Si el proyecto pasa una semana sin usarse, Supabase lo pausa; se reactiva desde su web.

## Estructura
- `www/` la app (HTML, CSS y JS sin compilar). `www/js/`: `incidencias`, `parcelas`, `tratamientos`, `informes`, `backup`, `sync`…
- `supabase/instalar.sql` tablas y permisos del servidor.
- `.github/workflows/apk.yml` compilación automática de la APK con Capacitor.

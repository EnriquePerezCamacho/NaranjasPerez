# Mi Naranjal: cómo sacar la APK

La APK la compila GitHub de forma automática y gratis. No hace falta instalar Android Studio.

1. Crea un repositorio nuevo en GitHub (por ejemplo `mi-naranjal`). Puede ser privado.
2. Sube **todo el contenido de esta carpeta**, incluida la carpeta oculta `.github`:
   ```
   git init && git add . && git commit -m "Mi Naranjal"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/mi-naranjal.git
   git push -u origin main
   ```
3. En GitHub, entra en la pestaña **Actions** → "Compilar APK". Tarda unos 4-6 minutos.
4. Cuando termine (tick verde), abre esa ejecución y descarga **mi-naranjal-apk** en la sección *Artifacts*. Es un .zip con `mi-naranjal.apk` dentro.
5. Pasa la APK al móvil, ábrela y permite "instalar apps de origen desconocido" cuando lo pida.
6. La primera vez, acepta los permisos de **ubicación** y **cámara**.

Cada vez que cambies algo en `www/` y hagas push, se genera una APK nueva. Al instalarla encima se conservan los datos.

## Probar en local (opcional, con Android Studio)
```
npm install
npx cap add android
npx cap open android
```
Recuerda añadir los permisos de ubicación y cámara en `android/app/src/main/AndroidManifest.xml` (mira el paso "Permisos" en `.github/workflows/apk.yml`).

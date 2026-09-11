# Ejecutar una copia descargada desde GitHub

La carpeta que se debe subir o descargar como aplicación contiene estos elementos en el mismo paquete:

```text
Launch-SOXTECH-Desktop.ps1
Launch-SOXTECH-Desktop.cmd
server.mjs
package.json
public/
src/
test/
```

El lanzador busca `server.mjs` relativo a su propia ubicación. Por eso funciona aunque GitHub agregue una carpeta contenedora al descargar el repositorio. No se debe editar la ruta de `server.mjs` a mano.

Requisitos: Node.js 20 o posterior. No hay dependencias npm externas para el prototipo.

En Windows, haz doble clic en `Launch-SOXTECH-Desktop.cmd`. Si quieres diagnosticarlo desde PowerShell:

```powershell
cd "C:\ruta\a\la\carpeta\que\contiene\el\launcher"
node server.mjs
```

Después abre `http://127.0.0.1:4173`. Si falta `server.mjs`, significa que se subió o descargó solo una subcarpeta; copia el paquete completo. El log del lanzador queda en `.runtime\launcher.log`.

La conexión SAP todavía es un perfil de configuración para completar: el prototipo no inventa SID, mandante, host ni credenciales, y no ejecuta escrituras contra sistemas productivos.

# Editor del sandbox y robots Unitree

Actualizado: 25 de septiembre de 2026. Aplicación local: http://127.0.0.1:4173/

## Cambiar entre perro y humanoide

1. Activa **EDIT MODE**. Termina cualquier simulación en curso.
2. Selecciona un Unitree del sandbox. En el inspector, usa **Unitree model → Robot representation**.
3. Elige **Unitree quadruped** o **Unitree H1 humanoid**. La malla se sustituye en el mismo objeto: conserva ID, posición, conexiones, capacidad y función de la rutina.
4. También puedes hacer doble clic sobre el objeto o su etiqueta 3D: su menú contiene el mismo selector y la vista previa 3D.
5. Usa **Undo / Redo** para revertir o recuperar el cambio.

Para añadir otro robot: busca “Unitree” en **Local Object Palette**. Abre una de las dos opciones de **Robots · Unitree**, revisa su representación y pulsa **Place in model**. La vista previa no modifica el sandbox hasta colocarlo.

H1 es el humanoide, no el perro ([referencia oficial de Unitree](https://www.unitree.com/h1/)). El cuadrúpedo queda genérico hasta confirmar el hardware. El humanoide es una malla propia inspirada en H1, no CAD oficial.

## Mover objetos y crear caminos

- **Model → Select:** arrastra un objeto o su etiqueta 3D. El movimiento se calcula sobre el suelo; no cambia su altura semántica.
- Arrastra el suelo vacío para orbitar; **Shift + arrastrar** para desplazar la cámara; rueda para zoom.
- Un clic selecciona; doble clic abre el espacio del objeto. También existe **Open workspace** en el inspector.
- **Model → Trail:** pulsa el objeto de origen y luego el destino. **Esc** cancela la selección pendiente. Se rechazan enlaces duplicados o al mismo objeto.
- **Parallel capacity:** número de unidades que el recurso puede atender al mismo tiempo; admite enteros de 1 a 32.
- **Undo / Redo:** controles globales encima de las pestañas. Atajos: Ctrl/Cmd+Z y Ctrl/Cmd+Shift+Z; Ctrl+Y también rehace. Los campos de texto conservan su propio historial.

Los Trails representan conexiones del modelo. No reescriben automáticamente el orden GRAFCET ni incorporan un nuevo robot a una rutina. Así se evita cambiar una secuencia ejecutable por un simple gesto visual.

## Simular y comparar capacidad

En **Simulate**:

- **Run:** DES rápido.
- **Paced playback:** los eventos se reproducen con pausas; no es un reloj de producción ni un controlador de tiempo real.
- **Monte Carlo:** repite el experimento con semillas reproducibles.
- **Reset clock:** reinicia la visualización, no borra resultados ni evidencia.
- **Save Snapshot:** guarda el modelo en la memoria del servidor local.

En **Industrial timing experiments**:

1. Pulsa **Load current model template**.
2. Elige **Resource to test**. **Baseline capacity** muestra la situación de referencia.
3. Escribe **Candidate capacity**, unidades por prueba y número de repeticiones.
4. Pulsa **Validate & run comparison**.
5. Revisa tiempo medio, producción por hora, espera y unidades terminadas. Los JSON y detalles técnicos están plegados.

La capacidad candidata es un “¿qué pasaría si…?”: no cambia el sandbox. Si el recurso no limita la ruta, aumentar su capacidad puede no mejorar el resultado. Eso no es necesariamente un error.

## Límites importantes / blindspots

- Cambiar la malla **no habilita** equilibrio, navegación, agarre, transporte ni control de un robot real. Las rutinas siguen siendo simuladas y Live permanece bloqueado.
- El humanoide tiene articulación ilustrativa de brazos y cabeza; no es un simulador dinámico ni un modelo de locomoción.
- Los tiempos son supuestos DEMO hasta cargar mediciones. Elegir otro robot no convierte esos supuestos en telemetría ni justifica una comparación real de rendimiento.
- Undo/Redo cubre cambios del modelo en esta sesión, no cancela trabajos ni revierte aprobaciones o acciones físicas.
- Guardar conserva la elección al recargar la página mientras el servidor siga vivo. Este prototipo aún guarda modelos en memoria: reiniciar el servidor no equivale a almacenamiento permanente.
- Recargar la misma celda conserva la representación Unitree. Cargar otra celda sustituye los objetos de escenario; los objetos personalizados permanecen.
- La paleta muestra todos los objetos de los casos definidos en esta copia. Colocar uno no configura automáticamente su driver ni sus enlaces de ejecución.

## Evidencia reproducible

- `npm test`: 87 pruebas unitarias/contratos más la prueba integral de API.
- `npm run test:browser`: prueba aislada con Playwright y Edge; requiere Playwright disponible o `PLAYWRIGHT_MODULE` apuntando a su módulo. Usa otro servidor en el puerto 4301 y no modifica la sesión de 4173.
- Capturas: `test-evidence/unitree-humanoid.png`, `unitree-quadruped.png`, `timing-executive-summary.png`.
- En esta instalación Windows, si Node encuentra un error de canonicalización de rutas, las pruebas se ejecutaron con `node --preserve-symlinks --preserve-symlinks-main test/<archivo>.mjs`.

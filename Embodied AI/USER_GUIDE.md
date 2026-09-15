# Guía de demostración — Autonomous Operations
Versión 0.7.0 · 2026-09-15. Todo es simulación local; BDC Connect y Joule no están conectados a un tenant real.

## 1. Abrir y orientarse
Abre http://127.0.0.1:4173 tras iniciar el servidor. “Load Example” carga Asset Management con BDC Connect, contexto, Joule, controles y objetos físicos en 3D. En la barra de misión puedes elegir activos, fabricación, orquestación o logística. “Load local workcell” incorpora la rutina elegida al modelo.
Arrastra el fondo para orbitar; Shift+arrastre para desplazar la cámara; rueda para zoom. La vista 2D y el GRAFCET son SVG. Haz clic en un objeto para abrir su espacio de trabajo.

## 2. Preparar una excepción en una transición Tn
En Routine Lab, pulsa un paso S o una transición T del GRAFCET. Aparece el expediente editable. No modifica una aprobación que ya está pendiente.

Ejemplo inventado para una demostración de logística:
- Business Object: Orden de traslado DEMO-001 / material MAT-DEMO / 4 unidades.
- Process: Reposición de estación de ensamble.
- Exception Type: Material no disponible físicamente en la estación.
- Business Impact: La orden de producción espera el material.
- Urgency: Validar antes del siguiente lote de demostración.
- Root Cause Candidates: Tote en ubicación incorrecta; registro de posición desactualizado.
- Physical Dependency: Identificar y trasladar el tote correcto.
- Physical Location: Almacén DEMO, posición A-01; destino línea DEMO B-02.
- Required Outcome: Cuatro unidades del material correcto verificadas en B-02.
- Available Resources: AMR y estación de lectura simulados, con capacidad adecuada.
- Constraints: Un tote por misión; pasillo y destino disponibles.
- Safety Requirements: Zona permitida y enclavamientos simulados revisados para el paso.
- Authorization Requirements: Revisión por el rol autorizado; permiso de una sola acción.
- Evidence Requirements: Identidad, cantidad, destino, presencia y comprobación del estado de negocio.
- Resolution Criteria: Evidencia completa y desaparición de la excepción originaria.

Estos son datos ficticios de entrenamiento, no instrucciones ni permisos para operar una instalación real. No pegues contraseñas, tokens, datos personales ni URL firmadas.

## 3. Demostrar que Assisted bloquea
1. Elige Assisted y Run routine.
2. En la primera acción el servidor queda esperando; no se despacha ningún comando físico.
3. Completa los 15 campos. Las siete condiciones físicas comienzan en “unknown”.
4. Deja Location known en “unknown”: la aprobación no debe habilitarse.
5. Revisa la capacidad real requerida por ese paso y sus condiciones de seguridad/autorización. En esta demo, responde sobre el escenario simulado; no sobre un robot inexistente.
6. Solo si las siete son “yes”, marca la revisión explícita de esta acción y aprueba.
7. El siguiente paso tiene otro permiso de un solo uso. Revisa sus condiciones de nuevo. Reject detiene sin exigir el formulario.

Una causa desconocida no se resuelve declarando que es física. Propón diagnóstico o escalamiento como una rutina distinta con un objetivo verificable. El modo de simulación nunca certifica seguridad real.

## 4. Probar el cierre con evidencia
Al terminar la rutina aparece Resolution Proof, inicialmente pendiente. No se cierra por terminar la animación.

Completa material, cantidad, destino, presencia física, estado esperado y desaparición de la excepción originaria. Cada “yes” necesita una referencia de evidencia; no se descarga ni se autentica esa referencia.
Prueba primero “originatingExceptionCleared = no”: el servidor devuelve blocked.
Después de corregir y justificar la evidencia de la demo, un conjunto válido devuelve resolved_simulated.
En inspección, material/cantidad/destino pueden ser not_applicable con motivo, no los tres controles restantes.
Exporta el comprobante guardado con “Export saved Resolution Proof”. “Export trace” guarda los eventos de la misión. El hash es de integridad local, no firma del fabricante ni verificación independiente.

## 5. Comparar alternativas con Monte Carlo
1. Elige Logistics y pulsa Load local workcell.
2. Baja a “Industrial timing experiments”.
3. Pulsa “Load current model template”. El JSON cubre todos los recursos de la ruta. Sigue marcado DEMO.
4. En el registro de wh-pick, usa un ejemplo hipotético: processSeconds = {"type":"triangular","min":25,"mode":35,"max":65}, capacity = 1. No lo marques como tiempo observado.
5. Copia el perfil completo al campo Candidate y cambia únicamente capacity de wh-pick a 2.
6. Usa 24 entidades, 20 réplicas y semilla 42. Pulsa Validate & run.
7. Compara tiempo medio, P95 de órdenes, espera y throughput por hora. La diferencia candidato-baseline usa semillas emparejadas; no demuestra por sí sola un ahorro real ni significancia.
8. Repite con la misma semilla: debe ser reproducible.

El perfil admite tiempos fijos, triangulares o muestras empíricas, más preparación, manipulación, viaje y aprobación en segundos. setupOncePerResource=true cobra preparación en el primer uso de cada recurso; no modela una matriz de cambios por lote.
Si importas medidas, especifica source="observed" y sourceReference. Eso registra una declaración de procedencia, no verifica automáticamente los datos. Se requieren observaciones de todos los recursos de la ruta.
La capacidad ocupada incluye todos los segmentos de servicio de ese recurso. No confundas esa utilización con OEE ni sumes otra vez la espera que calcula DES.
Las acciones diferentes que revisitan el mismo recurso comparten hoy su distribución; separar tiempos por operación es una mejora pendiente.

## 6. OEE y mantenimiento
En performanceData se pueden introducir, con unidades explícitas, tiempo planificado, tiempo de funcionamiento, ciclo ideal, unidades totales y buenas.
OEE solo se calcula con assetDomain="manufacturing", singleSKU=true y los datos necesarios. No hay un OEE genérico para todos los robots ni un porcentaje precargado.
operatingSeconds/failures y repairSeconds/repairs permiten los estimadores de MTBF y MTTR bajo esas convenciones, distintos del tiempo de resolución de una excepción.
Sin datos suficientes aparece no disponible. “KPI instrumentation” muestra qué medir en cada rutina; no afirma que todos los indicadores estén ya instrumentados.

## 7. Conexiones y límites
En Integrate solo aparecen BDC Connect y Joule. Los perfiles admiten destino o URL de tenant y entorno, sin credenciales.
Save draft conserva metadatos en memoria del servidor; Check revisa el contrato local. Ni un perfil completo ni un dry run significan conexión real.
Los registros se pierden al reiniciar: exporta pruebas y perfiles antes de hacerlo.
Playback speed cambia la animación, NO el tiempo máquina del experimento.
ANYmal no está conectado ni sustituye el motor WebGL. El comparativo de cuatro rutas y las referencias técnicas están en POWER_OPERATIONS_ROUTES.md.

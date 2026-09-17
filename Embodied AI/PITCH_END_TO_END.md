# SAP Autonomous Operations Twin — propuesta y demostración

Versión 0.8.0 · 16 de septiembre de 2026. Prototipo independiente, no producto oficial ni implementación certificada por SAP.

## 1. La propuesta en una frase

Convertir una excepción operativa en una intervención física **simulada, evaluada, autorizada y verificable**, utilizando contexto de SAP BDC Connect y coordinación inspirada en Joule.

El diferencial no es un chatbot que envía órdenes: es comparar decisiones con DES/Monte Carlo, visualizar su efecto y exigir evidencia antes de declarar resuelta la excepción.

## 2. Qué existe y qué todavía no

| Componente | Alcance implementado |
| --- | --- |
| Twin | Editor 2D y mallas poligonales en WebGL; animación de eventos. No simulador físico ni controlador de robot. |
| Joule | Objeto central y tres dominios conceptuales: Asset Management, Manufacturing y Orchestration. La logística participa en el último tramo. |
| Casos | Se mantienen Inspection, Assembly y Warehouse Fulfillment; **solo Orchestration** se transforma en Inspection-to-Fulfillment. |
| Unitree | Cuadrúpedo de inspección conceptual. Modelo/configuración por confirmar; no se presenta como transportador de carga. |
| UR5 | Nombre y descripción actualizados; geometría existente conservada. No cinemática UR5 validada ni programa de robot real. |
| Coordinación | GRAFCET de 12 pasos, actores previstos y selección determinista entre candidatos sintéticos. |
| Assisted | Solicitud individual, formulario de excepción, siete condiciones físicas y aprobación explícita. No se autoaprueba. |
| Material | SKU, EPC RFID, cantidad, destino y condición del rack; los tres estados problemáticos detienen el despacho. |
| Chat | Placeholder local determinista, identificado como NOT_CONNECTED. El texto describe el objetivo; los campos explícitos seleccionan una rutina predefinida. |
| Reutilización | BAT constante + receta JSON validada. Exportar no ejecuta. Caché de recetas por tenant, parámetros y versión; máximo 128 en memoria. |
| Experimentos | DES con colas/capacidades y Monte Carlo reproducible; perfiles de segundos fijos, triangulares o muestras empíricas. |
| Evidencia | Trace exportable y Resolution Proof local. Referencias declaradas por el usuario, no sensores autenticados. |
| Integración real | **No conectada**: BDC Connect, Joule, robots y ERP no reciben comandos de producción. |

La escena agrupa tres dominios bajo Joule para explicar el proyecto. No afirma que sean tres módulos incluidos automáticamente en una licencia de Joule. SAP describe asistentes especializados integrados en aplicaciones, con disponibilidad y permisos propios. Joule Work es una experiencia para coordinar trabajo: aquí se representa mediante tareas locales, no mediante su API real. Fuentes: [SAP, asistentes de supply chain](https://news.sap.com/2026/05/more-autonomous-supply-chain/) y [SAP, Autonomous Enterprise/Joule Work](https://news.sap.com/2026/05/sap-sapphire-sap-unveils-autonomous-enterprise/).

## 3. Un caso completo, sin borrar los otros

**Caso:** un activo presenta una condición anómala y puede necesitar un kit de repuesto.

1. **Asset operator:** registra la excepción y solicita inspección.
2. **Unitree:** realiza la misión simulada y genera observaciones; todavía no demuestra la causa.
3. **Joule Work conceptual:** propone un técnico entre candidatos con habilidad, disponibilidad y autorización compatibles.
4. **Técnico:** confirma diagnóstico y SKU necesario. La inspección del robot no sustituye su diagnóstico.
5. **Ejecutivo responsable:** autoriza demanda y orden. Un upsell requiere consentimiento comercial; no es una venta automática.
6. **Manufacturing:** propone una línea elegible según capacidad técnica y tiempo estimado.
7. **UR5:** representa el ensamble con una receta local de simulación.
8. **Calidad:** verifica el resultado simulado.
9. **Manufacturing operator:** embala y vincula SKU, cantidad y EPC.
10. **Warehouse operator:** verifica ubicación y estado del rack. Empty, blocked y replenishment_delayed producen excepción y detención.
11. **Orchestration/logística:** propone el transporte y ruta elegibles. El perro no entrega automáticamente la carga.
12. **Recepción y seguimiento:** verifica material, cantidad, destino y presencia. **La entrega no prueba que el activo esté reparado.** Se necesita evidencia adicional de instalación/retest y de desaparición de la excepción.

Los candidatos actuales son fixtures: técnico A, línea B y ruta A pueden ganar por menor tiempo estimado entre candidatos elegibles. No son recursos consultados en tiempo real ni una optimización global. La comparación de capacidad/tiempos con Monte Carlo ocurre en el laboratorio separado.

## 4. Demostración práctica para grabar, 4–6 minutos

Abre http://127.0.0.1:4173 con el servidor local encendido. Si quedó una versión anterior, recarga con Ctrl+F5. Los datos de servidor son temporales: exporta evidencias antes de reiniciar.

### Toma A — contexto y ciclo visible

1. En **Autonomous Operations Routine Lab**, elige **Orchestration · Power the Operations · Inspection-to-Fulfillment**.
2. Pulsa **Load local workcell** y usa **3D** / **Fit**.
3. Muestra Joule, sus tres dominios y el tramo físico. Los vínculos de coordinación no representan una carretera física.
4. En Material context, deja identificadores DEMO, cantidad 4, destino DEMO-RECEIVING-01 y rack **Available**.
5. Selecciona **Simulation**, un ciclo, velocidad 1×; pulsa **Run routine**.
6. Enseña el paso activo, el flujo y el GRAFCET. Las muestras están marcadas como sintéticas.
7. Al terminar, muestra **awaiting evidence**: completar el recorrido no cierra la excepción.

Narración: “Seguimos la misma necesidad desde la inspección hasta la entrega. Cada paso conserva el contexto de material y una responsabilidad. Esta es una simulación; no estamos controlando un equipo real.”

### Toma B — demostrar que falla de forma controlada

1. En el mismo caso cambia el rack a **Blocked shelf**.
2. Ejecuta un ciclo de Simulation; al llegar al rack debe aparecer la excepción y detenerse antes del transporte.
3. Repite si quieres con Empty shelf o Replenishment delayed.
4. Devuelve el estado a Available para las siguientes tomas.

Narración: “Si el material no es accesible, el sistema no inventa un despacho exitoso. Mantiene abierta la excepción.”

### Toma C — una aprobación real

1. Selecciona **Assisted — approval required**, un ciclo, Run routine.
2. Se detiene en el primer paso. Completa los 15 campos de Exception Fingerprint con contexto de demostración; no uses credenciales ni datos sensibles.
3. Revisa los siete criterios físicos. Un valor Unknown/No impide aprobar. No marques Yes para continuar si no existe una base válida.
4. Para un fixture puramente simulado, documenta la base sintética, confirma la revisión y aprueba **una** acción.
5. Muestra que la siguiente acción vuelve a pedir aprobación. Puedes rechazar/cancelar para terminar esta toma; no la presentes como ciclo completado.

Los actores “técnico”, “ejecutivo” y “warehouse operator” son responsabilidades del caso, no tres identidades reales autenticadas. El prototipo conserva el rol técnico approver/admin; una implantación necesita separación de funciones por proceso.

### Toma D — experimento reproducible

1. Conserva cargado el caso completo, con ninguna rutina activa.
2. Abre **Industrial timing experiments → Load current model template**.
3. Enseña source=demo y la advertencia de supuestos. No llames “tiempos reales” a estos números.
4. Copia el baseline en Candidate; en el nodo orch-tech añade capacity: 2. Mantén iguales el resto de parámetros.
5. Usa 24 órdenes del mismo SKU/lote, 20 réplicas y seed 42. Pulsa **Validate & run**.
6. Compara ciclo medio, P95 de órdenes, colas y utilización. El resultado dependerá de dónde esté el cuello de botella; más capacidad no garantiza una mejora global.
7. Vuelve a ejecutar con la misma semilla para mostrar reproducibilidad. No confundas el P95 de órdenes con el de medias de réplicas.

### Toma E — receta reutilizable y cierre con prueba

1. Abre **Joule-like local planner** — también accesible desde el objeto Joule.
2. Selecciona el caso completo, Assisted y contexto DEMO; escribe: “Preparar inspección de bomba, fabricación autorizada del kit y entrega verificada”.
3. Genera el plan; muestra NOT_CONNECTED y “nothing executed”.
4. Abre Preview y revisa el JSON. Export solicita **run-routine.bat** y **routine.recipe.json**; confirma ambas descargas.
5. Para reutilizar: coloca ambos archivos en la raíz de Embodied AI, conserva scripts/ y src/, inicia la app y ejecuta manualmente el BAT. Recarga la app para recuperar el job activo y sus aprobaciones. Usa solo archivos cuyo contenido hayas revisado.
6. La alternativa es la acción explícita de la vista previa para enviar la receta a la app, sin ejecutar un BAT.
7. Para una rutina terminada, completa las seis comprobaciones del Resolution Proof. Si el activo no fue reparado/retesteado, conserva originatingExceptionCleared como Unknown/No. Exporta la evidencia sin afirmar una resolución real.

Si el navegador bloquea múltiples descargas, permite las dos solo para la app local y verifica su contenido. El BAT no porta contraseñas, no acepta URLs ni contiene el objetivo del chat.

## 5. Pitch hablado, aproximadamente 90 segundos

“Una empresa puede detectar una excepción en segundos y tardar horas en resolverla porque sus datos, decisiones y recursos físicos no están coordinados.

Nuestra propuesta convierte esa excepción en un recorrido verificable. Utilizamos contexto gobernado de SAP BDC Connect y una experiencia inspirada en Joule para unir al operador de activos, al técnico, a manufactura y a logística.

En este prototipo, un robot Unitree inspecciona un activo. Un técnico confirma la necesidad de un repuesto, el ejecutivo autoriza la orden y manufactura evalúa una línea para ensamblarla con un UR5. Almacén verifica material, cantidad y RFID antes de proponer el transporte.

Lo importante es que podemos experimentar antes de actuar. DES y Monte Carlo permiten comparar capacidad, tiempos y variabilidad. Assisted exige autorizaciones, y un estante bloqueado detiene el proceso. Terminar una animación no equivale a resolver la excepción: exigimos una prueba de resolución.

Las rutinas aprobadas pueden reutilizarse como recetas estructuradas, reduciendo la necesidad de volver a pedirle a un modelo que improvise el mismo procedimiento.

Hoy demostramos el flujo con datos sintéticos y producción bloqueada. El siguiente paso es un piloto con tiempos reales, un sistema de pruebas SAP y un integrador de robótica. Nuestra promesa no es autonomía sin supervisión: es intervenir mejor, con menos espera y con evidencia.”

## 6. Tiempos: supuestos del demo frente a calibración

No se encontró un tiempo universal de inspección, ensamble o picking que sea trasladable a esta instalación. SAP utiliza valores estándar por operación, cantidad base y configuración; el trabajo de almacén añade desplazamiento y actividades. Una velocidad máxima de catálogo no equivale a la velocidad segura de una misión. Fuentes: [tiempos de operación SAP](https://help.sap.com/docs/SAP_ERP/bfece09273bd474d82fdd97bae070c25/f101b753128eb44ce10000000a174cb4.html), [trabajo de almacén SAP EWM](https://help.sap.com/docs/SAP_EXTENDED_WAREHOUSE_MANAGEMENT/3d97bec9bf1649099384bb8167df3cf2/d65b310b4e5e4cee9d3433e5e0c6ba3c.html) y [Unitree Go2](https://www.unitree.com/go2/).

El template usa estos **supuestos diseñados para el demo**, en segundos por orden de SKU/lote fijo. No son benchmarks verificados:

| Actividad | Triangular min / moda / max |
| --- | --- |
| Inspección Unitree | 90 / 180 / 420 |
| Inspección/diagnóstico del técnico | 300 / 900 / 1800 |
| Ensamble UR5 | 30 / 60 / 120 |
| Inspección de calidad | 20 / 45 / 120 |
| Embalaje | 30 / 60 / 120 |
| Verificación de rack | 15 / 30 / 90 |
| Transporte interno | 120 / 240 / 600 |

Estos rangos incluyen toda la actividad representada: no añadas de nuevo viaje/manipulación si ya están incluidos. El campo Quantity es contexto, no un multiplicador automático del tiempo. Recalibra por SKU y tamaño de lote.

Para un piloto registra: timestamps de entrada/inicio/fin, máquina/turno/SKU/lote, setup, proceso, manipulación, recorrido, esperas de autorización, cola, fallos, retrabajo y ausencias de recursos. Preserva trazabilidad de la muestra. Separa observaciones censuradas y fallidas, valida unidades y prueba la predicción contra jornadas no usadas para calibrar.

El motor permite muestras empíricas por recurso; source=observed exige una referencia, pero no autentica la medición. No hay actualmente calendarios de turnos, optimizador de rutas físicas, baterías, colisiones, recursos humanos compartidos entre estaciones ni modelos completos de averías. No uses resultados para dimensionar una planta hasta validar esas omisiones.

OEE = disponibilidad × rendimiento × calidad, solo con denominadores coherentes; no es “ELOI”. La implementación deja OEE sin valor cuando faltan datos adecuados o se mezclan SKUs sin ciclo ideal compatible. [SAP Digital Manufacturing: OEE](https://help.sap.com/docs/sap-digital-manufacturing/insights/oee-calculations).

Chi-cuadrado puede ayudar a contrastar un ajuste de distribución bajo sus supuestos; no es un modelo de regresión ni un algoritmo que encuentre la mejor ruta. [NIST: Chi-square goodness of fit](https://itl.nist.gov/div898/software/dataplot/refman1/auxillar/chsqgood.htm).

## 7. Seguridad y gobierno

La app muestra referencias por rutina. **No implementa ni certifica por sí misma esas normas.** La aplicabilidad, evaluación de riesgos y controles físicos corresponden a profesionales y al integrador del sistema.

| Referencia | Uso propuesto |
| --- | --- |
| [ISO 12100:2010](https://www.iso.org/standard/51528.html) | Evaluación y reducción de riesgos de maquinaria. |
| [ISO 10218-1:2025](https://www.iso.org/standard/73933.html) y [10218-2:2025](https://committee.iso.org/standard/73934.html) | Robot industrial y su integración/celda, especialmente el UR5. |
| [ISO 13849-1:2023](https://www.iso.org/standard/73481.html) | Partes de sistemas de control relacionadas con seguridad; el nivel requerido depende del riesgo. |
| [IEC 62443-3-2:2020](https://webstore.iec.ch/en/publication/30727) | Riesgo de ciberseguridad OT, zonas y conductos. |
| [ISO/IEC 27001:2022](https://www.iso.org/standard/27001) | Gestión de seguridad de información. |
| [ISO/IEC 42001:2023](https://www.iso.org/standard/42001) | Gestión y responsabilidad de sistemas de IA. |

[ISO 3691-4:2023](https://www.iso.org/standard/83545.html) trata de vehículos industriales sin conductor: no debe asignarse automáticamente a un perro robótico. Confirma modelo Unitree, sensores, protección ambiental y límites de misión. RFID requiere lector y asociación física verificada; el EPC hex del demo no demuestra una etiqueta real ni conformidad GS1.

Assisted exige Business Object, Process, Exception Type, Business Impact, Urgency, Root Cause Candidates, Physical Dependency/Location, Required Outcome, Available Resources, Constraints, Safety/Authorization/Evidence Requirements y Resolution Criteria. La revisión física comprende causa física, observabilidad, dispositivo adecuado, ubicación conocida, seguridad, autorización y verificabilidad.

Los controles de UI, CORS, validación, rate limiting, roles y aislamiento lógico no sustituyen un safety PLC ni una parada de emergencia. El modo desktop local tampoco equivale a autenticación empresarial. Para un piloto multiusuario: proveedor de identidad corporativo, separación de funciones, persistencia segura, almacenamiento de secretos externo, auditoría durable y autorizaciones de dispositivo/acción.

## 8. Valor económico: ejemplo, no ahorro demostrado

Primero mide una línea base, luego un piloto comparable. Evita contabilizar dos veces las mismas horas.

| Hipótesis mensual ilustrativa, USD | Cálculo | Valor |
| --- | --- | ---: |
| Capacidad administrativa liberada | 200 excepciones × 12 min / 60 × 60 USD/h | 2,400 |
| Contribución recuperada por menor parada | 6 h atribuibles × 1,000 USD/h | 6,000 |
| Retrabajo evitado | 20 eventos × 100 USD | 2,000 |
| Beneficio bruto potencial | Suma de hipótesis | 10,400 |
| Operación/soporte incremental supuesto | Estimación ilustrativa | −3,000 |
| Balance operativo ilustrativo | Antes de inversión, licencias/impuestos no incluidos | 7,400 |

No es cotización ni pronóstico. Liberar tiempo no implica reducir nómina. La contribución por parada requiere demanda y margen recuperables. Completa TCO con robot, sensores, lector RFID, integrador, licencias SAP, infraestructura, mantenimiento, seguridad, formación y validación. Si esos costos superan el beneficio, el caso no se sostiene.

La app local actual hace **cero llamadas a un LLM** para estas recetas: no puede demostrar un ahorro adicional respecto de cero. Para un futuro modelo remoto:

ahorro de inferencia = llamadas evitadas × (tokens de entrada × tarifa de entrada + tokens de salida × tarifa de salida) − costo de recuperación/validación.

Ejemplo puramente hipotético: 1,000 consultas/mes, 80% reutilizables, 8,000 tokens de entrada + 2,000 de salida por consulta evitarían 6.4 millones de tokens de entrada y 1.6 millones de salida. Usa precios contratados y tasa de reutilización observada. La caché local de recetas no es prompt caching del proveedor. Ningún fallback debe usarse para evadir salvaguardas.

## 9. Arquitectura y siguiente piloto

BDC Connect → contexto autorizado → coordinación Joule/receta → evaluación DES/Monte Carlo → aprobación → adaptador de ejecución → evidencia → verificación del estado del negocio.

En el prototipo son trabajos asíncronos y eventos SSE. El BAT solo reutiliza el mismo endpoint de rutinas; no añade un canal privilegiado. Recetas, jobs, perfiles y pruebas se pierden al reiniciar; las exportaciones son el soporte portable actual.

BDC Connect es intercambio de datos gobernados, no una API universal para crear órdenes o manejar robots. Las escrituras transaccionales y Joule requieren interfaces soportadas, licencias y permisos del tenant; el control físico requiere un adaptador de dispositivo independiente. [SAP sobre BDC Connect y colaboración multiagente](https://news.sap.com/2026/04/sap-google-cloud-expand-partnership-deploy-multi-agent-ai/).

Primer piloto recomendado: **inspección con Unitree + confirmación del técnico**, sin producción autónoma. Equipo: especialista SAP Asset Management/servicio, responsable de BDC Connect/Joule, integrador Unitree, ingeniero de seguridad OT, ingeniero de simulación y dueño de proceso. Después incorpora UR5, trazabilidad RFID y logística por etapas.

Preguntas pendientes que sí cambian arquitectura: modelo Unitree exacto; aplicación/tenant SAP disponible; SDK y sensor reales; quién puede aprobar cada acción; qué fuente demuestra la reparación; tamaño de lote y muestras de tiempo disponibles. No hace falta compartir credenciales para responderlas.

## 10. Evidencia técnica y límites de esta entrega

Los archivos test/full-circle.mjs, test/routine-library.mjs y test/robotics-smoke.mjs comprueban flujo, rack, validación, recetas, API asíncrona, aprobación y bloqueo live. Los tests industriales cubren reproducibilidad, colas, tiempos y KPI.

Ver PROJECT_LOG.md para resultados finales. Las pruebas de mallas/servidor no equivalen a una revisión visual en tu GPU. Tampoco validan comportamiento físico, conectividad de un tenant SAP ni una certificación de seguridad.

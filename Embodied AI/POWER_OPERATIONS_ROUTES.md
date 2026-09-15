# Cuatro rutas para Power the Operations: BDC Connect + Joule
Fecha: 2026-09-15. Propuesta de producto; no implica integración certificada ni disponibilidad contractual en un tenant.

## Recomendación
Vender una capa de **decisión y resolución verificable de excepciones físicas**: antes de intervenir, comparar alternativas con DES y Monte Carlo; después, demostrar tanto el resultado físico como la desaparición de la excepción de negocio. Empezar con una sola rutina, no con todo SAP ni todos los robots.

Mi elección sería la ruta 2 como producto, la ruta 1 como diferenciador analítico y una misión de la ruta 3 como demostración. La ruta 4 sería una línea posterior. No migrar el render ni comprar infraestructura robótica antes de escoger la primera excepción y obtener datos.

## Qué significa el cambio de integración
SAP presentó asistentes de activos/servicio, manufactura, logística, planificación e ingeniería integrados en aplicaciones de negocio, con disponibilidad escalonada durante 2026. No son funcionalidades que aparezcan automáticamente por conectar una URL de Joule. [SAP Sapphire: Autonomous Supply Chain](https://news.sap.com/2026/05/more-autonomous-supply-chain/).

BDC Connect es el plano de intercambio de productos de datos con plataformas compatibles. Joule y las interfaces soportadas del tenant son el plano de coordinación. Quitar aplicaciones del menú no elimina las aplicaciones, autorizaciones o licencias que el cliente necesita detrás de esos agentes. El uso de Connect no concede escritura transaccional universal. SAP distingue intercambio de datos y APIs de agentes en su [anuncio de integración con Google Cloud](https://news.sap.com/2026/04/sap-google-cloud-expand-partnership-deploy-multi-agent-ai/).

### Ruta 1 — Operations Decision Lab: decidir antes de ejecutar
**Comprador:** ingeniería industrial, dirección de planta y planificación. **Producto:** laboratorio de experimentos; no necesita controlar un robot.

Caso: una línea incumple su objetivo. Comparar el proceso actual frente a cambiar el tamaño de lote, añadir capacidad, alterar turnos o reducir la espera de autorización. El DES representa entidades, recursos, colas y eventos. Monte Carlo repite con incertidumbre de tiempos, averías y demanda cuando exista un modelo validado de esas variables.

Integración: productos de datos gobernados → conjuntos de tiempos e historial versionados → calibración → baseline/candidato → informe que Joule pueda presentar mediante una interfaz soportada. El 3D explica dónde se forma la cola; no es el motor estadístico.

Demo: ejecutar dos alternativas con las mismas semillas y mostrar diferencia de tiempo de ciclo, throughput, esperas, utilización y probabilidad de cumplir una meta. Presentar intervalos, no un único porcentaje de ahorro.
**Diferenciador:** evidencia cuantitativa antes de gastar o cambiar la operación.
**Límite:** sin datos contrastados es un experimento hipotético, no un caso económico demostrado.

### Ruta 2 — Exception Resolution OS: resolver y demostrar
**Comprador:** responsable de operaciones, process owner, supervisor de turno; arquitectura e IT/OT administran la plataforma. **Producto:** bandeja de excepciones con ciclo de resolución físico-digital.

Caso: el sistema dice que un material está disponible, pero la línea no puede consumirlo. El fingerprint identifica objeto, impacto, ubicación, hipótesis y condiciones de cierre. Se compara inspección, traslado, reintento digital o escalamiento humano. Assisted exige autorización para cada acción relevante.

Integración: contexto gobernado por BDC Connect → Joule propone una rutina admitida → DES compara alternativas → validación de resolubilidad física → aprobación → misión local/robot futuro → evidencia → lectura de retorno del estado de negocio → cierre.

Demo: primer intento bloqueado por ubicación desconocida; segundo autorizado; al terminar el movimiento, mantener la excepción abierta si falta confirmar cantidad o si el error originario sigue presente.
**Diferenciador:** “comando completado” no significa “excepción resuelta”.
**Límite:** escritura/idempotencia y lectura de retorno del sistema origen requieren un contrato real del tenant. No se simulan como transacciones reales.

### Ruta 3 — ANYmal Reliability Operations: inspección basada en riesgo
**Comprador:** mantenimiento, confiabilidad y operaciones de activos. **Producto:** planificación y evidencia de inspección, no un robot de reparación universal.

Caso: una bomba muestra un indicio anormal. Comparar inspeccionarla ahora, en una ronda agrupada o mediante un técnico. El modelo considera viaje, batería, acceso, toma de medición, revisión y posible parada.

Integración: contexto e historial → coordinación de Asset and Service Assistant → misión de inspección → evidencias térmicas/visuales/acústicas → decisión de mantenimiento y verificación posterior. El acceso a ANYmal sería una integración adicional de robot, distinta de las dos conexiones de negocio.

ANYmal es una solución robótica de inspección, no un motor de render. No asumir que puede mover material o reparar una bomba; su idoneidad depende de la capacidad del equipo y la misión. [ANYmal](https://www.anybotics.com/robotics/anymal/). ANYbotics documenta integración para misiones, flotas y datos de inspección, pero hay que obtener el contrato/SDK y permisos aplicables. [API de ANYbotics](https://www.anybotics.com/resources/whitepapers-and-ebooks/api-whitepaper/).

Demo: el robot confirma el indicio; la misión termina, pero la avería permanece abierta hasta reparación y comprobación. Una inspección que reduce incertidumbre puede aportar valor sin resolver físicamente la causa.
**Diferenciador:** priorizar inspecciones por riesgo y efecto operativo.
**Límite:** no se modifica WebGL ni se instala/controla ANYmal en esta entrega.

### Ruta 4 — Routine Qualification Factory: certificar rutinas antes de liberarlas
**Comprador:** centro de excelencia de automatización, integradores y responsables IT/OT. **Producto:** catálogo versionado de rutinas y banco de pruebas.

Caso: un equipo propone una rutina de reposición o recuperación. Se prueba contra perfiles de tiempos, recursos escasos, demoras de autorización, datos incompletos y excepciones conocidas. Se compara contra la versión anterior y se aprueba su publicación.

Integración: BDC Connect aporta contextos de prueba minimizados; Joule ayuda a seleccionar/explicar la rutina; un ejecutor determinista aplica pasos admitidos; DES produce evidencia de comportamiento operativo; el registro guarda versión, parámetros, límites y pruebas.

Los .bat/.vbs existentes serían adaptadores bajo lista permitida, parámetros validados, privilegio mínimo y supervisión; no scripts arbitrarios generados y ejecutados por un modelo. Los bloqueos de seguridad detienen o escalan, nunca se eluden cambiando de modelo.

Demo: una versión falla ante evidencia caducada; otra detiene correctamente y solicita revisión. Solo la segunda se libera.
**Diferenciador:** automatización repetible, portable y verificable con menor dependencia de tokens.
**Límite:** “entrenar una rutina” no equivale a entrenar locomoción robótica. El aprendizaje físico requiere otro simulador, activos cinemáticos, sensores y validación.

## Tiempos: contrato mínimo de datos
No existe un “tiempo máquina SAP” universal. SAP diferencia valores estándar de preparación, máquina y mano de obra, unidades, cantidad base y fórmulas por centro de trabajo. Una duración planificada no es necesariamente la duración observada. [Duración de segmentos de operación](https://help.sap.com/docs/SAP_ERP/bfece09273bd474d82fdd97bae070c25/f101b753128eb44ce10000000a174cb4.html).

Por equipo, operación, producto/variante y turno, conservar:
- Identificadores de equipo, ubicación funcional, orden, operación, lote y material; tenant y zona horaria.
- Fecha/hora de inicio y fin, reloj de origen y calidad del registro.
- Tiempo productivo de máquina, preparación/cambio, carga-descarga, traslado, espera de recursos, espera de aprobación y verificación.
- Estado: funcionando, parada, mantenimiento, bloqueo aguas abajo, falta de alimentación aguas arriba o fuera de turno.
- Cantidad total/buena/rechazada, ciclo ideal por producto, tamaño de lote y recursos simultáneos.
- Fallos, reparación, límites de acceso, batería y carga cuando correspondan.
- Fuente, periodo observado, tamaño de muestra, versión y tratamiento de faltantes.

**No sumar a ciegas:** preparación por lote no es preparación por pieza; máquina y operario pueden trabajar en paralelo; la cola calculada por DES no debe volver a incluirse en el tiempo de servicio medido. Si una medición inicio-fin ya incluye viajes y manipulación, no añadirlos de nuevo.

Un modelo de tarea sencillo:
tiempo de resolución = diagnóstico + espera de autorización + espera de recurso + viaje + intervención + verificación.
Un modelo de flujo tiene operaciones paralelas y recursos compartidos: su duración surge de los eventos, no de sumar todas las duraciones de la planta.

En almacén, SAP contempla tiempos de picking, desplazamiento entre ubicaciones y componentes fijos en estándares de trabajo. [Engineered Labor Standards](https://help.sap.com/docs/SAP_EXTENDED_WAREHOUSE_MANAGEMENT/3d97bec9bf1649099384bb8167df3cf2/d65b310b4e5e4cee9d3433e5e0c6ba3c.html).

## KPI por rutina
Estos son objetivos de instrumentación del producto, no una afirmación de que todos estén calculados hoy.

| Rutina | Indicadores prioritarios | Datos / condición de interpretación |
|---|---|---|
| Fabricación | OEE y A/P/Q, tiempo máquina por unidad, preparación por lote, throughput, first-pass yield, scrap/retrabajo, espera, bloqueo/falta de material, energía por unidad buena | Turno, paradas, ciclo ideal por variante, conteos y estados. No usar OEE de una máquina como OEE de toda la planta. |
| Activos/inspección | Tiempo de detección, MTTR, MTBF con convención explícita, duración de misión, cobertura de puntos válidos, falsos positivos, primera reparación exitosa, energía por misión | Inicio/fin de fallo y reparación, población de activos, verdad de referencia, observaciones válidas. Misiones completas no prueban reparación. |
| Logística | Ciclo de picking/orden, viaje con/sin carga, utilización de flota, congestión/colas, precisión material-cantidad-destino, permanencia en muelle, entrega a tiempo, energía por traslado | Eventos de tarea, distancias y velocidades medidas, unidades, localización y confirmaciones físicas. Una orden ERP cerrada no prueba presencia física. |
| Orquestación | Tiempo hasta acción y resolución verificada, porcentaje con resolución física viable, cierre a la primera, reapertura, cumplimiento SLA, espera de autorización, transferencias entre equipos, tokens/llamadas por excepción | Tiempos de excepción, decisiones, eventos correlacionados, prueba física y lectura de retorno del origen. Reportar también escalaciones seguras; no premiar ocultar fallos. |

### Fórmulas y denominadores
Para una operación homogénea con ciclo ideal definido:
- Disponibilidad = tiempo de funcionamiento / tiempo de producción planificado.
- Rendimiento = ciclo ideal × unidades totales / tiempo de funcionamiento.
- Calidad = unidades buenas / unidades totales.
- OEE = disponibilidad × rendimiento × calidad.

Con mezcla de productos, ponderar por los tiempos ideales correspondientes; no promediar porcentajes sin sus denominadores. Si faltan datos, resultado “no disponible”, no cero ni un valor inventado. Un rendimiento superior al 100% debe investigarse, no esconderse mediante un límite automático. [SAP: OEE Calculations](https://help.sap.com/docs/sap-digital-manufacturing/insights/oee-calculations).

MTTR requiere tiempo y número de reparaciones; los indicadores entre fallos requieren una población, ventana y convención temporal consistente. En este prototipo, el estimador operativo propuesto de MTBF es tiempo operativo acumulado / fallos, etiquetado con ese denominador; se debe mapear contra la definición específica del sistema origen, no asumir equivalencia. [SAP: Calculation of Mean Time KPIs](https://help.sap.com/docs/PRODUCT_ID/f50a0b24de8e4968a683e6f926bf1563/9774ed07f7e246c280e2f0cfac18c6db.html?locale=en-US&state=PRODUCTION&version=latest).

## DES y Monte Carlo defendibles
1. Separar DEMO, ESTIMADO y OBSERVADO; introducir la fuente y ventana de cada muestra.
2. Depurar unidades, duplicados, relojes, registros incompletos y mezcla de turnos/productos.
3. Modelar recursos y restricciones; empezar con distribuciones empíricas o supuestos explícitos. No afirmar un ajuste estadístico sin evaluarlo.
4. Contrastar el baseline con un periodo no usado en calibración: throughput, percentiles y colas.
5. Ejecutar réplicas independientes; comparar alternativas con semillas emparejadas cuando corresponda.
6. Distinguir P95 de órdenes, distribución entre réplicas e intervalo de confianza de la media. Un intervalo estadístico no cubre el error de un modelo mal especificado.
7. Medir sensibilidad y supuestos no modelados: fallos, recuperación, turnos, transporte, buffers finitos y capacidades compartidas.
8. Monetizar solo con costes y reglas de negocio aprobados, conservando baseline y trazabilidad.

Chi-cuadrado no es un modelo de regresión para optimizar rutas: es útil, entre otros usos, para comprobar ajuste de frecuencias bajo condiciones de muestra y agrupación. Su aprobación no demuestra que una distribución sea “verdadera” ni que una ruta sea óptima. [NIST: Chi-Square Goodness of Fit](https://itl.nist.gov/div898/software/dataplot/refman1/auxillar/chsqgood.htm).

La credibilidad requiere verificación, validación e incertidumbre durante el ciclo de vida del gemelo. [NIST: Credibility Consideration](https://www.nist.gov/publications/credibility-consideration-digital-twins-manufacturing).

## Assisted y transiciones TN
Cada acción relevante vincula un paso S y su transición T a un fingerprint versionado:

Business Object; Process; Exception Type; Business Impact; Urgency; Root Cause Candidates; Physical Dependency; Physical Location; Required Outcome; Available Resources; Constraints; Safety Requirements; Authorization Requirements; Evidence Requirements; Resolution Criteria.

Antes de intervenir:
1. ¿La causa es física?
2. ¿Su estado es observable?
3. ¿Existe un robot/dispositivo con la capacidad necesaria?
4. ¿La ubicación está identificada?
5. ¿La acción es segura?
6. ¿Está autorizada?
7. ¿Puede verificarse la resolución?

Cada respuesta tiene sí/no/desconocido. “Desconocido” no significa “sí”. Si falla una condición, no se libera la intervención: se investiga, se corrigen datos o se escala. Una misión diagnóstica se puede proponer como una rutina distinta, con su propio objetivo observable y su autorización; no convertir incertidumbre en permiso.

Tn exige condición del proceso + expediente completo + validación de capacidad + permiso vigente. La interfaz de aprobación no reemplaza enclavamientos ni sistemas de seguridad físicos.

## Protocolo de Resolution Proof
Estados propuestos: detectada → contextualizada → evaluada → autorizada → ejecutando → pendiente de evidencia → pendiente de reconciliación → resuelta verificada / escalada.

Comprobaciones:
- Material correcto.
- Cantidad correcta y unidad de medida coherente.
- Destino correcto.
- Presencia física comprobada.
- Estado físico esperado.
- Excepción originaria desaparecida mediante nueva lectura del origen.

Para inspección, los tres primeros pueden ser “no aplica” con justificación; los demás no se omiten. El expediente conserva identificadores, antes/después, tiempos de origen/recepción, referencias de evidencia, actor y decisión, versiones de rutina/modelo/contrato y relación con el evento inicial.

En producción: deduplicación, idempotencia, validez temporal de evidencia, dispositivos autenticados, permisos mínimos, reconciliación y verificación independiente. Un hash detecta cambios de contenido, pero no certifica que un sensor dijo la verdad. El prototipo solo debe emitir **resolved_simulated**, no cerrar una excepción real de SAP.

## Qué usa hoy el 3D
public/webgl-world.js crea un contexto **WebGL 1 nativo** con canvas.getContext('webgl'), shaders GLSL, geometría procedural y animación propia. La vista 2D y GRAFCET utilizan SVG; la interfaz, HTML/CSS/JavaScript; el servidor, Node.js con trabajos asíncronos y SSE.

No usa Three.js, Babylon.js, Unity, Unreal, Gazebo o Isaac Sim. Las animaciones no son simulación dinámica ni aprendizaje robótico: no resuelven locomoción, contactos, sensores calibrados ni alcance físico.

ANYmal se integraría como robot/modelo de misión. No sustituye WebGL. Para entrenamiento físico haría falta evaluar un simulador especializado y los activos/interfaces permitidos del fabricante; esa decisión queda pendiente, como pidió el usuario.

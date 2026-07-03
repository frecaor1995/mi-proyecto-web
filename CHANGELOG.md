# CHANGELOG — Calculadora Fly Electric Solutions

Registro de funcionalidades de `calculadora.html`. El objetivo de este archivo es que nunca más se pierda una funcionalidad ya construida: cualquier feature nueva debe agregarse aquí, y antes de rediseñar o reemplazar el archivo hay que revisar esta lista.

## [v3-estable] — 2026-07-03

Snapshot de respaldo permanente: `calculadora_v3_estable.html` (copia exacta y congelada de esta versión de `calculadora.html`). No editar ese archivo — es el punto de restauración conocido y funcional.

### Recuperado en esta versión (se había perdido, existía solo en `Downloads/calculadora (3).html`)
- **Modo dual Estimado / Cotización Oficial**: barra de selección debajo del nav (`📋 Estimado` / `🔒 Cotización Oficial`).
- **PIN de acceso (4 dígitos, código `2025`)** para desbloquear el modo Cotización Oficial. Teclado numérico con animación de error y sesión desbloqueada válida por 4 horas (`localStorage`, clave `fes_pin_unlocked`).
- **Texto legal tipo contrato** en modo Cotización Oficial: precios definitivos y cláusula de aceptación del cliente ("la aceptación de esta cotización por parte del cliente constituye un acuerdo para proceder").
- **PDF diferenciado por modo**: título "ESTIMADO ELÉCTRICO" vs "COTIZACIÓN ELÉCTRICA OFICIAL", insignia de color (verde = Estimado, dorado = Cotización Oficial), folio con prefijo `FES-` vs `FES-COT-`.
- **Diferenciación visual**: color del total y borde del recuadro legal cambian según el modo activo.
- **Mensaje de WhatsApp** distingue "Estimado" vs "Cotización Oficial".

### Funcionalidades completas actuales (estado íntegro del archivo)
- Formulario de cliente: nombre, dirección, teléfono, fecha (auto).
- Folio consecutivo por sesión (`FES-YYMMDD-###` / `FES-COT-YYMMDD-###`).
- Tabla de servicios/ítems editable: agregar fila manual, eliminar fila, cálculo de total por fila en vivo.
- Catálogo predefinido por categorías (Tomas y Apagadores, Tableros y Breakers, Iluminación, EV y Solar, Misceláneos) seleccionable desde modal.
- Cálculo automático: Subtotal, Materiales (15%), Labor (85%), Sales Tax 8.25% (solo sobre materiales, ley TX), Total.
- Generación de PDF (jsPDF + autoTable): header de marca, datos del cliente, tabla de ítems, totales, líneas de firma (Cliente / Contratista), pie de página con contacto y disclaimer legal.
- Envío de resumen por WhatsApp con enlace directo al número de la empresa.
- Contador de estimados/cotizaciones generados (total, del mes, valor total estimado) persistido en `localStorage` (clave `fes_counter_v1`).
- Notificación tipo "toast" al generar el PDF exitosamente.
- Soporte bilingüe completo ES/EN (botón "ES / EN" en el nav), incluyendo textos del modo activo.
- Botón "Nuevo Estimado/Nueva Cotización" con confirmación antes de limpiar el formulario.
- Sin texto de licencia TDLR (removido intencionalmente).
- Teléfono y contacto actualizados: (713) 384-2411, Houston TX.

### Archivos de respaldo relevantes
- `calculadora_backup_antes_restore.html` — snapshot tomado justo antes de fusionar la recuperación del modo dual/PIN (referencia de "antes").
- `calculadora_v3_estable.html` — snapshot de esta versión estable ya con todo fusionado (referencia de "después", punto de restauración oficial).

## Historial previo (resumen, ver `git log -- calculadora.html` para detalle completo)
- Contador consecutivo de estimados (`FES-YYYYMMDD-000`), catálogo con dropdown y botón de ítem personalizado.
- Tabla multilínea de ítems con total calculado por fila.
- Envío de email de confirmación al cliente (Web3Forms).
- Ajuste de número de teléfono a código de área de Houston.
- Corrección de contador para iniciar en 001 y eliminación del texto de licencia TDLR.
- Corrección del número de teléfono mostrado en el PDF.

## Cómo restaurar si algo se pierde de nuevo
1. Copiar `calculadora_v3_estable.html` sobre `calculadora.html`.
2. Confirmar en el navegador que el modo Estimado y Cotización Oficial (PIN `2025`) funcionan.
3. Si se necesita mezclar con cambios nuevos, comparar contra este CHANGELOG antes de sobrescribir cualquier función listada aquí.

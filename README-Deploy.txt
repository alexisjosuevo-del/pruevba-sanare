# Sanaré · Cotizador → CRM (Registro + PDF en Drive)

Este paquete incluye un flujo **registrar primero** para obtener folio del servidor, luego **generar PDF con ese folio**, **subir a Drive** y finalmente **actualizar** la fila con el `DriveURL` y `FileId`.

## Contenido
- `index.html` — maqueta lista para probar.
- `styles.css` — estilos básicos.
- `app.js` — lógica completa del flujo (registrar → PDF → subir → actualizar).

## Requisitos
1) Tener un proyecto de **Apps Script** desplegado como Web App (copia el código de abajo).
2) Crear una carpeta en Drive para PDFs y pegar su ID en `PDF_FOLDER_ID` del script.
3) Abrir `index.html` con internet (usa el CDN de `html2pdf`).

---

## Código Apps Script (pegar completo)
**Reemplaza solo `PDF_FOLDER_ID`**. El `SHEET_ID` ya apunta a tu Sheet:
`1uqOZKFYFs_Bao6IjsvEtpFZ00Mrfdv4DlaTeqVlgRec`.

```javascript
/***** CONFIG *****/
const SHEET_ID = '1uqOZKFYFs_Bao6IjsvEtpFZ00Mrfdv4DlaTeqVlgRec';
const SH_COTS  = 'Cotizaciones';
const SH_ITEMS = 'Items';
const PDF_FOLDER_ID = '1VeFl-1vUtW7Ky_XYo9ialYPs1c2nm0WY'; // Carpeta PDFs en Drive

/***** CORS mínimo *****/
function doOptions() { return ContentService.createTextOutput('{}').setMimeType(ContentService.MimeType.JSON); }
function doGet()     { return ContentService.createTextOutput('{"ok":true}').setMimeType(ContentService.MimeType.JSON); }

/***** Endpoint principal *****/
function doPost(e){
  try {
    const d = JSON.parse(e.postData.contents || '{}');
    if (d.type === 'cotizacion') return json_(saveCot_(d));
    if (d.type === 'uploadPdf')  return json_(savePdfToDrive_(d));
    if (d.type === 'updatePdf')  return json_(updatePdf_(d));  // NUEVO
    return json_({ok:false, error:'Tipo no soportado'});
  } catch(err){
    return json_({ok:false, error:String(err)});
  }
}

function saveCot_(d){
  const tz  = Session.getScriptTimeZone();
  const now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  const ss  = SpreadsheetApp.openById(SHEET_ID);
  const shC = ss.getSheetByName(SH_COTS);
  const shI = ss.getSheetByName(SH_ITEMS);
  if(!shC || !shI) throw new Error('Faltan pestañas "Cotizaciones" o "Items"');

  // Generar folio si no vino del front
  const folio = (d.folio && String(d.folio).trim()) || genFolioSmart_(d.kam);

  // Cabecera
  const row = [
    now,                                // A
    folio,                              // B
    d.estado || 'Nueva',                // C
    d.fechaEmision || now.slice(0,10),  // D
    d.validoHasta || '',                // E
    d.fechaProgramacion || '',          // F
    d.paciente || '',                   // G
    d.medico || '',                     // H
    d.aseguradora || '',                // I
    d.kam || '',                        // J
    d.realizadoPor || '',               // K
    d.direccion || '',                  // L
    d.telefono || '',                   // M
    d.esquema || '',                    // N
    d.comentarios || '',                // O
    num(d.subtotalMeds),                // P
    num(d.subtotalServ),                // Q
    num(d.ivaServicios),                // R
    num(d.descuentoGlobalPct),          // S
    num(d.descuentoGlobalMonto),        // T
    num(d.total),                       // U
    d.driveUrl || '',                   // V
    d.fileId || '',                     // W
    d.origen || 'via-cotizador',        // X
    JSON.stringify(d.medicamentos||[]), // Y
    JSON.stringify(d.servicios||[]),    // Z
    d.kamEmail || '',                   // AA
    d.realizadoPorEmail || ''           // AB
  ];
  shC.appendRow(row);

  // Detalle
  const push = (arr, tipo) => (arr||[]).forEach(it => shI.appendRow([
    now, folio, tipo,
    it.descripcion || '', it.codigo || '',
    num(it.cantidad), num(it.precioUnit), num(it.descPct),
    num(it.subtotalAntesDesc), num(it.subtotalConDesc),
    num(it.ivaPct), num(it.ivaMonto), num(it.totalLinea)
  ]));
  push(d.medicamentos, 'Medicamento');
  push(d.servicios,    'Servicio');

  return { ok:true, folio, row: shC.getLastRow() };
}

function savePdfToDrive_(d){
  if (!PDF_FOLDER_ID) return {ok:false, error:'Configura PDF_FOLDER_ID'};
  if (!d?.fileName || !d?.base64) return {ok:false, error:'Faltan fileName/base64'};

  const folder = DriveApp.getFolderById(PDF_FOLDER_ID);
  const bytes  = Utilities.base64Decode(String(d.base64).split(',').pop());
  const blob   = Utilities.newBlob(bytes, 'application/pdf', d.fileName);
  const file   = folder.createFile(blob);
  return { ok:true, fileId:file.getId(), url:file.getUrl(), name:file.getName() };
}

// NUEVO: actualizar DriveURL y FileId por folio
function updatePdf_(d){
  if (!d?.folio) return {ok:false, error:'Falta folio'};
  const ss  = SpreadsheetApp.openById(SHEET_ID);
  const shC = ss.getSheetByName(SH_COTS);
  const data = shC.getDataRange().getValues();
  // Buscar folio en columna B (índice 1)
  for (let i=1; i<data.length; i++){
    if (String(data[i][1]).trim() === String(d.folio).trim()){
      shC.getRange(i+1, 22).setValue(d.driveUrl||''); // V (22)
      shC.getRange(i+1, 23).setValue(d.fileId||'');   // W (23)
      return {ok:true, row:i+1};
    }
  }
  return {ok:false, error:'Folio no encontrado'};
}

/***** Helpers *****/
function json_(o){ return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function num(v){ v = Number(v); return isFinite(v)? v : 0; }
function genFolioSmart_(kam){
  // SAN-YYYYMMDD-XXXX-INICIALES
  const tz = Session.getScriptTimeZone();
  const d  = Utilities.formatDate(new Date(), tz, 'yyyyMMdd');
  const ini = String(kam||'').trim().toUpperCase().split(/\s+/).map(w=>w[0]||'').join('').slice(0,4) || 'SAN';
  const rand = Math.floor(Math.random()*9000)+1000;
  return `SAN-${d}-${rand}-${ini}`;
}
```

## Pasos
1. Crea/edita tu Apps Script con el código de arriba. Cambia `PDF_FOLDER_ID`. **Deploy** (misma URL).
2. Abre `index.html` con conexión a internet. Edita los campos o elimina las filas de ejemplo en tablas.
3. Pulsa **“Generar PDF, subir y registrar”**. Verás el folio en la esquina y la fila en tu Sheet.

---

### Notas
- Si ya tienes tu propio `index.html` del proyecto real, solo copia `app.js` y llama `flujoCompleto()` desde tu botón.
- Si tus tablas tienen IDs distintos, cambia los selectores en `getMedicamentosFromTable()` y `getServiciosFromTable()`.
- Tamaño de PDF: ideal < 15 MB.

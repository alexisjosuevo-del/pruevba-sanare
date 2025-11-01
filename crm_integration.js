// === SANARE · Integración CRM (drop-in) ===
// Reemplaza tu endpoint si cambia:
const CRM_ENDPOINT = 'https://script.google.com/macros/s/AKfycbw0P70owusCnwixQliGt-vNs5W6i62aWW6oODenRjhsnTFyYKh0ATbGgWuMA-sv2j-j/exec';

// CORS-safe: sin Content-Type para evitar preflight. Google Apps Script leerá e.postData.contents
async function api(body){
  const res = await fetch(CRM_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify(body), // text/plain por omitir headers
    cache: 'no-store',
    credentials: 'omit',
    mode: 'cors'
  });
  const txt = await res.text();           // Apps Script a veces devuelve text/plain
  let json;
  try { json = JSON.parse(txt); } catch(e){ throw new Error('Respuesta inválida del servidor'); }
  if (!json.ok) throw new Error(json.error || 'Error desconocido');
  return json;
}

async function registrarCotizacion(payload){ return api({ type:'cotizacion', ...payload }); }
async function subirPdf(fileName, base64){ return api({ type:'uploadPdf', fileName, base64 }); }
async function actualizarPdfEnFila(folio, driveUrl, fileId){ return api({ type:'updatePdf', folio, driveUrl, fileId }); }

// Helpers mínimos
const $ = (s) => document.querySelector(s);
const num = (v) => { const n = Number(String(v ?? '').replace(/[^\d.-]/g,'')); return Number.isFinite(n)? n : 0; };
const val = (sel, def='') => ($(sel)?.value ?? def).trim();

// Lector de tus tablas actuales (ajusta IDs si difieren)
function getMedicamentosFromTable(){
  const tbody = document.querySelector('#tablaMedicamentos tbody, #tablaMedicamentos');
  if(!tbody) return [];
  const out = [];
  tbody.querySelectorAll('tr').forEach(tr=>{
    const t = tr.querySelectorAll('td');
    if (t.length < 5) return;
    const descripcion = (t[0].innerText||'').trim();
    const codigo      = (t[1].innerText||'').trim();
    const cantidad    = num(t[2].innerText || t[2].querySelector('input')?.value || 1);
    const precioUnit  = num(t[3].innerText || t[3].querySelector('input')?.value || 0);
    const importe     = num(t[4].innerText || t[4].querySelector('.submed')?.innerText || (cantidad*precioUnit));
    out.push({
      descripcion, codigo, cantidad, precioUnit,
      descPct: 0,
      subtotalAntesDesc: cantidad*precioUnit,
      subtotalConDesc: importe,
      ivaPct: 0, ivaMonto: 0,
      totalLinea: importe
    });
  });
  return out;
}

function getServiciosFromTable(){
  const tbody = document.querySelector('#tablaServicios tbody, #tablaServicios');
  if(!tbody) return [];
  const out = [];
  tbody.querySelectorAll('tr').forEach(tr=>{
    const t = tr.querySelectorAll('td');
    if (t.length < 5) return;
    const descripcion = (t[0].innerText||'').trim();
    const cantidad    = num(t[1].innerText || t[1].querySelector('input')?.value || 1);
    const precioUnit  = num(t[2].innerText || t[2].querySelector('input')?.value || 0);
    const descPct     = num(t[3].innerText || t[3].querySelector('input')?.value || 0);
    const importe     = num(t[4].innerText || t[4].querySelector('.subserv')?.innerText || (cantidad*precioUnit*(1-descPct/100)));
    const subAntes    = cantidad*precioUnit;
    const subCon      = subAntes*(1 - descPct/100);
    const ivaMonto    = subCon*0.16;
    out.push({
      descripcion, codigo:'', cantidad, precioUnit, descPct,
      subtotalAntesDesc: subAntes, subtotalConDesc: subCon,
      ivaPct: 16, ivaMonto,
      totalLinea: subCon + ivaMonto
    });
  });
  return out;
}

// Flujo registrar→PDF→subir→update SIN tocar tu diseño
async function SANARE_flujoRegistrarPdf(){
  // 1) Payload desde tus inputs reales (ajusta selectores si difieren)
  const fechaISO = new Date().toISOString().slice(0,10);
  const medicamentos = getMedicamentosFromTable();
  const servicios    = getServiciosFromTable();
  const subtotalMeds = medicamentos.reduce((a,b)=>a+(b.subtotalConDesc||0),0);
  const subtotalServ = servicios.reduce((a,b)=>a+(b.subtotalConDesc||0),0);
  const ivaServicios = servicios.reduce((a,b)=>a+(b.ivaMonto||0),0);
  const totalGeneral = subtotalMeds + subtotalServ + ivaServicios;

  const payload = {
    estado: 'Nueva',
    fechaEmision: val('#fechaEmision', fechaISO),
    validoHasta:  val('#fechaValidez',''),
    fechaProgramacion: val('#fecha',''),
    paciente: val('#paciente',''),
    medico:   val('#medico',''),
    aseguradora: val('#aseguradora','Pago de bolsillo'),
    kam: val('#kam',''),
    realizadoPor: val('#realizadoPor','Corporativo'),
    direccion: val('#direccion',''),
    telefono:  val('#telefono','55 5255 8403'),
    esquema:   val('#esquema',''),
    comentarios: val('#dx',''),
    subtotalMeds, subtotalServ, ivaServicios,
    descuentoGlobalPct: 0, descuentoGlobalMonto: 0,
    total: totalGeneral,
    origen: 'via-cotizador',
    driveUrl: '', fileId: '',
    kamEmail: val('#kamEmail',''),
    realizadoPorEmail: val('#realizadoPorEmail',''),
    medicamentos, servicios
  };

  // 2) REGISTRAR para obtener folio
  const r1 = await registrarCotizacion(payload);
  const folio = r1.folio;
  window.folioActual = folio;
  const badge = document.querySelector('#folioBadge'); if (badge) badge.textContent = 'Folio: ' + folio;

  // 3) Generar PDF con html2pdf (tu contenedor visual tal cual)
  const element = document.querySelector('#comprobante') || document.body;
  const paciente = (val('#paciente','Cotizacion').replace(/[^\w\s-]/g,'').replace(/\s+/g,'_'));
  const fileName = `Sanare-${paciente}-${fechaISO}-${folio}.pdf`;
  const opt = { filename:fileName, image:{type:'jpeg',quality:.98}, html2canvas:{scale:2}, jsPDF:{unit:'pt',format:'a4',orientation:'portrait'} };
  const pdfDataUrl = await html2pdf().from(element).set(opt).outputPdf('datauristring');
  await html2pdf().from(element).set(opt).save(); // descarga local

  // 4) Subir PDF y 5) actualizar fila por folio
  const up = await subirPdf(fileName, pdfDataUrl);
  await actualizarPdfEnFila(folio, up.url, up.fileId);

  // 6) Listo
  console.log('OK folio', folio, 'PDF', up.url);
  return { folio, pdfUrl: up.url };
}

// Enlaza tu botón actual SIN cambiar estilos
// document.querySelector('#btnPDF')?.addEventListener('click', (e)=>{
//   e.preventDefault();
//   SANARE_flujoRegistrarPdf().catch(err=>alert('Error: '+err.message));
// });

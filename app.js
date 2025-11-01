// ====== CONFIGURA TU ENDPOINT (ya lo tienes activo) ======
const CRM_ENDPOINT = 'https://script.google.com/macros/s/AKfycbw0P70owusCnwixQliGt-vNs5W6i62aWW6oODenRjhsnTFyYKh0ATbGgWuMA-sv2j-j/exec';

// ========= Helpers =========
const $ = (sel) => document.querySelector(sel);
const num = (v) => { const n = Number(String(v ?? '').replace(/[^\d.-]/g,'')); return Number.isFinite(n) ? n : 0; };
const val = (sel, def='') => ($(sel)?.value ?? def).trim();

async function api(body){
  const r = await fetch(CRM_ENDPOINT, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const j = await r.json();
  if(!j.ok) throw new Error(j.error || ('HTTP '+r.status));
  return j;
}

// ========= Lee tablas =========
function getMedicamentosFromTable(){
  const tbody = $('#tablaMedicamentos tbody') || $('#tablaMedicamentos');
  if(!tbody) return [];
  const out = [];
  [...tbody.querySelectorAll('tr')].forEach(tr=>{
    const tds = tr.querySelectorAll('td');
    if (tds.length < 5) return;
    const descripcion = (tds[0].innerText||'').trim();
    const codigo      = (tds[1].innerText||'').trim();
    const cantidad    = num(tds[2].innerText || tds[2].querySelector('input')?.value || 1);
    const precioUnit  = num(tds[3].innerText || tds[3].querySelector('input')?.value || 0);
    const importe     = num(tds[4].innerText || tds[4].querySelector('.submed')?.innerText || (cantidad*precioUnit));
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
  const tbody = $('#tablaServicios tbody') || $('#tablaServicios');
  if(!tbody) return [];
  const out = [];
  [...tbody.querySelectorAll('tr')].forEach(tr=>{
    const tds = tr.querySelectorAll('td');
    if (tds.length < 5) return;
    const descripcion = (tds[0].innerText||'').trim();
    const cantidad    = num(tds[1].innerText || tds[1].querySelector('input')?.value || 1);
    const precioUnit  = num(tds[2].innerText || tds[2].querySelector('input')?.value || 0);
    const descPct     = num(tds[3].innerText || tds[3].querySelector('input')?.value || 0);
    const importe     = num(tds[4].innerText || tds[4].querySelector('.subserv')?.innerText || (cantidad*precioUnit*(1-descPct/100)));
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

// ========= Endpoints concretos =========
async function registrarCotizacion(payload){ return api({ type:'cotizacion', ...payload }); }
async function subirPdf(fileName, base64){ return api({ type:'uploadPdf', fileName, base64 }); }
async function actualizarPdfEnFila(folio, driveUrl, fileId){ return api({ type:'updatePdf', folio, driveUrl, fileId }); }

// ========= Flujo: REGISTRAR → PDF (folio) → SUBIR → UPDATE =========
async function flujoCompleto(){
  // 1) Construye payload SIN folio (lo genera el server)
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
    descuentoGlobalPct: 0,
    descuentoGlobalMonto: 0,
    total: totalGeneral,

    origen: 'via-cotizador',
    driveUrl: '', fileId: '',

    kamEmail: val('#kamEmail',''),
    realizadoPorEmail: val('#realizadoPorEmail',''),

    medicamentos, servicios
  };

  // 2) Registrar para obtener FOLIO
  const r1 = await registrarCotizacion(payload);
  const folio = r1.folio;
  window.folioActual = folio;
  const fb = $('#folioBadge'); if (fb) fb.textContent = 'Folio: ' + folio;

  // 3) Generar PDF con el FOLIO en el nombre
  const paciente = val('#paciente','Cotizacion').replace(/[^\w\s-]/g,'').replace(/\s+/g,'_');
  const fileName = `Sanare-${paciente}-${fechaISO}-${folio}.pdf`;
  const element  = $('#comprobante') || document.body;
  const opt = { filename:fileName, image:{type:'jpeg',quality:.98}, html2canvas:{scale:2}, jsPDF:{unit:'pt',format:'a4',orientation:'portrait'} };
  const pdfDataUrl = await html2pdf().from(element).set(opt).outputPdf('datauristring');
  await html2pdf().from(element).set(opt).save();

  // 4) Subir PDF a Drive
  const up = await subirPdf(fileName, pdfDataUrl);
  // 5) Actualizar fila con URL/ID
  await actualizarPdfEnFila(folio, up.url, up.fileId);

  alert('✅ Cotización registrada y PDF subido.\nFolio: ' + folio);
}

// Botón
document.addEventListener('DOMContentLoaded', ()=>{
  const btn = $('#btnPDF');
  if (btn) btn.addEventListener('click', (e)=>{ e.preventDefault(); flujoCompleto().catch(err=>{ console.error(err); alert('Error: '+err.message); }); });
});

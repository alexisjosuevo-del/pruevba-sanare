SANARE · Parche de integración CRM (Drop‑in, sin tocar diseño)

Cómo usar
1) Sube `crm_integration.js` a la raíz de tu repo (o `assets/js/`).
2) En tu `index.html` real, justo ANTES del cierre </body>, agrega:
   <script src="https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js"></script>
   <script src="crm_integration.js"></script>
3) Enlaza tu botón actual al flujo:
   <script>
     document.getElementById('btnPDF').addEventListener('click', function(e){
       e.preventDefault();
       SANARE_flujoRegistrarPdf().then(r => {
         // Opcional: mostrar toast/folio
         // alert('Registrado '+r.folio);
       }).catch(err => alert('Error: ' + err.message));
     });
   </script>

Notas importantes
- El fetch es CORS-safe (sin Content-Type) para evitar el “Failed to fetch” en GitHub Pages.
- No altera tu CSS ni HTML. Solo lee tus campos y tablas (#tablaMedicamentos, #tablaServicios).
- El servidor genera el FOLIO y se actualiza la fila con la URL/ID del PDF.

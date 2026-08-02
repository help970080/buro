/* ============================================================
   Comprobante de Autorización para Consulta de Buró de Crédito
   Formato basado en los datos que Buró requiere para firma autógrafa:
   nombre completo, domicilio, RFC, fecha de firma y firma autógrafa.
   ============================================================ */

'use strict';

const PDFDocument = require('pdfkit');

const TINTA = '#12263A';
const GRIS = '#6B7A88';
const LINEA = '#D8D2C6';

function fechaLarga(f) {
  if (!f) return '';
  const d = new Date(f);
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const p = d.toLocaleString('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit'
  }).split('-');
  return p[2].replace(/^0/, '') + ' de ' + meses[parseInt(p[1], 10) - 1] + ' de ' + p[0];
}

function horaMX(f) {
  if (!f) return '';
  return new Date(f).toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit'
  });
}

function fila(doc, etiqueta, valor, x, y, anchoEtiqueta) {
  doc.fontSize(8).fillColor(GRIS).font('Helvetica')
    .text(etiqueta.toUpperCase(), x, y, { width: anchoEtiqueta });
  doc.fontSize(10).fillColor(TINTA).font('Helvetica-Bold')
    .text(valor || '—', x, y + 10, { width: anchoEtiqueta });
  return y + 28;
}

/**
 * Dibuja una hoja de comprobante en el documento abierto.
 * @param {PDFDocument} doc
 * @param {object} d datos de la autorización + solicitud
 */
function hoja(doc, d) {
  const M = 50;
  const ANCHO = doc.page.width - M * 2;
  let y = M;

  /* Encabezado */
  doc.rect(M, y, ANCHO, 52).fill(TINTA);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(13)
    .text('LMV CREDIA, S.A. DE C.V.', M + 14, y + 12);
  doc.font('Helvetica').fontSize(9).fillColor('#C9D6E2')
    .text('Autorización para solicitar Reportes de Crédito · Persona Física', M + 14, y + 30);
  y += 70;

  /* Folio */
  doc.font('Helvetica').fontSize(8).fillColor(GRIS)
    .text('FOLIO DE SOLICITUD', M, y);
  doc.font('Helvetica-Bold').fontSize(14).fillColor(TINTA)
    .text(d.folio || '', M, y + 10);
  if (d.folio_bc) {
    doc.font('Helvetica').fontSize(8).fillColor(GRIS)
      .text('FOLIO DE CONSULTA BC', M + 260, y);
    doc.font('Helvetica-Bold').fontSize(14).fillColor(TINTA)
      .text(d.folio_bc, M + 260, y + 10);
  }
  y += 40;

  /* Texto de la autorización */
  doc.moveTo(M, y).lineTo(M + ANCHO, y).lineWidth(0.8).strokeColor(LINEA).stroke();
  y += 14;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(GRIS).text('TEXTO AUTORIZADO', M, y);
  y += 14;
  doc.font('Helvetica').fontSize(8.5).fillColor(TINTA)
    .text(d.texto || '', M, y, { width: ANCHO, align: 'justify', lineGap: 1.5 });
  y = doc.y + 16;

  /* Datos del titular */
  doc.moveTo(M, y).lineTo(M + ANCHO, y).strokeColor(LINEA).stroke();
  y += 14;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(GRIS).text('DATOS DEL TITULAR', M, y);
  y += 16;

  const col = ANCHO / 2 - 10;
  const nombre = [d.nombre, d.apellido_p, d.apellido_m].filter(Boolean).join(' ');
  let yIzq = y, yDer = y;
  yIzq = fila(doc, 'Nombre completo', nombre, M, yIzq, col);
  yDer = fila(doc, 'RFC', d.rfc, M + col + 20, yDer, col);
  yIzq = fila(doc, 'CURP', d.curp, M, yIzq, col);
  yDer = fila(doc, 'Teléfono', d.telefono, M + col + 20, yDer, col);
  yIzq = fila(doc, 'Calle y número', d.calle, M, yIzq, col);
  yDer = fila(doc, 'Colonia', d.colonia, M + col + 20, yDer, col);
  yIzq = fila(doc, 'Municipio', d.municipio, M, yIzq, col);
  yDer = fila(doc, 'Estado', d.estado_dom, M + col + 20, yDer, col);
  yIzq = fila(doc, 'Código postal', d.cp, M, yIzq, col);
  yDer = fila(doc, 'Fecha de nacimiento', d.fecha_nac, M + col + 20, yDer, col);
  y = Math.max(yIzq, yDer) + 4;

  /* Lugar y fecha */
  doc.moveTo(M, y).lineTo(M + ANCHO, y).strokeColor(LINEA).stroke();
  y += 14;
  yIzq = y; yDer = y;
  yIzq = fila(doc, 'Lugar en que se firma', d.lugar, M, yIzq, col);
  yDer = fila(doc, 'Fecha en que se firma', fechaLarga(d.aceptada) +
    (d.aceptada ? ', ' + horaMX(d.aceptada) + ' h' : ''), M + col + 20, yDer, col);
  yIzq = fila(doc, 'Vigencia de la autorización', d.vence
    ? 'Hasta el ' + fechaLarga(d.vence) + ' o mientras dure la relación jurídica'
    : '3 años', M, yIzq, col);
  yDer = fila(doc, 'Fecha de consulta BC', d.fecha_consulta_bc
    ? fechaLarga(d.fecha_consulta_bc) : 'Sin consulta registrada', M + col + 20, yDer, col);
  y = Math.max(yIzq, yDer) + 6;

  /* Firma */
  doc.moveTo(M, y).lineTo(M + ANCHO, y).strokeColor(LINEA).stroke();
  y += 16;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(GRIS).text('FIRMA AUTÓGRAFA DEL TITULAR', M, y);
  y += 12;

  if (d.firma && /^data:image\/(png|jpe?g);base64,/.test(d.firma)) {
    try {
      const buf = Buffer.from(d.firma.split(',')[1], 'base64');
      doc.image(buf, M, y, { fit: [230, 78], align: 'left' });
    } catch (e) {
      doc.font('Helvetica').fontSize(9).fillColor('#8C1C13')
        .text('(No se pudo mostrar la firma)', M, y + 20);
    }
  } else {
    doc.font('Helvetica').fontSize(9).fillColor('#8C1C13')
      .text('(Sin firma registrada)', M, y + 20);
  }

  doc.moveTo(M, y + 84).lineTo(M + 230, y + 84).strokeColor(TINTA).lineWidth(0.8).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(GRIS)
    .text(nombre, M, y + 89, { width: 230 });

  /* Constancia de recabado */
  const xd = M + 280;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(GRIS)
    .text('CONSTANCIA DE RECABADO', xd, y - 12);
  let yc = y + 4;
  doc.font('Helvetica').fontSize(8.5).fillColor(TINTA);
  doc.text('Recabó: ' + (d.funcionario || '—'), xd, yc); yc += 13;
  doc.text('Modo: ' + (d.modo === 'presencial'
    ? 'Firma en dispositivo, cliente presente'
    : 'Firma en dispositivo, autenticado por folio y código'), xd, yc, { width: ANCHO - 280 });
  yc = doc.y + 3;
  doc.text('Dirección IP: ' + (d.ip || '—'), xd, yc); yc += 13;
  if (d.texto_hash) {
    doc.fontSize(7).fillColor(GRIS)
      .text('Huella del texto (SHA-256):', xd, yc); yc += 9;
    doc.font('Courier').fontSize(6).text(d.texto_hash, xd, yc, { width: ANCHO - 280 });
  }

  y += 110;

  /* Pie */
  const yPie = doc.page.height - 78;
  doc.moveTo(M, yPie).lineTo(M + ANCHO, yPie).strokeColor(LINEA).lineWidth(0.8).stroke();
  doc.font('Helvetica').fontSize(7).fillColor(GRIS)
    .text('Documento generado por el sistema de LMV Credia, S.A. de C.V. La firma fue recabada directamente ' +
      'en un dispositivo electrónico por el titular de la información. Este comprobante se conserva bajo ' +
      'resguardo conforme al artículo 31 de la Ley para Regular las Sociedades de Información Crediticia.',
      M, yPie + 8, { width: ANCHO, align: 'justify' });
}

/**
 * Genera un PDF con uno o varios comprobantes (una hoja por autorización).
 * @param {Array} filas
 * @param {stream.Writable} salida
 */
function generaPDF(filas, salida) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 50, autoFirstPage: false });
  doc.pipe(salida);
  doc.info.Title = filas.length === 1
    ? 'Autorización de consulta ' + (filas[0].folio || '')
    : 'Autorizaciones de consulta (' + filas.length + ')';
  doc.info.Author = 'LMV CREDIA, S.A. DE C.V.';

  if (!filas.length) {
    doc.addPage();
    doc.font('Helvetica').fontSize(12).fillColor(TINTA)
      .text('No hay autorizaciones en el rango solicitado.', 50, 100);
  } else {
    filas.forEach(f => { doc.addPage(); hoja(doc, f); });
  }
  doc.end();
  return doc;
}

module.exports = { generaPDF, hoja, fechaLarga };

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
 * Hoja para imprimir y firmar con pluma. Mismos datos que Buró exige,
 * con espacios en blanco donde el cliente escribe y firma.
 */
function hojaEnBlanco(doc, d) {
  const M = 56;
  const ANCHO = doc.page.width - M * 2;
  let y = M;

  /* Título del Anexo A, sin marca */
  doc.font('Helvetica-Bold').fontSize(10).fillColor(TINTA)
    .text('Otorgamiento de Consentimiento para Autorización de Consulta en caso de uso de ' +
      'credenciales de Moffin de Buró de Crédito', M, y, { width: ANCHO, align: 'center' });
  y = doc.y + 14;

  /* Folio y código */
  const caja = (ANCHO - 16) / 2;
  ['FOLIO', 'CÓDIGO'].forEach(function (t, i) {
    const x = M + i * (caja + 16);
    doc.rect(x, y, caja, 32).lineWidth(0.8).strokeColor(LINEA).stroke();
    doc.font('Helvetica').fontSize(6.5).fillColor(GRIS).text(t, x + 7, y + 5);
  });
  y += 44;

  /* Lugar y fecha */
  doc.font('Helvetica').fontSize(9).fillColor(TINTA)
    .text('_______________________, a ______ de ____________________ de 20______.',
      M, y, { width: ANCHO, align: 'right' });
  y = doc.y + 16;

  /* Nombre del titular */
  doc.font('Helvetica').fontSize(7).fillColor(GRIS)
    .text('NOMBRE COMPLETO DEL TITULAR DE LA INFORMACIÓN', M, y);
  doc.moveTo(M, y + 26).lineTo(M + ANCHO, y + 26).lineWidth(0.8).strokeColor(TINTA).stroke();
  y += 38;

  /* Cuerpo: texto literal del Anexo A */
  const parrafos = [
    'Por este conducto autorizo expresamente a "Moffin Software, S.A.P.I. de C.V.", para que por ' +
    'conducto de sus funcionarios facultados lleve a cabo Investigaciones, sobre mi comportamiento ' +
    'crediticio o el de la sociedad que represento en o a través de las bases de datos de ' +
    '"Trans Union de México, S. A., SIC" y/o "Dun & Bradstreet, S.A., SIC". Asimismo, autorizo ' +
    'expresamente a "Moffin Software, S.A.P.I. de C.V." para que pueda consultar mi historial ' +
    'crediticio con "Trans Union de México, S.A., SIC" y "Dun & Bradstreet, S.A., SIC". Finalmente, ' +
    'autorizo expresamente para que "Moffin Software, S.A.P.I. de C.V." pueda compartir mis datos ' +
    'con "LMV CREDIA SA DE CV" (el "Usuario").',

    'Asimismo, declaro que conozco la naturaleza y alcance de la información que se solicitará, del ' +
    'uso que "Moffin Software, S.A.P.I. de C.V." hará de tal información y de que ésta podrá realizar ' +
    'consultas periódicas sobre mi historial o el de la sociedad que represento, consintiendo que esta ' +
    'autorización se encuentre vigente por un período de 3 años contados a partir de su expedición y ' +
    'en todo caso durante el tiempo que se mantenga la relación jurídica entre el Titular de la ' +
    'Información y el Usuario.',

    'En caso de que el Titular de la Información sea una Persona Moral, declaro bajo protesta de decir ' +
    'verdad ser representante legal de la sociedad que suscribe esta autorización; manifestando que a ' +
    'la fecha de firma de la presente los poderes que me han sido otorgados no me han sido revocados, ' +
    'limitados, ni modificados en forma alguna.'
  ];
  doc.font('Helvetica').fontSize(8.2).fillColor(TINTA);
  parrafos.forEach(function (p) {
    doc.text(p, M, y, { width: ANCHO, align: 'justify', lineGap: 1.2 });
    y = doc.y + 9;
  });
  y += 4;

  /* Datos del titular que Buró exige en la autorización */
  function renglon(etiqueta, x, yy, ancho) {
    doc.font('Helvetica').fontSize(6.5).fillColor(GRIS).text(etiqueta.toUpperCase(), x, yy);
    doc.moveTo(x, yy + 21).lineTo(x + ancho, yy + 21).lineWidth(0.8).strokeColor(TINTA).stroke();
    return yy + 30;
  }

  const c2 = (ANCHO - 18) / 2;
  const c3 = (ANCHO - 36) / 3;
  let yI = renglon('RFC con homoclave', M, y, c2);
  renglon('CURP', M + c2 + 18, y, c2);
  y = yI;
  y = renglon('Domicilio: calle y número', M, y, ANCHO);
  yI = renglon('Colonia', M, y, c3);
  renglon('Municipio o delegación', M + c3 + 18, y, c3);
  renglon('Estado', M + (c3 + 18) * 2, y, c3);
  y = yI;
  yI = renglon('Código postal', M, y, c3);
  renglon('Teléfono', M + c3 + 18, y, c3);
  y = yI + 8;

  /* Firma */
  doc.font('Helvetica').fontSize(8).fillColor(TINTA)
    .text('Firmas del Anexo A que celebran LAS PARTES:', M, y);
  y += 18;

  doc.rect(M + (ANCHO - 300) / 2, y, 300, 74)
    .lineWidth(0.8).strokeColor(LINEA).stroke();
  y += 84;
  doc.moveTo(M + (ANCHO - 260) / 2, y).lineTo(M + (ANCHO + 260) / 2, y)
    .lineWidth(0.8).strokeColor(TINTA).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(TINTA)
    .text('El "Titular de la Información"', M, y + 5, { width: ANCHO, align: 'center' });
  doc.font('Helvetica').fontSize(6.5).fillColor(GRIS)
    .text('Firma autógrafa', M, y + 17, { width: ANCHO, align: 'center' });
  y += 34;

  /* Uso interno */
  doc.moveTo(M, y).lineTo(M + ANCHO, y).lineWidth(0.6).strokeColor(LINEA).stroke();
  y += 8;
  const cu = (ANCHO - 18) / 2;
  renglon('Nombre de quien recaba la autorización', M, y, cu);
  renglon('Fecha y folio de consulta BC', M + cu + 18, y, cu);
}

/* Genera N hojas en blanco para que el vendedor las lleve impresas */
function generaHojaBlanco(datos, salida, cuantas) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 50, autoFirstPage: false });
  doc.pipe(salida);
  doc.info.Title = 'Autorización de consulta para firmar';
  doc.info.Author = 'LMV CREDIA, S.A. DE C.V.';
  const n = Math.min(Math.max(parseInt(cuantas, 10) || 1, 1), 50);
  for (let i = 0; i < n; i++) {
    doc.addPage();
    hojaEnBlanco(doc, datos);
  }
  doc.end();
  return doc;
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

module.exports = { generaPDF, generaHojaBlanco, hoja, fechaLarga };

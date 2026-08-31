/* ============================================================
   Reporte de Crédito en PDF, con el formato de Buró de Crédito.
   Secciones: datos generales, domicilios, empleos, resumen de
   créditos con semáforo de comportamiento, detalle con histórico
   de pagos mes a mes, y consultas de otros otorgantes.
   ============================================================ */

'use strict';

const PDFDocument = require('pdfkit');
const { monto, entero, fechaBuro } = require('./buro');

const NEGRO = '#000000';
const GRIS = '#6B7A88';
const GRISCLARO = '#EDEAE3';
const LINEA = '#BFBAB0';
const ROJO = '#C0392B';
const VERDE = '#1E7A45';
const AMBAR = '#D68910';

const TIPO_CONTRATO = {
  AA: 'Arrendamiento automotriz', AB: 'Automotriz bancario', AE: 'Arrendamiento',
  AL: 'Arrendamiento', AM: 'Aparatos y muebles', AR: 'Arrendamiento', AU: 'Compra de automóvil',
  AV: 'Aviación', BC: 'Banca comercial', BL: 'Bote o lancha', BR: 'Bienes raíces',
  CA: 'Compra de automóvil', CC: 'Tarjeta de crédito', CF: 'Crédito fiscal',
  CL: 'Línea de crédito', CO: 'Consolidación', CP: 'Crédito personal', CT: 'Crédito tienda',
  ED: 'Educativo', EQ: 'Equipo', FF: 'Fondeo', FI: 'Fianza', GS: 'Gasolina',
  HB: 'Hipotecario bancario', HE: 'Hipotecario', HV: 'Hipotecario vivienda',
  MI: 'Misceláneas', NG: 'Negocio', PB: 'Préstamo bancario', PC: 'Préstamo bancario',
  PE: 'Préstamo estudiantil', PG: 'Préstamo gubernamental', PL: 'Préstamo personal',
  PM: 'Préstamo empresarial', PQ: 'Préstamo quirografario', PR: 'Préstamo personal',
  PS: 'Préstamo personal', RC: 'Crédito revolvente', SE: 'Servicios',
  TC: 'Tarjeta de crédito', VE: 'Vehículo', OT: 'Otro', UK: 'Desconocido', ZZ: 'Desconocido'
};

const TIPO_CUENTA = {
  R: 'Revolvente', I: 'Pagos fijos', M: 'Hipoteca', O: 'Sin límite preestablecido', A: 'Abierta'
};

const RESPONSABILIDAD = {
  I: 'Individual', M: 'Mancomunado', O: 'Obligado solidario', A: 'Autorizado', T: 'Tercero'
};

const FRECUENCIA = {
  M: 'Mensual', S: 'Semanal', Q: 'Quincenal', C: 'Catorcenal', B: 'Bimestral',
  T: 'Trimestral', Y: 'Semestral', A: 'Anual', Z: 'Sin periodicidad', V: 'Variable',
  D: 'Deducción', P: 'Pago único'
};

const OBSERVACION = {
  LC: 'Quita otorgada', CV: 'Cartera vendida', FN: 'Fraude cometido por el consumidor',
  FD: 'Cuenta fraudulenta', CO: 'Cuenta en cobranza', UP: 'Cuenta que causa quebranto',
  PC: 'Cuenta en cobranza', DA: 'Dación en pago', AD: 'Adjudicación del bien',
  RA: 'Reestructurada por adjudicación', RF: 'Reestructura por fenómeno natural',
  CL: 'Cuenta cerrada', CC: 'Cuenta cancelada', CZ: 'Cuenta cerrada con saldo cero',
  RE: 'Cuenta reestructurada', RV: 'Cuenta reestructurada vencida',
  CM: 'Morosidad histórica', NA: 'No aplicable'
};

const MOP_TXT = {
  '00': 'Sin información', '01': 'Cuenta al corriente', '02': 'Atraso de 1 a 29 días',
  '03': 'Atraso de 30 a 59 días', '04': 'Atraso de 60 a 89 días', '05': 'Atraso de 90 a 119 días',
  '06': 'Atraso de 120 a 149 días', '07': 'Atraso de 150 días hasta 12 meses',
  '96': 'Atraso de más de 12 meses', '97': 'Cuenta en cobranza judicial',
  '99': 'Cuenta sin recuperar'
};

const MESES = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

function lista(nodo, llave) {
  if (!nodo) return [];
  const v = llave ? nodo[llave] : nodo;
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function pesos(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fecha(v) {
  const f = fechaBuro(v);
  if (!f) return '';
  const p = f.split('-');
  return p[2] + '/' + p[1] + '/' + p[0];
}

function mesAnio(v) {
  const f = fechaBuro(v);
  if (!f) return '';
  const p = f.split('-');
  const abr = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  return abr[parseInt(p[1], 10) - 1] + '-' + p[0].slice(2);
}

/* Verde al corriente, ámbar 1 a 89 días, rojo 90+ o sin recuperar */
function comportamiento(c) {
  const act = entero(c.FormaPagoActual);
  const hist = entero(c.MopHistoricoMorosidadMasGrave);
  const peor = Math.max(act === 0 ? 1 : act, hist);
  if (peor >= 5) return 'rojo';
  if (peor >= 2) return 'ambar';
  return 'verde';
}

/* El histórico es una cadena del mes más reciente al más antiguo.
   Se acomoda en rejilla año x mes, como la de Buró. */
function rejillaHistorico(c) {
  const cad = String(c.HistoricoPagos || '').trim();
  if (!cad) return null;
  const f = fechaBuro(c.FechaMasRecienteHistoricoPagos);
  if (!f) return null;
  let anio = parseInt(f.slice(0, 4), 10);
  let mes = parseInt(f.slice(5, 7), 10);

  const celdas = {};
  for (let i = 0; i < cad.length && i < 48; i++) {
    if (!celdas[anio]) celdas[anio] = new Array(12).fill(null);
    celdas[anio][mes - 1] = cad[i];
    mes--;
    if (mes === 0) { mes = 12; anio--; }
  }
  const anios = Object.keys(celdas).map(Number).sort(function (a, b) { return b - a; });
  return { anios: anios, celdas: celdas };
}

function colorMOP(v) {
  if (!v) return GRIS;
  if (v === 'U' || v === '-') return GRIS;
  const n = parseInt(v, 10);
  if (isNaN(n)) return GRIS;
  if (n >= 5) return ROJO;
  if (n >= 2) return AMBAR;
  return VERDE;
}

function barra(doc, texto, y, M, ANCHO) {
  doc.rect(M, y, ANCHO, 13).fill(NEGRO);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7.5)
    .text(texto.toUpperCase(), M + 4, y + 3.4);
  return y + 17;
}

function subbarra(doc, texto, y, M, ANCHO, derecha) {
  doc.rect(M, y, ANCHO, 11).fill(GRISCLARO);
  doc.fillColor(NEGRO).font('Helvetica-Bold').fontSize(6.8)
    .text(texto.toUpperCase(), M + 4, y + 2.9);
  if (derecha) {
    doc.fontSize(6.2).text(derecha.toUpperCase(), M, y + 3.2,
      { width: ANCHO - 5, align: 'right' });
  }
  return y + 14;
}

function icono(doc, tipo, x, y) {
  if (tipo === 'verde') {
    doc.lineWidth(1.7).strokeColor(VERDE)
      .moveTo(x, y + 4).lineTo(x + 3, y + 7.5).lineTo(x + 9, y).stroke();
  } else if (tipo === 'rojo') {
    doc.lineWidth(1.7).strokeColor(ROJO)
      .moveTo(x, y).lineTo(x + 8, y + 8).moveTo(x + 8, y).lineTo(x, y + 8).stroke();
  } else {
    doc.lineWidth(1.6).strokeColor(AMBAR)
      .moveTo(x + 4, y).lineTo(x + 4, y + 5).stroke();
    doc.circle(x + 4, y + 7.6, 0.9).lineWidth(1.4).strokeColor(AMBAR).stroke();
  }
}

function salto(doc, y, alto, M) {
  if (y + alto > doc.page.height - 46) { doc.addPage(); return M; }
  return y;
}

function generaReportePDF(datos, salida) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 34, bufferPages: true });
  doc.pipe(salida);

  const M = 34;
  const ANCHO = doc.page.width - M * 2;
  const s = datos.solicitud || {};
  const r = datos.resumen || {};
  const per = lista(datos.payload && datos.payload.return && datos.payload.return.Personas, 'Persona')[0] || {};
  const nom = per.Nombre || {};
  const resu = lista(per.ResumenReporte, 'ResumenReporte')[0] || {};

  doc.info.Title = 'Reporte de Crédito · ' + (s.folio || '');
  doc.info.Author = 'LMV CREDIA, S.A. DE C.V.';

  let y = M;

  /* Encabezado */
  doc.font('Helvetica-Bold').fontSize(17).fillColor(NEGRO)
    .text('REPORTE DE CRÉDITO', M, y + 6, { width: ANCHO - 165, align: 'center' });
  doc.font('Helvetica-BoldOblique').fontSize(10)
    .text('Personas Físicas', M, y + 26, { width: ANCHO - 165, align: 'center' });

  const xc = M + ANCHO - 158;
  const cajas = [
    ['Fecha de Consulta', datos.consultada
      ? new Date(datos.consultada).toLocaleDateString('es-MX',
        { timeZone: 'America/Mexico_City', day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
      : ''],
    ['Folio de Consulta', datos.folio_bc || ''],
    ['Fecha de Registro en BC', fecha(resu.FechaIngresoBD)]
  ];
  let yc = y;
  cajas.forEach(function (c) {
    doc.rect(xc, yc, 158, 18).lineWidth(0.6).strokeColor(LINEA).stroke();
    doc.font('Helvetica').fontSize(6).fillColor(NEGRO)
      .text(c[0], xc, yc + 2.5, { width: 158, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(7.5)
      .text(c[1] || '—', xc, yc + 9.5, { width: 158, align: 'center' });
    yc += 20;
  });
  y = Math.max(y + 46, yc + 3);

  /* Datos generales */
  y = barra(doc, 'Datos generales', y, M, ANCHO);
  const nombre = [nom.PrimerNombre, nom.SegundoNombre, nom.ApellidoPaterno, nom.ApellidoMaterno]
    .filter(Boolean).join(' ') || [s.nombre, s.apellido_p, s.apellido_m].filter(Boolean).join(' ');
  doc.fontSize(7.5).fillColor(NEGRO);
  doc.font('Helvetica-Bold').text('Nombre: ', M + 4, y, { continued: true })
    .font('Helvetica').text(nombre);
  doc.font('Helvetica-Bold').text('Fecha de Nacimiento: ', M + 250, y, { continued: true })
    .font('Helvetica').text(fecha(nom.FechaNacimiento) || s.fecha_nac || '—');
  doc.font('Helvetica-Bold').text('RFC: ', M + 420, y, { continued: true })
    .font('Helvetica').text(nom.RFC || s.rfc || '—');
  y += 14;
  if (s.curp) {
    doc.font('Helvetica-Bold').fontSize(7.5).text('CURP: ', M + 4, y, { continued: true })
      .font('Helvetica').text(s.curp);
    y += 13;
  }

  /* Score */
  y = barra(doc, 'Score de crédito', y, M, ANCHO);
  const hayScore = r.score !== null && r.score !== undefined;
  doc.rect(M, y, 74, 26).lineWidth(0.6).strokeColor(LINEA).stroke();
  doc.font('Helvetica-Bold').fontSize(hayScore ? 15 : 8)
    .fillColor(hayScore ? (r.score >= 650 ? VERDE : (r.score >= 600 ? AMBAR : ROJO)) : GRIS)
    .text(hayScore ? String(r.score) : 'SIN SCORE', M, y + (hayScore ? 6 : 9),
      { width: 74, align: 'center' });
  doc.font('Helvetica').fontSize(7).fillColor(NEGRO)
    .text(hayScore
      ? 'BC Score. Escala de 456 a 760: a mayor valor, menor probabilidad de incumplimiento.'
      : (r.score_texto || 'Buró no cuenta con información suficiente para calcular el score.') +
        ' No significa mal historial: puede ser falta de cuentas recientes.',
      M + 82, y + 3, { width: ANCHO - 86 });
  if (r.razones && r.razones.length) {
    doc.fontSize(6.5).fillColor(GRIS)
      .text('Claves de razón: ' + r.razones.join(', '), M + 82, y + 17, { width: ANCHO - 86 });
  }
  y += 33;

  /* Domicilios */
  const doms = lista(per.Domicilios, 'Domicilio');
  y = barra(doc, 'Domicilio(s) reportado(s)', y, M, ANCHO);
  const colD = [
    { t: 'Calle y Número', w: 168 }, { t: 'Colonia', w: 86 }, { t: 'Del / Mpio', w: 82 },
    { t: 'Estado', w: 76 }, { t: 'C.P.', w: 34 }, { t: 'Teléfono', w: 0 }
  ];
  colD[5].w = ANCHO - colD.reduce(function (a, c) { return a + c.w; }, 0);
  doc.rect(M, y - 3, ANCHO, 11).fill(GRISCLARO);
  doc.font('Helvetica-Bold').fontSize(6.2).fillColor(NEGRO);
  let xd = M + 3;
  colD.forEach(function (c) { doc.text(c.t, xd, y); xd += c.w; });
  y += 11;
  if (!doms.length) {
    doc.font('Helvetica').fontSize(7).fillColor(GRIS)
      .text('Sin domicilios reportados', M + 4, y);
    y += 11;
  }
  doms.slice(0, 6).forEach(function (d) {
    y = salto(doc, y, 14, M);
    const fila = [
      [d.Direccion1, d.Direccion2].filter(Boolean).join(' '),
      d.ColoniaPoblacion || '', d.DelegacionMunicipio || d.Ciudad || '',
      d.Estado || '', d.CP || '', d.NumeroTelefono || ''
    ];
    doc.font('Helvetica').fontSize(6.6).fillColor(NEGRO);
    let x = M + 3, alto = 0;
    fila.forEach(function (v, i) {
      const h = doc.heightOfString(String(v), { width: colD[i].w - 4 });
      doc.text(String(v), x, y, { width: colD[i].w - 4 });
      if (h > alto) alto = h;
      x += colD[i].w;
    });
    y += alto + 2;
    doc.moveTo(M, y).lineTo(M + ANCHO, y).lineWidth(0.3).strokeColor('#DDD8D0').stroke();
    y += 2.5;
  });
  y += 4;

  /* Empleos */
  const emps = lista(per.Empleos, 'Empleo');
  if (emps.length) {
    y = salto(doc, y, 44, M);
    y = barra(doc, 'Domicilio(s) de empleo(s) registrado(s)', y, M, ANCHO);
    doc.rect(M, y - 3, ANCHO, 11).fill(GRISCLARO);
    doc.font('Helvetica-Bold').fontSize(6.2).fillColor(NEGRO);
    doc.text('Compañía', M + 3, y);
    doc.text('Puesto', M + 210, y);
    doc.text('Salario', M + 300, y);
    doc.text('Domicilio', M + 360, y);
    y += 11;
    emps.slice(0, 5).forEach(function (e) {
      y = salto(doc, y, 14, M);
      doc.font('Helvetica').fontSize(6.6).fillColor(NEGRO);
      const sal = monto(e.Salario);
      doc.text(e.NombreEmpresa || '', M + 3, y, { width: 202 });
      doc.text(e.Cargo || '', M + 210, y, { width: 86 });
      doc.text(sal > 100 ? '$' + pesos(sal) : '', M + 300, y, { width: 56 });
      const hE = doc.heightOfString(
        [e.Direccion1, e.DelegacionMunicipio, e.Estado].filter(Boolean).join(', '),
        { width: ANCHO - 362 });
      doc.text([e.Direccion1, e.DelegacionMunicipio, e.Estado].filter(Boolean).join(', '),
        M + 360, y, { width: ANCHO - 362 });
      y += Math.max(9, hE) + 2;
      doc.moveTo(M, y).lineTo(M + ANCHO, y).lineWidth(0.3).strokeColor('#DDD8D0').stroke();
      y += 2.5;
    });
    y += 4;
  }

  /* Resumen de créditos */
  const cuentas = lista(per.Cuentas, 'Cuenta');
  y = salto(doc, y, 60, M);
  y = barra(doc, 'Resumen de créditos', y, M, ANCHO);
  y = subbarra(doc, 'Créditos reportados (' + cuentas.length + ')', y, M, ANCHO, 'Comportamiento');

  if (!cuentas.length) {
    doc.font('Helvetica').fontSize(7.5).fillColor(GRIS)
      .text('No hay créditos reportados en el expediente.', M + 4, y);
    y += 14;
  }

  cuentas.forEach(function (c, i) {
    y = salto(doc, y, 36, M);
    const comp = comportamiento(c);
    const mopAct = String(c.FormaPagoActual || '').padStart(2, '0');

    doc.rect(M, y, 15, 30).lineWidth(0.4).strokeColor(LINEA).stroke();
    doc.font('Helvetica-Bold').fontSize(7).fillColor(NEGRO)
      .text(String(i + 1) + '.', M + 3, y + 3);

    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(NEGRO)
      .text(c.NombreOtorgante || 'SIN NOMBRE', M + 20, y + 3, { width: 150 });
    doc.font('Helvetica').fontSize(6.8)
      .text(c.NumeroCuentaActual || '', M + 175, y + 3.5, { width: 100 });
    doc.font('Helvetica-Bold').fontSize(6.8)
      .text((TIPO_CONTRATO[c.TipoContrato] || c.TipoContrato || '').toUpperCase(),
        M + 280, y + 3.5, { width: 130 });
    doc.text(c.FechaCierreCuenta ? 'CERRADO' : 'ACTIVO', M + 415, y + 3.5, { width: 60 });

    doc.fontSize(6.5).fillColor(NEGRO);
    doc.font('Helvetica-Bold').text('Actualizado: ', M + 20, y + 14, { continued: true })
      .font('Helvetica').text(mesAnio(c.FechaActualizacion) || '—');
    doc.font('Helvetica-Bold').text('Saldo actual: ', M + 120, y + 14, { continued: true })
      .font('Helvetica').text('$' + pesos(monto(c.SaldoActual)));
    doc.font('Helvetica-Bold').text('Forma de Pago: ', M + 230, y + 14, { continued: true })
      .font('Helvetica').text(mopAct + '-' + (MOP_TXT[mopAct] || 'Sin información').toUpperCase());

    const venc = monto(c.SaldoVencido);
    if (venc > 0) {
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(ROJO)
        .text('Saldo vencido: $' + pesos(venc), M + 20, y + 22.5);
    }
    if (c.ClaveObservacion) {
      doc.font('Helvetica').fontSize(6.3).fillColor(venc > 0 ? NEGRO : GRIS)
        .text((OBSERVACION[c.ClaveObservacion] || c.ClaveObservacion) +
          ' (' + c.ClaveObservacion + ')', M + (venc > 0 ? 130 : 20), y + 22.5, { width: 240 });
    }

    icono(doc, comp, M + ANCHO - 26, y + 10);
    doc.moveTo(M, y + 31).lineTo(M + ANCHO, y + 31).lineWidth(0.4).strokeColor(LINEA).stroke();
    y += 34;
  });
  y += 4;

  /* Leyenda de comportamiento */
  y = salto(doc, y, 34, M);
  y = barra(doc, 'Información sobre el comportamiento', y, M, ANCHO);
  const ley = [['verde', 'CUENTA AL CORRIENTE'], ['ambar', 'ATRASO DE 1 A 89 DÍAS'],
    ['rojo', 'ATRASO MAYOR A 90 DÍAS O DEUDA SIN RECUPERAR']];
  let xl = M + 8;
  ley.forEach(function (l) {
    icono(doc, l[0], xl, y + 1);
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(NEGRO).text(l[1], xl + 15, y + 3);
    xl += l[0] === 'ambar' ? 175 : 165;
  });
  y += 20;

  /* Detalle de créditos */
  if (cuentas.length) {
    doc.addPage();
    y = M;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(NEGRO)
      .text('DETALLE DE CRÉDITOS', M, y);
    doc.font('Helvetica').fontSize(6.5).fillColor(GRIS)
      .text('Folio de consulta ' + (datos.folio_bc || '—'), M, y + 2,
        { width: ANCHO, align: 'right' });
    y += 18;

    doc.rect(M, y, ANCHO, 26).lineWidth(0.5).strokeColor(LINEA).stroke();
    doc.font('Helvetica-Bold').fontSize(6.3).fillColor(NEGRO)
      .text('¿Qué significa el Histórico de Pagos?', M + 5, y + 4);
    const claves = [
      ['1', 'Al corriente'], ['2', 'Atraso 1 a 29 días'], ['3', 'Atraso 30 a 59 días'],
      ['4', 'Atraso 60 a 89 días'], ['5', 'Atraso 90 a 119 días'], ['6', 'Atraso 120 a 149 días'],
      ['7', 'Atraso 150 días a 12 meses'], ['9', 'Más de 12 meses o sin recuperar'],
      ['U', 'Sin información'], ['-', 'No reportada']
    ];
    let xk = M + 152, yk = y + 4;
    claves.forEach(function (k, i) {
      if (i === 5) { xk = M + 152; yk = y + 15; }
      doc.font('Helvetica-Bold').fontSize(6).fillColor(colorMOP(k[0])).text(k[0], xk, yk);
      doc.font('Helvetica').fontSize(5.6).fillColor(NEGRO)
        .text(k[1], xk + 6, yk, { width: 72, lineBreak: false });
      xk += 78;
    });
    y += 32;

    cuentas.forEach(function (c, i) {
      const rej = rejillaHistorico(c);
      const altoRej = rej ? 12 + rej.anios.length * 8 + (c.ClaveObservacion ? 8 : 0) : 0;
      const alto = Math.max(48, altoRej + 10);
      y = salto(doc, y, alto + 6, M);

      doc.rect(M, y, ANCHO, alto).lineWidth(0.5).strokeColor(LINEA).stroke();

      doc.font('Helvetica-Bold').fontSize(7).fillColor(NEGRO)
        .text(String(i + 1) + '. ' + (c.NombreOtorgante || ''), M + 4, y + 4, { width: 126 });
      doc.font('Helvetica').fontSize(5.8).fillColor(NEGRO)
        .text(c.NumeroCuentaActual || '', M + 4, y + 13, { width: 126 });
      doc.text((TIPO_CONTRATO[c.TipoContrato] || c.TipoContrato || '').toUpperCase(),
        M + 4, y + 20, { width: 126 });
      doc.text((TIPO_CUENTA[c.TipoCuenta] || '').toUpperCase(), M + 4, y + 27, { width: 126 });
      doc.text((RESPONSABILIDAD[c.IndicadorTipoResponsabilidad] || '').toUpperCase(),
        M + 4, y + 34, { width: 126 });

      const cifras = [
        ['Apertura', mesAnio(c.FechaAperturaCuenta)],
        ['Último pago', mesAnio(c.FechaUltimoPago) || mesAnio(c.UltimaFechaSaldoCero)],
        ['Cierre', mesAnio(c.FechaCierreCuenta)],
        ['Límite', c.LimiteCredito ? '$' + pesos(monto(c.LimiteCredito)) : ''],
        ['Crédito máx.', c.CreditoMaximo ? '$' + pesos(monto(c.CreditoMaximo)) : ''],
        ['Saldo actual', '$' + pesos(monto(c.SaldoActual))],
        ['Vencido', monto(c.SaldoVencido) > 0 ? '$' + pesos(monto(c.SaldoVencido)) : ''],
        ['Monto a pagar', c.MontoPagar ? '$' + pesos(monto(c.MontoPagar)) : ''],
        ['Frecuencia', FRECUENCIA[c.FrecuenciaPagos] || '']
      ];
      const xf = M + 134;
      cifras.forEach(function (cf, k) {
        const xx = xf + (k % 5) * 47;
        const yy = y + 4 + Math.floor(k / 5) * 17;
        doc.font('Helvetica').fontSize(5.3).fillColor(GRIS).text(cf[0], xx, yy, { width: 45 });
        doc.font('Helvetica-Bold').fontSize(6.3)
          .fillColor(cf[0] === 'Vencido' && cf[1] ? ROJO : NEGRO)
          .text(cf[1] || '—', xx, yy + 6, { width: 45 });
      });

      if (rej) {
        const xr = M + ANCHO - 168;
        doc.font('Helvetica-Bold').fontSize(5).fillColor(NEGRO).text('Mes', xr, y + 4);
        MESES.forEach(function (mm, k) {
          doc.text(mm, xr + 20 + k * 12, y + 4, { width: 11, align: 'center' });
        });
        let yr = y + 12;
        rej.anios.forEach(function (an) {
          doc.font('Helvetica-Bold').fontSize(5.5).fillColor(NEGRO).text(String(an), xr, yr + 1);
          rej.celdas[an].forEach(function (v, k) {
            const cx = xr + 20 + k * 12;
            if (v) {
              doc.rect(cx, yr - 1, 11, 7.5).fill(colorMOP(v));
              doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(5)
                .text(v, cx, yr + 0.4, { width: 11, align: 'center' });
            } else {
              doc.rect(cx, yr - 1, 11, 7.5).lineWidth(0.3).strokeColor('#E4E0D8').stroke();
            }
          });
          yr += 8;
        });
        if (c.ClaveObservacion) {
          doc.font('Helvetica-Bold').fontSize(5.5).fillColor(NEGRO)
            .text(c.ClaveObservacion + '=' + (OBSERVACION[c.ClaveObservacion] || '').toUpperCase(),
              xr, yr + 1, { width: 164 });
        }
      }
      y += alto + 5;
    });
  }

  /* Consultas de otros otorgantes */
  const cons = lista(per.ConsultasEfectuadas, 'ConsultaEfectuada');
  if (cons.length) {
    y = salto(doc, y, 60, M);
    y += 6;
    y = barra(doc, 'Detalle de consultas (' + cons.length + ')', y, M, ANCHO);
    doc.rect(M, y - 3, ANCHO, 11).fill(GRISCLARO);
    doc.font('Helvetica-Bold').fontSize(6.2).fillColor(NEGRO);
    doc.text('Institución', M + 3, y);
    doc.text('Fecha', M + 200, y);
    doc.text('Tipo de crédito', M + 270, y);
    doc.text('Responsabilidad', M + 400, y);
    y += 11;
    cons.slice(0, 30).forEach(function (c) {
      y = salto(doc, y, 12, M);
      doc.font('Helvetica').fontSize(6.5).fillColor(NEGRO);
      doc.text(c.NombreOtorgante || '', M + 3, y, { width: 192 });
      doc.text(fecha(c.FechaConsulta), M + 200, y, { width: 66 });
      doc.text(TIPO_CONTRATO[c.TipoContrato] || c.TipoContrato || '', M + 270, y, { width: 126 });
      doc.text(RESPONSABILIDAD[c.IndicadorTipoResponsabilidad] || '', M + 400, y, { width: 100 });
      y += 9;
    });
    if (cons.length > 30) {
      doc.font('Helvetica').fontSize(6.3).fillColor(GRIS)
        .text('y ' + (cons.length - 30) + ' consultas más', M + 3, y);
      y += 9;
    }
  }

  /* Alertas */
  const alertas = lista(per.HawkAlertConsulta, 'HawkAlertC')
    .concat(lista(per.HawkAlertBD, 'HawkAlertBD'));
  if (alertas.length || (r.banderas && r.banderas.length)) {
    y = salto(doc, y, 40, M);
    y += 6;
    y = barra(doc, 'Mensajes y alertas', y, M, ANCHO);
    doc.font('Helvetica').fontSize(6.8).fillColor(NEGRO);
    (r.banderas || []).forEach(function (b) {
      doc.fillColor(b.grave ? ROJO : NEGRO).text('• ' + b.mensaje, M + 4, y, { width: ANCHO - 8 });
      y = doc.y + 1.5;
    });
    alertas.forEach(function (a) {
      doc.fillColor(NEGRO)
        .text('• ' + (a.CodigoClave ? '[' + a.CodigoClave + '] ' : '') + (a.Mensaje || ''),
          M + 4, y, { width: ANCHO - 8 });
      y = doc.y + 1.5;
    });
  }

  /* Pie en todas las páginas */
  const rango = doc.bufferedPageRange();
  for (let i = 0; i < rango.count; i++) {
    doc.switchToPage(rango.start + i);
    /* Sin margen inferior, o PDFKit crea una página nueva al escribir el pie */
    doc.page.margins.bottom = 0;
    doc.x = M; doc.y = M;
    const yPie = doc.page.height - 30;
    doc.rect(M, yPie, ANCHO, 11).fill(GRISCLARO);
    doc.fillColor(NEGRO).font('Helvetica').fontSize(6.5)
      .text('DOCUMENTO SIN VALOR PROBATORIO EN JUICIOS', M, yPie + 3,
        { width: ANCHO, align: 'center' });
    doc.font('Helvetica').fontSize(5.8).fillColor(GRIS)
      .text('Consulta realizada por LMV Credia, S.A. de C.V. con autorización expresa del titular. ' +
        'Folio de solicitud ' + (s.folio || '—') + '.', M, yPie + 13, { width: ANCHO - 60 });
    doc.text('PÁGINA ' + (i + 1) + ' DE ' + rango.count, M + ANCHO - 60, yPie + 13,
      { width: 60, align: 'right' });
  }

  doc.end();
  return doc;
}

module.exports = { generaReportePDF, TIPO_CONTRATO, MOP_TXT, OBSERVACION };

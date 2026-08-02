/* ============================================================
   Reporte de Crédito en PDF, armado desde la respuesta de Moffin.
   Reproduce la información que entrega Buró: datos generales,
   domicilios, empleos, score, detalle de créditos y resumen.
   ============================================================ */

'use strict';

const PDFDocument = require('pdfkit');
const { monto, entero, fechaBuro } = require('./buro');

const TINTA = '#12263A';
const GRIS = '#6B7A88';
const LINEA = '#D8D2C6';
const ROJO = '#8C1C13';
const VERDE = '#1E6F50';

/* Catálogos de Buró */
const TIPO_CONTRATO = {
  AU: 'Compra de automóvil', AA: 'Arrendamiento automotriz', AB: 'Automotriz bancario', AE: 'Arrendamiento',
  AL: 'Arrendamiento', AM: 'Aparatos/muebles', AR: 'Arrendamiento', AV: 'Aviación',
  BC: 'Banca comercial', BL: 'Bote/lancha', BR: 'Bienes raíces', CA: 'Compra de automóvil',
  CC: 'Tarjeta de crédito', CF: 'Crédito fiscal', CO: 'Consolidación', CP: 'Crédito personal',
  ED: 'Educativo', EQ: 'Equipo', FF: 'Fondeo', FI: 'Fianza', GS: 'Gasolina',
  HB: 'Hipotecario bancario', HE: 'Hipotecario', HV: 'Hipotecario vivienda',
  LC: 'Línea de crédito', MI: 'Misceláneas', NG: 'Negocio', PB: 'Préstamo bancario',
  PC: 'Préstamo bancario', PE: 'Préstamo estudiantil', PG: 'Préstamo gubernamental',
  PL: 'Préstamo personal', PM: 'Préstamo empresarial', PQ: 'Préstamo quirografario',
  PR: 'Préstamo personal', PS: 'Préstamo personal', RC: 'Crédito revolvente',
  SE: 'Servicios', TC: 'Tarjeta de crédito', VE: 'Vehículo', OT: 'Otro'
};

const TIPO_CUENTA = { R: 'Revolvente', I: 'Pagos fijos', M: 'Hipoteca', O: 'Sin límite preestablecido' };

const MOP = {
  '00': 'Sin información', '01': 'Al corriente', '02': 'Atraso 1 a 29 días',
  '03': 'Atraso 30 a 59 días', '04': 'Atraso 60 a 89 días', '05': 'Atraso 90 a 119 días',
  '06': 'Atraso 120 a 149 días', '07': 'Atraso 150 a 179 días',
  '96': 'Fraude', '97': 'Cuenta en cobranza judicial', '99': 'Cuenta irrecuperable',
  UR: 'Sin información'
};

function lista(nodo, llave) {
  if (!nodo) return [];
  const v = llave ? nodo[llave] : nodo;
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function pesos(n) {
  const v = Number(n) || 0;
  return '$' + v.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fecha(v) {
  const f = fechaBuro(v);
  if (!f) return '—';
  const p = f.split('-');
  return p[2] + '/' + p[1] + '/' + p[0];
}

function titulo(doc, texto, y, ancho, M) {
  doc.rect(M, y, ancho, 18).fill('#EDEAE3');
  doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(8.5)
    .text(texto.toUpperCase(), M + 8, y + 5.5);
  return y + 26;
}

function saltoSiHaceFalta(doc, y, alto, M) {
  if (y + alto > doc.page.height - 60) {
    doc.addPage();
    return M;
  }
  return y;
}

/**
 * Genera el PDF del reporte de crédito.
 * @param {object} datos { payload, solicitud, resumen, consultada, folio_bc }
 * @param {stream.Writable} salida
 */
function generaReportePDF(datos, salida) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 40, layout: 'portrait' });
  doc.pipe(salida);

  const M = 40;
  const ANCHO = doc.page.width - M * 2;
  const s = datos.solicitud || {};
  const r = datos.resumen || {};
  const per = lista(datos.payload && datos.payload.return && datos.payload.return.Personas, 'Persona')[0] || {};

  doc.info.Title = 'Reporte de Crédito · ' + (s.folio || '');
  doc.info.Author = 'LMV CREDIA, S.A. DE C.V.';

  let y = M;

  /* Encabezado */
  doc.rect(M, y, ANCHO, 48).fill(TINTA);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(12)
    .text('REPORTE DE CRÉDITO · PERSONA FÍSICA', M + 12, y + 11);
  doc.font('Helvetica').fontSize(8).fillColor('#C9D6E2')
    .text('Información recolectada de Buró de Crédito · Consulta realizada por LMV Credia, S.A. de C.V.',
      M + 12, y + 28);
  y += 58;

  doc.font('Helvetica').fontSize(7.5).fillColor(GRIS)
    .text('FOLIO ' + (s.folio || '—') +
      (datos.folio_bc ? '   ·   CONSULTA BC ' + datos.folio_bc : '') +
      '   ·   FECHA DE CONSULTA ' +
      (datos.consultada
        ? new Date(datos.consultada).toLocaleString('es-MX',
          { timeZone: 'America/Mexico_City', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '—'), M, y);
  y += 18;

  /* Datos generales */
  y = titulo(doc, 'Datos generales', y, ANCHO, M);
  const n = per.Nombre || {};
  const nombre = [n.PrimerNombre, n.SegundoNombre, n.ApellidoPaterno, n.ApellidoMaterno]
    .filter(Boolean).join(' ') || [s.nombre, s.apellido_p, s.apellido_m].filter(Boolean).join(' ');
  const col = ANCHO / 3;
  const gen = [
    ['Nombre', nombre],
    ['RFC', n.RFC || s.rfc || '—'],
    ['Fecha de nacimiento', fecha(n.FechaNacimiento) !== '—' ? fecha(n.FechaNacimiento) : (s.fecha_nac || '—')],
    ['CURP', s.curp || '—'],
    ['Registro en Buró', fecha(lista(per.ResumenReporte, 'ResumenReporte')[0] &&
      lista(per.ResumenReporte, 'ResumenReporte')[0].FechaIngresoBD)],
    ['Nacionalidad', n.Nacionalidad || 'MX']
  ];
  gen.forEach(function (g, i) {
    const x = M + (i % 3) * col;
    const yy = y + Math.floor(i / 3) * 26;
    doc.font('Helvetica').fontSize(7).fillColor(GRIS).text(g[0].toUpperCase(), x, yy, { width: col - 8 });
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(TINTA).text(g[1], x, yy + 9, { width: col - 8 });
  });
  y += Math.ceil(gen.length / 3) * 26 + 6;

  /* Score */
  y = titulo(doc, 'Score', y, ANCHO, M);
  const tieneScore = r.score !== null && r.score !== undefined;
  doc.rect(M, y, 110, 42).fillAndStroke(tieneScore ? '#F2F6F4' : '#FBF3EC', LINEA);
  doc.font('Helvetica-Bold').fontSize(tieneScore ? 22 : 11)
    .fillColor(tieneScore ? (r.score >= 650 ? VERDE : (r.score >= 600 ? '#B0761A' : ROJO)) : GRIS)
    .text(tieneScore ? String(r.score) : 'SIN SCORE', M + 10, y + (tieneScore ? 10 : 15), { width: 90 });
  doc.font('Helvetica').fontSize(8).fillColor(TINTA)
    .text(tieneScore
      ? 'BC Score. Escala de 300 a 850; a mayor valor, menor probabilidad de incumplimiento.'
      : (r.score_texto || 'Buró no cuenta con información suficiente para calcular el score.') +
      ' Esto no significa mal historial: puede ser falta de cuentas recientes.',
      M + 122, y + 6, { width: ANCHO - 122 });
  y += 52;

  /* Resumen */
  y = titulo(doc, 'Resumen del expediente', y, ANCHO, M);
  const res = [
    ['Cuentas totales', String(r.cuentas || 0)],
    ['Cuentas cerradas', String(r.cuentas_cerradas || 0)],
    ['Cuentas negativas hoy', String(r.cuentas_negativas || 0)],
    ['Saldo revolvente', pesos(r.saldo_revolvente)],
    ['Saldo pagos fijos', pesos(r.saldo_fijos)],
    ['Saldo VENCIDO', pesos(r.vencido_total)],
    ['Uso del límite', (r.pct_uso === null || r.pct_uso === undefined) ? '—' : r.pct_uso + '%'],
    ['Peor atraso histórico', r.peor_mop ? 'MOP ' + r.peor_mop : 'Sin atrasos'],
    ['Consultas en 6 meses', String(r.consultas_6m || 0)],
    ['Con atrasos previos', String(r.historia_negativa || 0)],
    ['En despacho cobranza', String(r.cuentas_cobranza || 0)],
    ['Cuenta más antigua', r.cuenta_mas_antigua || '—']
  ];
  const c4 = ANCHO / 4;
  res.forEach(function (g, i) {
    const x = M + (i % 4) * c4;
    const yy = y + Math.floor(i / 4) * 26;
    doc.font('Helvetica').fontSize(6.5).fillColor(GRIS).text(g[0].toUpperCase(), x, yy, { width: c4 - 6 });
    const rojo = (g[0] === 'Saldo VENCIDO' && r.vencido_total > 0) ||
      (g[0] === 'Cuentas negativas hoy' && r.cuentas_negativas > 0) ||
      (g[0] === 'En despacho cobranza' && r.cuentas_cobranza > 0);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(rojo ? ROJO : TINTA)
      .text(g[1], x, yy + 8, { width: c4 - 6 });
  });
  y += Math.ceil(res.length / 4) * 26 + 6;

  /* Alertas */
  const alertas = lista(per.HawkAlertConsulta, 'HawkAlertC')
    .concat(lista(per.HawkAlertBD, 'HawkAlertBD'));
  if (alertas.length || (r.banderas && r.banderas.length)) {
    y = titulo(doc, 'Alertas y mensajes de Buró', y, ANCHO, M);
    doc.font('Helvetica').fontSize(8).fillColor(TINTA);
    (r.banderas || []).forEach(function (b) {
      doc.fillColor(b.grave ? ROJO : TINTA).text('• ' + b.mensaje, M + 4, y, { width: ANCHO - 8 });
      y = doc.y + 2;
    });
    alertas.forEach(function (a) {
      doc.fillColor(TINTA).fontSize(8)
        .text('• ' + (a.CodigoClave ? '[' + a.CodigoClave + '] ' : '') + (a.Mensaje || ''),
          M + 4, y, { width: ANCHO - 8 });
      y = doc.y + 2;
    });
    y += 6;
  }

  /* Detalle de créditos */
  const cuentas = lista(per.Cuentas, 'Cuenta');
  y = saltoSiHaceFalta(doc, y, 90, M);
  y = titulo(doc, 'Detalle de los créditos (' + cuentas.length + ')', y, ANCHO, M);

  if (!cuentas.length) {
    doc.font('Helvetica').fontSize(9).fillColor(GRIS)
      .text('No hay créditos reportados en el expediente.', M + 4, y);
    y += 20;
  } else {
    const cols = [
      { t: 'OTORGANTE', w: 92 }, { t: 'TIPO', w: 78 }, { t: 'APERTURA', w: 46 },
      { t: 'LÍMITE', w: 52 }, { t: 'SALDO', w: 52 }, { t: 'VENCIDO', w: 52 },
      { t: 'PAGO', w: 46 }, { t: 'SITUACIÓN', w: 0 }
    ];
    cols[7].w = ANCHO - cols.reduce(function (a, c) { return a + c.w; }, 0);

    function cabezaTabla(yy) {
      doc.font('Helvetica-Bold').fontSize(6).fillColor(GRIS);
      let x = M;
      cols.forEach(function (c) { doc.text(c.t, x, yy, { width: c.w - 3 }); x += c.w; });
      doc.moveTo(M, yy + 10).lineTo(M + ANCHO, yy + 10).lineWidth(0.6).strokeColor(LINEA).stroke();
      return yy + 15;
    }
    y = cabezaTabla(y);

    cuentas.forEach(function (c) {
      y = saltoSiHaceFalta(doc, y, 34, M);
      if (y === M) y = cabezaTabla(y);

      const mopAct = String(c.FormaPagoActual || '').padStart(2, '0');
      const mopHist = String(c.MopHistoricoMorosidadMasGrave || '').padStart(2, '0');
      const venc = monto(c.SaldoVencido);
      const grave = venc > 0 || ['96', '97', '99'].indexOf(mopHist) >= 0 || entero(mopAct) >= 2;

      const fila = [
        c.NombreOtorgante || '—',
        (TIPO_CONTRATO[c.TipoContrato] || c.TipoContrato || '—') +
        (TIPO_CUENTA[c.TipoCuenta] ? ' · ' + TIPO_CUENTA[c.TipoCuenta] : ''),
        fecha(c.FechaAperturaCuenta),
        c.LimiteCredito ? pesos(monto(c.LimiteCredito)) : '—',
        pesos(monto(c.SaldoActual)),
        venc > 0 ? pesos(venc) : '—',
        c.MontoPagar ? pesos(monto(c.MontoPagar)) : '—',
        MOP[mopAct] || ('MOP ' + mopAct)
      ];

      let x = M;
      let altoMax = 0;
      fila.forEach(function (v, i) {
        doc.font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(7)
          .fillColor(i === 5 && venc > 0 ? ROJO : TINTA);
        const alto = doc.heightOfString(String(v), { width: cols[i].w - 3 });
        doc.text(String(v), x, y, { width: cols[i].w - 3 });
        if (alto > altoMax) altoMax = alto;
        x += cols[i].w;
      });
      y += altoMax + 2;

      /* Segundo renglón: historial y peor atraso */
      const hist = String(c.HistoricoPagos || '');
      if (hist || mopHist !== '00') {
        doc.font('Helvetica').fontSize(6).fillColor(grave ? ROJO : GRIS);
        let txt = '';
        if (hist) txt += 'Historial (24 meses, del más reciente): ' + hist;
        if (mopHist !== '00' && mopHist !== '01') {
          txt += (txt ? '   ·   ' : '') + 'Peor atraso: ' + (MOP[mopHist] || 'MOP ' + mopHist) +
            ' en ' + fecha(c.FechaHistoricaMorosidadMasGrave);
          if (c.ImporteSaldoMorosidadHistMasGrave) {
            txt += ' por ' + pesos(monto(c.ImporteSaldoMorosidadHistMasGrave));
          }
        }
        if (c.ClaveObservacion) txt += '   ·   Observación: ' + c.ClaveObservacion;
        doc.text(txt, M + 4, y, { width: ANCHO - 8 });
        y = doc.y + 1;
      }
      doc.moveTo(M, y + 2).lineTo(M + ANCHO, y + 2).lineWidth(0.4).strokeColor('#EDE9E1').stroke();
      y += 7;
    });
  }

  /* Domicilios */
  const doms = lista(per.Domicilios, 'Domicilio');
  if (doms.length) {
    y = saltoSiHaceFalta(doc, y, 60, M);
    y = titulo(doc, 'Domicilios reportados', y, ANCHO, M);
    doc.font('Helvetica').fontSize(7.5).fillColor(TINTA);
    doms.slice(0, 6).forEach(function (d) {
      const t = [d.Direccion1, d.Direccion2, d.ColoniaPoblacion, d.DelegacionMunicipio,
        d.Ciudad, d.Estado, d.CP].filter(Boolean).join(', ');
      doc.fillColor(TINTA).text('• ' + t, M + 4, y, { width: ANCHO - 90 });
      doc.fillColor(GRIS).fontSize(6.5)
        .text('Reportado ' + fecha(d.FechaReporteDireccion), M + ANCHO - 82, y, { width: 82 });
      doc.fontSize(7.5);
      y = doc.y + 3;
    });
    y += 4;
  }

  /* Empleos */
  const emp = lista(per.Empleos, 'Empleo');
  if (emp.length) {
    y = saltoSiHaceFalta(doc, y, 50, M);
    y = titulo(doc, 'Empleos reportados', y, ANCHO, M);
    doc.font('Helvetica').fontSize(7.5);
    emp.slice(0, 5).forEach(function (e) {
      let t = e.NombreEmpresa || '—';
      if (e.Cargo) t += ' · ' + e.Cargo;
      if (e.Salario && entero(e.Salario) > 1) t += ' · Salario reportado ' + pesos(monto(e.Salario));
      doc.fillColor(TINTA).text('• ' + t, M + 4, y, { width: ANCHO - 90 });
      doc.fillColor(GRIS).fontSize(6.5)
        .text('Reportado ' + fecha(e.FechaReportoEmpleo), M + ANCHO - 82, y, { width: 82 });
      doc.fontSize(7.5);
      y = doc.y + 3;
    });
    y += 4;
  }

  /* Consultas efectuadas */
  const cons = lista(per.ConsultasEfectuadas, 'ConsultaEfectuada');
  if (cons.length) {
    y = saltoSiHaceFalta(doc, y, 50, M);
    y = titulo(doc, 'Consultas de otros otorgantes (' + cons.length + ')', y, ANCHO, M);
    doc.font('Helvetica').fontSize(7).fillColor(TINTA);
    cons.slice(0, 14).forEach(function (c) {
      doc.text('• ' + fecha(c.FechaConsulta) + '   ' + (c.NombreOtorgante || '—') +
        '   ' + (TIPO_CONTRATO[c.TipoContrato] || c.TipoContrato || ''), M + 4, y, { width: ANCHO - 8 });
      y = doc.y + 1;
    });
    if (cons.length > 14) {
      doc.fillColor(GRIS).text('  y ' + (cons.length - 14) + ' más', M + 4, y);
      y = doc.y + 1;
    }
    y += 6;
  }

  /* Pie en todas las páginas */
  const rango = doc.bufferedPageRange ? doc.bufferedPageRange() : { start: 0, count: 1 };
  for (let i = 0; i < rango.count; i++) {
    try { doc.switchToPage(rango.start + i); } catch (e) { break; }
    const yPie = doc.page.height - 42;
    doc.moveTo(M, yPie).lineTo(M + ANCHO, yPie).lineWidth(0.6).strokeColor(LINEA).stroke();
    doc.font('Helvetica').fontSize(6).fillColor(GRIS)
      .text('Información obtenida de Buró de Crédito con autorización expresa del titular. ' +
        'DOCUMENTO SIN VALOR PROBATORIO EN JUICIOS. Uso exclusivo del destinatario; ' +
        'su reproducción o difusión no autorizada está prohibida.',
        M, yPie + 6, { width: ANCHO - 60, align: 'left' });
    doc.text('Pág. ' + (i + 1) + ' de ' + rango.count, M + ANCHO - 55, yPie + 6, { width: 55, align: 'right' });
  }

  doc.end();
  return doc;
}

module.exports = { generaReportePDF, TIPO_CONTRATO, MOP };

/* ============================================================
   Evaluación interna LGX
   Puntaje por reglas, calibrado para crédito chico de pago
   semanal o quincenal. NO es un score estadístico: es un
   criterio ordenado para que todo el equipo evalúe igual.
   Se recalibra cuando haya historial propio de pagos.
   ============================================================ */

'use strict';

const { monto, entero, fechaBuro } = require('./buro');

function lista(nodo, llave) {
  if (!nodo) return [];
  const v = llave ? nodo[llave] : nodo;
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/* Convierte la frecuencia de pago a un equivalente mensual */
const VECES_MES = {
  S: 4.33, C: 2.17, Q: 2, M: 1, B: 0.5, T: 0.33, Y: 0.17, A: 0.083,
  D: 1, V: 1, Z: 1, P: 0
};

/* Los últimos N meses del histórico, del más reciente al más antiguo */
function ultimosMeses(c, n) {
  const cad = String(c.HistoricoPagos || '').trim();
  if (!cad) return [];
  return cad.slice(0, n).split('');
}

function esCreditoChico(c) {
  const tipo = String(c.TipoContrato || '').toUpperCase();
  const max = monto(c.CreditoMaximo) || monto(c.LimiteCredito);
  /* Préstamo personal, tienda, línea de crédito o cualquier cuenta de monto bajo */
  return ['PL', 'PS', 'PR', 'CP', 'CT', 'AM', 'CL', 'MI', 'SE'].indexOf(tipo) >= 0 ||
    (max > 0 && max <= 30000);
}

/**
 * Evalúa el expediente y devuelve puntaje, nivel y las señales que lo explican.
 * @param {object} payload respuesta cruda de Moffin
 * @param {object} resumen salida de resumeReporte
 */
function evalua(payload, resumen) {
  const r = resumen || {};
  const per = lista(payload && payload.return && payload.return.Personas, 'Persona')[0] || {};
  const cuentas = lista(per.Cuentas, 'Cuenta');

  let p = 45;                    /* base; las señales suben o bajan desde aquí */
  const aFavor = [];
  const enContra = [];

  /* ---------- Lo que descalifica ---------- */
  let quebranto = 0, cobranza = 0;
  cuentas.forEach(function (c) {
    const act = entero(c.FormaPagoActual);
    const hist = entero(c.MopHistoricoMorosidadMasGrave);
    const obs = String(c.ClaveObservacion || '').toUpperCase();
    if (act >= 96 || hist >= 96 || obs === 'UP' || obs === 'FN' || obs === 'FD') quebranto++;
    if (obs === 'PC' || obs === 'CO') cobranza++;
  });

  if (quebranto > 0) {
    p -= 32;
    enContra.push(quebranto + ' crédito(s) con quebranto o más de 12 meses de atraso');
  }
  if (cobranza > 0) {
    p -= 18;
    enContra.push(cobranza + ' crédito(s) en despacho de cobranza');
  }

  /* ---------- Saldo vencido hoy ---------- */
  const vencido = r.vencido_total || 0;
  if (vencido > 0) {
    if (vencido >= 10000) { p -= 25; }
    else if (vencido >= 3000) { p -= 16; }
    else { p -= 9; }
    enContra.push('Debe $' + vencido.toLocaleString('es-MX') + ' vencidos hoy');
  } else {
    p += 12;
    aFavor.push('Sin saldo vencido');
  }

  /* ---------- Comportamiento reciente: los últimos 12 meses pesan más ---------- */
  let mesesLimpios = 0, mesesConDato = 0, mesesMalos = 0;
  cuentas.forEach(function (c) {
    ultimosMeses(c, 12).forEach(function (v) {
      if (v === 'U' || v === '-') return;
      mesesConDato++;
      const n = parseInt(v, 10);
      if (isNaN(n)) return;
      if (n <= 1) mesesLimpios++;
      else if (n >= 3) mesesMalos++;
    });
  });
  if (mesesConDato >= 6) {
    const pct = mesesLimpios / mesesConDato;
    if (pct >= 0.9) {
      p += 16;
      aFavor.push('Pagó puntual el ' + Math.round(pct * 100) + '% del último año');
    } else if (pct >= 0.7) {
      p += 8;
      aFavor.push('Cumplió el ' + Math.round(pct * 100) + '% del último año');
    } else if (pct < 0.4) {
      p -= 14;
      enContra.push('Solo cumplió el ' + Math.round(pct * 100) + '% del último año');
    }
    if (mesesMalos >= 6) {
      p -= 8;
      enContra.push('Atrasos frecuentes en meses recientes');
    }
  } else {
    enContra.push('Poca información de pagos reciente');
  }

  /* ---------- Cuentas al corriente ---------- */
  const alCorriente = cuentas.filter(function (c) {
    const a = entero(c.FormaPagoActual);
    return a <= 1 && monto(c.SaldoVencido) === 0;
  }).length;
  if (alCorriente >= 3) {
    p += 8;
    aFavor.push(alCorriente + ' créditos al corriente');
  } else if (alCorriente > 0) {
    p += 4;
    aFavor.push(alCorriente + ' crédito(s) al corriente');
  }

  /* ---------- Experiencia con crédito parecido al tuyo ---------- */
  const chicos = cuentas.filter(esCreditoChico);
  const chicosBien = chicos.filter(function (c) {
    return entero(c.FormaPagoActual) <= 1 && monto(c.SaldoVencido) === 0;
  }).length;
  if (chicosBien >= 2) {
    p += 7;
    aFavor.push('Buen historial en créditos de monto chico');
  } else if (chicos.length && chicosBien === 0) {
    p -= 6;
    enContra.push('Sin buen historial en créditos parecidos al nuestro');
  }

  /* ---------- Antigüedad ---------- */
  const antigua = r.cuenta_mas_antigua;
  let anios = 0;
  if (antigua) {
    anios = (Date.now() - new Date(antigua).getTime()) / (365.25 * 24 * 3600 * 1000);
    if (anios >= 5) { p += 7; aFavor.push('Más de 5 años de historial crediticio'); }
    else if (anios >= 2) { p += 4; aFavor.push(Math.floor(anios) + ' años de historial'); }
  }
  if (!cuentas.length) {
    p -= 5;
    enContra.push('Sin historial en Buró: no hay con qué evaluarlo');
  } else if (cuentas.length === 1) {
    enContra.push('Historial muy corto: una sola cuenta');
  }

  /* ---------- Búsqueda reciente de crédito ---------- */
  const cons6 = r.consultas_6m || 0;
  if (cons6 >= 6) {
    p -= 14;
    enContra.push(cons6 + ' consultas en 6 meses: anda buscando crédito en varios lados');
  } else if (cons6 >= 3) {
    p -= 6;
    enContra.push(cons6 + ' consultas en 6 meses');
  }

  /* ---------- Uso del límite ---------- */
  if (r.pct_uso !== null && r.pct_uso !== undefined) {
    if (r.pct_uso > 100) { p -= 9; enContra.push('Sobregirado: usa el ' + r.pct_uso + '% de su límite'); }
    else if (r.pct_uso >= 85) { p -= 5; enContra.push('Usa el ' + r.pct_uso + '% de su límite'); }
    else if (r.pct_uso <= 40 && cuentas.length > 1) {
      p += 3;
      aFavor.push('Usa poco de su crédito disponible (' + r.pct_uso + '%)');
    }
  }

  /* ---------- Alertas graves ---------- */
  if (r.defuncion) { p -= 40; enContra.push('Buró reporta fecha de defunción: verificar identidad'); }
  if (r.rfc_no_coincide) { p -= 6; enContra.push('El RFC no coincide con el de Buró'); }

  /* ---------- Score de Buró como apoyo, no como base ---------- */
  if (r.score !== null && r.score !== undefined) {
    if (r.score >= 680) { p += 6; aFavor.push('Score de Buró alto (' + r.score + ')'); }
    else if (r.score >= 620) { p += 3; }
    else if (r.score < 560) { p -= 8; enContra.push('Score de Buró bajo (' + r.score + ')'); }
  }

  p = Math.max(0, Math.min(100, Math.round(p)));

  /* ---------- Nivel ---------- */
  let nivel, semaforo, recomendacion;
  const sinDatos = cuentas.length === 0 ||
    (cuentas.length === 1 && mesesConDato < 6);

  if (quebranto > 0 || (vencido >= 10000 && cobranza > 0)) {
    nivel = 'No recomendable';
    semaforo = 'rojo';
    recomendacion = 'Tiene créditos con quebranto o cobranza. No otorgar.';
    p = Math.min(p, 35);
  } else if (sinDatos) {
    nivel = 'Sin historial suficiente';
    semaforo = 'ambar';
    recomendacion = 'Buró no tiene con qué evaluarlo. Decidir por referencias y capacidad de pago.';
    p = Math.min(p, 58);
  } else if (p >= 78) {
    nivel = 'Riesgo bajo';
    semaforo = 'verde';
    recomendacion = 'Perfil sólido. Puede aprobarse el monto solicitado.';
  } else if (p >= 60) {
    nivel = 'Riesgo moderado';
    semaforo = 'verde';
    recomendacion = 'Aprobable. Considerar empezar con monto estándar.';
  } else if (p >= 45) {
    nivel = 'Riesgo alto, viable con condiciones';
    semaforo = 'ambar';
    recomendacion = 'Puede otorgarse con monto reducido y seguimiento cercano.';
  } else {
    nivel = 'No recomendable';
    semaforo = 'rojo';
    recomendacion = 'El historial no respalda el otorgamiento.';
  }

  /* ---------- Compromiso mensual actual ---------- */
  let compromiso = 0;
  const pagos = [];
  cuentas.forEach(function (c) {
    if (c.FechaCierreCuenta) return;
    const mp = monto(c.MontoPagar);
    if (mp <= 0) return;
    const f = String(c.FrecuenciaPagos || 'M').toUpperCase();
    const veces = VECES_MES[f] !== undefined ? VECES_MES[f] : 1;
    const mensual = mp * veces;
    compromiso += mensual;
    pagos.push({
      otorgante: c.NombreOtorgante || '',
      pago: mp,
      frecuencia: f,
      mensual: Math.round(mensual)
    });
  });
  pagos.sort(function (a, b) { return b.mensual - a.mensual; });

  if (!aFavor.length) aFavor.push('Sin señales positivas claras en el expediente');
  if (!enContra.length) enContra.push('Sin señales negativas en el expediente');

  return {
    puntaje: p,
    nivel: nivel,
    semaforo: semaforo,
    recomendacion: recomendacion,
    a_favor: aFavor,
    en_contra: enContra,
    compromiso_mensual: Math.round(compromiso),
    pagos: pagos.slice(0, 6),
    creditos_activos: cuentas.filter(function (c) { return !c.FechaCierreCuenta; }).length,
    anios_historial: anios ? Math.floor(anios) : 0
  };
}

/**
 * Qué mensualidad soportaría con un ingreso dado.
 * Regla conservadora para crédito chico: hasta 30% del ingreso
 * entre todos sus compromisos, incluido el nuestro.
 */
function capacidad(ingresoMensual, compromisoActual, pct) {
  const ing = Number(ingresoMensual) || 0;
  if (ing <= 0) return null;
  const tope = ing * ((Number(pct) || 30) / 100);
  const libre = Math.max(0, tope - (Number(compromisoActual) || 0));
  return {
    ingreso: Math.round(ing),
    tope: Math.round(tope),
    comprometido: Math.round(compromisoActual || 0),
    disponible: Math.round(libre),
    pct_usado: tope > 0 ? Math.round(((compromisoActual || 0) / tope) * 100) : 0
  };
}

module.exports = { evalua, capacidad };

/* ============================================================
   Lectura de reportes de Buró de Crédito (Persona Física)
   Estructura verificada contra los mocks de Moffin (sandbox).
   ============================================================ */

'use strict';

/* Los montos de Buró vienen con signo al final: "7200+", "1822-", "0+".
   El "+" es saldo deudor; el "-" es saldo a favor del cliente. */
function monto(v) {
  if (v === null || v === undefined) return 0;
  const s = String(v).trim();
  if (!s) return 0;
  const neg = s.endsWith('-');
  const n = parseFloat(s.replace(/[+\-\s,]/g, '')) || 0;
  return neg ? -n : n;
}

function entero(v) {
  if (v === null || v === undefined) return 0;
  return parseInt(String(v).replace(/\D/g, ''), 10) || 0;
}

/* Toma un nodo que puede venir como objeto, arreglo o null */
function lista(nodo, llave) {
  if (!nodo) return [];
  const v = llave ? nodo[llave] : nodo;
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/* Fechas de Buró: "25062014" = 25/06/2014 */
function fechaBuro(v) {
  const s = String(v || '').trim();
  if (!/^\d{8}$/.test(s) || s === '00000000') return null;
  return s.slice(4) + '-' + s.slice(2, 4) + '-' + s.slice(0, 2);
}

/* Score: valores negativos son códigos, no calificaciones.
   -008 = sin información suficiente para generar score. */
function leeScore(persona) {
  const sc = lista(persona.ScoreBuroCredito, 'ScoreBC');
  const s0 = sc[0];
  if (!s0) return { score: null, texto: 'Sin score', razones: [] };

  const bruto = String(s0.ValorScore || '').trim();
  const n = parseInt(bruto, 10);
  const razones = [s0.CodigoScore, s0.CodigoRazon1, s0.CodigoRazon2,
    s0.CodigoRazon3, s0.CodigoRazon4]
    .filter(x => x && String(x).trim() && String(x).trim() !== '00');

  if (isNaN(n) || n <= 0) {
    return {
      score: null,
      texto: bruto === '-008' || n === -8
        ? 'Sin score: Buró no tiene información suficiente'
        : 'Sin score (clave ' + (bruto || 'sin dato') + ')',
      razones: razones
    };
  }
  return { score: n, texto: String(n), razones: razones };
}

/* MOP: 1 = al corriente. 2 a 7 = atrasos crecientes.
   96, 97, 99 = fraude, cobranza judicial, cuenta irrecuperable. */
function peorMOP(cuentas) {
  let peor = 0;
  cuentas.forEach(c => {
    const m = entero(c.MopHistoricoMorosidadMasGrave);
    const a = entero(c.FormaPagoActual);
    if (m > peor && m < 90) peor = m;
    if (a > peor && a < 90) peor = a;
  });
  return peor;
}

/* Claves de observación que Buró marca como deterioro del crédito */
const OBSERVACION = {
  LC: 'Quita otorgada por el otorgante',
  CV: 'Cartera vendida a un tercero',
  FN: 'Fraude cometido por el consumidor',
  FD: 'Cuenta fraudulenta',
  CO: 'Cuenta en cobranza',
  UP: 'Cuenta en proceso de cobranza',
  PC: 'Pago menor al acordado',
  DA: 'Dación en pago',
  AD: 'Adjudicación del bien',
  RA: 'Cuenta reestructurada por adjudicación',
  RF: 'Reestructura por fenómeno natural',
  CL: 'Cuenta cerrada',
  CC: 'Cuenta cancelada',
  CZ: 'Cuenta cerrada con saldo cero',
  RE: 'Cuenta reestructurada',
  RV: 'Cuenta reestructurada vencida',
  CM: 'Cuenta con morosidad histórica',
  NA: 'Cuenta no aplicable'
};
const OBS_GRAVE = ['LC', 'CV', 'FN', 'FD', 'CO', 'UP', 'PC', 'DA', 'AD', 'RA'];

/* MOP 96/97/99 puede venir en el histórico O en la forma de pago actual */
function tieneClaveGrave(cuentas) {
  const graves = [];
  cuentas.forEach(c => {
    const hist = entero(c.MopHistoricoMorosidadMasGrave);
    const act = entero(c.FormaPagoActual);
    const mop = [96, 97, 99].indexOf(act) >= 0 ? act
      : ([96, 97, 99].indexOf(hist) >= 0 ? hist : 0);
    const obs = String(c.ClaveObservacion || '').toUpperCase();
    if (mop || OBS_GRAVE.indexOf(obs) >= 0) {
      graves.push({
        otorgante: c.NombreOtorgante || '',
        mop: mop || null,
        observacion: obs || null,
        observacion_texto: OBSERVACION[obs] || null,
        vencido: monto(c.SaldoVencido),
        actual: act === 96 || act === 97 || act === 99
      });
    }
  });
  return graves;
}

/* MensajesAlerta: cadena de 6 posiciones. "Y" en cada posicion significa: */
const POS_ALERTA = [
  'Aparece FECHA DE DEFUNCIÓN en la base de datos',
  'El RFC no corresponde al de la base de datos',
  'El domicilio no corresponde al de la base de datos',
  'Existe información adicional en Buró de Crédito Comercial',
  'Domicilio inválido en la consulta',
  'Otorgante con menos de 5 mil registros'
];

function leeMensajesAlerta(v) {
  const s = String(v || '').toUpperCase();
  const out = [];
  for (let i = 0; i < POS_ALERTA.length && i < s.length; i++) {
    if (s[i] === 'Y') out.push({ posicion: i + 1, mensaje: POS_ALERTA[i], grave: (i === 0 || i === 1) });
  }
  return out;
}

/**
 * Convierte la respuesta cruda de Moffin en un resumen legible.
 */
function resumeReporte(payload) {
  const base = {
    ok: false, score: null, score_texto: 'Sin datos', razones: [],
    titular: '', rfc: '',
    cuentas: 0, cuentas_cerradas: 0, cuentas_negativas: 0, cuentas_atraso: 0,
    saldo_revolvente: 0, saldo_fijos: 0, saldo_total: 0,
    vencido_revolvente: 0, vencido_fijos: 0, vencido_total: 0,
    pct_uso: null, peor_mop: 0, claves_graves: [],
    consultas_6m: 0, alertas: [], cuenta_mas_antigua: null,
    banderas: [], defuncion: false, rfc_no_coincide: false,
    historia_negativa: 0, cuentas_cobranza: 0, consultas_cobranza: 0,
    mop96: 0, mop97: 0, mop99: 0, declaraciones: false
  };

  try {
    const per = lista(payload && payload.return && payload.return.Personas, 'Persona')[0];
    if (!per) return base;
    base.ok = true;

    const n = per.Nombre || {};
    base.titular = [n.PrimerNombre, n.SegundoNombre, n.ApellidoPaterno, n.ApellidoMaterno]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    base.rfc = n.RFC || '';

    const sc = leeScore(per);
    base.score = sc.score;
    base.score_texto = sc.texto;
    base.razones = sc.razones;

    const cuentas = lista(per.Cuentas, 'Cuenta');
    base.cuentas = cuentas.length;
    base.peor_mop = peorMOP(cuentas);
    base.claves_graves = tieneClaveGrave(cuentas);

    cuentas.forEach(c => {
      const venc = monto(c.SaldoVencido);
      const pagosVenc = entero(c.NumeroPagosVencidos);
      if (venc > 0 || pagosVenc > 0) base.cuentas_atraso++;
    });

    /* El resumen que manda Buró es más confiable que sumar cuenta por cuenta */
    const r = lista(per.ResumenReporte, 'ResumenReporte')[0];
    if (r) {
      base.cuentas = entero(r.NumeroCuentas) || base.cuentas;
      base.cuentas_cerradas = entero(r.CuentasCerradas);
      base.cuentas_negativas = entero(r.CuentasNegativasActuales);
      base.saldo_revolvente = monto(r.TotalSaldosActualesRevolventes);
      base.saldo_fijos = monto(r.TotalSaldosActualesPagosFijos);
      base.vencido_revolvente = monto(r.TotalSaldosVencidosRevolventes);
      base.vencido_fijos = monto(r.TotalSaldosVencidosPagosFijos);
      base.consultas_6m = entero(r.NumeroSolicitudesUltimos6Meses);
      base.historia_negativa = entero(r.CuentasClavesHistoriaNegativa);
      base.cuentas_cobranza = entero(r.NumeroTotalCuentasDespachoCobranza);
      base.consultas_cobranza = entero(r.NumeroTotalSolicitudesDespachosCobranza);
      base.mop96 = entero(r.NumeroMOP96);
      base.mop97 = entero(r.NumeroMOP97);
      base.mop99 = entero(r.NumeroMOP99);
      base.declaraciones = String(r.ExistenciaDeclaracionesConsumidor || '').toUpperCase() === 'Y';
      base.banderas = leeMensajesAlerta(r.MensajesAlerta);
      base.defuncion = base.banderas.some(b => b.posicion === 1);
      base.rfc_no_coincide = base.banderas.some(b => b.posicion === 2);
      const p = entero(r.PctLimiteCreditoUtilizadoRevolventes);
      base.pct_uso = r.PctLimiteCreditoUtilizadoRevolventes ? p : null;
      base.cuenta_mas_antigua = fechaBuro(r.FechaAperturaCuentaMasAntigua);

      /* Si el resumen no marcó cuentas negativas pero sí hay MOP altos */
      const mopMalos = ['NumeroMOP2', 'NumeroMOP3', 'NumeroMOP4',
        'NumeroMOP5', 'NumeroMOP6', 'NumeroMOP7']
        .reduce((a, k) => a + entero(r[k]), 0);
      if (mopMalos > base.cuentas_atraso) base.cuentas_atraso = mopMalos;
    }

    base.saldo_total = base.saldo_revolvente + base.saldo_fijos;
    base.vencido_total = base.vencido_revolvente + base.vencido_fijos;

    /* Alertas: el nodo de consulta usa HawkAlertC, el de base HawkAlertBD */
    lista(per.HawkAlertConsulta, 'HawkAlertC').forEach(a => {
      base.alertas.push({ origen: 'consulta', clave: a.CodigoClave || '', mensaje: a.Mensaje || '' });
    });
    lista(per.HawkAlertBD, 'HawkAlertBD').forEach(a => {
      base.alertas.push({ origen: 'base', clave: a.CodigoClave || '', mensaje: a.Mensaje || '' });
    });
  } catch (e) {
    base.error_lectura = e.message;
  }

  return base;
}

/**
 * Semáforo sugerido. Es una propuesta: el dictamen final lo pone la persona.
 */
function semaforoSugerido(r) {
  const razones = [];
  let sem = 'verde';

  if (r.defuncion) {
    razones.push('ALERTA: Buró reporta fecha de defunción');
    sem = 'rojo';
  }
  if (r.rfc_no_coincide) {
    razones.push('El RFC no coincide con el de Buró: verificar identidad');
    if (sem !== 'rojo') sem = 'ambar';
  }
  if (r.cuentas_cobranza > 0) {
    razones.push(r.cuentas_cobranza + ' cuenta(s) en despacho de cobranza');
    sem = 'rojo';
  }
  if (r.mop96 > 0) { razones.push(r.mop96 + ' crédito(s) marcados como fraude'); sem = 'rojo'; }
  if (r.mop97 > 0) { razones.push(r.mop97 + ' crédito(s) en cobranza judicial'); sem = 'rojo'; }
  if (r.mop99 > 0) { razones.push(r.mop99 + ' crédito(s) considerados irrecuperables'); sem = 'rojo'; }
  if (r.historia_negativa > 0) {
    razones.push(r.historia_negativa + ' cuenta(s) hoy al corriente pero con atrasos en su historia');
    if (sem === 'verde') sem = 'ambar';
  }
  if (r.claves_graves && r.claves_graves.length) {
    const quitas = r.claves_graves.filter(g => g.observacion === 'LC');
    const vendidas = r.claves_graves.filter(g => g.observacion === 'CV');
    const fraude = r.claves_graves.filter(g => g.observacion === 'FN' || g.observacion === 'FD');
    const judicial = r.claves_graves.filter(g => g.mop === 97 || g.mop === 99);
    const yaContado = (r.mop96 + r.mop97 + r.mop99) > 0;
    if (fraude.length && !yaContado) razones.push('Cuenta marcada como fraude en Buró');
    if (judicial.length && !yaContado) razones.push(judicial.length + ' crédito(s) en cobranza judicial');
    if (quitas.length) razones.push(quitas.length + ' crédito(s) con quita: el otorgante perdonó parte de la deuda');
    if (vendidas.length) razones.push(vendidas.length + ' crédito(s) con cartera vendida a un despacho');
    if (!fraude.length && !judicial.length && !quitas.length && !vendidas.length && !yaContado) {
      razones.push('Cuentas con clave de observación de deterioro');
    }
    sem = 'rojo';
  }
  if (r.vencido_total > 0) {
    razones.push('Saldo vencido de $' + r.vencido_total.toLocaleString('es-MX'));
    sem = 'rojo';
  }
  if (r.cuentas_negativas > 0) {
    razones.push(r.cuentas_negativas + ' cuenta(s) negativa(s) actuales');
    if (sem !== 'rojo') sem = 'rojo';
  }
  if (r.peor_mop >= 4) {
    razones.push('Atraso histórico grave (MOP ' + r.peor_mop + ')');
    if (sem !== 'rojo') sem = 'rojo';
  } else if (r.peor_mop >= 2) {
    razones.push('Atrasos históricos moderados (MOP ' + r.peor_mop + ')');
    if (sem === 'verde') sem = 'ambar';
  }
  if (r.score !== null && r.score < 600) {
    razones.push('Score bajo (' + r.score + ')');
    if (sem === 'verde') sem = 'ambar';
  }
  if (r.score === null) {
    razones.push('Sin score de Buró');
    if (sem === 'verde') sem = 'ambar';
  }
  if (r.pct_uso !== null && r.pct_uso > 100) {
    razones.push('Sobregirado: usa el ' + r.pct_uso + '% de su límite de crédito');
    sem = 'rojo';
  } else if (r.pct_uso !== null && r.pct_uso >= 80) {
    razones.push('Usa el ' + r.pct_uso + '% de su límite de crédito');
    if (sem === 'verde') sem = 'ambar';
  }
  if (r.consultas_6m >= 6) {
    razones.push(r.consultas_6m + ' consultas en los últimos 6 meses');
    if (sem === 'verde') sem = 'ambar';
  }
  if (!razones.length) razones.push('Sin atrasos ni saldos vencidos');

  return { semaforo: sem, razones: razones };
}

module.exports = { resumeReporte, semaforoSugerido, monto, entero, fechaBuro, leeMensajesAlerta, POS_ALERTA, OBSERVACION };

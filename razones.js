/* ============================================================
   Claves de razón y exclusión del BC Score (Buró de Crédito).
   Buró entrega hasta 3 claves por score, de la más a la menos grave.
   Cada clave explica qué le BAJA puntos al expediente.
   Descripciones redactadas para el evaluador (no son texto oficial).
   ============================================================ */

'use strict';

/* BC Score (versión anterior, claves 001–061) */
const RAZON_CLASICA = {
  '001': 'Nivel de deuda elevado.',
  '002': 'Nivel de deuda elevado en sus cuentas.',
  '003': 'Nivel de deuda elevado en tarjetas y créditos revolventes.',
  '004': 'Lo consultaron recientemente otras instituciones.',
  '005': 'Tiene un pago vencido reciente.',
  '007': 'Tiene cuentas abiertas con atraso.',
  '008': 'Aumentaron sus cuentas con deuda.',
  '009': 'Sus créditos abiertos son recientes (poca antigüedad promedio).',
  '010': 'Sus créditos abiertos son recientes (poca antigüedad promedio).',
  '011': 'Sus créditos en tiendas son recientes.',
  '012': 'Usa tipos de crédito considerados de mayor riesgo.',
  '013': 'Número de cuentas abiertas desfavorable.',
  '014': 'Mezcla desfavorable entre tarjetas y créditos a plazo.',
  '015': 'Usa buena parte del límite de sus tarjetas.',
  '016': 'Abrió una cuenta hace poco.',
  '017': 'Su último atraso es reciente.',
  '018': 'Su cuenta más antigua es relativamente nueva.',
  '019': 'Su tarjeta más antigua es relativamente nueva.',
  '020': 'Proporción alta de cuentas con atraso frente a cuentas sanas.',
  '021': 'Atrasos frecuentes o recientes.',
  '022': 'Aumentaron las consultas a su expediente.',
  '023': 'Aumentaron las consultas en los últimos 4 años.',
  '024': 'Tiene créditos con atraso importante.',
  '025': 'Tiene muchas cuentas abiertas.',
  '026': 'Muchas consultas recientes de otras instituciones.',
  '027': 'Varios créditos cerrados.',
  '028': 'Sus saldos están cerca de su crédito máximo.',
  '029': 'Abrió muchas cuentas en los últimos 2 años.',
  '031': 'Atrasos frecuentes o recientes.',
  '032': 'Proporción desfavorable entre experiencias con y sin atraso.',
  '033': 'Usa tipos de crédito considerados de mayor riesgo.',
  '034': 'Tiene cuentas con atraso reciente.',
  '055': 'Tiene créditos con atraso.',
  '056': 'Tiene créditos nuevos con atraso.',
  '057': 'Tiene historial de atrasos.',
  '058': 'Tiene créditos con atraso.',
  '059': 'Tiene créditos con atraso de más de 90 días.',
  '060': 'Tiene créditos con atraso de más de 90 días.',
  '061': 'Tiene créditos con atraso de más de 90 días.'
};

/* Claves positivas de la versión anterior */
const RAZON_POSITIVA = {
  '051': 'Paga adecuadamente sus créditos.',
  '052': 'Paga adecuadamente sus créditos.',
  '053': 'Paga adecuadamente sus créditos.',
  '054': 'Paga adecuadamente sus créditos.'
};

/* BC Score 2022 (claves 301–371). Gravedad: 3 = alta, 2 = media, 1 = baja */
const RAZON_2022 = {
  '301': [3, 'Todas sus cuentas tienen quebranto (deuda castigada).'],
  '302': [3, 'Todas sus cuentas al día muestran atraso de más de 60 días en los últimos 6 meses.'],
  '303': [3, 'Tres o más otorgantes reportan atraso de 60+ días en los últimos 3 meses.'],
  '304': [3, 'Varias cuentas con atraso de más de 90 días en los últimos 2 años.'],
  '305': [3, 'Atraso de 90+ días este mes o el anterior, sin reportes entre los meses 3 y 24.'],
  '306': [3, 'Tiene cuentas castigadas recientemente.'],
  '307': [3, 'Tiene cuentas castigadas hace más de 3 meses.'],
  '308': [2, 'Deuda alta en créditos a plazo.'],
  '309': [2, 'Usa en promedio más del 30% de sus tarjetas bancarias (últimos 2 años).'],
  '310': [1, 'Solo una cuenta reportada en los últimos 3 meses (y no es de servicios).'],
  '311': [3, 'La mayoría de sus cuentas tiene atraso de más de 30 días en los últimos 3 meses.'],
  '312': [1, 'Muy pocas cuentas con bancos en los últimos 2 años.'],
  '313': [3, 'Cuentas de teléfono o servicios recientes con atraso de 90+ días.'],
  '314': [1, 'Su historial de crédito tiene menos de 2 años.'],
  '315': [3, 'Tiene cuentas con 90+ días de atraso en los últimos 2 meses.'],
  '316': [3, 'Cuentas con atraso alto o sin actualizar en los últimos 6 meses.'],
  '317': [3, 'Al menos una cuenta castigada y el resto con atraso o sin actualizar.'],
  '318': [2, 'La mayoría de sus créditos tuvo atraso de más de 30 días en los últimos 2 años.'],
  '319': [3, 'Créditos con atraso de más de 60 días en los últimos 3 meses.'],
  '320': [1, 'Sus cuentas son más nuevas que el promedio.'],
  '321': [2, 'Uso alto de créditos que no son tarjeta en los últimos 3 meses.'],
  '322': [2, 'Uso alto de sus tarjetas de crédito en los últimos 3 meses.'],
  '323': [2, 'Más de una cuenta con atraso de 60+ días en los últimos 2 años.'],
  '324': [2, 'Más de una institución reportó atraso de 60+ días en los últimos 2 años.'],
  '325': [2, 'Tiene cuentas con 90+ días de atraso en los últimos 2 años.'],
  '326': [2, 'Atrasos de 90+ días en 2 años y cuentas abiertas en los últimos 18 meses.'],
  '327': [2, 'Sin actualizaciones recientes, pero con atrasos en los últimos 2 años.'],
  '328': [2, 'Alguna cuenta con más de 30 días de atraso en los últimos 3 meses.'],
  '329': [1, 'Todas sus cuentas tienen menos de un año.'],
  '330': [2, 'Muchas consultas de distintas instituciones en el último año.'],
  '331': [1, 'Sin tarjetas en 6 años y uso alto de otros créditos.'],
  '332': [1, 'Usa más del 25% de sus tarjetas de crédito.'],
  '333': [2, 'Dos o más cuentas bancarias con atraso.'],
  '334': [2, 'Uso alto de cuentas bancarias en los últimos 3 meses.'],
  '335': [1, 'Al menos un atraso ligero en los últimos 12 meses.'],
  '336': [1, 'Al menos un atraso ligero en los últimos 6 meses.'],
  '337': [1, 'Al menos un atraso ligero en los últimos 7 meses.'],
  '338': [2, 'Cuentas con más de 30 días de atraso en los últimos 2 años.'],
  '339': [1, 'Uso alto de sus tarjetas de crédito.'],
  '340': [2, 'Atrasos de 30+ días en 2 años y muchas tarjetas abiertas.'],
  '341': [1, 'Poco historial con otorgantes que no son de servicios.'],
  '342': [3, 'Cuentas bancarias con atraso de 60 días o más.'],
  '343': [2, 'Al menos una cuenta no bancaria con atraso de 30+ días.'],
  '344': [1, 'Cuentas inactivas o sin cuentas bancarias.'],
  '345': [1, 'Sin tarjetas abiertas y sin pagos en más de 18 meses.'],
  '346': [2, 'Sin tarjetas abiertas y deuda alta en créditos a plazo.'],
  '347': [1, 'Uso promedio alto de sus tarjetas y créditos revolventes.'],
  '348': [1, 'Sus cuentas tienen menos de 30 meses.'],
  '349': [1, 'Tiene cuentas en varias instituciones.'],
  '350': [1, 'Primera consulta para tarjeta en los últimos 4 años.'],
  '351': [1, 'Abrió créditos a plazo en los últimos 12 meses.'],
  '352': [1, 'La mayoría de sus tarjetas se abrió en los últimos 18 meses.'],
  '353': [1, 'Sin consultas y algunos atrasos menores a 30 días en 2 años.'],
  '354': [1, 'La mayoría de las consultas fueron en los últimos 6 meses.'],
  '355': [1, 'Abrió cuentas de servicios o telefonía en los últimos 2 años.'],
  '356': [1, 'Abrió préstamos personales en los últimos 2 años.'],
  '357': [2, 'Cuentas con nivel de deuda alto.'],
  '358': [1, 'Abrió muchas cuentas en los últimos 2 años.'],
  '359': [1, 'Abrió tarjetas de crédito en los últimos 3 años.'],
  '360': [1, 'Tiene muchos tipos distintos de crédito.'],
  '361': [2, 'Tarjetas casi al límite.'],
  '362': [1, 'Algunas tarjetas sin actualizar en los últimos 3 meses.'],
  '363': [1, 'Tarjetas y revolventes con uso alto.'],
  '364': [2, 'Uso alto en todas sus cuentas activas (últimos 3 meses).'],
  '365': [1, 'Varias instituciones han consultado su expediente.'],
  '366': [1, 'Tarjetas sin actualizar en los últimos 6 años.'],
  '367': [1, 'Saldo promedio alto en sus tarjetas.'],
  '368': [1, 'Abrió una cuenta nueva en los últimos 12 meses.'],
  '369': [2, 'Sus cuentas muestran saldos altos.'],
  '370': [1, 'Cuentas bancarias sin actualizar en los últimos 6 años.'],
  '371': [2, 'Uso alto de tarjetas y revolventes bancarios.']
};

/* Exclusiones: Buró no calcula score */
const EXCLUSION = {
  '-001': 'Buró reporta al consumidor como fallecido. Verificar identidad antes de continuar.',
  '-005': 'Todas sus cuentas están cerradas y al menos una tuvo atraso de 90+ días.',
  '-006': 'Todas sus cuentas tienen menos de 6 meses y alguna tiene atraso (MOP 03 o más).',
  '-007': 'Todas sus cuentas tienen menos de 6 meses y alguna tiene atraso (MOP 02 o más).',
  '-008': 'Información insuficiente: no hay cuentas recientes o con antigüedad mínima para calcular score.',
  '-009': 'El expediente no tiene cuentas que sirvan para calcular el score.'
};

/* Bandas de referencia interna sobre la escala 456–760 */
const BANDAS = [
  { min: 456, max: 549, nombre: 'Riesgo alto', color: '#C0392B',
    texto: 'Probabilidad de incumplimiento alta. Solo con garantía, aval sólido o monto muy bajo.' },
  { min: 550, max: 619, nombre: 'Riesgo medio-alto', color: '#E67E22',
    texto: 'Historial con señales de atraso. Monto conservador y verificar capacidad de pago.' },
  { min: 620, max: 679, nombre: 'Riesgo moderado', color: '#D4AC0D',
    texto: 'Perfil aceptable con algunas debilidades. Evaluar ingreso y referencias.' },
  { min: 680, max: 719, nombre: 'Buen perfil', color: '#27AE60',
    texto: 'Buen manejo de crédito. Riesgo bajo para montos habituales.' },
  { min: 720, max: 760, nombre: 'Perfil excelente', color: '#1E7A45',
    texto: 'Historial muy sólido. Riesgo mínimo.' }
];

function clave3(v) {
  const s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return '';
  if (/^-/.test(s)) return '-' + s.replace(/\D/g, '').padStart(3, '0');
  return s.replace(/\D/g, '').padStart(3, '0');
}

function banda(score) {
  if (score === null || score === undefined || isNaN(score)) return null;
  for (let i = 0; i < BANDAS.length; i++) {
    if (score <= BANDAS[i].max) return BANDAS[i];
  }
  return BANDAS[BANDAS.length - 1];
}

/* Describe una clave de razón */
function describe(clave) {
  const k = clave3(clave);
  if (RAZON_2022[k]) return { clave: k, gravedad: RAZON_2022[k][0], texto: RAZON_2022[k][1], positiva: false };
  if (RAZON_POSITIVA[k]) return { clave: k, gravedad: 0, texto: RAZON_POSITIVA[k], positiva: true };
  if (RAZON_CLASICA[k]) return { clave: k, gravedad: 2, texto: RAZON_CLASICA[k], positiva: false };
  if (EXCLUSION[k]) return { clave: k, gravedad: 3, texto: EXCLUSION[k], positiva: false };
  return { clave: k, gravedad: 1, texto: 'Clave ' + k + ' sin descripción en el catálogo.', positiva: false };
}

/**
 * Interpretación para el evaluador.
 * lectura: resultado de resumeReporte. ev: evaluación interna (opcional).
 */
function interpretaScore(lectura, ev) {
  const r = lectura || {};
  const score = (r.score === null || r.score === undefined) ? null : Number(r.score);
  const b = banda(score);
  const soloScore = r.origen === 'prospector' || (!r.cuentas && !r.cuentas_cerradas);
  const claves = (r.claves_razon || []).map(describe);
  const enContra = claves.filter(function (c) { return !c.positiva; });
  const aFavor = claves.filter(function (c) { return c.positiva; }).map(function (c) { return c.texto; });

  /* Señales del detalle de cuentas, solo si es reporte completo */
  if (!soloScore && ev) {
    (ev.a_favor || []).forEach(function (t) { if (aFavor.indexOf(t) < 0) aFavor.push(t); });
  }
  const extraContra = (!soloScore && ev) ? (ev.en_contra || []) : [];

  /* A favor que se deduce del propio score y de las claves */
  if (b && score >= 680 && !aFavor.length) aFavor.push('Score en rango ' + b.nombre.toLowerCase() + '.');
  const graves = enContra.filter(function (c) { return c.gravedad >= 3; });
  if (enContra.length && !graves.length) aFavor.push('Ninguna de las claves indica atraso grave o quebranto.');
  if (!enContra.some(function (c) { return /castig|quebranto/i.test(c.texto); }) && score !== null) {
    aFavor.push('Buró no señala cuentas castigadas.');
  }

  let resumen;
  if (score === null) {
    const crudo = r.score_clave || ((r.score_texto || '').match(/-0?\d+/) || [''])[0];
    const d = crudo ? describe(crudo) : null;
    resumen = d && EXCLUSION[d.clave] ? d.texto
      : 'Buró no calculó score para este expediente.';
  } else {
    resumen = 'Score ' + score + ': ' + b.nombre.toLowerCase() + '. ' + b.texto;
    if (enContra.length) {
      resumen += ' Lo que más le pesa: ' + enContra[0].texto.replace(/\.$/, '').toLowerCase() + '.';
    }
  }

  return {
    score: score,
    banda: b ? b.nombre : 'Sin score',
    color: b ? b.color : '#6B7A88',
    resumen: resumen,
    en_contra: enContra,
    en_contra_cuentas: extraContra,
    a_favor: aFavor,
    solo_score: soloScore,
    nota: soloScore
      ? 'Consulta de score: Buró no entrega el detalle de cuentas. Las claves describen el expediente completo.'
      : ''
  };
}

module.exports = { interpretaScore, describe, banda, BANDAS, EXCLUSION };

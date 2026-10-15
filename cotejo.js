/* ============================================================
   Cotejo: lo que capturó el operador contra lo que tiene Buró.
   Funciona con la consulta de score (Prospector) y con el reporte completo.
   ============================================================ */

'use strict';

const { normaliza } = require('./buro');

function lista(nodo, llave) {
  if (!nodo) return [];
  const v = llave ? nodo[llave] : nodo;
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/* Mayúsculas, sin acentos, sin signos, espacios simples */
function norm(v) {
  return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* Fecha a AAAA-MM-DD. Buró manda DDMMAAAA */
function fechaISO(v) {
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{8}$/.test(s)) return s.slice(4) + '-' + s.slice(2, 4) + '-' + s.slice(0, 2);
  return '';
}
function fechaTxt(iso) {
  return iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '';
}

/* Palabras en común: tolera abreviaturas y orden distinto */
function parecido(a, b) {
  const A = norm(a).split(' ').filter(function (w) { return w.length > 2; });
  const B = norm(b).split(' ').filter(function (w) { return w.length > 2; });
  if (!A.length || !B.length) return 0;
  const comunes = A.filter(function (w) { return B.indexOf(w) >= 0; }).length;
  return comunes / Math.min(A.length, B.length);
}

function fila(campo, capturado, buro, estado, nota) {
  return { campo: campo, capturado: capturado || '', buro: buro || '', estado: estado, nota: nota || '' };
}

/* estado: coincide | difiere | parcial | no_comparable | sin_dato */
function compara(campo, cap, bur, opciones) {
  const op = opciones || {};
  if (!cap && !bur) return fila(campo, '', '', 'sin_dato', 'Sin dato en ambos');
  if (!bur) return fila(campo, cap, '', 'sin_dato', op.notaSinBuro || 'Buró no lo reporta');
  if (!cap) return fila(campo, '', bur, 'sin_dato', 'No se capturó');
  if (op.exacto) {
    return norm(cap) === norm(bur) ? fila(campo, cap, bur, 'coincide')
      : fila(campo, cap, bur, 'difiere', op.notaDifiere || '');
  }
  const p = parecido(cap, bur);
  if (norm(cap) === norm(bur) || p >= 0.99) return fila(campo, cap, bur, 'coincide');
  if (p >= 0.5) return fila(campo, cap, bur, 'parcial', 'Coincide en parte');
  return fila(campo, cap, bur, 'difiere', op.notaDifiere || '');
}

/**
 * sol: la solicitud (lo capturado). payload: respuesta de Moffin.
 * claveEstado: convierte "Veracruz" → "VER" (la de server.js).
 */
function cotejo(sol, payload, claveEstado) {
  const s = sol || {};
  const p = normaliza(payload) || {};
  const esScore = p.origen === 'prospector';
  const per = lista(p.return && p.return.Personas, 'Persona')[0] || {};
  const n = per.Nombre || {};
  const doms = lista(per.Domicilios, 'Domicilio');
  const d = doms[0] || {};
  const j = (payload && payload.json) || {};
  const filas = [];
  const alertas = [];

  /* Identidad */
  filas.push(compara('Nombre(s)', s.nombre, [n.PrimerNombre, n.SegundoNombre].filter(Boolean).join(' ')));
  filas.push(compara('Apellido paterno', s.apellido_p, n.ApellidoPaterno, { exacto: true }));
  if (esScore) {
    filas.push(fila('Apellido materno', s.apellido_m, '', 'no_comparable',
      'No se envía en consulta de score'));
  } else {
    filas.push(compara('Apellido materno', s.apellido_m, n.ApellidoMaterno, { exacto: true }));
  }
  const fnCap = fechaISO(s.fecha_nac), fnBur = fechaISO(n.FechaNacimiento);
  filas.push(compara('Fecha de nacimiento', fechaTxt(fnCap), fechaTxt(fnBur),
    { exacto: true, notaDifiere: 'Revisar identidad' }));
  const rfcCap = norm(s.rfc), rfcBur = norm(n.RFC);
  if (rfcCap && rfcBur && rfcCap !== rfcBur && rfcCap.slice(0, 10) === rfcBur.slice(0, 10)) {
    filas.push(fila('RFC', s.rfc, n.RFC, 'parcial', 'Misma base, distinta homoclave'));
  } else {
    filas.push(compara('RFC', s.rfc, n.RFC, { exacto: true, notaDifiere: 'Revisar identidad' }));
  }
  filas.push(compara('CURP', s.curp, n.CURP || n.CURPConsumidor,
    { exacto: true, notaDifiere: 'Revisar identidad', notaSinBuro: 'Buró no la reporta' }));

  /* Domicilio */
  filas.push(compara('Calle y número', s.calle, [d.Direccion1, d.Direccion2].filter(Boolean).join(' ')));
  filas.push(compara('Colonia', s.colonia, d.ColoniaPoblacion));
  filas.push(compara('Municipio', s.municipio, d.DelegacionMunicipio || d.Ciudad));
  const edoCap = claveEstado ? claveEstado(s.estado_dom) : norm(s.estado_dom);
  const edoBur = norm(d.Estado);
  if (s.estado_dom || d.Estado) {
    filas.push(edoCap && edoBur
      ? fila('Estado', s.estado_dom, d.Estado, edoCap === edoBur ? 'coincide' : 'difiere',
          edoCap === edoBur ? '' : 'Otro estado')
      : compara('Estado', s.estado_dom, d.Estado));
  }
  filas.push(compara('Código postal', (s.cp || '').replace(/\D/g, ''), (d.CP || '').replace(/\D/g, ''),
    { exacto: true }));

  /* Teléfono: solo el reporte completo lo trae por domicilio */
  const telBur = doms.map(function (x) { return String(x.NumeroTelefono || '').replace(/\D/g, ''); })
    .filter(Boolean);
  const telCap = String(s.telefono || '').replace(/\D/g, '');
  if (esScore) {
    filas.push(fila('Teléfono', telCap, '', 'no_comparable', 'No viene en consulta de score'));
  } else if (!telBur.length) {
    filas.push(fila('Teléfono', telCap, '', 'sin_dato', 'Buró no tiene teléfono registrado'));
  } else {
    const ok = telBur.some(function (t) { return t.slice(-8) === telCap.slice(-8); });
    filas.push(fila('Teléfono', telCap, telBur.join(', '), ok ? 'coincide' : 'difiere',
      ok ? '' : 'No coincide con los registrados'));
  }

  /* Alertas para el evaluador */
  const dif = function (c) { return filas.some(function (f) { return f.campo === c && f.estado === 'difiere'; }); };
  if (dif('Fecha de nacimiento') || dif('CURP') || dif('RFC')) {
    alertas.push('Los datos de identidad no coinciden con Buró: verificar INE antes de continuar.');
  }
  if (dif('Estado')) alertas.push('El domicilio en Buró está en otro estado que el capturado.');
  else if (dif('Código postal') || dif('Municipio')) alertas.push('El domicilio en Buró no coincide con el capturado.');

  const encontrado = j.header ? j.header.wasFound !== '0' : (per && Object.keys(per).length > 0);
  if (!encontrado) alertas.push('Buró no encontró expediente para esta persona.');

  const resumen = { coincide: 0, parcial: 0, difiere: 0 };
  filas.forEach(function (f) { if (resumen[f.estado] !== undefined) resumen[f.estado]++; });

  return {
    filas: filas,
    alertas: alertas,
    resumen: resumen,
    domicilios: doms.map(function (x) {
      return {
        calle: [x.Direccion1, x.Direccion2].filter(Boolean).join(' '),
        colonia: x.ColoniaPoblacion || '', municipio: x.DelegacionMunicipio || '',
        ciudad: x.Ciudad || '', estado: x.Estado || '', cp: x.CP || '',
        telefono: x.NumeroTelefono || '', desde: fechaTxt(fechaISO(x.FechaResidencia || x.FechaRegistroDomicilio))
      };
    }),
    consulta: {
      encontrado: encontrado,
      control_bc: (j.fileEnd && j.fileEnd.controlNumber) || '',
      modelo: (j.score && j.score.name) ? j.score.name + (j.score.code ? ' (' + j.score.code + ')' : '') : '',
      pais: (j.name && j.name.countryKey) || '',
      nacionalidad: (j.name && j.name.nationality) || '',
      tipo: esScore ? 'Score (Prospector)' : 'Reporte completo'
    }
  };
}

module.exports = { cotejo };

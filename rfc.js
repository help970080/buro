/* ============================================================
   Cálculo de RFC de persona física (algoritmo del SAT)
   - Si hay CURP válida, los primeros 10 caracteres se toman de ella
     (son idénticos por construcción y ya traen las reglas del SAT
     aplicadas: vocal interna, palabras ignoradas, altisonantes).
   - Si no hay CURP, se derivan del nombre y la fecha.
   - Homoclave (2) y dígito verificador (1) siempre se calculan.
   IMPORTANTE: el resultado es una SUGERENCIA. El SAT puede haber
   asignado algo distinto en casos de homonimia o corrección.
   ============================================================ */

'use strict';

const VAL_HOMO = {
  ' ': '00', '0': '00', '1': '01', '2': '02', '3': '03', '4': '04', '5': '05',
  '6': '06', '7': '07', '8': '08', '9': '09', '&': '10', 'A': '11', 'B': '12',
  'C': '13', 'D': '14', 'E': '15', 'F': '16', 'G': '17', 'H': '18', 'I': '19',
  'J': '21', 'K': '22', 'L': '23', 'M': '24', 'N': '25', 'O': '26', 'P': '27',
  'Q': '28', 'R': '29', 'S': '32', 'T': '33', 'U': '34', 'V': '35', 'W': '36',
  'X': '37', 'Y': '38', 'Z': '39', 'Ñ': '40'
};

const TABLA_HOMO = '123456789ABCDEFGHIJKLMNPQRSTUVWXYZ'; // 34 caracteres

const VAL_DV = {
  '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  'A': 10, 'B': 11, 'C': 12, 'D': 13, 'E': 14, 'F': 15, 'G': 16, 'H': 17, 'I': 18,
  'J': 19, 'K': 20, 'L': 21, 'M': 22, 'N': 23, '&': 24, 'O': 25, 'P': 26, 'Q': 27,
  'R': 28, 'S': 29, 'T': 30, 'U': 31, 'V': 32, 'W': 33, 'X': 34, 'Y': 35, 'Z': 36,
  ' ': 37, 'Ñ': 38
};

/* Palabras que el SAT ignora al armar las siglas */
const IGNORAR = ['DE', 'LA', 'LAS', 'LOS', 'DEL', 'Y', 'MC', 'MAC', 'VAN', 'VON',
  'EL', 'A', 'SA', 'SS', 'E'];

/* Nombres que se omiten si hay un segundo nombre */
const NOMBRE_COMUN = ['MARIA', 'JOSE', 'MA', 'MA.', 'J', 'J.'];

/* Combinaciones que el SAT sustituye por decoro */
const ALTISONANTES = {
  BACA: 'BXCA', BAKA: 'BXKA', BUEI: 'BUEX', BUEY: 'BUEX', CACA: 'CXCA',
  CACO: 'CXCO', CAGA: 'CXGA', CAGO: 'CXGO', CAKA: 'CXKA', CAKO: 'CXKO',
  COGE: 'CXGE', COGI: 'CXGI', COJA: 'CXJA', COJE: 'CXJE', COJI: 'CXJI',
  COJO: 'CXJO', COLA: 'CXLA', CULO: 'CXLO', FALO: 'FXLO', FETO: 'FXTO',
  GETA: 'GXTA', GUEI: 'GUEX', GUEY: 'GUEX', JOTO: 'JXTO', KACA: 'KXCA',
  KACO: 'KXCO', KAGA: 'KXGA', KAGO: 'KXGO', KAKA: 'KXKA', KAKO: 'KXKO',
  KOGE: 'KXGE', KOGI: 'KXGI', KOJA: 'KXJA', KOJE: 'KXJE', KOJI: 'KXJI',
  KOJO: 'KXJO', KOLA: 'KXLA', KULO: 'KXLO', LILO: 'LXLO', LOCA: 'LXCA',
  LOCO: 'LXCO', LOKA: 'LXKA', LOKO: 'LXKO', MAME: 'MXME', MAMO: 'MXMO',
  MEAR: 'MXAR', MEAS: 'MXAS', MEON: 'MXON', MIAR: 'MXAR', MION: 'MXON',
  MOCO: 'MXCO', MOKO: 'MXKO', MULA: 'MXLA', MULO: 'MXLO', NACA: 'NXCA',
  NACO: 'NXCO', PEDA: 'PXDA', PEDO: 'PXDO', PENE: 'PXNE', PIPI: 'PXPI',
  PITO: 'PXTO', POPO: 'PXPO', PUTA: 'PXTA', PUTO: 'PXTO', QULO: 'QXLO',
  RATA: 'RXTA', ROBA: 'RXBA', ROBE: 'RXBE', ROBO: 'RXBO', RUIN: 'RXIN',
  SENO: 'SXNO', TETA: 'TXTA', VACA: 'VXCA', VAGA: 'VXGA', VAGO: 'VXGO',
  VAKA: 'VXKA', VUEI: 'VUEX', VUEY: 'VUEX', WUEI: 'WUEX', WUEY: 'WUEX'
};

function limpia(s) {
  return (s || '').toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // quita acentos
    .replace(/[^A-Za-zÑñ&\s]/g, ' ')   // deja solo letras, Ñ y &
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .replace(/N~/g, 'Ñ');
}

/* Quita las palabras que el SAT ignora, salvo que quede vacío */
function palabrasUtiles(s) {
  const p = limpia(s).split(' ').filter(Boolean);
  const f = p.filter(x => IGNORAR.indexOf(x) < 0);
  return f.length ? f : p;
}

function primeraVocalInterna(pal) {
  for (let i = 1; i < pal.length; i++) {
    if ('AEIOU'.indexOf(pal[i]) >= 0) return pal[i];
  }
  return 'X';
}

/* Primeros 4 caracteres a partir del nombre */
function siglas(nombre, apPaterno, apMaterno) {
  const pat = palabrasUtiles(apPaterno);
  const mat = palabrasUtiles(apMaterno);
  let nom = palabrasUtiles(nombre);

  /* Si el primer nombre es común y hay otro, se usa el segundo */
  if (nom.length > 1 && NOMBRE_COMUN.indexOf(nom[0]) >= 0) nom = nom.slice(1);

  const p = pat.join('') ? pat[0] : '';
  const m = mat.join('') ? mat[0] : '';
  const n = nom.length ? nom[0] : '';

  let s;
  if (!p) {
    /* Sin apellido paterno: 2 del materno + 2 del nombre */
    s = (m.substring(0, 2) + n.substring(0, 2)).padEnd(4, 'X');
  } else if (!m) {
    /* Sin apellido materno: 2 del paterno + 2 del nombre */
    s = (p.substring(0, 2) + n.substring(0, 2)).padEnd(4, 'X');
  } else if (p.length < 3) {
    /* Apellido paterno de 1 o 2 letras: 1 de cada uno */
    s = (p[0] + m[0] + n.substring(0, 2)).padEnd(4, 'X');
  } else {
    s = p[0] + primeraVocalInterna(p) + m[0] + n[0];
  }

  s = s.substring(0, 4).replace(/\s/g, 'X');
  return ALTISONANTES[s] || s;
}

function fechaRFC(fechaNac) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((fechaNac || '').trim());
  if (!m) return null;
  return m[1].slice(2) + m[2] + m[3];
}

/* Homoclave: 2 caracteres derivados del nombre completo */
function homoclave(nombre, apPaterno, apMaterno) {
  const completo = limpia(apPaterno) + ' ' + limpia(apMaterno) + ' ' + limpia(nombre);
  let num = '0';
  for (const ch of completo.trim().replace(/\s+/g, ' ')) {
    num += (VAL_HOMO[ch] !== undefined ? VAL_HOMO[ch] : '00');
  }
  let suma = 0;
  for (let i = 0; i < num.length - 1; i++) {
    suma += parseInt(num.substring(i, i + 2), 10) * parseInt(num[i + 1], 10);
  }
  const res = suma % 1000;
  return TABLA_HOMO[Math.floor(res / 34)] + TABLA_HOMO[res % 34];
}

/* Dígito verificador (última posición) */
function digitoVerificador(rfc12) {
  let r = rfc12.toUpperCase();
  /* Persona moral (11 posiciones): se antepone un espacio */
  if (r.length === 11) r = ' ' + r;
  if (r.length !== 12) return null;
  let suma = 0;
  for (let i = 0; i < 12; i++) {
    const v = VAL_DV[r[i]];
    if (v === undefined) return null;
    suma += v * (13 - i);
  }
  const mod = suma % 11;
  if (mod === 0) return '0';
  const d = 11 - mod;
  if (d === 11) return '0';
  if (d === 10) return 'A';
  return String(d);
}

/* Verifica que un RFC completo traiga el dígito correcto */
function verificaRFC(rfc) {
  const r = (rfc || '').toUpperCase().replace(/[\s-]/g, '');
  if (r.length !== 13 && r.length !== 12) return false;
  const dv = digitoVerificador(r.slice(0, -1));
  return dv !== null && dv === r.slice(-1);
}

/**
 * Calcula el RFC sugerido.
 * @param {object} d {nombre, apellido_p, apellido_m, curp, fecha_nac}
 * @returns {object} {rfc, base, homoclave, dv, origen, confianza, aviso}
 */
function calculaRFC(d) {
  const o = d || {};
  const curp = (o.curp || '').toUpperCase().trim();
  let base = null;
  let origen = '';

  if (/^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z\d]\d$/.test(curp)) {
    base = curp.substring(0, 10);
    origen = 'curp';
  } else {
    const f = fechaRFC(o.fecha_nac);
    if (!f) {
      return { rfc: null, error: 'Falta CURP válida o fecha de nacimiento.' };
    }
    if (!limpia(o.nombre) || !limpia(o.apellido_p)) {
      return { rfc: null, error: 'Falta nombre o apellido paterno.' };
    }
    base = siglas(o.nombre, o.apellido_p, o.apellido_m) + f;
    origen = 'nombre';
  }

  const hc = homoclave(o.nombre, o.apellido_p, o.apellido_m);
  const dv = digitoVerificador(base + hc);
  if (!dv) return { rfc: null, error: 'No se pudo calcular el dígito verificador.' };

  return {
    rfc: base + hc + dv,
    base: base,
    homoclave: hc,
    dv: dv,
    origen: origen,
    confianza: origen === 'curp' ? 'alta' : 'media',
    aviso: origen === 'curp'
      ? 'Las primeras 10 posiciones vienen de la CURP. La homoclave es calculada.'
      : 'Calculado desde el nombre. Verifícalo si el cliente tiene su RFC a la mano.'
  };
}

module.exports = { calculaRFC, verificaRFC, digitoVerificador, homoclave, siglas };

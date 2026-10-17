/* ============================================================
   BURÓ — LMV CREDIA S.A. DE C.V.
   Consulta de historial crediticio vía Moffin
   v1.0  ·  buro.legaxia.uk
   ============================================================
   Variables de entorno requeridas en Render:
     DATABASE_URL        postgres://...
     JWT_SECRET          (crypto.randomBytes(48).toString('hex'))
     ADMIN_USER          usuario inicial del equipo
     ADMIN_PASS          contraseña inicial
     MOFFIN_API_KEY      llave de Moffin
     MOFFIN_ENV          sandbox | produccion
     MOFFIN_MOCK         1 = simulado (sin gastar consultas). Default 1.
     CUOTA_MENSUAL       consultas incluidas en el plan. Default 200.
     ANTHROPIC_API_KEY   lectura de INE (opcional)
     IVR_URL             https://ivr.legaxia.uk/api/llamar (opcional)
     IVR_TOKEN           token del bridge (opcional)
   ============================================================ */

const express = require('express');
const { Pool } = require('pg');
const crypto = require('crypto');
const path = require('path');
const { calculaRFC, verificaRFC } = require('./rfc');
const { resumeReporte, semaforoSugerido } = require('./buro');
const { generaPDF, generaHojaBlanco } = require('./comprobante');
const { generaReportePDF } = require('./reporte');
const { generaReporteCredia } = require('./reporte_credia');
const { evalua } = require('./evaluacion');
const { interpretaScore } = require('./razones');
const { cotejo } = require('./cotejo');

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true, limit: '12mb' }));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || '';
const MOFFIN_KEY = process.env.MOFFIN_API_KEY || '';
const MOFFIN_ENV = process.env.MOFFIN_ENV || 'sandbox';
const MOFFIN_MOCK = process.env.MOFFIN_MOCK !== '0';
const CUOTA = parseInt(process.env.CUOTA_MENSUAL || '200', 10);
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const IVR_URL = process.env.IVR_URL || '';
const IVR_TOKEN = process.env.IVR_TOKEN || '';
const CACHE_DIAS = parseInt(process.env.CACHE_DIAS || '90', 10);
const DOCS_KEY = process.env.DOCS_KEY || '';
const MESES_INE = parseInt(process.env.MESES_INE || '6', 10);
const MESES_HOJA = parseInt(process.env.MESES_HOJA || '38', 10);

if (!JWT_SECRET) {
  console.error('FALTA la variable JWT_SECRET en Render. El server no arranca sin ella.');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('FALTA la variable DATABASE_URL en Render. Cópiala de tu base de datos (Internal Database URL).');
  process.exit(1);
}

const MOFFIN_BASE = MOFFIN_ENV === 'produccion'
  ? 'https://app.moffin.mx/api/v1'
  : 'https://sandbox.moffin.mx/api/v1';
/* Código de producto de Buró (opcional). Se cambia desde Render. */
const MOFFIN_PRODUCTO = process.env.MOFFIN_PRODUCTO || '';

/* ---------- Postgres ---------- */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  keepAlive: true,
  max: 6,
  idleTimeoutMillis: 30000
});

pool.on('error', (e) => console.error('pg pool error:', e.message));

async function q(sql, params) {
  let intento = 0;
  for (;;) {
    try {
      return await pool.query(sql, params);
    } catch (e) {
      intento++;
      const recuperable = /terminat|ECONNRESET|timeout|Connection/i.test(e.message || '');
      if (intento >= 3 || !recuperable) throw e;
      await new Promise(r => setTimeout(r, 400 * intento));
    }
  }
}

/* ---------- Utilidades ---------- */
function hoyMX() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}
function mesMX() {
  return hoyMX().slice(0, 7);
}
function digitos(n) {
  let s = '';
  const b = crypto.randomBytes(n);
  for (let i = 0; i < n; i++) s += (b[i] % 10).toString();
  return s;
}
function hashPass(pass, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(pass, s, 32).toString('hex');
  return s + ':' + h;
}
function verificaPass(pass, guardado) {
  if (!guardado || guardado.indexOf(':') < 0) return false;
  const [s, h] = guardado.split(':');
  const calc = crypto.scryptSync(pass, s, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(calc));
}
function b64url(o) {
  return Buffer.from(JSON.stringify(o)).toString('base64url');
}
function firmaJWT(payload, horas) {
  const head = b64url({ alg: 'HS256', typ: 'JWT' });
  const exp = Math.floor(Date.now() / 1000) + (horas * 3600);
  const body = b64url(Object.assign({}, payload, { exp }));
  const mac = crypto.createHmac('sha256', JWT_SECRET).update(head + '.' + body).digest('base64url');
  return head + '.' + body + '.' + mac;
}
function leeJWT(tok) {
  if (!tok) return null;
  const p = tok.split('.');
  if (p.length !== 3) return null;
  const mac = crypto.createHmac('sha256', JWT_SECRET).update(p[0] + '.' + p[1]).digest('base64url');
  if (mac.length !== p[2].length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(p[2]))) return null;
  try {
    const d = JSON.parse(Buffer.from(p[1], 'base64url').toString());
    if (d.exp && d.exp < Math.floor(Date.now() / 1000)) return null;
    return d;
  } catch (e) { return null; }
}
function normNombre(s) {
  return (s || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim().toUpperCase();
}
const CURP_RE = /^[A-Z][AEIOUX][A-Z]{2}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[HM](AS|BC|BS|CC|CL|CM|CS|CH|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QT|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE)[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d$/;

/* ---------- Cifrado de documentos (AES-256-GCM) ---------- */
function docsListo() { return /^[0-9a-fA-F]{64}$/.test(DOCS_KEY); }

function cifra(texto) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', Buffer.from(DOCS_KEY, 'hex'), iv);
  const d = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), d]).toString('base64');
}

function descifra(guardado) {
  const raw = Buffer.from(guardado, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(DOCS_KEY, 'hex'), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

/* ---------- Texto de autorización (Anexo A del contrato Moffin) ---------- */
const PARRAFOS_AUTORIZACION = [
  'Por este conducto autorizo expresamente a "Moffin Software, S.A.P.I. de C.V.", para que por conducto de sus funcionarios facultados lleve a cabo Investigaciones, sobre mi comportamiento crediticio o el de la sociedad que represento en o a través de las bases de datos de "Trans Union de México, S. A., SIC" y/o "Dun & Bradstreet, S.A., SIC".',
  'Asimismo, autorizo expresamente a "Moffin Software, S.A.P.I. de C.V." para que pueda consultar mi historial crediticio con "Trans Union de México, S.A., SIC" y "Dun & Bradstreet, S.A., SIC".',
  'Finalmente, autorizo expresamente para que "Moffin Software, S.A.P.I. de C.V." pueda compartir mis datos con "LMV CREDIA SA DE CV" (el "Usuario").',
  'Asimismo, declaro que conozco la naturaleza y alcance de la información que se solicitará, del uso que "Moffin Software, S.A.P.I. de C.V." hará de tal información y de que ésta podrá realizar consultas periódicas sobre mi historial, consintiendo que esta autorización se encuentre vigente por un período de 3 años contados a partir de su expedición y en todo caso durante el tiempo que se mantenga la relación jurídica entre el Titular de la Información y el Usuario.'
];

function textoAutorizacion() {
  return PARRAFOS_AUTORIZACION.join('\n\n');
}

function hashTexto(t) {
  return crypto.createHash('sha256').update(t).digest('hex');
}

const TEXTO_AUTORIZACION = textoAutorizacion('');
const HASH_AUTORIZACION = hashTexto(TEXTO_AUTORIZACION);

/* ---------- Estados: la API exige clave ISO 3166-2:MX de 3 letras ---------- */
const ESTADOS_VALIDOS = ['AGU','BCN','BCS','CAM','CHP','CHH','CMX','COA','COL','DUR','GUA','GRO',
  'HID','JAL','MEX','MIC','MOR','NAY','NLE','OAX','PUE','QUE','ROO','SLP','SIN','SON','TAB','TAM',
  'TLA','VER','YUC','ZAC'];

const ESTADOS = {
  AGUASCALIENTES: 'AGU', 'BAJA CALIFORNIA': 'BCN', 'BAJA CALIFORNIA SUR': 'BCS',
  CAMPECHE: 'CAM', CHIAPAS: 'CHP', CHIHUAHUA: 'CHH',
  'CIUDAD DE MEXICO': 'CMX', CDMX: 'CMX', 'DISTRITO FEDERAL': 'CMX', DF: 'CMX',
  COAHUILA: 'COA', 'COAHUILA DE ZARAGOZA': 'COA', COLIMA: 'COL', DURANGO: 'DUR',
  GUANAJUATO: 'GUA', GUERRERO: 'GRO', HIDALGO: 'HID', JALISCO: 'JAL',
  'ESTADO DE MEXICO': 'MEX', MEXICO: 'MEX', EDOMEX: 'MEX',
  MICHOACAN: 'MIC', 'MICHOACAN DE OCAMPO': 'MIC', MORELOS: 'MOR', NAYARIT: 'NAY',
  'NUEVO LEON': 'NLE', OAXACA: 'OAX', PUEBLA: 'PUE', QUERETARO: 'QUE',
  'QUINTANA ROO': 'ROO', 'SAN LUIS POTOSI': 'SLP', SINALOA: 'SIN', SONORA: 'SON',
  TABASCO: 'TAB', TAMAULIPAS: 'TAM', TLAXCALA: 'TLA',
  VERACRUZ: 'VER', 'VERACRUZ DE IGNACIO DE LA LLAVE': 'VER', YUCATAN: 'YUC', ZACATECAS: 'ZAC'
};

function claveEstado(v) {
  const t = normNombre(v);
  if (!t) return '';
  if (ESTADOS_VALIDOS.indexOf(t) >= 0) return t;
  if (ESTADOS[t]) return ESTADOS[t];
  const k = Object.keys(ESTADOS).find(x => x.indexOf(t) === 0 || t.indexOf(x) === 0);
  return k ? ESTADOS[k] : '';
}

/* La API rechaza caracteres fuera de su patrón */
function limpiaTexto(v, conNumeros) {
  let t = (v || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  t = conNumeros
    ? t.replace(/[^A-Za-z0-9nN&.\-\s,()\/]/g, ' ')
    : t.replace(/[^A-Za-znN'\s.\-]/g, ' ');
  return t.replace(/\s+/g, ' ').trim().slice(0, 256);
}

/* ---------- Esquema ---------- */
async function initDB() {
  await q(`CREATE TABLE IF NOT EXISTS buro_usuarios (
    id SERIAL PRIMARY KEY,
    usuario TEXT UNIQUE NOT NULL,
    pass TEXT NOT NULL,
    nombre TEXT,
    activo BOOLEAN DEFAULT TRUE,
    creado TIMESTAMPTZ DEFAULT NOW()
  )`);

  await q(`CREATE TABLE IF NOT EXISTS buro_solicitudes (
    id BIGSERIAL PRIMARY KEY,
    folio TEXT UNIQUE NOT NULL,
    codigo TEXT NOT NULL,
    agencia TEXT,
    telefono TEXT,
    nombre TEXT,
    apellido_p TEXT,
    apellido_m TEXT,
    curp TEXT,
    rfc TEXT,
    fecha_nac TEXT,
    calle TEXT,
    colonia TEXT,
    municipio TEXT,
    estado_dom TEXT,
    cp TEXT,
    estado TEXT DEFAULT 'nueva',
    intentos INT DEFAULT 0,
    creada TIMESTAMPTZ DEFAULT NOW(),
    actualizada TIMESTAMPTZ DEFAULT NOW(),
    creada_por TEXT,
    exp_acceso TIMESTAMPTZ
  )`);

  await q(`CREATE TABLE IF NOT EXISTS buro_autorizaciones (
    id BIGSERIAL PRIMARY KEY,
    solicitud_id BIGINT REFERENCES buro_solicitudes(id) ON DELETE CASCADE,
    texto_hash TEXT NOT NULL,
    texto TEXT NOT NULL,
    firma TEXT,
    ip TEXT,
    agente TEXT,
    datos JSONB,
    lugar TEXT,
    telefono TEXT,
    funcionario TEXT,
    folio_bc TEXT,
    fecha_consulta_bc DATE,
    aceptada TIMESTAMPTZ DEFAULT NOW(),
    vence DATE
  )`);
  /* Columnas agregadas después del primer despliegue */
  for (const col of ['lugar TEXT', 'telefono TEXT', 'funcionario TEXT',
                     'folio_bc TEXT', 'fecha_consulta_bc DATE', 'modo TEXT']) {
    await q('ALTER TABLE buro_autorizaciones ADD COLUMN IF NOT EXISTS ' + col);
  }

  await q(`CREATE TABLE IF NOT EXISTS buro_consultas (
    id BIGSERIAL PRIMARY KEY,
    solicitud_id BIGINT REFERENCES buro_solicitudes(id) ON DELETE SET NULL,
    tipo TEXT,
    curp TEXT,
    rfc TEXT,
    score INT,
    resumen JSONB,
    payload JSONB,
    folio_moffin TEXT,
    error TEXT,
    simulada BOOLEAN DEFAULT FALSE,
    mes TEXT,
    consultada TIMESTAMPTZ DEFAULT NOW()
  )`);

  await q(`CREATE TABLE IF NOT EXISTS buro_dictamenes (
    id BIGSERIAL PRIMARY KEY,
    solicitud_id BIGINT REFERENCES buro_solicitudes(id) ON DELETE CASCADE,
    semaforo TEXT,
    monto_sugerido NUMERIC,
    notas TEXT,
    autor TEXT,
    token_agencia TEXT UNIQUE,
    exp_agencia TIMESTAMPTZ,
    creado TIMESTAMPTZ DEFAULT NOW()
  )`);

  await q(`CREATE TABLE IF NOT EXISTS buro_documentos (
    id BIGSERIAL PRIMARY KEY,
    solicitud_id BIGINT REFERENCES buro_solicitudes(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL,
    imagen TEXT NOT NULL,
    bytes INT,
    sha256 TEXT,
    subido_por TEXT,
    revisado BOOLEAN DEFAULT FALSE,
    revisado_por TEXT,
    revisado_en TIMESTAMPTZ,
    nota TEXT,
    creado TIMESTAMPTZ DEFAULT NOW(),
    purgar DATE,
    purgado TIMESTAMPTZ
  )`);

  await q(`CREATE TABLE IF NOT EXISTS buro_vistas_doc (
    id BIGSERIAL PRIMARY KEY,
    documento_id BIGINT,
    solicitud_id BIGINT,
    usuario TEXT,
    ip TEXT,
    visto TIMESTAMPTZ DEFAULT NOW()
  )`);

  /* Roles: admin (todo) y gerente (solo su agencia, score con tope). Los usuarios previos quedan admin. */
  for (const col of ["rol TEXT DEFAULT 'admin'", 'agencia TEXT', 'tope_mes INT DEFAULT 0', 'ultimo_acceso TIMESTAMPTZ']) {
    await q('ALTER TABLE buro_usuarios ADD COLUMN IF NOT EXISTS ' + col);
  }
  await q('ALTER TABLE buro_consultas ADD COLUMN IF NOT EXISTS usuario TEXT');
  await q('ALTER TABLE buro_solicitudes ADD COLUMN IF NOT EXISTS editada_por TEXT');
  await q('ALTER TABLE buro_solicitudes ADD COLUMN IF NOT EXISTS editada TIMESTAMPTZ');
  await q(`CREATE INDEX IF NOT EXISTS ix_cons_usuario ON buro_consultas(usuario, mes)`);
  await q(`CREATE INDEX IF NOT EXISTS ix_sol_agencia ON buro_solicitudes((UPPER(TRIM(agencia))))`);

  await q(`CREATE INDEX IF NOT EXISTS ix_doc_sol ON buro_documentos(solicitud_id)`);
  await q(`CREATE INDEX IF NOT EXISTS ix_doc_purgar ON buro_documentos(purgar) WHERE purgado IS NULL`);
  await q(`CREATE INDEX IF NOT EXISTS ix_sol_estado ON buro_solicitudes(estado)`);
  await q(`CREATE INDEX IF NOT EXISTS ix_sol_curp ON buro_solicitudes(curp)`);
  await q(`CREATE INDEX IF NOT EXISTS ix_cons_mes ON buro_consultas(mes)`);
  await q(`CREATE INDEX IF NOT EXISTS ix_cons_curp ON buro_consultas(curp)`);

  const r = await q('SELECT COUNT(*)::int AS n FROM buro_usuarios');
  if (r.rows[0].n === 0 && process.env.ADMIN_USER && process.env.ADMIN_PASS) {
    await q('INSERT INTO buro_usuarios(usuario, pass, nombre) VALUES ($1,$2,$3)',
      [process.env.ADMIN_USER.toLowerCase(), hashPass(process.env.ADMIN_PASS), 'Administrador']);
    console.log('Usuario inicial creado:', process.env.ADMIN_USER);
  }
  console.log('Base lista.');
}

/* ---------- Auth del equipo ---------- */
async function auth(req, res, next) {
  const h = req.headers.authorization || (req.query.t ? 'Bearer ' + req.query.t : '');
  const d = leeJWT(h.replace(/^Bearer\s+/i, ''));
  if (!d || d.t !== 'equipo') return res.status(401).json({ error: 'Sesión expirada. Vuelve a entrar.' });
  try {
    /* Se relee el usuario en cada petición: bajas y cambios de rol aplican al instante */
    const r = await q('SELECT usuario, nombre, rol, agencia, tope_mes, activo FROM buro_usuarios WHERE usuario=$1', [d.u]);
    if (!r.rows.length || !r.rows[0].activo) return res.status(401).json({ error: 'Tu acceso fue desactivado.' });
    const u = r.rows[0];
    req.user = { u: u.usuario, n: u.nombre, rol: u.rol || 'admin', agencia: (u.agencia || '').trim(), tope: u.tope_mes || 0 };
    if (req.user.rol === 'gerente' && !req.user.agencia) {
      return res.status(403).json({ error: 'Tu usuario no tiene agencia asignada. Pide al administrador que la configure.' });
    }
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
function esGerente(req) { return req.user && req.user.rol === 'gerente'; }
function normAg(s) { return String(s || '').trim().toUpperCase(); }
function soloAdmin(req, res, next) {
  if (esGerente(req)) return res.status(403).json({ error: 'Tu perfil de gerente no tiene acceso a esta función.' });
  next();
}
/* Gerente: la solicitud debe ser de su agencia */
async function deSuAgencia(req, solicitudId) {
  if (!esGerente(req)) return true;
  const r = await q('SELECT agencia FROM buro_solicitudes WHERE id=$1', [solicitudId]);
  return !!(r.rows.length && normAg(r.rows[0].agencia) === normAg(req.user.agencia));
}
async function alcance(req, res, next) {
  try {
    if (!(await deSuAgencia(req, req.params.id))) {
      return res.status(403).json({ error: 'Esa solicitud no es de tu agencia.' });
    }
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
async function alcanceDoc(req, res, next) {
  try {
    if (!esGerente(req)) return next();
    const r = await q('SELECT solicitud_id FROM buro_documentos WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Documento no disponible.' });
    if (!(await deSuAgencia(req, r.rows[0].solicitud_id))) {
      return res.status(403).json({ error: 'Ese documento no es de tu agencia.' });
    }
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
/* Evidencia: la INE del cliente debe estar resguardada antes de consultar */
async function tieneINE(solicitudId) {
  const r = await q(`SELECT 1 FROM buro_documentos
    WHERE solicitud_id=$1 AND tipo='ine' AND purgado IS NULL LIMIT 1`, [solicitudId]);
  return r.rows.length > 0;
}

/* Tope POR AGENCIA: suman todas las consultas del mes de las solicitudes de esa agencia (las haga quien las
   haga) contra el tope de la agencia = el mayor tope_mes de sus gerentes activos. Así una agencia con varios
   usuarios (p. ej. admin y supervisores que entran desde CobraPro) no multiplica su cupo. */
async function usadasAgencia(agencia) {
  const r = await q(`SELECT COUNT(*)::int AS n FROM buro_consultas c JOIN buro_solicitudes s ON s.id = c.solicitud_id
    WHERE UPPER(TRIM(s.agencia))=$1 AND c.mes=$2 AND c.error IS NULL AND c.simulada=FALSE`, [normAg(agencia), mesMX()]);
  return r.rows[0].n;
}
async function topeAgencia(agencia) {
  const r = await q(`SELECT COALESCE(MAX(tope_mes),0)::int AS t FROM buro_usuarios
    WHERE COALESCE(rol,'admin')='gerente' AND activo=TRUE AND UPPER(TRIM(agencia))=$1`, [normAg(agencia)]);
  return r.rows[0].t;
}
async function usadasUsuario(usuario) {
  const r = await q(`SELECT COUNT(*)::int AS n FROM buro_consultas
    WHERE usuario=$1 AND mes=$2 AND error IS NULL AND simulada=FALSE`, [usuario, mesMX()]);
  return r.rows[0].n;
}

/* Freno de fuerza bruta: por usuario (sin importar IP, que se puede falsificar) y por IP. */
const FALLOS = new Map(); const FALLO_VENTANA = 15 * 60000;
function falloBloqueado(k, max) { const x = FALLOS.get(k); return !!(x && Date.now() - x.desde < FALLO_VENTANA && x.n >= max); }
function falloAnota(k) {
  const x = FALLOS.get(k), t = Date.now();
  if (!x || t - x.desde > FALLO_VENTANA) FALLOS.set(k, { n: 1, desde: t }); else x.n++;
  while (FALLOS.size > 10000) FALLOS.delete(FALLOS.keys().next().value);
}
function ipDe(req) { return String(req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0] || req.ip || '').trim(); }
setInterval(() => { const t = Date.now(); for (const [k, x] of FALLOS) if (t - x.desde > FALLO_VENTANA) FALLOS.delete(k); }, 10 * 60000).unref();

app.post('/api/login', async (req, res) => {
  try {
    const usuario = (req.body.usuario || '').toLowerCase().trim();
    const pass = req.body.pass || '';
    const kU = 'u:' + usuario, kI = 'ip:' + ipDe(req);
    if (falloBloqueado(kU, 10) || falloBloqueado(kI, 30)) return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos.' });
    const r = await q('SELECT * FROM buro_usuarios WHERE usuario=$1 AND activo=TRUE', [usuario]);
    if (!r.rows.length || !verificaPass(pass, r.rows[0].pass)) {
      falloAnota(kU); falloAnota(kI);
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }
    FALLOS.delete(kU);
    const u = r.rows[0];
    q('UPDATE buro_usuarios SET ultimo_acceso=NOW() WHERE id=$1', [u.id]).catch(() => {});
    res.json({ token: firmaJWT({ t: 'equipo', u: u.usuario, n: u.nombre }, 12), nombre: u.nombre, usuario: u.usuario,
      rol: u.rol || 'admin', agencia: u.agencia || '' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function datosRol(b) {
  const rol = b.rol === 'gerente' ? 'gerente' : 'admin';
  const agencia = String(b.agencia || '').trim().slice(0, 120);
  const tope = Math.max(0, Math.min(1000, parseInt(b.tope_mes, 10) || 0));
  if (rol === 'gerente' && !agencia) throw Object.assign(new Error('El gerente necesita una agencia.'), { http: 400 });
  return { rol, agencia: rol === 'gerente' ? agencia : (agencia || null), tope };
}

/* ---------- Acceso desde CobraPro (pase de un solo uso) ----------
   CobraPro (servidor a servidor) pide un pase firmado con BURO_SSO_SECRET. Aquí se crea o actualiza el
   usuario como GERENTE de esa agencia (tope 50 al crearlo; luego el admin lo ajusta en Usuarios) y se
   guarda, si viene, la captura del cliente para prellenar "Nueva solicitud". El navegador canjea el
   pase una sola vez dentro de 2 minutos; nunca viaja un token ni datos del cliente en la URL. */
const SSO_SECRET = process.env.BURO_SSO_SECRET || '';
const SSO_TOPE = parseInt(process.env.BURO_SSO_TOPE || '50', 10) || 50;
const PASES = new Map();
function ssoFirmaOk(payload, ts, firma) {
  if (!SSO_SECRET || !payload || !firma) return false;
  if (!(Math.abs(Date.now() - (+ts || 0)) < 120000)) return false;
  const calc = crypto.createHmac('sha256', SSO_SECRET).update(String(ts) + '.' + payload).digest('hex');
  return calc.length === String(firma).length && crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(String(firma)));
}
app.post('/api/sso/pase', async (req, res) => {
  try {
    if (!SSO_SECRET) return res.status(503).json({ error: 'Falta BURO_SSO_SECRET en Render (buró).' });
    const payload = String((req.body && req.body.payload) || '');
    if (!ssoFirmaOk(payload, req.headers['x-ts'], req.headers['x-firma'])) return res.status(401).json({ error: 'Firma inválida.' });
    const p = JSON.parse(payload);
    let agencia = String(p.agencia || '').trim().slice(0, 120);
    const usuario = String(p.usuario || '').toLowerCase().replace(/[^a-z0-9:_-]/g, '').slice(0, 60);
    if (!agencia || !usuario) return res.status(400).json({ error: 'Falta agencia o usuario.' });
    const nombre = String(p.nombre || usuario).slice(0, 90);
    /* La agencia viene del NOMBRE de marca de CobraPro, que el admin de cada agencia puede editar.
       Renombrándose como otra agencia entraba como gerente de ella y veía sus reportes. Ahora el nombre
       queda ligado a la agencia de CobraPro (prefijo cpN-) la primera vez y ya no se puede tomar uno ajeno. */
    const pref = (/^(cp\d+-)/.exec(usuario) || [])[1];
    if (!pref) return res.status(400).json({ error: 'Usuario de CobraPro no válido.' });
    const mios = await q("SELECT agencia FROM buro_usuarios WHERE usuario LIKE $1 AND agencia IS NOT NULL AND TRIM(agencia)<>'' ORDER BY id LIMIT 1", [pref + '%']);
    if (mios.rows.length) {
      agencia = mios.rows[0].agencia;
    } else {
      const ajena = await q("SELECT 1 FROM buro_usuarios WHERE UPPER(TRIM(agencia))=$1 AND usuario NOT LIKE $2 LIMIT 1", [normAg(agencia), pref + '%']);
      if (ajena.rows.length) return res.status(409).json({ error: 'Ese nombre de agencia ya está registrado en buró. Habla con el administrador.' });
    }
    const ex = await q('SELECT activo FROM buro_usuarios WHERE usuario=$1', [usuario]);
    if (!ex.rows.length) {
      await q('INSERT INTO buro_usuarios(usuario, pass, nombre, rol, agencia, tope_mes) VALUES ($1,$2,$3,$4,$5,$6)',
        [usuario, hashPass(crypto.randomBytes(24).toString('hex')), nombre, 'gerente', agencia, SSO_TOPE]);
    } else {
      if (!ex.rows[0].activo) return res.status(403).json({ error: 'Tu acceso a buró fue desactivado. Habla con el administrador.' });
      await q('UPDATE buro_usuarios SET nombre=$1, agencia=$2 WHERE usuario=$3', [nombre, agencia, usuario]);
    }
    const ahora = Date.now();
    for (const [k, v] of PASES) if (v.exp < ahora) PASES.delete(k);
    const id = crypto.randomBytes(18).toString('base64url');
    PASES.set(id, { usuario, exp: ahora + 120000, pre: p.pre && typeof p.pre === 'object' ? p.pre : null });
    res.json({ pase: id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post('/api/sso/canjear', async (req, res) => {
  try {
    const id = String((req.body && req.body.pase) || '');
    const p = PASES.get(id);
    PASES.delete(id);
    if (!p || p.exp < Date.now()) return res.status(401).json({ error: 'El acceso desde CobraPro venció. Vuelve a abrirlo desde CobraPro.' });
    const r = await q('SELECT * FROM buro_usuarios WHERE usuario=$1 AND activo=TRUE', [p.usuario]);
    if (!r.rows.length) return res.status(403).json({ error: 'Tu acceso a buró fue desactivado.' });
    const u = r.rows[0];
    q('UPDATE buro_usuarios SET ultimo_acceso=NOW() WHERE id=$1', [u.id]).catch(() => {});
    res.json({ token: firmaJWT({ t: 'equipo', u: u.usuario, n: u.nombre }, 12), nombre: u.nombre, usuario: u.usuario,
      rol: u.rol || 'admin', agencia: u.agencia || '', pre: p.pre });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/usuarios', auth, soloAdmin, async (req, res) => {
  try {
    const usuario = (req.body.usuario || '').toLowerCase().trim();
    const pass = req.body.pass || '';
    if (usuario.length < 3 || pass.length < 6) {
      return res.status(400).json({ error: 'Usuario mínimo 3 caracteres, contraseña mínimo 6.' });
    }
    const d = datosRol(req.body);
    await q('INSERT INTO buro_usuarios(usuario, pass, nombre, rol, agencia, tope_mes) VALUES ($1,$2,$3,$4,$5,$6)',
      [usuario, hashPass(pass), req.body.nombre || usuario, d.rol, d.agencia, d.tope]);
    res.json({ ok: true });
  } catch (e) {
    if (/duplicate/i.test(e.message)) return res.status(400).json({ error: 'Ese usuario ya existe.' });
    res.status(e.http || 500).json({ error: e.message });
  }
});

app.get('/api/usuarios', auth, soloAdmin, async (req, res) => {
  try {
    const r = await q(
      `SELECT u.usuario, u.nombre, u.activo, u.creado, COALESCE(u.rol,'admin') AS rol, u.agencia,
              COALESCE(u.tope_mes,0) AS tope_mes, u.ultimo_acceso,
              (SELECT COUNT(*)::int FROM buro_consultas c WHERE c.usuario=u.usuario AND c.mes=$1
                 AND c.error IS NULL AND c.simulada=FALSE) AS usadas_mes
       FROM buro_usuarios u ORDER BY u.creado`, [mesMX()]);
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* Editar rol, agencia, tope, nombre, activo o contraseña */
app.put('/api/usuarios/:usuario', auth, soloAdmin, async (req, res) => {
  try {
    const usuario = String(req.params.usuario || '').toLowerCase().trim();
    const ex = await q('SELECT * FROM buro_usuarios WHERE usuario=$1', [usuario]);
    if (!ex.rows.length) return res.status(404).json({ error: 'No existe ese usuario.' });
    const b = req.body || {};
    const actual = ex.rows[0];
    const d = datosRol({
      rol: b.rol !== undefined ? b.rol : actual.rol,
      agencia: b.agencia !== undefined ? b.agencia : actual.agencia,
      tope_mes: b.tope_mes !== undefined ? b.tope_mes : actual.tope_mes
    });
    const activo = b.activo !== undefined ? !!b.activo : actual.activo;
    if (usuario === req.user.u && (!activo || d.rol !== 'admin')) {
      return res.status(400).json({ error: 'No puedes quitarte el acceso de administrador a ti mismo.' });
    }
    if (d.rol !== 'admin' || !activo) {
      const adm = await q(`SELECT COUNT(*)::int AS n FROM buro_usuarios
        WHERE activo=TRUE AND COALESCE(rol,'admin')='admin' AND usuario<>$1`, [usuario]);
      if (adm.rows[0].n === 0) return res.status(400).json({ error: 'Debe quedar al menos un administrador activo.' });
    }
    if (b.pass && String(b.pass).length < 6) return res.status(400).json({ error: 'Contraseña mínimo 6 caracteres.' });
    await q(`UPDATE buro_usuarios SET nombre=$1, rol=$2, agencia=$3, tope_mes=$4, activo=$5,
             pass=COALESCE($6, pass) WHERE usuario=$7`,
      [String(b.nombre !== undefined ? b.nombre : actual.nombre || usuario).slice(0, 120),
        d.rol, d.agencia, d.tope, activo, b.pass ? hashPass(String(b.pass)) : null, usuario]);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.http || 500).json({ error: e.message });
  }
});

/* Bitácora: quién consultó, cuánto y qué */
app.get('/api/bitacora', auth, soloAdmin, async (req, res) => {
  try {
    const mes = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes : mesMX();
    const porUsuario = await q(
      `SELECT COALESCE(usuario,'(sin registro)') AS usuario,
              COUNT(*) FILTER (WHERE error IS NULL AND simulada=FALSE)::int AS reales,
              COUNT(*) FILTER (WHERE error IS NULL AND simulada=TRUE)::int AS sin_costo,
              COUNT(*) FILTER (WHERE error IS NOT NULL)::int AS errores
       FROM buro_consultas WHERE mes=$1 GROUP BY 1 ORDER BY 2 DESC`, [mes]);
    const ultimas = await q(
      `SELECT c.id, c.consultada, c.usuario, c.tipo, c.score, c.simulada, c.error, c.folio_moffin,
              s.id AS solicitud_id, s.folio, s.agencia,
              TRIM(CONCAT_WS(' ', s.nombre, s.apellido_p, s.apellido_m)) AS cliente
       FROM buro_consultas c LEFT JOIN buro_solicitudes s ON s.id=c.solicitud_id
       WHERE c.mes=$1 ORDER BY c.id DESC LIMIT 150`, [mes]);
    res.json({ mes, por_usuario: porUsuario.rows, ultimas: ultimas.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* Tablero: conteos por estado y semáforo, dentro del alcance del usuario */
app.get('/api/tablero', auth, async (req, res) => {
  try {
    const params = [];
    let w = 'WHERE 1=1';
    if (esGerente(req)) { params.push(normAg(req.user.agencia)); w += ` AND UPPER(TRIM(s.agencia))=$${params.length}`; }
    else if (req.query.agencia) { params.push(normAg(req.query.agencia)); w += ` AND UPPER(TRIM(s.agencia))=$${params.length}`; }
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.desde || '')) { params.push(req.query.desde); w += ` AND (s.creada AT TIME ZONE 'America/Mexico_City')::date >= $${params.length}`; }
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.hasta || '')) { params.push(req.query.hasta); w += ` AND (s.creada AT TIME ZONE 'America/Mexico_City')::date <= $${params.length}`; }
    const r = await q(
      `SELECT s.estado, d.semaforo, COUNT(*)::int AS n
       FROM buro_solicitudes s
       LEFT JOIN LATERAL (SELECT semaforo FROM buro_dictamenes y WHERE y.solicitud_id=s.id ORDER BY y.id DESC LIMIT 1) d ON TRUE
       ${w} GROUP BY 1, 2`, params);
    const out = { total: 0, estado: {}, semaforo: {} };
    r.rows.forEach(function (x) {
      out.total += x.n;
      out.estado[x.estado] = (out.estado[x.estado] || 0) + x.n;
      if (x.semaforo) out.semaforo[x.semaforo] = (out.semaforo[x.semaforo] || 0) + x.n;
    });
    let agencias = [];
    if (!esGerente(req)) {
      const a = await q(`SELECT DISTINCT TRIM(agencia) AS a FROM buro_solicitudes WHERE COALESCE(TRIM(agencia),'')<>'' ORDER BY 1`);
      agencias = a.rows.map(function (x) { return x.a; });
    }
    out.agencias = agencias;
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------- Cuota del mes ---------- */
async function cuotaMes() {
  const r = await q(
    `SELECT COUNT(*)::int AS n FROM buro_consultas WHERE mes=$1 AND error IS NULL AND simulada=FALSE`,
    [mesMX()]
  );
  const usadas = r.rows[0].n;
  return { mes: mesMX(), usadas, incluidas: CUOTA, restantes: Math.max(0, CUOTA - usadas), excedidas: Math.max(0, usadas - CUOTA) };
}

app.get('/api/cuota', auth, async (req, res) => {
  try {
    const c = await cuotaMes();
    c.rol = req.user.rol;
    c.agencia = req.user.agencia;
    if (esGerente(req)) c.mia = { usadas: await usadasAgencia(req.user.agencia), tope: await topeAgencia(req.user.agencia) };
    res.json(c);
  }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- Lectura de INE con IA (opcional) ---------- */
app.post('/api/ine/leer', auth, async (req, res) => {
  if (!ANTHROPIC_KEY) return res.status(400).json({ error: 'La lectura de INE no está configurada. Captura los datos a mano.' });
  try {
    const img = (req.body.imagen || '').replace(/^data:image\/\w+;base64,/, '');
    if (!img) return res.status(400).json({ error: 'No llegó la imagen.' });
    const tipo = /png/i.test(req.body.imagen || '') ? 'image/png' : 'image/jpeg';
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: tipo, data: img } },
            {
              type: 'text',
              text: 'Extrae de esta credencial de elector los datos y responde SOLO con JSON, sin explicación ni backticks: {"nombre":"","apellido_p":"","apellido_m":"","curp":"","fecha_nac":"AAAA-MM-DD","calle":"","colonia":"","municipio":"","estado":"","cp":""}. Si un dato no se ve, deja cadena vacía.'
            }
          ]
        }]
      })
    });
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: 'No se pudo leer la credencial. Captura a mano.' });
    let txt = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
    txt = txt.replace(/```json|```/g, '').trim();
    let out = {};
    try { out = JSON.parse(txt); } catch (e) { return res.status(422).json({ error: 'No se entendió la credencial. Captura a mano.' }); }
    if (out.curp) {
      out.curp = out.curp.toUpperCase().trim();
      if (!CURP_RE.test(out.curp)) { out.curp_dudosa = true; }
    }
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: 'No se pudo leer la credencial. Captura a mano.' });
  }
});

/* ---------- Documentos de respaldo ---------- */
app.post('/api/solicitudes/:id/documento', auth, alcance, async (req, res) => {
  try {
    if (!docsListo()) {
      return res.status(400).json({
        error: 'El resguardo de documentos no esta configurado. Falta DOCS_KEY en Render.'
      });
    }
    const tipo = req.body.tipo === 'ine' ? 'ine' : 'hoja';
    const img = req.body.imagen || '';
    if (!/^data:image\/(jpe?g|png|webp);base64,/.test(img)) {
      return res.status(400).json({ error: 'Manda una imagen valida (JPG o PNG).' });
    }
    const bytes = Math.round((img.length - img.indexOf(',') - 1) * 0.75);
    if (bytes > 5 * 1024 * 1024) {
      return res.status(413).json({ error: 'La imagen pesa mas de 5 MB. Tomala con menos resolucion.' });
    }

    const sol = await q('SELECT id FROM buro_solicitudes WHERE id=$1', [req.params.id]);
    if (!sol.rows.length) return res.status(404).json({ error: 'No existe esa solicitud.' });

    await q(`UPDATE buro_documentos SET imagen='', purgado=NOW()
             WHERE solicitud_id=$1 AND tipo=$2 AND purgado IS NULL`, [req.params.id, tipo]);

    const purgar = new Date();
    purgar.setMonth(purgar.getMonth() + (tipo === 'ine' ? MESES_INE : MESES_HOJA));

    const r = await q(
      `INSERT INTO buro_documentos(solicitud_id, tipo, imagen, bytes, sha256, subido_por, purgar)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, tipo, creado, purgar`,
      [req.params.id, tipo, cifra(img), bytes,
        crypto.createHash('sha256').update(img).digest('hex'), req.user.u,
        purgar.toISOString().slice(0, 10)]);
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/solicitudes/:id/documentos', auth, alcance, async (req, res) => {
  try {
    const r = await q(
      `SELECT id, tipo, bytes, subido_por, revisado, revisado_por, revisado_en, nota, creado, purgar
       FROM buro_documentos WHERE solicitud_id=$1 AND purgado IS NULL ORDER BY tipo`,
      [req.params.id]);
    const porTipo = {};
    r.rows.forEach(function (d) { porTipo[d.tipo] = d; });
    res.json({
      ine: porTipo.ine || null,
      hoja: porTipo.hoja || null,
      completo: !!(porTipo.ine && porTipo.ine.revisado && porTipo.hoja && porTipo.hoja.revisado)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/documento/:id', auth, alcanceDoc, async (req, res) => {
  try {
    if (!docsListo()) return res.status(400).json({ error: 'Resguardo no configurado.' });
    const r = await q(
      `SELECT id, solicitud_id, tipo, imagen FROM buro_documentos
       WHERE id=$1 AND purgado IS NULL`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Documento no disponible.' });
    await q(`INSERT INTO buro_vistas_doc(documento_id, solicitud_id, usuario, ip) VALUES ($1,$2,$3,$4)`,
      [r.rows[0].id, r.rows[0].solicitud_id, req.user.u,
        (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim()]);
    res.json({ id: r.rows[0].id, tipo: r.rows[0].tipo, imagen: descifra(r.rows[0].imagen) });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo abrir el documento.' });
  }
});

app.post('/api/documento/:id/revisar', auth, alcanceDoc, async (req, res) => {
  try {
    const ok = req.body.correcto !== false;
    const r = await q(
      `UPDATE buro_documentos SET revisado=$1, revisado_por=$2, revisado_en=NOW(), nota=$3
       WHERE id=$4 AND purgado IS NULL RETURNING id, tipo, revisado`,
      [ok, req.user.u, (req.body.nota || '').slice(0, 300), req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Documento no disponible.' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/documento/:id', auth, alcanceDoc, async (req, res) => {
  try {
    await q(`UPDATE buro_documentos SET imagen='', purgado=NOW() WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function purgaDocumentos() {
  try {
    const r = await q(
      `UPDATE buro_documentos SET imagen='', purgado=NOW()
       WHERE purgado IS NULL AND purgar IS NOT NULL AND purgar < CURRENT_DATE RETURNING id`);
    if (r.rows.length) console.log('Documentos purgados por vencimiento:', r.rows.length);
  } catch (e) {
    console.error('purgaDocumentos:', e.message);
  }
}

/* ---------- RFC sugerido ---------- */
app.post('/api/rfc', auth, (req, res) => {
  res.json(calculaRFC(req.body || {}));
});

/* ---------- Solicitudes ---------- */
app.post('/api/solicitudes', auth, async (req, res) => {
  try {
    const b = req.body || {};
    const tel = (b.telefono || '').replace(/\D/g, '');
    if (tel.length !== 10) return res.status(400).json({ error: 'El teléfono debe tener 10 dígitos.' });
    if (!normNombre(b.nombre) || !normNombre(b.apellido_p)) {
      return res.status(400).json({ error: 'Falta nombre y apellido paterno.' });
    }
    let rfc = (b.rfc || '').toUpperCase().trim();
    if (!rfc) {
      const c = calculaRFC({ nombre: b.nombre, apellido_p: b.apellido_p,
        apellido_m: b.apellido_m, curp: b.curp, fecha_nac: b.fecha_nac });
      if (c.rfc) rfc = c.rfc;
    }
    const faltanAlta = faltanCaptura(Object.assign({}, b, { rfc: rfc }));
    if (faltanAlta.length) {
      return res.status(400).json({ error: 'Faltan datos: ' + faltanAlta.join(', ') + '.', faltan: faltanAlta });
    }
    let folio;
    for (let i = 0; i < 12; i++) {
      folio = digitos(6);
      const ex = await q('SELECT 1 FROM buro_solicitudes WHERE folio=$1', [folio]);
      if (!ex.rows.length) break;
    }
    const codigo = digitos(4);
    const exp = new Date(Date.now() + 72 * 3600 * 1000);
    const r = await q(
      `INSERT INTO buro_solicitudes
       (folio, codigo, agencia, telefono, nombre, apellido_p, apellido_m, curp, rfc, fecha_nac,
        calle, colonia, municipio, estado_dom, cp, creada_por, exp_acceso)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [folio, codigo, esGerente(req) ? req.user.agencia : String(b.agencia || '').trim(), tel,
        normNombre(b.nombre), normNombre(b.apellido_p), normNombre(b.apellido_m),
        (b.curp || '').toUpperCase().trim(), rfc, b.fecha_nac || '',
        b.calle || '', b.colonia || '', b.municipio || '', b.estado_dom || '', (b.cp || '').replace(/\D/g, ''),
        req.user.u, exp]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* Lo mínimo que Buró pide para consultar (el apellido materno solo lo exige el reporte) */
function faltanCaptura(b) {
  const f = [];
  if (!normNombre(b.nombre)) f.push('nombre');
  if (!normNombre(b.apellido_p)) f.push('apellido paterno');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.fecha_nac || '')) f.push('fecha de nacimiento');
  if (String(b.rfc || '').trim().length < 10) f.push('RFC');
  if (!String(b.calle || '').trim()) f.push('calle y número');
  if (!String(b.colonia || '').trim()) f.push('colonia');
  if (!String(b.municipio || '').trim()) f.push('municipio');
  if (!claveEstado(b.estado_dom)) f.push('estado');
  if (String(b.cp || '').replace(/\D/g, '').length !== 5) f.push('código postal');
  return f;
}

/* Corregir o completar datos antes de consultar */
app.put('/api/solicitudes/:id', auth, alcance, async (req, res) => {
  try {
    const r = await q('SELECT * FROM buro_solicitudes WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'No existe esa solicitud.' });
    const s = r.rows[0];
    if (['consultada', 'entregada'].indexOf(s.estado) >= 0) {
      return res.status(409).json({ error: 'Esta solicitud ya fue consultada; sus datos ya no se pueden cambiar.' });
    }
    const b = req.body || {};
    const v = function (k) { return b[k] !== undefined ? String(b[k]) : (s[k] || ''); };
    const n = {
      telefono: v('telefono').replace(/\D/g, ''),
      nombre: normNombre(v('nombre')), apellido_p: normNombre(v('apellido_p')), apellido_m: normNombre(v('apellido_m')),
      curp: v('curp').toUpperCase().trim(), rfc: v('rfc').toUpperCase().trim(), fecha_nac: v('fecha_nac').trim(),
      calle: v('calle').trim().slice(0, 120), colonia: v('colonia').trim().slice(0, 120),
      municipio: v('municipio').trim().slice(0, 120), estado_dom: v('estado_dom').trim().slice(0, 60),
      cp: v('cp').replace(/\D/g, '').slice(0, 5)
    };
    if (n.telefono.length !== 10) return res.status(400).json({ error: 'El teléfono debe tener 10 dígitos.' });
    if (!n.rfc) {
      const c = calculaRFC({ nombre: n.nombre, apellido_p: n.apellido_p, apellido_m: n.apellido_m, curp: n.curp, fecha_nac: n.fecha_nac });
      if (c.rfc) n.rfc = c.rfc;
    }
    const faltan = faltanCaptura(n);
    if (faltan.length) return res.status(400).json({ error: 'Faltan datos: ' + faltan.join(', ') + '.', faltan: faltan });
    const u = await q(
      `UPDATE buro_solicitudes SET telefono=$1, nombre=$2, apellido_p=$3, apellido_m=$4, curp=$5, rfc=$6, fecha_nac=$7,
         calle=$8, colonia=$9, municipio=$10, estado_dom=$11, cp=$12, editada_por=$13, editada=NOW(), actualizada=NOW()
       WHERE id=$14 RETURNING *`,
      [n.telefono, n.nombre, n.apellido_p, n.apellido_m, n.curp, n.rfc, n.fecha_nac,
        n.calle, n.colonia, n.municipio, n.estado_dom, n.cp, req.user.u, req.params.id]);
    res.json(u.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/solicitudes', auth, async (req, res) => {
  try {
    const est = req.query.estado || '';
    const bus = normNombre(req.query.q || '');
    const params = [];
    let w = 'WHERE 1=1';
    if (est) { params.push(est); w += ` AND s.estado=$${params.length}`; }
    if (esGerente(req)) { params.push(normAg(req.user.agencia)); w += ` AND UPPER(TRIM(s.agencia))=$${params.length}`; }
    else if (req.query.agencia) { params.push(normAg(req.query.agencia)); w += ` AND UPPER(TRIM(s.agencia))=$${params.length}`; }
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.desde || '')) { params.push(req.query.desde); w += ` AND (s.creada AT TIME ZONE 'America/Mexico_City')::date >= $${params.length}`; }
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.hasta || '')) { params.push(req.query.hasta); w += ` AND (s.creada AT TIME ZONE 'America/Mexico_City')::date <= $${params.length}`; }
    if (req.query.semaforo === 'sin') w += ' AND d.semaforo IS NULL';
    else if (['verde', 'ambar', 'rojo'].indexOf(req.query.semaforo) >= 0) { params.push(req.query.semaforo); w += ` AND d.semaforo=$${params.length}`; }
    if (bus) {
      params.push('%' + bus + '%');
      w += ` AND (UPPER(s.nombre||' '||COALESCE(s.apellido_p,'')||' '||COALESCE(s.apellido_m,'')) LIKE $${params.length}
              OR s.folio LIKE $${params.length} OR s.telefono LIKE $${params.length}
              OR s.curp LIKE $${params.length} OR s.rfc LIKE $${params.length}
              OR EXISTS (SELECT 1 FROM buro_consultas bc
                         WHERE bc.solicitud_id = s.id AND bc.folio_moffin LIKE $${params.length}))`;
    }
    const r = await q(
      `SELECT s.*, c.score, c.tipo AS tipo_consulta, c.consultada, c.error AS error_consulta,
              c.resumen, c.folio_moffin, d.semaforo, d.token_agencia
       FROM buro_solicitudes s
       LEFT JOIN LATERAL (SELECT * FROM buro_consultas x WHERE x.solicitud_id=s.id ORDER BY x.id DESC LIMIT 1) c ON TRUE
       LEFT JOIN LATERAL (SELECT * FROM buro_dictamenes y WHERE y.solicitud_id=s.id ORDER BY y.id DESC LIMIT 1) d ON TRUE
       ${w} ORDER BY s.id DESC LIMIT 200`, params);
    if (esGerente(req)) r.rows.forEach(function (x) { delete x.resumen; });
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/solicitudes/:id', auth, alcance, async (req, res) => {
  try {
    const s = await q('SELECT * FROM buro_solicitudes WHERE id=$1', [req.params.id]);
    if (!s.rows.length) return res.status(404).json({ error: 'No existe esa solicitud.' });
    const a = await q('SELECT id, texto_hash, ip, agente, aceptada, vence, datos, firma FROM buro_autorizaciones WHERE solicitud_id=$1 ORDER BY id DESC', [req.params.id]);
    const c = await q('SELECT * FROM buro_consultas WHERE solicitud_id=$1 ORDER BY id DESC', [req.params.id]);
    const d = await q('SELECT * FROM buro_dictamenes WHERE solicitud_id=$1 ORDER BY id DESC LIMIT 1', [req.params.id]);
    let consultas = c.rows;
    /* Interpretación de las claves de razón (se calcula al leer: aplica también a consultas viejas) */
    consultas.forEach(function (x) {
      if (x.error || !x.payload) return;
      try { x.cotejo = cotejo(s.rows[0], x.payload, claveEstado); } catch (e) { /* opcional */ }
      try {
        const lect = resumeReporte(x.payload);
        x.interpretacion = interpretaScore(Object.assign({}, x.resumen || lect, {
          score: x.score !== null && x.score !== undefined ? x.score : lect.score,
          claves_razon: lect.claves_razon, score_clave: lect.score_clave, origen: lect.origen
        }), x.resumen && x.resumen.evaluacion);
      } catch (e) { /* opcional */ }
    });
    if (esGerente(req)) {
      /* Gerente: score y estado de la consulta; sin reporte ni detalle de cuentas */
      consultas = consultas.map(function (x) {
        return { id: x.id, tipo: x.tipo, score: x.score, folio_moffin: x.folio_moffin, error: x.error,
          simulada: x.simulada, consultada: x.consultada, usuario: x.usuario,
          interpretacion: x.interpretacion ? { score: x.interpretacion.score, banda: x.interpretacion.banda, color: x.interpretacion.color } : null,
          resumen: x.resumen && x.resumen.score_texto ? { score_texto: x.resumen.score_texto } : null };
      });
    }
    res.json({
      solicitud: s.rows[0],
      autorizaciones: a.rows,
      consultas: consultas,
      dictamen: d.rows[0] || null,
      tiene_ine: await tieneINE(req.params.id),
      docs: docsListo(),
      rol: req.user.rol
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* Regenera código y extiende el acceso */
app.post('/api/solicitudes/:id/renovar', auth, alcance, async (req, res) => {
  try {
    const codigo = digitos(4);
    const exp = new Date(Date.now() + 72 * 3600 * 1000);
    const r = await q(
      `UPDATE buro_solicitudes SET codigo=$1, exp_acceso=$2, intentos=0, actualizada=NOW()
       WHERE id=$3 RETURNING folio, codigo, exp_acceso`, [codigo, exp, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'No existe esa solicitud.' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* Llamada del IVR para dictar el código al cliente */
app.post('/api/solicitudes/:id/llamar', auth, alcance, async (req, res) => {
  try {
    const r = await q('SELECT folio, codigo, telefono, nombre FROM buro_solicitudes WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'No existe esa solicitud.' });
    const s = r.rows[0];
    if (!IVR_URL) return res.status(400).json({ error: 'La llamada automática no está configurada. Dicta el código por teléfono.' });
    const texto = `Hola. Le llama L M V Credia. Su folio es ${s.folio.split('').join(' ')}. Su código es ${s.codigo.split('').join(' ')}. Repito, su código es ${s.codigo.split('').join(' ')}.`;
    const rr = await fetch(IVR_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + IVR_TOKEN },
      body: JSON.stringify({ telefono: s.telefono, texto, mensaje: texto, tenant: 'credia' })
    });
    if (!rr.ok) {
      const t = await rr.text();
      return res.status(502).json({ error: 'La llamada no salió. Dicta el código por teléfono.', detalle: t.slice(0, 200) });
    }
    res.json({ ok: true, folio: s.folio, codigo: s.codigo });
  } catch (e) {
    res.status(502).json({ error: 'La llamada no salió. Dicta el código por teléfono.' });
  }
});

/* ---------- Acceso del cliente ---------- */
app.post('/api/acceso', async (req, res) => {
  try {
    const folio = (req.body.folio || '').replace(/\D/g, '');
    const codigo = (req.body.codigo || '').replace(/\D/g, '');
    /* Los 404 no contaban: se podían barrer los 1,000,000 de folios para hallar los abiertos. */
    if (falloBloqueado('acceso:ip:' + ipDe(req), 20) || falloBloqueado('acceso:global', 300)) {
      return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos e intenta de nuevo.' });
    }
    const r = await q('SELECT * FROM buro_solicitudes WHERE folio=$1', [folio]);
    if (!r.rows.length) { falloAnota('acceso:ip:' + ipDe(req)); falloAnota('acceso:global'); return res.status(404).json({ error: 'No encontramos ese folio. Verifícalo con quien te atendió.' }); }
    const s = r.rows[0];
    if (s.exp_acceso && new Date(s.exp_acceso) < new Date()) {
      return res.status(410).json({ error: 'Este folio ya venció. Pide uno nuevo a quien te atendió.' });
    }
    if (s.estado === 'autorizada' || s.estado === 'consultada' || s.estado === 'entregada') {
      return res.status(409).json({ error: 'Esta solicitud ya fue completada. No necesitas hacer nada más.' });
    }
    if (s.intentos >= 6) {
      return res.status(429).json({ error: 'Demasiados intentos. Pide un código nuevo a quien te atendió.' });
    }
    if (s.codigo !== codigo) {
      falloAnota('acceso:ip:' + ipDe(req)); falloAnota('acceso:global');
      await q('UPDATE buro_solicitudes SET intentos=intentos+1 WHERE id=$1', [s.id]);
      return res.status(401).json({ error: 'El código no coincide. Revísalo e intenta de nuevo.' });
    }
    await q('UPDATE buro_solicitudes SET intentos=0, estado=CASE WHEN estado=$2 THEN $3 ELSE estado END WHERE id=$1',
      [s.id, 'nueva', 'abierta']);
    res.json({
      token: firmaJWT({ t: 'cliente', s: s.id }, 2),
      datos: {
        nombre: s.nombre, apellido_p: s.apellido_p, apellido_m: s.apellido_m,
        curp: s.curp, rfc: s.rfc, fecha_nac: s.fecha_nac,
        calle: s.calle, colonia: s.colonia, municipio: s.municipio,
        estado_dom: s.estado_dom, cp: s.cp
      },
      texto: textoAutorizacion()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* Modo presencial: el cliente está enfrente y firma en el celular del empleado.
   El empleado abre esto desde su sesión; no hay folio ni código de por medio.
   La sesión dura 20 minutos y sirve una sola vez. */
app.post('/api/solicitudes/:id/presencial', auth, alcance, async (req, res) => {
  try {
    const r = await q('SELECT * FROM buro_solicitudes WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'No existe esa solicitud.' });
    const s = r.rows[0];
    if (['autorizada', 'consultada', 'entregada'].indexOf(s.estado) >= 0) {
      return res.status(409).json({ error: 'Esta solicitud ya fue autorizada.' });
    }
    await q('UPDATE buro_solicitudes SET estado=$1, actualizada=NOW() WHERE id=$2 AND estado=$3',
      ['abierta', s.id, 'nueva']);
    res.json({
      token: firmaJWT({ t: 'cliente', s: s.id, p: 1 }, 0.34),
      datos: {
        nombre: s.nombre, apellido_p: s.apellido_p, apellido_m: s.apellido_m,
        curp: s.curp, rfc: s.rfc, fecha_nac: s.fecha_nac,
        calle: s.calle, colonia: s.colonia, municipio: s.municipio,
        estado_dom: s.estado_dom, cp: s.cp
      },
      texto: textoAutorizacion()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function authCliente(req, res, next) {
  const h = req.headers.authorization || '';
  const d = leeJWT(h.replace(/^Bearer\s+/i, ''));
  if (!d || d.t !== 'cliente') return res.status(401).json({ error: 'La sesión expiró. Vuelve a entrar con tu folio.' });
  req.sol = d.s;
  req.presencial = d.p === 1;
  next();
}

/* RFC sugerido para el cliente (requiere su sesión de folio) */
app.post('/api/rfc-publico', authCliente, (req, res) => {
  res.json(calculaRFC(req.body || {}));
});

app.post('/api/autorizar', authCliente, async (req, res) => {
  try {
    const b = req.body || {};
    const falta = [];
    ['nombre', 'apellido_p', 'calle', 'colonia', 'municipio', 'estado_dom', 'cp'].forEach(k => {
      if (!(b[k] || '').toString().trim()) falta.push(k);
    });
    if (falta.length) return res.status(400).json({ error: 'Faltan datos por llenar.', campos: falta });
    if (!b.firma || b.firma.length < 100) return res.status(400).json({ error: 'Falta tu firma.' });
    if (!b.acepto) return res.status(400).json({ error: 'Debes marcar la casilla de autorización.' });

    const s = await q('SELECT * FROM buro_solicitudes WHERE id=$1', [req.sol]);
    if (!s.rows.length) return res.status(404).json({ error: 'No existe esa solicitud.' });
    if (['autorizada', 'consultada', 'entregada'].indexOf(s.rows[0].estado) >= 0) {
      return res.status(409).json({ error: 'Esta solicitud ya fue completada.' });
    }

    const datos = {
      nombre: normNombre(b.nombre), apellido_p: normNombre(b.apellido_p), apellido_m: normNombre(b.apellido_m),
      curp: (b.curp || '').toUpperCase().trim(), rfc: (b.rfc || '').toUpperCase().trim(),
      fecha_nac: b.fecha_nac || '', calle: b.calle, colonia: b.colonia,
      municipio: b.municipio, estado_dom: b.estado_dom, cp: (b.cp || '').replace(/\D/g, '')
    };

    if (!datos.rfc) {
      const c = calculaRFC(datos);
      if (c.rfc) datos.rfc = c.rfc;
    }

    const vence = new Date();
    vence.setFullYear(vence.getFullYear() + 3);

    await q(
      `UPDATE buro_solicitudes SET nombre=$1, apellido_p=$2, apellido_m=$3, curp=$4, rfc=$5, fecha_nac=$6,
       calle=$7, colonia=$8, municipio=$9, estado_dom=$10, cp=$11, estado='autorizada', actualizada=NOW()
       WHERE id=$12`,
      [datos.nombre, datos.apellido_p, datos.apellido_m, datos.curp, datos.rfc, datos.fecha_nac,
        datos.calle, datos.colonia, datos.municipio, datos.estado_dom, datos.cp, req.sol]
    );

    await q(
      `INSERT INTO buro_autorizaciones(solicitud_id, texto_hash, texto, firma, ip, agente, datos,
        lugar, telefono, funcionario, modo, vence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [req.sol, HASH_AUTORIZACION, TEXTO_AUTORIZACION, b.firma,
        (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim(),
        (req.headers['user-agent'] || '').slice(0, 300), JSON.stringify(datos),
        (b.lugar || '').toString().slice(0, 120) || [datos.municipio, datos.estado_dom].filter(Boolean).join(', '),
        s.rows[0].telefono || '', s.rows[0].creada_por || '',
        req.presencial ? 'presencial' : 'remoto',
        vence.toISOString().slice(0, 10)]
    );

    res.json({ ok: true });

    /* La consulta corre después de responder: el cliente no espera. */
    consultaAutomatica(req.sol, s.rows[0].creada_por || '').catch(e => console.error('consulta bg:', e.message));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------- Moffin ---------- */

/* RFCs del sandbox de Moffin. En sandbox el match es SOLO por RFC. */
const RFC_PRUEBA = {
  PRPU800101:    { score: 721, nota: 'Bueno: 7 cuentas al corriente, 20% de uso' },
  PRPU800102:    { score: 721, nota: 'Igual que PRPU800101' },
  PRPU800101R67: { score: 721, nota: 'Igual que PRPU800101' },
  PRPU800101XX6: { score: 721, nota: 'Igual que PRPU800101' },
  WWWW500122XX1: { score: 716, nota: 'Bueno: 17 cuentas, 31% de uso, sin vencido' },
  WWWW500122XX2: { score: 654, nota: 'Regular: 82% de uso del limite' },
  WWWW500122XX3: { score: 655, nota: 'Regular: 12 cuentas, 11% de uso' },
  AESE500614JK2: { score: null, nota: 'MALO: cartera vencida 40,314, MOP 97' },
  AESE500614JX1: { score: null, nota: 'Variante de cartera vencida' },
  AESE500614JX2: { score: null, nota: 'Variante de cartera vencida' },
  HEPE600122XX0: { score: null, nota: 'Sin score: 17 cuentas al corriente' },
  HEPE60012222A: { score: null, nota: 'Sin score: 5 cuentas al corriente' },
  DESCONOCIDO:   { score: null, nota: 'Persona no encontrada' }
};

app.get('/api/rfc-prueba', auth, soloAdmin, (req, res) => {
  res.json(Object.keys(RFC_PRUEBA).map(k => ({ rfc: k, nota: RFC_PRUEBA[k].nota })));
});

async function llamaMoffin(sol, tipo) {
  if (MOFFIN_MOCK || !MOFFIN_KEY) {
    const rfc = (sol.rfc || '').toUpperCase();
    const caso = RFC_PRUEBA[rfc];
    const semilla = parseInt((sol.curp || sol.folio || '0').replace(/\D/g, '').slice(-4) || '0', 10);
    const score = caso ? caso.score : 500 + (semilla % 300);
    return {
      simulada: true,
      payload: {
        simulado: true,
        aviso: 'Consulta simulada. No se cobró.',
        caso: caso ? caso.nota : 'Score generado al azar (RFC no es de prueba)',
        return: { Personas: { Persona: [{
          Nombre: { PrimerNombre: sol.nombre || '', ApellidoPaterno: sol.apellido_p || '',
                    ApellidoMaterno: sol.apellido_m || '', RFC: rfc },
          Cuentas: { Cuenta: [] },
          ResumenReporte: { ResumenReporte: [{ NumeroCuentas: '0000' }] },
          ScoreBuroCredito: score ? { ScoreBC: [{ ValorScore: String(score) }] } : null
        }] } }
      },
      folio_moffin: 'SIM-' + Date.now()
    };
  }
  const edo = claveEstado(sol.estado_dom);
  if (!edo) {
    const e = new Error('El estado "' + (sol.estado_dom || '(vacío)') +
      '" no es válido para Buró. Corrígelo, por ejemplo: Morelos.');
    e.datos = true;
    throw e;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sol.fecha_nac || '')) {
    const e = new Error('Falta la fecha de nacimiento del cliente. Buró la exige.');
    e.datos = true;
    throw e;
  }

  const body = {
    accountType: 'PF',
    firstName: limpiaTexto(sol.nombre),
    firstLastName: limpiaTexto(sol.apellido_p),
    secondLastName: limpiaTexto(sol.apellido_m),
    rfc: (sol.rfc || '').toUpperCase().trim(),
    birthdate: sol.fecha_nac,
    address: limpiaTexto(sol.calle, true),
    neighborhood: limpiaTexto(sol.colonia, true),
    municipality: limpiaTexto(sol.municipio, true),
    city: limpiaTexto(sol.municipio, true),
    state: edo,
    zipCode: (sol.cp || '').replace(/\D/g, '').slice(0, 5),
    country: 'MX',
    nationality: 'MX',
    externalId: String(sol.folio || '')
  };
  if (sol.curp) body.curp = sol.curp.toUpperCase().trim();
  if (sol.telefono) body.phone = sol.telefono.replace(/\D/g, '');
  if (tipo === 'reporte') {
    if (MOFFIN_PRODUCTO) body.productType = MOFFIN_PRODUCTO;
  } else {
    delete body.secondLastName;   /* Prospector no lo acepta */
  }

  const ruta = tipo === 'reporte' ? '/query/bureau_pf' : '/query/prospector_pf';
  const r = await fetch(MOFFIN_BASE + ruta, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Authorization': 'Token ' + MOFFIN_KEY },
    body: JSON.stringify(body)
  });
  const txt = await r.text();
  let data;
  try { data = JSON.parse(txt); } catch (e) { data = { crudo: txt.slice(0, 4000) }; }
  if (!r.ok) {
    let msg = 'Moffin respondió ' + r.status;
    if (r.status === 400 && data.message) msg = 'Datos rechazados: ' + String(data.message).slice(0, 300);
    else if (r.status === 401) msg = 'La llave de Moffin no es válida o venció.';
    else if (r.status === 429) msg = 'Se alcanzó el límite de consultas de la cuenta Moffin.';
    else if (/no credentials/i.test(String(data.message || txt))) msg = tipo === 'reporte'
      ? 'Tu cuenta de Moffin no tiene habilitado el reporte completo (bureau_pf). Consulta con score o pide a Moffin que lo active. No se cobró.'
      : 'Tu cuenta de Moffin no tiene habilitado el score (prospector_pf). No se cobró.';
    else if (r.status === 502 || r.status === 504) msg = 'Moffin no respondió a tiempo. Vuelve a intentar.';
    else if (data.message) msg += ': ' + String(data.message).slice(0, 250);
    const err = new Error(msg);
    err.http = r.status;
    throw err;
  }

  if (data.status === 'FAIL') {
    const err = new Error('Buró no completó la consulta' +
      (data.state && data.state.message ? ': ' + String(data.state.message).slice(0, 200) : '.'));
    throw err;
  }

  /* La respuesta viene envuelta: { id, uuid, status, response: {...} } */
  return {
    simulada: false,
    payload: data.response || data,
    folio_moffin: data.id ? String(data.id) : (data.uuid || null),
    pendiente: data.status === 'PENDING'
  };
}

/* Consulta automática al firmar. Se atribuye a quien creó la solicitud;
   si es gerente y ya no tiene tope o cuota, se queda en 'autorizada' para el administrador. */
/* ---------- Modo REPORTE (LMV CREDIA y el usuario legaxia) ----------
   Estas solicitudes se consultan con el REPORTE DETALLADO de Moffin (bureau_pf) y NUNCA con score:
   una sola consulta cobrada por cliente. Su PDF usa reporte_credia.js (sin sección de score).
   Agencias/usuarios configurables con BURO_REPORTE_AGENCIAS y BURO_REPORTE_USUARIOS (separados por coma).
   APAGADO por defecto: la cuenta de Moffin debe tener habilitado bureau_pf antes de activarlo. */
const REP_AGENCIAS = (process.env.BURO_REPORTE_AGENCIAS || '').split(',').map(x => x.trim().toUpperCase()).filter(Boolean);
const REP_USUARIOS = (process.env.BURO_REPORTE_USUARIOS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
function modoReporte(sol) {
  if (!sol) return false;
  const ag = normAg(sol.agencia);
  if (ag && REP_AGENCIAS.some(a => ag.includes(a))) return true;
  return REP_USUARIOS.includes(String(sol.creada_por || '').toLowerCase());
}

async function consultaAutomatica(solicitudId, creador) {
  if (docsListo() && !(await tieneINE(solicitudId))) {
    console.log('Consulta automática en espera: falta INE', solicitudId);
    return;
  }
  if (creador) {
    const u = await q('SELECT COALESCE(rol,\'admin\') AS rol, agencia FROM buro_usuarios WHERE usuario=$1', [creador]);
    if (u.rows.length && u.rows[0].rol === 'gerente') {
      const c = await cuotaMes();
      if (c.restantes <= 0 || (await usadasAgencia(u.rows[0].agencia)) >= (await topeAgencia(u.rows[0].agencia))) {
        console.log('Consulta automática omitida (tope/cuota del gerente):', creador, solicitudId);
        return;
      }
    }
  }
  const so = await q('SELECT agencia, creada_por FROM buro_solicitudes WHERE id=$1', [solicitudId]);
  const tipo = modoReporte(so.rows[0]) ? 'reporte' : 'score';
  return consultarMoffin(solicitudId, tipo, { usuario: creador || null });
}

/* Una sola consulta cobrada por cliente: candado contra clics simultáneos */
const consultando = new Set();

async function consultarMoffin(solicitudId, tipo, opciones) {
  const llave = String(solicitudId);
  if (consultando.has(llave)) {
    throw Object.assign(new Error('Ya hay una consulta en curso para este cliente. Espera unos segundos y actualiza.'), { http: 409 });
  }
  consultando.add(llave);
  try {
    return await consultarMoffinUna(solicitudId, tipo, opciones);
  } finally {
    consultando.delete(llave);
  }
}

async function consultarMoffinUna(solicitudId, tipo, opciones) {
  const op = opciones || {};
  const rs = await q('SELECT * FROM buro_solicitudes WHERE id=$1', [solicitudId]);
  if (!rs.rows.length) throw new Error('No existe esa solicitud.');
  const sol = rs.rows[0];

  const ra = await q('SELECT vence FROM buro_autorizaciones WHERE solicitud_id=$1 ORDER BY id DESC LIMIT 1', [solicitudId]);
  if (!ra.rows.length) throw new Error('Sin autorización firmada. No se puede consultar.');
  if (ra.rows[0].vence && ra.rows[0].vence.toISOString().slice(0, 10) < hoyMX()) {
    throw new Error('La autorización ya venció. Hay que recabarla de nuevo.');
  }

  /* Si ya existe una consulta exitosa del cliente en la ventana, no se cobra otra */
  const previa = await q(
    `SELECT id, tipo, consultada FROM buro_consultas
     WHERE (solicitud_id=$1 OR (COALESCE($2,'')<>'' AND curp=$2)) AND error IS NULL
       AND consultada > NOW() - ($3 || ' days')::interval
     ORDER BY id DESC LIMIT 1`, [solicitudId, sol.curp || '', String(CACHE_DIAS)]);
  if (previa.rows.length && previa.rows[0].tipo !== tipo) {
    throw Object.assign(new Error('Este cliente ya tiene una consulta de ' + previa.rows[0].tipo +
      ' de hace menos de ' + CACHE_DIAS + ' días. No se hace otra para no cobrar doble.'), { http: 409, bloqueada: true });
  }

  if (sol.curp) {
    const cache = await q(
      `SELECT * FROM buro_consultas
       WHERE curp=$1 AND tipo=$2 AND error IS NULL AND consultada > NOW() - ($3 || ' days')::interval
       ORDER BY id DESC LIMIT 1`, [sol.curp, tipo, String(CACHE_DIAS)]);
    if (cache.rows.length) {
      const c = cache.rows[0];
      await q('UPDATE buro_solicitudes SET estado=$1, actualizada=NOW() WHERE id=$2', ['consultada', solicitudId]);
      await q(
        `INSERT INTO buro_consultas(solicitud_id, tipo, curp, rfc, score, resumen, payload, folio_moffin, simulada, mes, usuario)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9,$10)`,
        [solicitudId, tipo, sol.curp, sol.rfc, c.score, c.resumen, c.payload,
          'CACHE-' + c.id, mesMX(), op.usuario || null]);
      return { reutilizada: true, score: c.score, resumen: c.resumen };
    }
  }

  try {
    const out = await llamaMoffin(sol, tipo);
    const lectura = resumeReporte(out.payload);
    const score = lectura.score;
    const resumen = Object.assign({}, lectura, semaforoSugerido(lectura));
    delete resumen.error_lectura;
    try { resumen.evaluacion = evalua(out.payload, lectura); } catch (e) { /* opcional */ }
    await q(
      `INSERT INTO buro_consultas(solicitud_id, tipo, curp, rfc, score, resumen, payload, folio_moffin, simulada, mes, usuario)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [solicitudId, tipo, sol.curp, sol.rfc, score,
        resumen ? JSON.stringify(resumen) : null, JSON.stringify(out.payload),
        out.folio_moffin, out.simulada, mesMX(), op.usuario || null]);
    await q('UPDATE buro_solicitudes SET estado=$1, actualizada=NOW() WHERE id=$2', ['consultada', solicitudId]);
    await q(`UPDATE buro_autorizaciones SET folio_bc=COALESCE(folio_bc,$1), fecha_consulta_bc=COALESCE(fecha_consulta_bc,$2)
             WHERE solicitud_id=$3`, [out.folio_moffin || null, hoyMX(), solicitudId]);
    return { score, resumen, simulada: out.simulada };
  } catch (e) {
    await q(
      `INSERT INTO buro_consultas(solicitud_id, tipo, curp, rfc, error, mes, usuario) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [solicitudId, tipo, sol.curp, sol.rfc, e.message.slice(0, 500), mesMX(), op.usuario || null]);
    await q('UPDATE buro_solicitudes SET estado=$1, actualizada=NOW() WHERE id=$2', ['error', solicitudId]);
    throw e;
  }
}

/* Revisa que los datos pasen las reglas de Moffin, sin gastar consulta */
function revisaDatos(sol) {
  const faltan = [];
  if (!normNombre(sol.nombre)) faltan.push('nombre');
  if (!normNombre(sol.apellido_p)) faltan.push('apellido paterno');
  if (!normNombre(sol.apellido_m)) faltan.push('apellido materno (Buró lo exige para el reporte)');
  if (!(sol.rfc || '').trim()) faltan.push('RFC');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sol.fecha_nac || '')) faltan.push('fecha de nacimiento');
  if (!(sol.calle || '').trim()) faltan.push('calle y número');
  if (!(sol.colonia || '').trim()) faltan.push('colonia');
  if (!(sol.municipio || '').trim()) faltan.push('municipio');
  if (!claveEstado(sol.estado_dom)) faltan.push('estado (no se reconoce "' + (sol.estado_dom || '') + '")');
  const cp = (sol.cp || '').replace(/\D/g, '');
  if (cp.length !== 5) faltan.push('código postal de 5 dígitos');
  return faltan;
}

app.get('/api/solicitudes/:id/revisar', auth, alcance, async (req, res) => {
  try {
    const r = await q('SELECT * FROM buro_solicitudes WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'No existe esa solicitud.' });
    const faltan = revisaDatos(r.rows[0]);
    res.json({
      listo: faltan.length === 0,
      faltan: faltan,
      estado_clave: claveEstado(r.rows[0].estado_dom)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/solicitudes/:id/consultar', auth, alcance, async (req, res) => {
  try {
    let tipo = req.body.tipo === 'reporte' ? 'reporte' : 'score';
    const sr = await q('SELECT * FROM buro_solicitudes WHERE id=$1', [req.params.id]);
    if (!sr.rows.length) return res.status(404).json({ error: 'No existe esa solicitud.' });
    const soloReporte = modoReporte(sr.rows[0]);
    if (soloReporte) tipo = 'reporte';   // CREDIA / legaxia: nunca score, para no cobrar doble
    const faltan = revisaDatos(sr.rows[0]).filter(f =>
      tipo === 'reporte' || f.indexOf('apellido materno') < 0);
    if (faltan.length) {
      return res.status(400).json({
        error: 'Faltan datos que Buró exige: ' + faltan.join(', ') + '.',
        faltan: faltan, sin_consumo: true
      });
    }
    if (docsListo() && !(await tieneINE(req.params.id))) {
      return res.status(400).json({ error: 'Antes de consultar, sube la foto de la INE del cliente.', sin_consumo: true });
    }
    const c = await cuotaMes();
    if (esGerente(req)) {
      if (tipo !== 'score' && !soloReporte) return res.status(403).json({ error: 'El gerente solo puede consultar score.' });
      if (c.restantes <= 0) {
        return res.status(403).json({ error: 'Se agotaron las consultas del mes. Pide al administrador que la haga.' });
      }
      const tope = await topeAgencia(req.user.agencia);
      if ((await usadasAgencia(req.user.agencia)) >= tope) {
        return res.status(403).json({ error: 'Tu agencia llegó a su tope de ' + tope + ' consultas este mes. Pide al administrador que lo amplíe.' });
      }
    }
    if (c.restantes <= 0 && !req.body.confirmado) {
      return res.status(409).json({
        error: 'Ya usaste las ' + CUOTA + ' consultas del mes. Esta se cobra aparte.',
        requiere_confirmacion: true, cuota: c
      });
    }
    if (tipo === 'reporte' && !soloReporte && !req.body.confirmado) {
      return res.status(409).json({
        error: 'El reporte completo cuesta más que el score. Confirma para continuar.',
        requiere_confirmacion: true
      });
    }
    const out = await consultarMoffin(req.params.id, tipo, { usuario: req.user.u });
    if (esGerente(req)) { delete out.resumen; }
    res.json(Object.assign({ ok: true }, out, { cuota: await cuotaMes() }));
  } catch (e) {
    res.status(e.http === 409 ? 409 : 502).json({ error: e.message, bloqueada: !!e.bloqueada });
  }
});

/* ---------- Respuesta cruda de Moffin y relectura sin cobrar ---------- */
app.get('/api/consultas/:id/crudo', auth, soloAdmin, async (req, res) => {
  try {
    const r = await q('SELECT id, tipo, folio_moffin, payload FROM buro_consultas WHERE id=$1', [req.params.id]);
    if (!r.rows.length || !r.rows[0].payload) return res.status(404).json({ error: 'Esa consulta no tiene respuesta guardada.' });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="moffin-' + r.rows[0].tipo + '-' + (r.rows[0].folio_moffin || r.rows[0].id) + '.json"');
    res.send(JSON.stringify(r.rows[0].payload, null, 2));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* Vuelve a leer las respuestas guardadas con el lector actual. No llama a Moffin ni cobra. */
app.post('/api/consultas/reprocesar', auth, soloAdmin, async (req, res) => {
  try {
    const r = await q(`SELECT id, payload FROM buro_consultas
      WHERE payload IS NOT NULL AND error IS NULL AND folio_moffin NOT LIKE 'CACHE-%' ORDER BY id`);
    let leidas = 0, conScore = 0;
    for (const x of r.rows) {
      const lectura = resumeReporte(x.payload);
      const resumen = Object.assign({}, lectura, semaforoSugerido(lectura));
      delete resumen.error_lectura;
      try { resumen.evaluacion = evalua(x.payload, lectura); } catch (e) { /* opcional */ }
      await q('UPDATE buro_consultas SET score=$1, resumen=$2 WHERE id=$3', [lectura.score, JSON.stringify(resumen), x.id]);
      if (lectura.ok) leidas++;
      if (lectura.score !== null && lectura.score !== undefined) conScore++;
    }
    /* Las reutilizadas (CACHE-) copian el resultado de su original */
    await q(`UPDATE buro_consultas c SET score=o.score, resumen=o.resumen
             FROM buro_consultas o WHERE c.folio_moffin = 'CACHE-' || o.id`);
    res.json({ revisadas: r.rows.length, leidas: leidas, con_score: conScore });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------- Dictamen y entrega ---------- */
app.post('/api/solicitudes/:id/dictamen', auth, soloAdmin, async (req, res) => {
  try {
    const sem = ['verde', 'ambar', 'rojo'].indexOf(req.body.semaforo) >= 0 ? req.body.semaforo : null;
    if (!sem) return res.status(400).json({ error: 'Elige verde, ámbar o rojo.' });
    const tok = crypto.randomBytes(18).toString('base64url');
    const exp = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    const r = await q(
      `INSERT INTO buro_dictamenes(solicitud_id, semaforo, monto_sugerido, notas, autor, token_agencia, exp_agencia)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.id, sem,
        req.body.monto_sugerido ? parseFloat(req.body.monto_sugerido) : null,
        (req.body.notas || '').slice(0, 2000), req.user.u, tok, exp]);
    await q('UPDATE buro_solicitudes SET estado=$1, actualizada=NOW() WHERE id=$2', ['entregada', req.params.id]);
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* Reporte de crédito en PDF. Interno. */
async function datosReporte(solicitudId) {
  const s = await q('SELECT * FROM buro_solicitudes WHERE id=$1', [solicitudId]);
  if (!s.rows.length) return null;
  const c = await q(
    `SELECT * FROM buro_consultas WHERE solicitud_id=$1 AND error IS NULL
     ORDER BY (tipo='reporte') DESC, id DESC LIMIT 1`, [solicitudId]);
  if (!c.rows.length) return null;
  const res = c.rows[0].resumen || resumeReporte(c.rows[0].payload);
  let cot = null;
  try { cot = cotejo(s.rows[0], c.rows[0].payload, claveEstado); } catch (e) { /* opcional */ }
  return {
    cotejo: cot,
    payload: c.rows[0].payload,
    resumen: res,
    evaluacion: (res && res.evaluacion) || null,
    solicitud: s.rows[0],
    consultada: c.rows[0].consultada,
    folio_bc: c.rows[0].folio_moffin
  };
}

app.get('/api/solicitudes/:id/reporte.pdf', auth, alcance, async (req, res) => {
  try {
    const d = await datosReporte(req.params.id);
    if (!d) return res.status(404).json({ error: 'Esta solicitud no tiene consulta registrada.' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      'inline; filename="reporte-' + (d.solicitud.folio || req.params.id) + '.pdf"');
    if (modoReporte(d.solicitud)) generaReporteCredia(d, res); else generaReportePDF(d, res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* Vista para la agencia: solo el dictamen. El reporte no sale por aquí. */
app.get('/api/dictamen/:token', async (req, res) => {
  try {
    const r = await q(
      `SELECT d.semaforo, d.monto_sugerido, d.notas, d.creado, d.exp_agencia, d.solicitud_id,
              s.folio, s.nombre, s.apellido_p, s.apellido_m, s.agencia, s.curp, s.rfc
       FROM buro_dictamenes d JOIN buro_solicitudes s ON s.id=d.solicitud_id
       WHERE d.token_agencia=$1`, [req.params.token]);
    if (!r.rows.length) return res.status(404).json({ error: 'Este enlace no existe.' });
    const d = r.rows[0];
    if (d.exp_agencia && new Date(d.exp_agencia) < new Date()) {
      return res.status(410).json({ error: 'Este enlace ya venció. Pide uno nuevo.' });
    }
    /* El detalle solo sale si el titular autorizó compartirlo con esta agencia */
    const au = await q(
      `SELECT texto FROM buro_autorizaciones WHERE solicitud_id=$1 ORDER BY id DESC LIMIT 1`,
      [d.solicitud_id]);
    const consintio = !!(au.rows.length && d.agencia &&
      au.rows[0].texto.toUpperCase().indexOf(String(d.agencia).trim().toUpperCase()) >= 0);

    let consulta = null;
    if (consintio) {
      const c = await q(
        `SELECT tipo, score, resumen, consultada FROM buro_consultas
         WHERE solicitud_id=$1 AND error IS NULL ORDER BY id DESC LIMIT 1`, [d.solicitud_id]);
      if (c.rows.length) {
        const x = c.rows[0];
        const R = x.resumen || {};
        consulta = {
          tipo: x.tipo,
          fecha: x.consultada,
          score: x.score,
          score_texto: R.score_texto || null,
          cuentas: R.cuentas || 0,
          cuentas_cerradas: R.cuentas_cerradas || 0,
          cuentas_negativas: R.cuentas_negativas || 0,
          cuentas_atraso: R.cuentas_atraso || 0,
          historia_negativa: R.historia_negativa || 0,
          saldo_total: R.saldo_total || 0,
          saldo_revolvente: R.saldo_revolvente || 0,
          saldo_fijos: R.saldo_fijos || 0,
          vencido_total: R.vencido_total || 0,
          pct_uso: (R.pct_uso === undefined ? null : R.pct_uso),
          peor_mop: R.peor_mop || 0,
          consultas_6m: R.consultas_6m || 0,
          cuentas_cobranza: R.cuentas_cobranza || 0,
          claves_graves: R.claves_graves || [],
          banderas: R.banderas || [],
          cuenta_mas_antigua: R.cuenta_mas_antigua || null,
          razones: R.razones || []
        };
      }
    }

    res.json({
      folio: d.folio,
      cliente: [d.nombre, d.apellido_p, d.apellido_m].filter(Boolean).join(' '),
      rfc: d.rfc,
      agencia: d.agencia,
      semaforo: d.semaforo,
      monto_sugerido: d.monto_sugerido,
      notas: d.notas,
      fecha: d.creado,
      consulta: consulta,
      sin_consentimiento: !consintio
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------- Exportar autorizaciones (auditoría CNBV / CONDUSEF / Moffin) ---------- */
app.get('/api/export/autorizaciones', auth, soloAdmin, async (req, res) => {
  try {
    const desde = req.query.desde || '2000-01-01';
    const hasta = req.query.hasta || '2999-12-31';
    const r = await q(
      `SELECT s.folio, s.nombre, s.apellido_p, s.apellido_m, s.curp, s.rfc, s.telefono,
              s.calle, s.colonia, s.municipio, s.estado_dom, s.cp,
              a.aceptada, a.vence, a.ip, a.texto_hash, a.agente,
              a.lugar, a.funcionario, a.folio_bc, a.fecha_consulta_bc, a.modo,
              (SELECT bc.folio_moffin FROM buro_consultas bc
               WHERE bc.solicitud_id = s.id AND bc.error IS NULL
               ORDER BY bc.id DESC LIMIT 1) AS folio_consulta,
              (SELECT bc.payload->'json'->'fileEnd'->>'controlNumber' FROM buro_consultas bc
               WHERE bc.solicitud_id = s.id AND bc.error IS NULL
               ORDER BY bc.id DESC LIMIT 1) AS control_bc,
              (a.firma IS NOT NULL) AS con_firma
       FROM buro_autorizaciones a JOIN buro_solicitudes s ON s.id=a.solicitud_id
       WHERE a.aceptada::date BETWEEN $1 AND $2 ORDER BY a.id`, [desde, hasta]);
    const esc = v => '"' + (v === null || v === undefined ? '' : String(v)).replace(/"/g, '""') + '"';
    const cab = ['Folio', 'Nombre', 'Apellido paterno', 'Apellido materno', 'CURP', 'RFC', 'Teléfono',
      'Calle y número', 'Colonia', 'Municipio', 'Estado', 'CP',
      'Lugar de firma', 'Fecha de autorización', 'Vence', 'Con firma',
      'Funcionario que recabó', 'Modo de firma', 'Folio de consulta BC', 'Número de control BC', 'Fecha de consulta BC',
      'IP', 'Hash del texto', 'Navegador'];
    const filas = r.rows.map(x => [x.folio, x.nombre, x.apellido_p, x.apellido_m, x.curp, x.rfc, x.telefono,
      x.calle, x.colonia, x.municipio, x.estado_dom, x.cp,
      x.lugar, x.aceptada ? new Date(x.aceptada).toISOString() : '',
      x.vence ? x.vence.toISOString().slice(0, 10) : '', x.con_firma ? 'Sí' : 'No',
      x.funcionario, x.modo || 'remoto', x.folio_bc || x.folio_consulta || '', x.control_bc || '', x.fecha_consulta_bc ? x.fecha_consulta_bc.toISOString().slice(0, 10) : '',
      x.ip, x.texto_hash, x.agente].map(esc).join(','));
    const csv = '\uFEFF' + [cab.map(esc).join(',')].concat(filas).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="autorizaciones.csv"');
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* Hojas en blanco para imprimir. El vendedor las lleva y las llena a mano.
   ?n=10 para sacar un talonario de 10 copias. */
app.get('/api/hojas.pdf', auth, (req, res) => {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="autorizaciones-para-firmar.pdf"');
  generaHojaBlanco({ texto: TEXTO_AUTORIZACION }, res, req.query.n || 1);
});

/* Subir la hoja firmada con pluma. Equivale a la firma en pantalla. */
app.post('/api/solicitudes/:id/firma-papel', auth, alcance, async (req, res) => {
  try {
    const dr = await q(
      `SELECT id, imagen, revisado FROM buro_documentos
       WHERE solicitud_id=$1 AND tipo='hoja' AND purgado IS NULL ORDER BY id DESC LIMIT 1`,
      [req.params.id]);
    if (!dr.rows.length) return res.status(400).json({ error: 'Primero sube la foto de la hoja firmada.' });
    if (!dr.rows[0].revisado) {
      return res.status(400).json({ error: 'Revisa la hoja y marcala como correcta antes de registrarla.' });
    }
    const ine = await q(
      `SELECT revisado FROM buro_documentos
       WHERE solicitud_id=$1 AND tipo='ine' AND purgado IS NULL ORDER BY id DESC LIMIT 1`,
      [req.params.id]);
    if (!ine.rows.length || !ine.rows[0].revisado) {
      return res.status(400).json({ error: 'Falta subir y revisar la identificacion del cliente.' });
    }
    const img = descifra(dr.rows[0].imagen);

    const r = await q('SELECT * FROM buro_solicitudes WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'No existe esa solicitud.' });
    const s = r.rows[0];
    if (['autorizada', 'consultada', 'entregada'].indexOf(s.estado) >= 0) {
      return res.status(409).json({ error: 'Esta solicitud ya tiene autorización registrada.' });
    }

    const faltan = [];
    if (!normNombre(s.nombre)) faltan.push('nombre');
    if (!normNombre(s.apellido_p)) faltan.push('apellido paterno');
    if (!(s.calle || '').trim()) faltan.push('calle');
    if (!(s.colonia || '').trim()) faltan.push('colonia');
    if (!(s.municipio || '').trim()) faltan.push('municipio');
    if (!claveEstado(s.estado_dom)) faltan.push('estado');
    if ((s.cp || '').replace(/\D/g, '').length !== 5) faltan.push('código postal');
    if (faltan.length) {
      return res.status(400).json({
        error: 'Completa estos datos antes de registrar la firma: ' + faltan.join(', ') + '.'
      });
    }

    const vence = new Date();
    vence.setFullYear(vence.getFullYear() + 3);
    const datos = {
      nombre: s.nombre, apellido_p: s.apellido_p, apellido_m: s.apellido_m,
      curp: s.curp, rfc: s.rfc, fecha_nac: s.fecha_nac, calle: s.calle,
      colonia: s.colonia, municipio: s.municipio, estado_dom: s.estado_dom, cp: s.cp
    };

    await q(
      `INSERT INTO buro_autorizaciones(solicitud_id, texto_hash, texto, firma, ip, agente, datos,
        lugar, telefono, funcionario, modo, vence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [s.id, HASH_AUTORIZACION, TEXTO_AUTORIZACION, img,
        (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim(),
        'Hoja firmada con pluma, digitalizada',
        JSON.stringify(datos),
        (req.body.lugar || '').toString().slice(0, 120) ||
          [s.municipio, s.estado_dom].filter(Boolean).join(', '),
        s.telefono || '', req.user.u, 'papel',
        vence.toISOString().slice(0, 10)]);

    await q('UPDATE buro_solicitudes SET estado=$1, actualizada=NOW() WHERE id=$2',
      ['autorizada', s.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* Comprobante en PDF: una hoja por autorización.
   Sin parámetros = solo esa solicitud. Con ?desde y ?hasta = lote. */
const SQL_COMPROBANTE = `
  SELECT s.folio, s.nombre, s.apellido_p, s.apellido_m, s.curp, s.rfc, s.telefono,
         s.calle, s.colonia, s.municipio, s.estado_dom, s.cp, s.fecha_nac,
         a.texto, a.texto_hash, a.firma, a.ip, a.aceptada, a.vence,
         a.lugar, a.funcionario, a.modo, a.folio_bc, a.fecha_consulta_bc
  FROM buro_autorizaciones a JOIN buro_solicitudes s ON s.id = a.solicitud_id`;

app.get('/api/solicitudes/:id/comprobante.pdf', auth, alcance, async (req, res) => {
  try {
    const r = await q(SQL_COMPROBANTE + ' WHERE a.solicitud_id=$1 ORDER BY a.id DESC LIMIT 1',
      [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Esta solicitud no tiene autorización firmada.' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      'inline; filename="autorizacion-' + (r.rows[0].folio || req.params.id) + '.pdf"');
    generaPDF(r.rows, res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/export/comprobantes.pdf', auth, soloAdmin, async (req, res) => {
  try {
    const desde = req.query.desde || '2000-01-01';
    const hasta = req.query.hasta || '2999-12-31';
    const r = await q(
      SQL_COMPROBANTE + ' WHERE a.aceptada::date BETWEEN $1 AND $2 ORDER BY a.id LIMIT 150',
      [desde, hasta]);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="autorizaciones.pdf"');
    generaPDF(r.rows, res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* Comprobante individual de una autorización (para exhibir) */
app.get('/api/autorizacion/:id', auth, soloAdmin, async (req, res) => {
  try {
    const r = await q(
      `SELECT a.*, s.folio, s.telefono FROM buro_autorizaciones a
       JOIN buro_solicitudes s ON s.id=a.solicitud_id WHERE a.id=$1`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'No existe.' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------- Salud ---------- */
app.get('/api/health', async (req, res) => {
  try {
    await q('SELECT 1');
    const c = await cuotaMes();
    res.json({
      salud: true, version: '1.2', mock: MOFFIN_MOCK, entorno: MOFFIN_ENV, docs: docsListo(),
      cuota: c, hoy: hoyMX()
    });
  } catch (e) {
    res.status(500).json({ salud: false, error: e.message });
  }
});

/* ---------- Páginas ---------- */
/* Las páginas se revalidan siempre: si no, el navegador sigue mostrando una versión vieja del panel después de un deploy. */
app.use(express.static(path.join(__dirname, 'publico'), { setHeaders: (res, f) => { if (/\.html$/.test(f)) res.setHeader('Cache-Control', 'no-cache'); } }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'publico', 'cliente.html'), { headers: { 'Cache-Control': 'no-cache' } }));
app.get('/panel', (req, res) => res.sendFile(path.join(__dirname, 'publico', 'panel.html'), { headers: { 'Cache-Control': 'no-cache' } }));
app.get('/r/:token', (req, res) => res.sendFile(path.join(__dirname, 'publico', 'entrega.html'), { headers: { 'Cache-Control': 'no-cache' } }));

/* ---------- Guardianes ---------- */
process.on('uncaughtException', e => console.error('uncaught:', e.message));
process.on('unhandledRejection', e => console.error('unhandled:', (e && e.message) || e));

initDB()
  .then(() => {
    purgaDocumentos();
    setInterval(purgaDocumentos, 24 * 3600 * 1000);
  })
  .then(() => app.listen(PORT, () => {
    console.log('Buró LMV Credia escuchando en ' + PORT + (MOFFIN_MOCK ? ' [MODO SIMULADO]' : ' [PRODUCCIÓN]'));
    if (!docsListo()) console.log('Aviso: sin DOCS_KEY no se pueden resguardar INE ni hojas firmadas.');
  }))
  .catch(e => {
    console.error('No arrancó. Error de base de datos:');
    console.error('  mensaje:', e.message || '(sin mensaje)');
    console.error('  código :', e.code || '(sin código)');
    if (e.stack) console.error(e.stack);
    console.error('Revisa DATABASE_URL en Render (usa la Internal Database URL de tu base).');
    process.exit(1);
  });

#!/usr/bin/env node
/**
 * download-weekly-events.js — KADEL (Ranking uso fuera de horario)
 *
 * TrackGTS expone los eventos de "Motor Encendido" vía:
 *   POST /api/alerts/-1/3175/{hash}
 *   body: [{ startDate, endDate, unitIds, eventCode: '-109', checked: 2 }]
 *
 * Confirmado en vivo el 2026-08-03 interceptando el fetch real de la UI de
 * TrackGTS (pantalla "Eventos" → Unidad: Seleccionados, Evento: Motor
 * Encendido, Filtro: Últimos 7 días).
 *
 * La respuesta trae un registro JSON por cada instancia de encendido, y
 * TrackGTS ya incluye una clasificación "Fuera horario"/"dentro horario"
 * en el campo unitsCustomerSensorIdName — pero esa clasificación depende de
 * la regla configurada por unidad en su alerta (que no todas tienen, y que
 * se fue configurando a mitad de semana), así que NO es confiable como
 * fuente única. Además el mismo encendido físico puede aparecer dos veces
 * (una vez por cada alerta "dentro"/"fuera" asociada a la unidad).
 *
 * Por eso este script:
 *   1. Deduplica por (unitId + timestamp exacto) — un encendido físico
 *      cuenta una sola vez, sin importar cuántas alertas lo referencian.
 *   2. Clasifica "fuera de horario" él mismo, con la regla exacta que dio
 *      Rafael (Track Link) el 2026-08-01:
 *        - Lunes a viernes: encendidos entre las 19:00 y las 07:00 (del
 *          día siguiente)
 *        - Sábado y domingo: todo el día
 *
 * IMPORTANTE sobre zona horaria: el campo "gpsUtcTimeC13" que devuelve la
 * API, pese al nombre, se observó alineado con hora de Chile en los casos
 * verificables (ej. eventos después de las 19:00 ya venían etiquetados
 * "Fuera horario" por TrackGTS usando ese mismo valor sin conversión). Este
 * script trata gpsUtcTimeC13 como hora de pared de Chile — si se detectan
 * inconsistencias al validar contra los registros reales de Tracklink,
 * revisar este supuesto primero.
 *
 * Variables de entorno:
 *   TL_START     — "YYYY/MM/DD 04:00:00" (convención +4h, ver README)
 *   TL_END       — "YYYY/MM/DD 03:59:00" (día siguiente)
 *   TL_UNIT_IDS  — lista de unitIds de KADEL separados por coma (incluye
 *                  las 5 unidades excluidas del reporte de excesos — la
 *                  exclusión para este informe se aplica aparte si
 *                  corresponde, ver generate-pdf-ranking.js)
 */
'use strict';

const puppeteer = require('puppeteer');
const XLSX      = require('xlsx');
const fs        = require('fs');
const path      = require('path');

function parseLocal(dateStr) {
  // "2026-07-30T14:52:40" → Date construido SIN conversión de zona horaria,
  // usando los mismos números tal cual vienen (ver nota de zona horaria arriba).
  const [datePart, timePart] = dateStr.split('T');
  const [y, mo, da] = datePart.split('-').map(Number);
  const [h, mi, se] = (timePart || '00:00:00').split(':').map(Number);
  return new Date(Date.UTC(y, mo - 1, da, h, mi, se || 0));
}

function isOffHours(dateStr) {
  const d = parseLocal(dateStr);
  const dow = d.getUTCDay(); // 0=domingo ... 6=sábado
  if (dow === 0 || dow === 6) return true; // fin de semana: siempre fuera de horario
  const totalMin = d.getUTCHours() * 60 + d.getUTCMinutes();
  return totalMin >= 19 * 60 || totalMin < 7 * 60; // lunes a viernes: 19:00–07:00
}

// TrackGTS no siempre sostiene un login más si ya hubo 1-2 logins seguidos
// de la misma cuenta en poco tiempo (confirmado 2026-08-07: 5 intentos
// seguidos fallaron en ~25 minutos, la página se queda en login.html y la
// API responde idResult=-11 "sesión expirada" — mismo comportamiento de
// rate-limit por cuenta ya visto en /api/sync de la app STLC, ahí con
// mensaje explícito de "~20 minutos"). Por eso:
//   - cada intento usa un browser nuevo desde cero (no solo una pestaña
//     nueva), para no heredar cookies/localStorage de un intento fallido
//   - la espera entre intentos es de minutos, no segundos — hay ~6 horas
//     de margen entre esta corrida (lunes 01:00 CLT) y el envío de n8n
//     (lunes 07:00 CLT), así que de sobra para esperar un rate-limit real
const MAX_ATTEMPTS = 4;
const RETRY_DELAY_MS = 7 * 60_000;

async function loginAndFetchEventos({ TL_USER, TL_PASSWORD, TL_DOMAIN, TL_START, TL_END, TL_UNIT_IDS }) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(60_000);
      const loginUrl = `https://${TL_DOMAIN}.trackgts.com/admin/login.html`;
      console.log(`[1] Intento ${attempt}/${MAX_ATTEMPTS} — Login en: ${loginUrl}`);
      await page.goto(loginUrl, { waitUntil: 'networkidle0', timeout: 60_000 });
      await page.waitForSelector('#username', { timeout: 30_000 });

      await page.evaluate(() => localStorage.setItem('sltLanguage', '0'));
      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForSelector('#username', { timeout: 30_000 });

      await page.evaluate((user, password, domain) => {
        const K  = 'd5fg4df5sg4ds5fg';
        const S  = { a:'1', b:'2', c:'3', d:'4', e:'5', f:'6', g:'7', h:'8', i:'9' };
        const k  = CryptoJS.enc.Utf8.parse(K);
        const iv = CryptoJS.enc.Utf8.parse(K);
        const a  = [];
        for (const c of password) {
          a.push(
            CryptoJS.AES.encrypt(
              CryptoJS.enc.Utf8.parse(S[c] || c), k,
              { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
            ).toString()
          );
        }
        ARRAYPSWD = a;
        document.getElementById('username').value = user;
        document.getElementById('domain').value   = domain;
        document.getElementById('password').value = '********';
        LOGININPROCESS = false;
        onLoginOn();
      }, TL_USER, TL_PASSWORD, TL_DOMAIN);

      console.log('[2] Esperando sesión (15s)...');
      await new Promise(r => setTimeout(r, 15_000));
      console.log(`[2] URL actual: ${page.url()}`);

      console.log(`[3] Consultando eventos: ${TL_START} → ${TL_END}`);
      const result = await page.evaluate(async (startDate, endDate, unitIds) => {
        const h = JSONUSER.hash;
        const body = JSON.stringify([{ startDate, endDate, unitIds, eventCode: '-109', checked: 2 }]);
        const res = await fetch(
          `https://www.trackgts.com:82/api/alerts/-1/3175/${h}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json;charset=UTF-8' }, body }
        );
        const text = await res.text();
        let json;
        try { json = JSON.parse(text); } catch (e) {
          return { error: `Respuesta no-JSON: ${text.slice(0, 300)}` };
        }
        // La API devuelve el array serializado dos veces (un string JSON que
        // contiene el JSON real adentro) — parsear de nuevo si hace falta.
        if (typeof json === 'string') {
          try { json = JSON.parse(json); } catch (e) {
            return { error: `Respuesta string no parseable como JSON: ${json.slice(0, 300)}` };
          }
        }
        if (json && json.idResult !== undefined) {
          return { error: `idResult=${json.idResult} (sesión expirada o sin datos)` };
        }
        if (!Array.isArray(json)) {
          return { error: `Respuesta inesperada (no es array): ${JSON.stringify(json).slice(0, 300)}` };
        }
        return { rows: json };
      }, TL_START, TL_END, TL_UNIT_IDS);

      if (result.error) throw new Error(result.error);
      return result.rows || [];
    } catch (err) {
      lastError = err;
      console.log(`[!] Intento ${attempt}/${MAX_ATTEMPTS} falló: ${err.message}`);
      if (attempt < MAX_ATTEMPTS) {
        console.log(`[!] Esperando ${Math.round(RETRY_DELAY_MS / 60_000)} min antes de reintentar (posible rate-limit de login en TrackGTS)...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      }
    } finally {
      await browser.close();
    }
  }
  throw lastError;
}

async function main() {
  const { TL_USER, TL_PASSWORD, TL_DOMAIN, TL_START, TL_END, TL_UNIT_IDS } = process.env;

  if (!TL_USER || !TL_PASSWORD || !TL_DOMAIN) {
    throw new Error('Faltan variables de entorno: TL_USER, TL_PASSWORD, TL_DOMAIN');
  }
  if (!TL_START || !TL_END) {
    throw new Error('Faltan variables TL_START y TL_END (calculadas por el step anterior)');
  }
  if (!TL_UNIT_IDS) {
    throw new Error('Falta TL_UNIT_IDS — lista de unitIds de KADEL. Ver README.md.');
  }

  console.log(`=== Download Weekly KADEL (Eventos - Motor Encendido): ${TL_START} → ${TL_END} ===`);
  console.log(`Unidades incluidas: ${TL_UNIT_IDS}`);

  const rawRows = await loginAndFetchEventos({ TL_USER, TL_PASSWORD, TL_DOMAIN, TL_START, TL_END, TL_UNIT_IDS });
  console.log(`[4] Registros crudos recibidos (con posibles duplicados): ${rawRows.length}`);

  // ── 3. Deduplicar por (unitId + timestamp exacto) ──────────────────────────
    const seen = new Map();
    for (const r of rawRows) {
      const key = `${r.unitida0}|${r.gpsUtcTimeC13}`;
      if (!seen.has(key)) {
        seen.set(key, {
          unitId: r.unitida0,
          alias:  r.unitalias,
          fecha:  r.gpsUtcTimeC13,
        });
      }
    }
    const eventos = [...seen.values()].map(e => ({
      ...e,
      fueraHorario: isOffHours(e.fecha),
    })).sort((a, b) => a.alias.localeCompare(b.alias) || a.fecha.localeCompare(b.fecha));

    console.log(`[5] Encendidos únicos (deduplicados): ${eventos.length}`);
    console.log(`[5] Fuera de horario: ${eventos.filter(e => e.fueraHorario).length}`);

    // ── 4. Armar .xlsx (Detalle + Resumen por Unidad) ──────────────────────────
    const detalle = eventos.map(e => ({
      Unidad: e.alias,
      unitId: e.unitId,
      'Fecha y Hora': e.fecha.replace('T', ' '),
      'Fuera de Horario': e.fueraHorario ? 'SI' : 'NO',
    }));

    const resumenMap = new Map();
    for (const e of eventos) {
      if (!resumenMap.has(e.alias)) resumenMap.set(e.alias, { Unidad: e.alias, unitId: e.unitId, Total: 0, FueraHorario: 0 });
      const acc = resumenMap.get(e.alias);
      acc.Total++;
      if (e.fueraHorario) acc.FueraHorario++;
    }
    const resumen = [...resumenMap.values()]
      .map(r => ({ Unidad: r.Unidad, unitId: r.unitId, 'Total Encendidos': r.Total, 'Fuera de Horario': r.FueraHorario }))
      .sort((a, b) => b['Fuera de Horario'] - a['Fuera de Horario']);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detalle), 'Detalle');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumen), 'Resumen por Unidad');

    const dest = path.join(process.cwd(), 'latest-events.xlsx');
    XLSX.writeFile(wb, dest);
    console.log(`[6] Guardado como: ${dest}`);
    console.log('=== COMPLETADO ===');
}

main().catch(err => {
  console.error('ERROR FATAL:', err.message);
  process.exit(1);
});

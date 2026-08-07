#!/usr/bin/env node
/**
 * download-weekly.js — KADEL
 * Descarga el reporte de excesos de velocidad de TrackGTS
 * para un rango exacto Lunes–Domingo usando las variables de entorno:
 *   TL_START     — "YYYY/MM/DD 00:00:00"
 *   TL_END       — "YYYY/MM/DD 23:59:59"
 *   TL_UNIT_IDS  — lista de unitIds separados por coma (ya excluye las
 *                  unidades fuera de monitoreo: LTTW96, TVKC50, PKGT50,
 *                  RHDZ45, SWFB15 — ver README para el mapeo patente→unitId)
 *
 * IMPORTANTE: a diferencia de Santa Marta, esta llamada NO usa un reportName
 * ni un tipo de reporte genéricos. TrackGTS exige que reportName, parameters,
 * speed y el segmento de tipo de reporte en la URL coincidan exactamente con
 * la definición del reporte "Excesos 100 Semanal" ya existente en la cuenta
 * de KADEL (creado por Adriana Verc, reportTypeId 24) — de lo contrario el
 * backend de TrackGTS devuelve 500 Internal Server Error. Estos valores NO
 * se guardan ni se modifican desde este script (nunca se llama a "Guardar"),
 * solo se replican para poder descargar el reporte de forma automática.
 * Confirmado funcionando: 2026-08-01 (fetch directo + corrida real via
 * GitHub Actions con estos valores exactos).
 */
'use strict';

const puppeteer = require('puppeteer');
const AdmZip    = require('adm-zip');
const fs        = require('fs');
const path      = require('path');

// TrackGTS no siempre sostiene un login más si ya hubo 1-2 logins seguidos
// de la misma cuenta en poco tiempo (confirmado 2026-08-07 en el script de
// eventos de KADEL: 5 intentos seguidos fallaron en ~25 minutos — mismo
// comportamiento de rate-limit por cuenta ya visto en /api/sync de la app
// STLC, ahí con mensaje explícito de "~20 minutos"). Este script en particular
// no había fallado todavía, pero usa el mismo login — se hace igual de
// resistente por si pasa en un lunes sin nadie mirando. Cada intento usa un
// browser nuevo desde cero (no solo una pestaña nueva), y la espera entre
// intentos es de minutos: hay ~6 horas de margen entre esta corrida (lunes
// 01:00 CLT) y el envío de n8n (lunes 07:00 CLT).
const MAX_ATTEMPTS = 4;
const RETRY_DELAY_MS = 7 * 60_000;

async function loginAndDownloadZip({ TL_USER, TL_PASSWORD, TL_DOMAIN, TL_START, TL_END, TL_UNIT_IDS }) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(60_000);

      // ── 1. Login ──────────────────────────────────────────────────────────────
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

      // ── 2. Descargar reporte para el rango exacto ─────────────────────────────
      console.log(`[3] Descargando: ${TL_START} → ${TL_END}`);
      const result = await page.evaluate(async (startDate, endDate, unitIds) => {
        const h    = JSONUSER.hash;
        const body = JSON.stringify({
          startDate,
          endDate,
          unitIds,
          reportName:          'Excesos 100 Semanal',
          parameters:          '  100  km/h',
          userTimeZone:        -4,
          userfuelMeasure:     0,
          userMeasureDistance: 0,
          speed:               100,
          language:            0,
        });
        const res = await fetch(
          `https://www.trackgts.com:82/api/reportTravel/GetSpeedingReportByUnitsPagesZip/24/${h}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json;charset=UTF-8' }, body }
        );
        const json = await res.json();
        if (!json.FileContents)
          return { error: `Sin FileContents: ${JSON.stringify(json).slice(0, 300)}` };
        return { fileContents: json.FileContents };
      }, TL_START, TL_END, TL_UNIT_IDS);

      if (result.error) throw new Error(result.error);
      return result.fileContents;
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
    throw new Error('Falta TL_UNIT_IDS — lista de unitIds de KADEL (excluyendo LTTW96, TVKC50, PKGT50, RHDZ45, SWFB15). Ver README.md.');
  }

  console.log(`=== Download Weekly KADEL: ${TL_START} → ${TL_END} ===`);
  console.log(`Unidades incluidas: ${TL_UNIT_IDS}`);

  const fileContents = await loginAndDownloadZip({ TL_USER, TL_PASSWORD, TL_DOMAIN, TL_START, TL_END, TL_UNIT_IDS });

  // ── 3. Extraer .xlsx del ZIP ───────────────────────────────────────────────
  const zip  = new AdmZip(Buffer.from(fileContents, 'base64'));
  const xlsx = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.xlsx'));
  if (!xlsx) throw new Error(`Sin .xlsx en ZIP. Entradas: ${zip.getEntries().map(e => e.entryName).join(', ')}`);

  const dest = path.join(process.cwd(), 'latest.xlsx');
  fs.writeFileSync(dest, xlsx.getData());
  console.log(`[4] Guardado como: ${dest}`);
  console.log('=== COMPLETADO ===');
}

main().catch(err => {
  console.error('ERROR FATAL:', err.message);
  process.exit(1);
});

# tracklink-kadel

Automatización del **Informe de Excesos de Velocidad (>100 km/h)** para KADEL,
clon parametrizado de [tracklink-santamarta](https://github.com/WurfelSPA/tracklink-santamarta).

Cada lunes a las 01:00 CLT, GitHub Actions descarga el reporte de TrackGTS,
lo fusiona con el historial y genera `reporte-semanal.pdf`. n8n lo descarga
y lo envía por email a las 07:00 CLT.

## Estado (2026-08-01)

- [x] Diseño confirmado (muestra enviada por Mauricio el 27/07, 5 páginas: portada, KPIs, unidades, distribución horaria, día + conclusiones)
- [x] `generate-pdf.js` — clon parametrizado, paleta navy/slate, agrupado por Unidad
- [x] `download-weekly.js` — clon parametrizado, unitIds vía secret `TL_UNIT_IDS`
- [x] `weekly-report.yml` — mismo horario que Santa Marta (lunes 01:00 CLT)
- [ ] **PENDIENTE: secret `TL_UNIT_IDS`** — falta el mapeo patente → unitId de
      TrackGTS para las unidades de KADEL, excluyendo:
      `LTTW96, TVKC50, PKGT50, RHDZ45, SWFB15`
- [ ] Secrets `TL_USER` / `TL_PASSWORD` / `TL_DOMAIN` (probablemente los mismos
      que Santa Marta — confirmar)
- [ ] Workflow n8n de envío (Lunes 07:00 CLT, TEST-only hasta validación del cliente)
- [ ] Prueba end-to-end contra el Excel de referencia antes de producción

## Umbral de velocidad

La API de TrackGTS (`GetSpeedingReportByUnitsPagesZip`) no acepta un umbral
configurable — siempre devuelve lo que el sistema marca como "exceso" según
su propio default. `generate-pdf.js` aplica un filtro adicional
(`CONFIG.speedThreshold = 100`) como red de seguridad para respetar el
umbral pactado con el cliente.

## Secrets requeridos (Settings → Secrets → Actions)

| Secret        | Descripción                                                  |
|---------------|---------------------------------------------------------------|
| `TL_USER`     | Usuario TrackGTS                                              |
| `TL_PASSWORD` | Contraseña TrackGTS                                            |
| `TL_DOMAIN`   | Subdominio (ej. `tlchile`)                                     |
| `TL_UNIT_IDS` | unitIds de KADEL separados por coma, ya excluyendo las 5 unidades fuera de monitoreo |

## Destinatarios finales (confirmar antes de activar envío real)

- p.rebolledo@kadel.cl
- a.verc.kadel@gmail.com
- j.silva@kadel.cl
- francisca.lopez@tracklink.cl

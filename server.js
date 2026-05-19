const http       = require("http");
const fs         = require("fs");
const path       = require("path");
const nodemailer = require("nodemailer");

const EMAIL_USER = process.env.EMAIL_USER || "";
const EMAIL_PASS = process.env.EMAIL_PASS || "";

const mailer = nodemailer.createTransport({
  service: "gmail",
  auth: { user: EMAIL_USER, pass: EMAIL_PASS }
});

const COUNTER_FILE = path.join(__dirname, "quote-counter.json");

function quoteNumber() {
  let data = { year: 0, seq: 0 };
  try { data = JSON.parse(fs.readFileSync(COUNTER_FILE, "utf8")); } catch(_) {}
  const year = new Date().getFullYear();
  if (data.year !== year) { data.year = year; data.seq = 0; }
  data.seq += 1;
  fs.writeFileSync(COUNTER_FILE, JSON.stringify(data));
  return "FES-" + year + "-" + String(data.seq).padStart(6, "0");
}

function expiryDate() {
  const d = new Date();
  d.setDate(d.getDate() + 15);
  return d.toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric" });
}

function buildClientHtml(b, qn) {
  const es      = b.lang === "es";
  const exp     = expiryDate();
  const today   = new Date().toLocaleDateString(es ? "es-US" : "en-US", { year:"numeric", month:"long", day:"numeric" });
  const incList = (b.includes || "").split("||").filter(Boolean);
  const incRows = incList.map(i =>
    `<tr><td style="padding:7px 0;border-bottom:1px solid #222;font-size:14px;color:#e8e8e8;">` +
    `<span style="color:#00e87a;margin-right:8px;">&#10003;</span>${i}</td></tr>`
  ).join("");

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>${es?"Cotización":"Quote"} ${qn}</title></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:32px 16px;">
<tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

<!-- HEADER -->
<tr><td style="background:#111;border:1px solid #2a2a2a;border-radius:16px 16px 0 0;padding:28px 32px;">
<table width="100%" cellpadding="0" cellspacing="0"><tr>
<td><div style="font-size:22px;font-weight:800;color:#FFD000;">&#9889; Fly Electric Solutions</div>
<div style="font-size:11px;color:#666;margin-top:4px;">Licensed &amp; Insured &middot; Houston, TX &middot; (571) 379-6040 &middot; info@flyelectricsolution.com</div></td>
<td align="right"><div style="background:rgba(255,208,0,0.1);border:1px solid rgba(255,208,0,0.3);border-radius:8px;padding:10px 16px;">
<div style="font-size:10px;color:#FFD000;text-transform:uppercase;letter-spacing:0.1em;">${es?"N&deg; Cotización":"Quote No."}</div>
<div style="font-size:16px;font-weight:800;color:#fff;margin-top:2px;">${qn}</div></div></td>
</tr></table></td></tr>

<!-- TITLE BAR -->
<tr><td style="background:#FFD000;padding:12px 32px;">
<table width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font-size:13px;font-weight:800;color:#0a0a0a;text-transform:uppercase;">
${es?"COTIZACIÓN PRELIMINAR DE SERVICIOS ELÉCTRICOS":"PRELIMINARY ELECTRICAL SERVICES QUOTE"}</td>
<td align="right" style="font-size:12px;color:#0a0a0a;">${es?"Fecha":"Date"}: ${today}</td>
</tr></table></td></tr>

<!-- CLIENT -->
<tr><td style="background:#111;border-left:1px solid #2a2a2a;border-right:1px solid #2a2a2a;padding:24px 32px;">
<table width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="48%" style="vertical-align:top;">
<div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:10px;">${es?"PREPARADO PARA":"PREPARED FOR"}</div>
<div style="font-size:16px;font-weight:700;color:#fff;">${b.name}</div>
<div style="font-size:13px;color:#aaa;margin-top:4px;">&#128222; ${b.phone}</div>
<div style="font-size:13px;color:#aaa;">&#9993; ${b.email}</div>
${b.address ? `<div style="font-size:13px;color:#aaa;">&#128205; ${b.address}</div>` : ""}
</td>
<td width="4%"></td>
<td width="48%" style="vertical-align:top;">
<div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:10px;">${es?"VALIDEZ":"VALIDITY"}</div>
<div style="font-size:13px;color:#aaa;">${es?"Válida hasta":"Valid until"}: <span style="color:#FFD000;font-weight:600;">${exp}</span></div>
<div style="font-size:13px;color:#aaa;">${es?"Urgente":"Rush"}: ${b.rush==="yes"?`<span style="color:#ff4545;">${es?"Sí (+25%)":"Yes (+25%)"}</span>`:"No"}</div>
</td></tr></table></td></tr>

<!-- SERVICE TABLE -->
<tr><td style="background:#111;border-left:1px solid #2a2a2a;border-right:1px solid #2a2a2a;padding:0 32px 24px;">
<div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px;">${es?"DETALLE DEL SERVICIO":"SERVICE DETAIL"}</div>
<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #2a2a2a;border-radius:10px;overflow:hidden;">
<tr style="background:#181818;"><td style="padding:10px 16px;font-size:11px;color:#666;text-transform:uppercase;">${es?"Descripción":"Description"}</td>
<td style="padding:10px 16px;font-size:11px;color:#666;text-transform:uppercase;">${es?"Detalle":"Detail"}</td></tr>
<tr style="background:#141414;"><td style="padding:11px 16px;font-size:13px;color:#aaa;border-top:1px solid #2a2a2a;">${es?"Servicio":"Service"}</td>
<td style="padding:11px 16px;font-size:13px;color:#fff;font-weight:600;border-top:1px solid #2a2a2a;">${b.service}</td></tr>
<tr style="background:#141414;"><td style="padding:11px 16px;font-size:13px;color:#aaa;border-top:1px solid #2a2a2a;">${es?"Opción":"Option"}</td>
<td style="padding:11px 16px;font-size:13px;color:#fff;border-top:1px solid #2a2a2a;">${b.option}</td></tr>
<tr style="background:#141414;"><td style="padding:11px 16px;font-size:13px;color:#aaa;border-top:1px solid #2a2a2a;">${es?"Tipo de Propiedad":"Property Type"}</td>
<td style="padding:11px 16px;font-size:13px;color:#fff;border-top:1px solid #2a2a2a;">${b.propertyType}</td></tr>
<tr style="background:#141414;"><td style="padding:11px 16px;font-size:13px;color:#aaa;border-top:1px solid #2a2a2a;">${es?"Área":"Area"}</td>
<td style="padding:11px 16px;font-size:13px;color:#fff;border-top:1px solid #2a2a2a;">${b.sqft} sq ft &middot; ${b.zone}</td></tr>
</table></td></tr>

<!-- PRICE -->
<tr><td style="background:#111;border-left:1px solid #2a2a2a;border-right:1px solid #2a2a2a;padding:0 32px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,208,0,0.07);border:1.5px solid rgba(255,208,0,0.35);border-radius:12px;">
<tr><td align="center" style="padding:24px;">
<div style="font-size:11px;color:#FFD000;text-transform:uppercase;letter-spacing:0.12em;margin-bottom:8px;">
${es?"RANGO ESTIMADO DEL PROYECTO":"ESTIMATED PROJECT RANGE"}</div>
<div style="font-size:36px;font-weight:800;color:#fff;">$${b.priceMin} <span style="color:#FFD000;">&#8211;</span> $${b.priceMax}</div>
<div style="font-size:12px;color:#666;margin-top:6px;">USD &middot; ${es?"Mano de obra + materiales básicos":"Labor + basic materials"}</div>
${b.rush==="yes"?`<div style="display:inline-block;background:rgba(255,69,69,0.12);border:1px solid rgba(255,69,69,0.3);color:#ff4545;padding:4px 12px;border-radius:100px;font-size:12px;margin-top:10px;">&#128680; ${es?"Urgente +25% incluido":"Rush +25% included"}</div>`:""}
</td></tr></table></td></tr>

<!-- INCLUDES -->
<tr><td style="background:#111;border-left:1px solid #2a2a2a;border-right:1px solid #2a2a2a;padding:0 32px 24px;">
<div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px;">${es?"QUÉ INCLUYE ESTA COTIZACIÓN":"WHAT'S INCLUDED"}</div>
<table width="100%" cellpadding="0" cellspacing="0">${incRows}</table></td></tr>

<!-- DISCLAIMER -->
<tr><td style="background:#111;border-left:1px solid #2a2a2a;border-right:1px solid #2a2a2a;padding:0 32px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,208,0,0.04);border:1px solid rgba(255,208,0,0.15);border-radius:10px;">
<tr><td style="padding:16px;">
<div style="font-size:12px;font-weight:700;color:#FFD000;margin-bottom:8px;">&#9888; ${es?"AVISO IMPORTANTE":"IMPORTANT DISCLAIMER"}</div>
<div style="font-size:12px;color:#888;line-height:1.7;">
${es
  ? "Esta es una cotizaci&oacute;n <strong style='color:#aaa;'>PRELIMINAR</strong> generada autom&aacute;ticamente basada &uacute;nicamente en la informaci&oacute;n proporcionada en l&iacute;nea. El costo final real puede variar seg&uacute;n las condiciones f&iacute;sicas del lugar, requisitos del c&oacute;digo el&eacute;ctrico local (NEC), permisos municipales, disponibilidad de materiales y trabajo adicional descubierto durante la inspecci&oacute;n. <strong style='color:#FFD000;'>La cotizaci&oacute;n formal y vinculante ser&aacute; emitida por un electricista certificado tras una inspecci&oacute;n presencial en el predio.</strong>"
  : "This is a <strong style='color:#aaa;'>PRELIMINARY</strong> quote generated automatically based solely on information provided online. The actual final cost may vary based on physical site conditions, local electrical code requirements (NEC), municipal permits, material availability, and additional work discovered during inspection. <strong style='color:#FFD000;'>The formal and binding quote will be issued by a licensed electrician after an on-site inspection of your property.</strong>"}
</div>
<div style="margin-top:12px;font-size:12px;color:#666;">
${es?`V&aacute;lida por <strong style='color:#aaa;'>15 d&iacute;as</strong> hasta el ${exp}.`:`Valid for <strong style='color:#aaa;'>15 days</strong> until ${exp}.`}
</div></td></tr></table></td></tr>

<!-- FOOTER -->
<tr><td style="background:#FFD000;border-radius:0 0 16px 16px;padding:20px 32px;">
<table width="100%" cellpadding="0" cellspacing="0"><tr>
<td><div style="font-size:14px;font-weight:800;color:#0a0a0a;">&#9889; Fly Electric Solutions LLC</div>
<div style="font-size:12px;color:#333;margin-top:3px;">Houston, TX &middot; ${es?"Licenciados y Asegurados":"Licensed &amp; Insured"}</div></td>
<td align="right">
<div style="font-size:13px;font-weight:700;color:#0a0a0a;">(571) 379-6040</div>
<div style="font-size:12px;color:#333;">info@flyelectricsolution.com</div>
</td></tr></table></td></tr>

</table></td></tr></table></body></html>`;
}

async function handleQuote(req, res) {
  let body;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw.toString("utf8"));
  } catch(e) {
    send(res, 400, { error: "Solicitud invalida." }); return;
  }

  if (!body.name || !body.phone || !body.email) {
    send(res, 400, { error: "Faltan campos requeridos." }); return;
  }

  const qn = quoteNumber();
  const es = body.lang === "es";

  try {
    // 1. Notificacion interna al negocio
    await mailer.sendMail({
      from:    `"Fly Electric Solutions" <${EMAIL_USER}>`,
      to:      "info@flyelectricsolution.com",
      subject: `[${qn}] ${es?"Solicitud de Cotizacion":"Quote Request"} — ${body.service} — ${body.name}`,
      text: `NUEVA SOLICITUD ${qn}\n\nCliente: ${body.name}\nTelefono: ${body.phone}\nEmail: ${body.email}\nDireccion: ${body.address||"No provista"}\n\nServicio: ${body.service}\nOpcion: ${body.option}\nMetraje: ${body.sqft} sq ft\nPropiedad: ${body.propertyType}\nZona: ${body.zone}\nUrgente: ${body.rush==="yes"?"SI (+25%)":"No"}\n\nESTIMADO: $${body.priceMin} - $${body.priceMax} USD`
    });

    // 2. Cotizacion HTML al cliente
    await mailer.sendMail({
      from:    `"Fly Electric Solutions" <${EMAIL_USER}>`,
      to:      body.email,
      subject: es ? `Tu Cotizacion ${qn} — ${body.service} — Fly Electric Solutions`
                  : `Your Quote ${qn} — ${body.service} — Fly Electric Solutions`,
      html: buildClientHtml(body, qn)
    });

    send(res, 200, { success: true, quote: qn });
  } catch(e) {
    console.error("[quote]", e.message);
    send(res, 500, { error: "Error al enviar el email: " + e.message });
  }
}

const PORT           = Number(process.env.PORT || 3000);
const MAX_BODY_BYTES = 55 * 1024 * 1024;

// --- Proveedores ---
const GEMINI_KEY   = process.env.GEMINI_API_KEY;
const OPENAI_KEY   = process.env.OPENAI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const GEMINI_BASE  = "https://generativelanguage.googleapis.com/v1beta/models";
const OPENAI_BASE  = "https://api.openai.com/v1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon"
};

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, ...CORS });
  res.end(type.includes("json") ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`Archivo demasiado grande (max ${MAX_BODY_BYTES / 1024 / 1024} MB).`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end",   () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function extractJson(text) {
  if (!text || typeof text !== "string") throw new Error("La IA no devolvio texto.");
  const cleaned = text.trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const start = cleaned.indexOf("{");
    const end   = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("La IA no devolvio JSON valido. Respuesta: " + cleaned.slice(0, 300));
  }
}

// Extrae base64 puro de un data URL
function dataUrlToBase64(dataUrl) {
  return dataUrl.replace(/^data:[^;]+;base64,/, "");
}

// Extrae el mime type de un data URL
function dataUrlMime(dataUrl, fallbackType) {
  const m = dataUrl.match(/^data:([^;]+);base64,/);
  return m ? m[1] : (fallbackType || "application/octet-stream");
}

// ─── GEMINI ──────────────────────────────────────────────────────────────────
async function analyzeWithGemini(prompt, files) {
  const parts = [];

  for (const file of files) {
    if (!file.dataUrl || !file.name) continue;
    const mime = dataUrlMime(file.dataUrl, file.type);
    // Gemini acepta imagenes y PDFs inline en base64 — sin subir archivos
    if (mime.startsWith("image/") || mime.includes("pdf")) {
      parts.push({
        inline_data: {
          mime_type: mime,
          data: dataUrlToBase64(file.dataUrl)
        }
      });
    }
  }

  if (!parts.length) throw new Error("No se recibio ninguna imagen o PDF valido.");

  parts.push({
    text: prompt + "\n\nIMPORTANTE: Responde UNICAMENTE con JSON valido. Sin markdown, sin texto antes ni despues."
  });

  const url = `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
    })
  });

  const payload = await res.json();
  if (!res.ok) {
    const msg = payload.error?.message || JSON.stringify(payload.error) || "Error de Gemini API.";
    throw new Error(msg);
  }

  const rawText = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return extractJson(rawText);
}

// ─── OPENAI ──────────────────────────────────────────────────────────────────
async function uploadPdfToOpenAI(apiKey, fileName, dataUrl) {
  const base64 = dataUrlToBase64(dataUrl);
  const pdfBuf = Buffer.from(base64, "base64");
  const boundary = `----PlanoBoundary${Date.now()}`;
  const CRLF = "\r\n";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="purpose"${CRLF}${CRLF}user_data${CRLF}`),
    Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="file"; filename="${fileName}"${CRLF}Content-Type: application/pdf${CRLF}${CRLF}`),
    pdfBuf,
    Buffer.from(`${CRLF}--${boundary}--${CRLF}`)
  ]);
  const res = await fetch(`${OPENAI_BASE}/files`, {
    method:  "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Error al subir PDF a OpenAI.");
  return data.id;
}

async function analyzeWithOpenAI(prompt, files) {
  const content = [];
  for (const file of files) {
    if (!file.dataUrl || !file.name) continue;
    const type = (file.type || "").toLowerCase();
    if (type.includes("pdf")) {
      const fileId = await uploadPdfToOpenAI(OPENAI_KEY, file.name, file.dataUrl);
      content.push({ type: "file", file: { file_id: fileId } });
    } else if (type.startsWith("image/")) {
      content.push({ type: "image_url", image_url: { url: file.dataUrl, detail: "high" } });
    }
  }
  if (!content.length) throw new Error("No se recibio ninguna imagen o PDF valido.");
  content.push({ type: "text", text: prompt + "\n\nIMPORTANTE: Responde UNICAMENTE con JSON valido." });

  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method:  "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: OPENAI_MODEL, messages: [{ role: "user", content }], max_tokens: 8192 })
  });
  const payload = await res.json();
  if (!res.ok) throw new Error(payload.error?.message || "Error de OpenAI API.");
  return extractJson(payload.choices?.[0]?.message?.content ?? "");
}

// ─── HANDLER PRINCIPAL ───────────────────────────────────────────────────────
async function analyze(req, res) {
  if (!GEMINI_KEY && !OPENAI_KEY) {
    send(res, 500, { error: "No hay API key configurada. Ejecuta: $env:GEMINI_API_KEY='TU_KEY' (gratis en aistudio.google.com)" });
    return;
  }

  let body;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw.toString("utf8"));
  } catch (e) {
    send(res, 400, { error: "Solicitud invalida: " + e.message });
    return;
  }

  const files = Array.isArray(body.files) ? body.files : [];
  if (!body.prompt || !files.length) {
    send(res, 400, { error: "Falta prompt o archivos en la solicitud." });
    return;
  }

  try {
    // Gemini tiene prioridad por ser gratis; OpenAI es el respaldo
    const analysis = GEMINI_KEY
      ? await analyzeWithGemini(body.prompt, files)
      : await analyzeWithOpenAI(body.prompt, files);

    send(res, 200, { analysis });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}

// ─── ARCHIVOS ESTATICOS ───────────────────────────────────────────────────────
function serveStatic(req, res) {
  const urlPath  = decodeURIComponent(req.url.split("?")[0]);
  const safePath = urlPath === "/" ? "/plano.html" : urlPath;
  const filePath = path.resolve(__dirname, "." + safePath);
  if (!filePath.startsWith(__dirname)) { send(res, 403, "Forbidden", "text/plain"); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { send(res, 404, "Not found", "text/plain"); return; }
    send(res, 200, data, MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream");
  });
}

// ─── SERVIDOR ─────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS")                                { res.writeHead(204, CORS); res.end(); return; }
  if (req.method === "POST" && req.url === "/api/analyze")     { analyze(req, res); return; }
  if (req.method === "POST" && req.url === "/api/quote")       { handleQuote(req, res); return; }
  if (req.method === "GET")                                    { serveStatic(req, res); return; }
  send(res, 405, { error: "Metodo no permitido." });
});

server.listen(PORT, () => {
  const proveedor = GEMINI_KEY ? `Gemini (${GEMINI_MODEL}) ✓` : OPENAI_KEY ? `OpenAI (${OPENAI_MODEL}) ✓` : "NINGUNO — configura GEMINI_API_KEY";
  console.log(`\nPlano corriendo en: http://localhost:${PORT}`);
  console.log(`Proveedor IA: ${proveedor}\n`);
});

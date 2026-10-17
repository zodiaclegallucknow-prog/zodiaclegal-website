import { Hono } from 'hono';
import { cors } from 'hono/cors';

const rateLimitStore = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 5;

export function resetRateLimitStore() {
  rateLimitStore.clear();
}

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    rateLimitStore.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  entry.count += 1;
  if (entry.count > MAX_REQUESTS_PER_WINDOW) {
    return true;
  }
  return false;
}

export function validateConsultationPayload(raw) {
  const fullName = String(raw.fullName ?? '').trim();
  const phone = String(raw.phone ?? '').trim();
  const email = String(raw.email ?? '').trim();
  const organization = String(raw.organization ?? '').trim();
  const practiceArea = String(raw.practiceArea ?? '').trim();
  const message = String(raw.message ?? '').trim();
  const bciConsent = String(raw.bciConsent ?? '').trim();
  const websiteUrl = String(raw.website_url ?? '').trim();

  if (websiteUrl.length > 0) {
    return { valid: true, honeypotTriggered: true, sanitized: null };
  }

  if (fullName.length < 2 || fullName.length > 120) {
    return { valid: false, error: 'Please provide a valid full name (2–120 characters).' };
  }

  if (!/^[0-9+\-\s()]{8,20}$/.test(phone)) {
    return { valid: false, error: 'Please provide a valid telephone or WhatsApp number.' };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) {
    return { valid: false, error: 'Please provide a valid email address.' };
  }

  if (!practiceArea || practiceArea.length > 80) {
    return { valid: false, error: 'Please select a practice area.' };
  }

  if (message.length < 20 || message.length > 2500) {
    return {
      valid: false,
      error: 'Please provide a brief matter overview between 20 and 2,500 characters.',
    };
  }

  if (bciConsent !== 'accepted' && bciConsent !== 'on' && bciConsent !== 'true') {
    return {
      valid: false,
      error: 'Please acknowledge the Bar Council of India non-solicitation notice.',
    };
  }

  return {
    valid: true,
    honeypotTriggered: false,
    sanitized: {
      fullName,
      phone,
      email,
      organization: organization.slice(0, 140),
      practiceArea,
      message,
      submittedAt: new Date().toISOString(),
    },
  };
}

export function getReceiverEmail() {
  const envEmail = (process.env.CONTACT_RECEIVER_EMAIL || '').trim();
  if (!envEmail || envEmail === 'contact@zodiaclegal.com') {
    return 'zodiaclegal.lucknow@gmail.com';
  }
  return envEmail;
}

async function sendNotificationEmail(sanitized) {
  const apiKey = process.env.RESEND_API_KEY;
  const receiver = getReceiverEmail();
  const sender = process.env.CONTACT_SENDER_EMAIL || 'onboarding@resend.dev';

  if (apiKey) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Zodiac Legal Intake <${sender}>`,
        to: [receiver],
        reply_to: sanitized.email,
        subject: `[Consultation Request] ${sanitized.practiceArea} — ${sanitized.fullName}`,
        text: [
          `New Consultation Inquiry via zodiaclegal.com`,
          `---------------------------------------------`,
          `Recipient Desk: ${receiver}`,
          `Name: ${sanitized.fullName}`,
          `Organization: ${sanitized.organization || 'Not specified'}`,
          `Phone / WhatsApp: ${sanitized.phone}`,
          `Email: ${sanitized.email}`,
          `Practice Area: ${sanitized.practiceArea}`,
          `Submitted At: ${sanitized.submittedAt}`,
          ``,
          `Matter Overview:`,
          sanitized.message,
        ].join('\n'),
      }),
    });

    if (!response.ok) {
      throw new Error(`Email delivery failed with status ${response.status}`);
    }

    return { delivered: true, mode: 'resend', recipient: receiver };
  }

  // Zero-config fallback relay to zodiaclegal.lucknow@gmail.com when RESEND_API_KEY is not configured
  if (process.env.NODE_ENV === 'production') {
    try {
      await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(receiver)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Origin: 'https://zodiaclegal.com',
          Referer: 'https://zodiaclegal.com/contact/',
        },
        body: JSON.stringify({
          _subject: `[Zodiac Legal Consultation] ${sanitized.practiceArea} — ${sanitized.fullName}`,
          _replyto: sanitized.email,
          _template: 'table',
          Full_Name: sanitized.fullName,
          Organization: sanitized.organization || 'Not specified',
          Phone_WhatsApp: sanitized.phone,
          Client_Email: sanitized.email,
          Practice_Area: sanitized.practiceArea,
          Matter_Overview: sanitized.message,
          Submitted_At: sanitized.submittedAt,
        }),
      });
    } catch (relayErr) {
      console.warn('FormSubmit relay warning:', relayErr);
    }
  }

  console.info('Consultation logged for:', receiver, sanitized);
  return { delivered: true, mode: 'logged', recipient: receiver };
}

export function createApp() {
  const app = new Hono();

  const allowedOrigins = (
    process.env.ALLOWED_ORIGINS ||
    'https://zodiaclegal.com,https://www.zodiaclegal.com,https://zodiaclegal-web.onrender.com,http://localhost:4321'
  )
    .split(',')
    .map((o) => o.trim());

  app.use(
    '/api/*',
    cors({
      origin: (origin) => {
        if (!origin) return allowedOrigins[0];
        return allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
      },
      allowMethods: ['POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Accept'],
    })
  );

  app.get('/healthz', (c) => {
    return c.json({
      status: 'ok',
      service: 'zodiaclegal-consultation-api',
      recipient: getReceiverEmail(),
      timestamp: new Date().toISOString(),
    });
  });

  app.post('/api/consult', async (c) => {
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('cf-connecting-ip') ||
      '127.0.0.1';

    if (isRateLimited(ip)) {
      return c.json(
        {
          ok: false,
          error:
            'Too many consultation requests from this address. Please try again in 15 minutes.',
        },
        429
      );
    }

    const contentType = c.req.header('content-type') || '';
    let bodyData = {};

    try {
      if (contentType.includes('application/json')) {
        bodyData = await c.req.json();
      } else {
        bodyData = await c.req.parseBody();
      }
    } catch {
      return c.json({ ok: false, error: 'Malformed request payload.' }, 400);
    }

    const validation = validateConsultationPayload(bodyData);
    if (!validation.valid) {
      return c.json({ ok: false, error: validation.error }, 400);
    }

    if (validation.honeypotTriggered) {
      return c.json({
        ok: true,
        message: 'Thank you. Your consultation request has been received.',
      });
    }

    try {
      await sendNotificationEmail(validation.sanitized);
    } catch (err) {
      console.error('Consultation email delivery error:', err);
      return c.json(
        {
          ok: false,
          error:
            'We encountered a temporary mail gateway error. Please email zodiaclegal.lucknow@gmail.com or call +91 98390 10163 directly.',
        },
        502
      );
    }

    const acceptsHtml = (c.req.header('accept') || '').includes('text/html');
    if (acceptsHtml && !contentType.includes('application/json')) {
      return c.redirect('https://zodiaclegal.com/contact/?submitted=true', 303);
    }

    return c.json({
      ok: true,
      recipient: 'zodiaclegal.lucknow@gmail.com',
      message:
        'Thank you. Your consultation request has been logged and routed to zodiaclegal.lucknow@gmail.com. Our corporate desk will respond within one business day.',
    });
  });

  return app;
}

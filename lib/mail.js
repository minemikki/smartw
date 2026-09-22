// Outbound email. Resend when configured, console otherwise.
//
// The console fallback is not a placeholder to replace later: it is how the
// magic-link flow is developed and tested without sending real mail. If it ever
// runs in production the link is still printed to the server log, so a login is
// recoverable rather than silently broken.

const FROM = process.env.MAIL_FROM || 'Smartwaiter <ingen-svar@example.invalid>';

export async function sendMail({ to, subject, text }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`\n[mail:console] til ${to}\n[mail:console] ${subject}\n${text}\n`);
    return { ok: true, via: 'console' };
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject, text }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      console.error('[mail] resend avviste', r.status, body.slice(0, 300));
      return { ok: false, via: 'resend', error: `${r.status}` };
    }
    return { ok: true, via: 'resend' };
  } catch (e) {
    console.error('[mail]', e.message);
    return { ok: false, via: 'resend', error: e.message };
  }
}

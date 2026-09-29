// Shared email helper + Samskar-themed templates.
// The leading underscore means Vercel does NOT turn this file into an endpoint
// (so it doesn't use up one of your free-plan functions).

const ADMIN_EMAIL = process.env.NOTIFY_EMAIL || 'official.samskar@gmail.com';
const BOOKING_FORM_URL = process.env.BOOKING_FORM_URL || 'https://tally.so/r/xXGlx5';
const ROSTER_URL = process.env.ROSTER_URL || 'https://samskarproject.vercel.app';
const MEMBERS_SITE_URL = process.env.MEMBERS_SITE_URL || 'https://samskarmembers.vercel.app';

function fromAddress() {
  const f = process.env.FROM_EMAIL || 'onboarding@resend.dev'; // Resend's shared test sender until you verify a domain
  return f.indexOf('<') > -1 ? f : 'Samskar <' + f + '>';
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// Never throws: a failed email must not break saving the data.
async function sendMail(to, subject, html) {
  if (!process.env.RESEND_API_KEY || !to) return { skipped: true };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromAddress(), to: [to], subject: subject, html: html }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error('Resend error', res.status, t);
      return { ok: false, error: t };
    }
    return { ok: true };
  } catch (err) {
    console.error('Email send failed', err);
    return { ok: false, error: err.message };
  }
}

// ---------- look & feel (maroon + gold, like the website) ----------
function layout(heading, inner) {
  return (
    '<div style="background:#FBF3E6;padding:24px 12px;font-family:Helvetica,Arial,sans-serif;color:#2B1B12;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #DBBE83;border-radius:10px;overflow:hidden;">' +
    '<tr><td style="background:#6E1F2B;padding:22px 26px;text-align:center;">' +
    '<div style="font-family:Georgia,serif;font-style:italic;font-size:28px;color:#E7C77E;">Samskar</div>' +
    '<div style="font-size:11px;letter-spacing:.14em;color:#F6E7C4;">CRAFTING TRADITIONS WITH TREND</div></td></tr>' +
    '<tr><td style="padding:26px;font-size:15px;line-height:1.6;">' +
    '<h2 style="font-family:Georgia,serif;font-weight:600;font-size:22px;color:#4A141C;margin:0 0 14px;">' + esc(heading) + '</h2>' +
    inner +
    '</td></tr>' +
    '<tr><td style="background:#F3E6C9;padding:14px 26px;text-align:center;font-family:Georgia,serif;font-style:italic;color:#5A4A3D;font-size:14px;">Celebrate Faith. Create Memories.</td></tr>' +
    '</table></div>'
  );
}
function p(t) { return '<p style="margin:0 0 12px;">' + t + '</p>'; }
function button(href, label) {
  return '<p style="margin:18px 0;"><a href="' + esc(href) + '" style="background:#6E1F2B;color:#E7C77E;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:600;display:inline-block;">' + esc(label) + '</a></p>';
}
function table(pairs) {
  const rows = pairs.filter(function (r) { return r[1] !== '' && r[1] != null; }).map(function (r) {
    return '<tr><td style="padding:7px 10px;border-bottom:1px solid #EEDFBA;color:#5A4A3D;width:38%;">' + esc(r[0]) + '</td><td style="padding:7px 10px;border-bottom:1px solid #EEDFBA;font-weight:600;">' + r[1] + '</td></tr>';
  }).join('');
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #DBBE83;margin:8px 0 14px;">' + rows + '</table>';
}
function rupees(n) { return '&#8377;' + Number(n).toLocaleString('en-IN'); }
function niceDate(s) {
  if (!s) return '';
  const d = new Date(String(s).slice(0, 10) + 'T00:00:00');
  return isNaN(d.getTime()) ? esc(s) : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
const NAMASTE = function (name) { return p('Namaste ' + esc(name || 'there') + ','); };

// ---------- templates ----------
function kycConfirmation(name) {
  return layout('We received your KYC details', NAMASTE(name) +
    p('Thank you for completing your KYC with Samskar. Your details are safely with our team.') +
    p('You will get a separate email with your booking form.'));
}
function bookingFormEmail(name) {
  return layout('Your booking form', NAMASTE(name) +
    p('Your KYC is complete, so you are all set to book with us. Please <b>save this email</b> and use the same form every time you want to book a service.') +
    button(BOOKING_FORM_URL, 'Open booking form') +
    p('Puja &amp; rituals, photography, decoration and catering &mdash; just tell us the occasion and we will take it from there.'));
}
function bookingConfirmation(b) {
  return layout('Booking received', NAMASTE(b.name) +
    p('Thank you for booking with Samskar. Here is what we received:') +
    table([['Service', esc(b.service)], ['Event date', niceDate(b.eventDate)], ['Location', esc(b.location)], ['Notes', esc(b.notes)]]) +
    p('Our team will confirm the details and cost with you, and your receipt will follow by email.'));
}
function adminBookingAlert(b) {
  return layout('New booking: ' + (b.name || ''), p('A new booking came in through the booking form.') +
    table([['Client', esc(b.name)], ['Phone', esc(b.phone)], ['Email', esc(b.email)], ['Service', esc(b.service)], ['Event date', niceDate(b.eventDate)], ['Location', esc(b.location)], ['Notes', esc(b.notes)]]) +
    p('A <b>draft receipt</b> was created in The Roster (without any amount). Add the cost and finalize it to email the receipt.') +
    button(ROSTER_URL, 'Open The Roster'));
}
function enrollmentConfirmation(name) {
  return layout('Enrollment received', NAMASTE(name) +
    p('Thank you for submitting your enrollment form. Our team will review your details.') +
    p('Once you are confirmed on the roster, your login details will arrive in a separate email.'));
}
function receiptEmail(r) {
  return layout('Your receipt from Samskar', NAMASTE(r.clientName) +
    p('Thank you. Here is your receipt:') +
    table([
      ['Receipt no.', esc(r.receiptNo)], ['Date', niceDate(r.receiptDate)], ['Client', esc(r.clientName)],
      ['Service', esc(r.service)], ['Event date', niceDate(r.eventDate)], ['Location', esc(r.location)],
      ['Details', esc(r.description)], ['Payment mode', esc(r.paymentMode)], ['Amount', rupees(r.amount)],
    ]) +
    p('Please keep your receipt number &mdash; you will need it to book again or update your details.'));
}
function credentialsEmail(m) {
  return layout('Welcome to the Samskar team', NAMASTE(m.name) +
    p('You have been added to the Samskar team' + (m.title ? ' as <b>' + esc(m.title) + '</b>' : '') + '. Here are your login details for the members site:') +
    table([['Member ID', esc(m.memberCode)], ['Login', esc(m.login)], ['Temporary password', esc(m.password)]]) +
    button(MEMBERS_SITE_URL, 'Log in to the members site') +
    p('Please change your password from the <b>Profile</b> page after you log in.'));
}

module.exports = {
  ADMIN_EMAIL, BOOKING_FORM_URL, esc, sendMail, layout,
  kycConfirmation, bookingFormEmail, bookingConfirmation, adminBookingAlert,
  enrollmentConfirmation, receiptEmail, credentialsEmail,
};

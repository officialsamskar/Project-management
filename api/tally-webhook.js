// Receives Tally form submissions and saves them in the Neon database.
//
// Tally calls this URL every time someone submits one of the four forms.
// Each request is signed by Tally with the shared TALLY_SIGNING_SECRET, so a
// request that isn't signed correctly is rejected: nobody can add fake
// customers or bookings by posting to this address.
//
// See SETUP.md for how the forms are connected.

const crypto = require("crypto");
const { neon } = require("@neondatabase/serverless");
const mail = require("./_mail");

const DATABASE_URL = process.env.DATABASE_URL;
const SIGNING_SECRET = process.env.TALLY_SIGNING_SECRET || "";
const sql = DATABASE_URL ? neon(DATABASE_URL) : null;

// Same forms (and same optional overrides) as api/roster.js.
const FORM_KEYS = {};
FORM_KEYS[process.env.TALLY_BOOKINGS_FORM_ID || "xXGlx5"] = "bookings";
FORM_KEYS[process.env.TALLY_KYC_FORM_ID || "RGOVK9"] = "kyc";
FORM_KEYS[process.env.TALLY_ENROLLMENT_FORM_ID || "obJk6P"] = "enrollment";
FORM_KEYS[process.env.TALLY_EXISTING_FORM_ID || "1AjRpO"] = "existing";
FORM_KEYS[process.env.TALLY_LEAVE_FORM_ID || "aQWkRW"] = "leave";

// Tally signs the exact bytes it sends, so the raw body is needed to check
// the signature.
function readRawBody(req){
  return new Promise(function(resolve, reject){
    if(typeof req.body === "string") return resolve(req.body);
    if(Buffer.isBuffer(req.body)) return resolve(req.body.toString("utf8"));
    if(req.body && typeof req.body === "object") return resolve(JSON.stringify(req.body)); // already parsed
    var chunks = [];
    req.on("data", function(c){ chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); });
    req.on("end", function(){ resolve(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", reject);
  });
}

function signatureIsValid(raw, given){
  var expected = crypto.createHmac("sha256", SIGNING_SECRET).update(raw).digest("base64");
  var a = Buffer.from(expected);
  var b = Buffer.from(String(given || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Turn one Tally field into plain text. Choice questions arrive as a list of
// option ids; the field's options map them back to the labels people saw.
function fieldText(f){
  var v = f.value;
  if(v === null || v === undefined) return "";
  var text;
  if(Array.isArray(v)){
    var names = {};
    (f.options || []).forEach(function(o){ names[o.id] = o.name; });
    text = v.map(function(x){
      if(x && typeof x === "object") return x.name || x.url || "";
      return names[x] || String(x);
    }).filter(Boolean).join(", ");
  } else if(typeof v === "object"){
    text = String(v.name || v.url || v.value || "");
  } else {
    text = String(v);
  }
  text = text.trim();

  // The app puts dates straight into a date input, which needs YYYY-MM-DD.
  if(text && f.type === "INPUT_DATE"){
    if(/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    var d = new Date(text);
    if(!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return text;
}


// ---------------- what happens after each form ----------------
function cleanDate(v){ return /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null; }
function validEmail(v){ return /^\S+@\S+\.\S+$/.test(String(v || "").trim()); }

async function afterSubmission(formKey, row, id, isNew){
  var email = String(row["Email"] || "").trim();

  // KYC done -> confirmation email + the booking form to use from now on.
  if(formKey === "kyc"){
    if(isNew && validEmail(email)){
      var name = row["Full Name"];
      await mail.sendMail(email, "We received your KYC details \u2014 Samskar", mail.kycConfirmation(name));
      await mail.sendMail(email, "Your Samskar booking form", mail.bookingFormEmail(name));
    }
    return;
  }

  // Booking -> draft receipt in the Roster (no budget/amount) + customer
  // confirmation + alert to the admin.
  if(formKey === "bookings"){
    var b = {
      name: row["Client Name"] || "", phone: row["Phone"] || "", email: email,
      service: row["Service"] || "", eventDate: cleanDate(row["Event Date"]),
      location: row["Location"] || "", notes: row["Notes"] || ""
    };
    var contact = validEmail(email) ? email : b.phone;
    var today = new Date().toISOString().slice(0, 10);
    // Editing a booking updates the draft, but only while it is still a draft.
    await sql`INSERT INTO receipts (id, receipt_no, client_name, contact, service, amount, payment_mode, project_id, note, issued_by, receipt_date, status, submission_id, event_date, location, description)
              VALUES (${"bk-" + id}, NULL, ${b.name}, ${contact || null}, ${b.service || null}, NULL, NULL, NULL, NULL, 'Booking form', ${today}, 'draft', ${id}, ${b.eventDate}, ${b.location || null}, ${b.notes || null})
              ON CONFLICT (submission_id) DO UPDATE SET
                client_name = EXCLUDED.client_name, contact = EXCLUDED.contact, service = EXCLUDED.service,
                event_date = EXCLUDED.event_date, location = EXCLUDED.location, description = EXCLUDED.description
              WHERE receipts.status = 'draft'`;
    if(isNew){
      if(validEmail(email)){
        await mail.sendMail(email, "We received your booking \u2014 Samskar", mail.bookingConfirmation(b));
      }
      await mail.sendMail(mail.ADMIN_EMAIL, "New booking: " + b.name, mail.adminBookingAlert(b));
    }
    return;
  }

  // Member enrollment -> confirmation to the person who filled it in.
  if(formKey === "enrollment"){
    if(isNew && validEmail(email)){
      await mail.sendMail(email, "We received your enrollment \u2014 Samskar", mail.enrollmentConfirmation(row["Full Name"]));
    }
    return;
  }
}

module.exports = async (req, res) => {
  if(req.method !== "POST"){
    res.status(405).json({ ok:false, error:"Method not allowed." });
    return;
  }
  if(!SIGNING_SECRET || !sql){
    res.status(500).json({ ok:false, error:"Server is missing TALLY_SIGNING_SECRET or DATABASE_URL." });
    return;
  }

  try {
    var raw = await readRawBody(req);
    if(!signatureIsValid(raw, req.headers["tally-signature"])){
      res.status(401).json({ ok:false, error:"Bad signature." });
      return;
    }

    var event = JSON.parse(raw);
    if(event.eventType !== "FORM_RESPONSE" || !event.data){
      res.status(200).json({ ok:true, ignored:"Not a form response." });
      return;
    }

    var data = event.data;
    var formKey = FORM_KEYS[data.formId];
    if(!formKey){
      res.status(200).json({ ok:true, ignored:"Not one of the Roster forms." });
      return;
    }

    var id = data.submissionId || data.responseId;
    if(!id){
      res.status(400).json({ ok:false, error:"Missing submission id." });
      return;
    }

    var row = {};
    (data.fields || []).forEach(function(f){
      var label = String(f.label || "").trim();
      if(label) row[label] = fieldText(f);
    });

    var submittedAt = data.createdAt || event.createdAt || new Date().toISOString();

    // Save the answers. If the same submission arrives again (Tally re-sends
    // it when a respondent EDITS their answers) the stored answers are updated
    // instead of ignored. "inserted" is true only the first time.
    var saved = await sql`INSERT INTO intake_submissions (id, form_key, submitted_at, data)
              VALUES (${String(id)}, ${formKey}, ${submittedAt}, ${JSON.stringify(row)}::jsonb)
              ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
              RETURNING (xmax = 0) AS inserted`;
    var isNew = !!(saved[0] && saved[0].inserted);

    // Automatic emails / draft receipt. Never let a failure here make Tally
    // retry (the answers are already safely saved).
    try {
      await afterSubmission(formKey, row, String(id), isNew);
    } catch (e) {
      console.error("Follow-up after submission failed", e);
    }

    res.status(200).json({ ok:true });
  } catch (err) {
    console.error("Tally webhook error", err);
    // A 500 makes Tally retry later, so a brief database hiccup loses nothing.
    res.status(500).json({ ok:false, error:"Couldn't save the submission." });
  }
};

// Keep the request body unparsed so the signature can be checked.
module.exports.config = { api: { bodyParser: false } };

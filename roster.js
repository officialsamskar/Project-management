const { neon } = require('@neondatabase/serverless');

// All of these must be set as Environment Variables in the Vercel project
// settings (Settings -> Environment Variables). Nothing sensitive is
// hardcoded in this file, so it's safe to commit / share / push to a repo.
const DATABASE_URL = process.env.DATABASE_URL;
const PORTAL_PIN = process.env.ROSTER_PIN;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || "onboarding@resend.dev"; // Resend's shared test sender; verify your own domain for production

// Optional: Tally API key, used to pull live form responses into the Intake tab.
// See SETUP.md. The form IDs below are the three forms created for this app
// (the ID is the last part of the form's share link, tally.so/r/<ID>); set the
// env vars only if you want to point Intake at different forms.
const TALLY_API_KEY = process.env.TALLY_API_KEY || "";
const TALLY_FORM_IDS = {
  bookings: process.env.TALLY_BOOKINGS_FORM_ID || "xXGlx5",
  kyc: process.env.TALLY_KYC_FORM_ID || "RGOVK9",
  enrollment: process.env.TALLY_ENROLLMENT_FORM_ID || "obJk6P"
};
const MEMBER_ENROLLMENT_FORM_URL = process.env.MEMBER_ENROLLMENT_FORM_URL || "";

const sql = DATABASE_URL ? neon(DATABASE_URL) : null;

// ---------------- mappers ----------------
function mapMember(r){
  return {
    id: r.id, memberCode: r.member_code, name: r.name, title: r.title, department: r.department,
    email: r.email, phone: r.phone, location: r.location,
    startDate: r.start_date ? String(r.start_date).slice(0,10) : null,
    status: r.status
  };
}
function mapLeave(r){
  return {
    id: r.id, memberId: r.employee_id, type: r.type,
    startDate: String(r.start_date).slice(0,10), endDate: String(r.end_date).slice(0,10),
    note: r.note, status: r.status, requestedBy: r.requested_by
  };
}
function mapPerformance(r){
  return { id: r.id, memberId: r.employee_id, date: String(r.date).slice(0,10), rating: r.rating, note: r.note, author: r.author };
}
function mapProject(r){
  return {
    id: r.id, name: r.name, description: r.description,
    currentMemberId: r.current_member_id, status: r.status,
    clientName: r.client_name, service: r.service,
    budget: r.budget != null ? Number(r.budget) : null,
    location: r.location, eventDate: r.event_date ? String(r.event_date).slice(0,10) : null
  };
}
function mapHandover(r){
  return {
    id: r.id, projectId: r.project_id, fromMemberId: r.from_member_id, toMemberId: r.to_member_id,
    note: r.note, handoverDate: String(r.handover_date).slice(0,10), notifyPrevious: r.notify_previous
  };
}
function mapReceipt(r){
  return {
    id: r.id, receiptNo: r.receipt_no, clientName: r.client_name, contact: r.contact,
    service: r.service, amount: Number(r.amount), paymentMode: r.payment_mode,
    projectId: r.project_id, note: r.note, issuedBy: r.issued_by,
    receiptDate: String(r.receipt_date).slice(0,10)
  };
}
function mapTestimonial(r){
  return {
    id: r.id, clientName: r.client_name, body: r.body, rating: r.rating,
    source: r.source, date: r.testimonial_date ? String(r.testimonial_date).slice(0,10) : null
  };
}
function mapKyc(r){
  return {
    id: r.id, fullName: r.full_name, idType: r.id_type, idNumber: r.id_number,
    phone: r.phone, email: r.email, address: r.address, source: r.source
  };
}
function mapService(r){
  return { id: r.id, name: r.name, description: r.description, active: r.active, sortOrder: r.sort_order };
}

// ---------------- email ----------------
async function sendEmail(to, subject, html){
  if(!RESEND_API_KEY || !to) return { skipped: true };
  try{
    var res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + RESEND_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject: subject, html: html })
    });
    if(!res.ok){
      var errText = await res.text();
      console.error("Resend error", res.status, errText);
      return { ok:false, error: errText };
    }
    return { ok:true };
  }catch(err){
    console.error("Email send failed", err);
    return { ok:false, error: err.message };
  }
}

// ---------------- Tally form responses ----------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Turn one Tally answer into plain text. Text, email, phone and date answers
// arrive as strings; choice answers (dropdowns, checkboxes) can arrive as a
// list of option ids, which we map back to the option's label.
function answerToText(resp, question){
  var answer = resp ? resp.answer : null;
  if(answer === null || answer === undefined) return "";
  var text = "";

  if(Array.isArray(answer)){
    var labels = {};
    ((question && question.fields) || []).forEach(function(f){
      var label = f.text || f.title || f.label;
      if(f.uuid && label) labels[f.uuid] = label;
    });
    var unresolved = false;
    var parts = answer.map(function(a){
      if(a && typeof a === "object") return a.name || a.url || a.text || "";
      var s = String(a);
      if(labels[s]) return labels[s];
      if(UUID_RE.test(s)) unresolved = true;
      return s;
    }).filter(Boolean);
    if(unresolved && typeof resp.formattedAnswer === "string" && resp.formattedAnswer.trim()){
      text = resp.formattedAnswer.trim();
    } else {
      text = parts.join(", ");
    }
  } else if(typeof answer === "object"){
    text = String(answer.name || answer.url || answer.text || answer.value || "");
  } else {
    text = String(answer);
  }
  text = text.trim();

  // The app puts this straight into a date input, which needs YYYY-MM-DD.
  if(text && question && question.type === "INPUT_DATE"){
    if(/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    var d = new Date(text);
    if(!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return text;
}

function formatTimestamp(iso){
  if(!iso) return "";
  var d = new Date(iso);
  if(isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

// Returns rows shaped like the old Google Sheet rows: one object per response,
// keyed by question title (plus "Timestamp"), newest first. The front end
// reads fields like row["Client Name"], so keep the form's question titles
// exactly as listed in SETUP.md.
async function fetchTallyForm(key){
  var formId = TALLY_FORM_IDS[key];
  if(!TALLY_API_KEY || !formId) return { configured:false, rows:[] };

  var questions = null;
  var submissions = [];
  for(var page = 1; page <= 20; page++){
    var res = await fetch(
      "https://api.tally.so/forms/" + encodeURIComponent(formId) + "/submissions?page=" + page + "&limit=100",
      { headers: { "Authorization": "Bearer " + TALLY_API_KEY } }
    );
    if(res.status === 401 || res.status === 403){
      throw new Error("Tally rejected the API key. Check TALLY_API_KEY in Vercel.");
    }
    if(res.status === 404){
      throw new Error("Tally couldn't find the " + key + " form. Check its form ID.");
    }
    if(!res.ok){
      throw new Error("Couldn't fetch the " + key + " responses from Tally (status " + res.status + ").");
    }
    var data = await res.json();
    if(!questions) questions = data.questions || [];
    submissions = submissions.concat(data.submissions || []);
    if(!data.hasMore) break;
  }

  var inputs = (questions || []).filter(function(q){
    return q && q.type !== "FORM_TITLE" && !q.isDeleted && String(q.title || "").trim();
  });

  submissions = submissions.filter(function(s){ return s.isCompleted !== false; });
  submissions.sort(function(a, b){ return new Date(b.submittedAt) - new Date(a.submittedAt); });

  var rows = submissions.map(function(s){
    var byQuestion = {};
    (s.responses || []).forEach(function(r){ byQuestion[r.questionId] = r; });
    var row = { "Timestamp": formatTimestamp(s.submittedAt) };
    inputs.forEach(function(q){
      row[String(q.title).trim()] = answerToText(byQuestion[q.id], q);
    });
    return row;
  });
  return { configured:true, rows: rows };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if(!DATABASE_URL || !PORTAL_PIN){
    res.status(500).json({ ok:false, error:"Server is missing DATABASE_URL or ROSTER_PIN environment variables. Set them in Vercel project settings." });
    return;
  }

  var pinHeader = req.headers['x-roster-pin'];
  if(pinHeader !== PORTAL_PIN){
    res.status(401).json({ ok:false, error:"Incorrect passcode." });
    return;
  }

  try{
    if(req.method === 'GET'){
      var members = await sql`SELECT * FROM employees ORDER BY name ASC`;
      var leave = await sql`SELECT * FROM leave_requests ORDER BY created_at DESC`;
      var performance = await sql`SELECT * FROM performance_notes ORDER BY created_at DESC`;
      var projects = await sql`SELECT * FROM projects ORDER BY created_at DESC`;
      var handovers = await sql`SELECT * FROM project_handovers ORDER BY created_at DESC`;
      var receipts = await sql`SELECT * FROM receipts ORDER BY created_at DESC`;
      var testimonials = await sql`SELECT * FROM testimonials ORDER BY created_at DESC`;
      var kyc = await sql`SELECT * FROM kyc_records ORDER BY created_at DESC`;
      var services = await sql`SELECT * FROM services ORDER BY sort_order ASC, name ASC`;
      res.status(200).json({
        ok:true,
        members: members.map(mapMember),
        leave: leave.map(mapLeave),
        performance: performance.map(mapPerformance),
        projects: projects.map(mapProject),
        handovers: handovers.map(mapHandover),
        receipts: receipts.map(mapReceipt),
        testimonials: testimonials.map(mapTestimonial),
        kycRecords: kyc.map(mapKyc),
        services: services.map(mapService),
        // (name kept from the Google Sheets version so the front end needs no change)
        sheetsConfigured: {
          bookings: !!(TALLY_API_KEY && TALLY_FORM_IDS.bookings),
          kyc: !!(TALLY_API_KEY && TALLY_FORM_IDS.kyc),
          enrollment: !!(TALLY_API_KEY && TALLY_FORM_IDS.enrollment)
        },
        memberEnrollmentFormUrl: MEMBER_ENROLLMENT_FORM_URL
      });
      return;
    }

    if(req.method === 'POST'){
      var body = req.body || {};
      var resource = body.resource;
      var action = body.action;
      var p = body.payload || {};

      // ---------- Tally intake ----------
      if(resource === 'sheet' && action === 'fetch'){
        if(!TALLY_FORM_IDS.hasOwnProperty(p.key)){ res.status(400).json({ ok:false, error:"Unknown intake form." }); return; }
        var sheetResult = await fetchTallyForm(p.key);
        res.status(200).json({ ok:true, configured: sheetResult.configured, rows: sheetResult.rows });
        return;
      }

      // ---------- members ----------
      if(resource === 'members' && action === 'create'){
        var codeRow = await sql`SELECT 'MBR-' || LPAD(nextval('member_code_seq')::text, 4, '0') AS code`;
        var memberCode = codeRow[0].code;
        await sql`
          INSERT INTO employees (id, member_code, name, title, department, email, phone, location, start_date, status)
          VALUES (${p.id}, ${memberCode}, ${p.name}, ${p.title||null}, ${p.department||null}, ${p.email||null}, ${p.phone||null}, ${p.location||null}, ${p.startDate||null}, ${p.status||'active'})
        `;
        res.status(200).json({ ok:true, memberCode: memberCode });
        return;
      }
      if(resource === 'members' && action === 'update'){
        await sql`
          UPDATE employees SET
            name=${p.name}, title=${p.title||null}, department=${p.department||null},
            email=${p.email||null}, phone=${p.phone||null}, location=${p.location||null},
            start_date=${p.startDate||null}, status=${p.status||'active'}
          WHERE id=${p.id}
        `;
        res.status(200).json({ ok:true });
        return;
      }
      if(resource === 'members' && action === 'delete'){
        await sql`DELETE FROM employees WHERE id=${p.id}`;
        res.status(200).json({ ok:true });
        return;
      }
      if(resource === 'members' && action === 'invite'){
        if(!p.email){ res.status(400).json({ ok:false, error:"An email address is required to send an invite." }); return; }
        var formLine = MEMBER_ENROLLMENT_FORM_URL
          ? "<p>Please fill out this short enrollment form to get started: <a href=\"" + MEMBER_ENROLLMENT_FORM_URL + "\">" + MEMBER_ENROLLMENT_FORM_URL + "</a></p>"
          : "<p>Your team will follow up shortly with next steps.</p>";
        var result = await sendEmail(
          p.email,
          "You're invited to join the Samskar team",
          "<p>Hi " + (p.name || "there") + ",</p><p>You've been invited to join the team at Samskar.</p>" +
          formLine +
          "<p>— The Roster</p>"
        );
        res.status(200).json({ ok:true, emailSkipped: !!result.skipped });
        return;
      }

      // ---------- leave ----------
      if(resource === 'leave' && action === 'create'){
        await sql`INSERT INTO leave_requests (id, employee_id, type, start_date, end_date, note, status, requested_by) VALUES (${p.id}, ${p.memberId}, ${p.type}, ${p.startDate}, ${p.endDate}, ${p.note||null}, 'pending', ${p.requestedBy||null})`;
        res.status(200).json({ ok:true });
        return;
      }
      if(resource === 'leave' && action === 'setStatus'){
        await sql`UPDATE leave_requests SET status=${p.status} WHERE id=${p.id}`;
        res.status(200).json({ ok:true });
        return;
      }
      if(resource === 'leave' && action === 'delete'){
        await sql`DELETE FROM leave_requests WHERE id=${p.id}`;
        res.status(200).json({ ok:true });
        return;
      }

      // ---------- performance ----------
      if(resource === 'performance' && action === 'create'){
        await sql`INSERT INTO performance_notes (id, employee_id, date, rating, note, author) VALUES (${p.id}, ${p.memberId}, ${p.date}, ${p.rating||null}, ${p.note}, ${p.author||null})`;
        res.status(200).json({ ok:true });
        return;
      }
      if(resource === 'performance' && action === 'delete'){
        await sql`DELETE FROM performance_notes WHERE id=${p.id}`;
        res.status(200).json({ ok:true });
        return;
      }

      // ---------- projects ----------
      if(resource === 'projects' && action === 'create'){
        await sql`
          INSERT INTO projects (id, name, description, current_member_id, status, client_name, service, budget, location, event_date)
          VALUES (${p.id}, ${p.name}, ${p.description||null}, ${p.memberId}, 'active', ${p.clientName||null}, ${p.service||null}, ${p.budget||null}, ${p.location||null}, ${p.eventDate||null})
        `;
        var handoverId = p.id + '-h0';
        await sql`INSERT INTO project_handovers (id, project_id, from_member_id, to_member_id, note, notify_previous) VALUES (${handoverId}, ${p.id}, NULL, ${p.memberId}, ${p.note||null}, false)`;

        var toRows = await sql`SELECT name, email FROM employees WHERE id=${p.memberId}`;
        if(toRows[0] && toRows[0].email){
          await sendEmail(
            toRows[0].email,
            "New project assigned: " + p.name,
            "<p>Hi " + toRows[0].name + ",</p><p>A new project has been assigned to you:</p><p><strong>" + p.name + "</strong></p>" +
            (p.description ? "<p>" + p.description + "</p>" : "") +
            "<p>— The Roster</p>"
          );
        }
        res.status(200).json({ ok:true });
        return;
      }

      if(resource === 'projects' && action === 'handover'){
        var projRows = await sql`SELECT * FROM projects WHERE id=${p.id}`;
        var project = projRows[0];
        if(!project){ res.status(400).json({ ok:false, error:"Project not found." }); return; }
        var fromMemberId = project.current_member_id;

        await sql`UPDATE projects SET current_member_id=${p.toMemberId} WHERE id=${p.id}`;
        var handoverId = p.id + '-h' + Date.now().toString(36);
        var notifyPrevious = p.notifyPrevious !== false;
        await sql`INSERT INTO project_handovers (id, project_id, from_member_id, to_member_id, note, notify_previous) VALUES (${handoverId}, ${p.id}, ${fromMemberId||null}, ${p.toMemberId}, ${p.note||null}, ${notifyPrevious})`;

        var toRows2 = await sql`SELECT name, email FROM employees WHERE id=${p.toMemberId}`;
        if(toRows2[0] && toRows2[0].email){
          await sendEmail(
            toRows2[0].email,
            "Project handed over to you: " + project.name,
            "<p>Hi " + toRows2[0].name + ",</p><p>A project has been handed over to you:</p><p><strong>" + project.name + "</strong></p>" +
            (p.note ? "<p>" + p.note + "</p>" : "") +
            "<p>— The Roster</p>"
          );
        }
        if(notifyPrevious && fromMemberId){
          var fromRows = await sql`SELECT name, email FROM employees WHERE id=${fromMemberId}`;
          if(fromRows[0] && fromRows[0].email){
            await sendEmail(
              fromRows[0].email,
              "Project transferred: " + project.name,
              "<p>Hi " + fromRows[0].name + ",</p><p>Your project <strong>" + project.name + "</strong> has been transferred to another member.</p>" +
              "<p>— The Roster</p>"
            );
          }
        }
        res.status(200).json({ ok:true });
        return;
      }

      if(resource === 'projects' && action === 'delete'){
        await sql`DELETE FROM projects WHERE id=${p.id}`;
        res.status(200).json({ ok:true });
        return;
      }

      // ---------- receipts ----------
      if(resource === 'receipts' && action === 'create'){
        var rcptRow = await sql`SELECT 'RCPT-' || LPAD(nextval('receipt_code_seq')::text, 4, '0') AS code`;
        var receiptNo = rcptRow[0].code;
        await sql`
          INSERT INTO receipts (id, receipt_no, client_name, contact, service, amount, payment_mode, project_id, note, issued_by, receipt_date)
          VALUES (${p.id}, ${receiptNo}, ${p.clientName}, ${p.contact||null}, ${p.service||null}, ${p.amount}, ${p.paymentMode||null}, ${p.projectId||null}, ${p.note||null}, ${p.issuedBy||null}, ${p.receiptDate||new Date().toISOString().slice(0,10)})
        `;
        res.status(200).json({ ok:true, receiptNo: receiptNo });
        return;
      }
      if(resource === 'receipts' && action === 'delete'){
        await sql`DELETE FROM receipts WHERE id=${p.id}`;
        res.status(200).json({ ok:true });
        return;
      }

      // ---------- testimonials ----------
      if(resource === 'testimonials' && action === 'create'){
        await sql`INSERT INTO testimonials (id, client_name, body, rating, source, testimonial_date) VALUES (${p.id}, ${p.clientName}, ${p.body}, ${p.rating||null}, ${p.source||'Manual'}, ${p.date||null})`;
        res.status(200).json({ ok:true });
        return;
      }
      if(resource === 'testimonials' && action === 'delete'){
        await sql`DELETE FROM testimonials WHERE id=${p.id}`;
        res.status(200).json({ ok:true });
        return;
      }

      // ---------- kyc ----------
      if(resource === 'kyc' && action === 'create'){
        await sql`INSERT INTO kyc_records (id, full_name, id_type, id_number, phone, email, address, source) VALUES (${p.id}, ${p.fullName}, ${p.idType||null}, ${p.idNumber||null}, ${p.phone||null}, ${p.email||null}, ${p.address||null}, ${p.source||'Manual'})`;
        res.status(200).json({ ok:true });
        return;
      }
      if(resource === 'kyc' && action === 'delete'){
        await sql`DELETE FROM kyc_records WHERE id=${p.id}`;
        res.status(200).json({ ok:true });
        return;
      }

      // ---------- services ----------
      if(resource === 'services' && action === 'create'){
        await sql`INSERT INTO services (id, name, description, active, sort_order) VALUES (${p.id}, ${p.name}, ${p.description||null}, ${p.active!==false}, ${p.sortOrder||0})`;
        res.status(200).json({ ok:true });
        return;
      }
      if(resource === 'services' && action === 'update'){
        await sql`UPDATE services SET name=${p.name}, description=${p.description||null}, active=${p.active!==false}, sort_order=${p.sortOrder||0} WHERE id=${p.id}`;
        res.status(200).json({ ok:true });
        return;
      }
      if(resource === 'services' && action === 'delete'){
        await sql`DELETE FROM services WHERE id=${p.id}`;
        res.status(200).json({ ok:true });
        return;
      }

      res.status(400).json({ ok:false, error:"Unknown resource or action." });
      return;
    }

    res.status(405).json({ ok:false, error:"Method not allowed." });
  }catch(err){
    console.error(err);
    res.status(500).json({ ok:false, error: err.message || "Server error." });
  }
};

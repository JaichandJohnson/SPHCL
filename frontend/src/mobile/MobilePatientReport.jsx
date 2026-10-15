import { mobileApi } from '@/lib/mobileApi';
import logo from '@/assets/mds-logo.png';

const titles = {
  routine: 'Laboratory Test Report',
  mr_surveillance: 'Measles / Rubella Surveillance Sample Report',
  diphtheria: 'Diphtheria Surveillance Report',
  pertussis: 'Pertussis Surveillance Report',
  rabies: 'National Rabies Control Programme - Rabies Surveillance Report',
  fla: 'Amoebic Meningoencephalitis Report',
  special_serology: 'Special Serology Report',
  typhoid_surveillance: 'Typhoid Surveillance Report',
};
const epidemiology = new Set(['mr_surveillance', 'diphtheria', 'pertussis', 'typhoid_surveillance']);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const show = (value) => escapeHtml(value === null || value === undefined || value === '' ? '—' : value);
const fmt = (value) => {
  if (!value) return '—';
  const str = String(value).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : str;
};
const result = (test) => [test.result1 ?? test.result_1, test.result2 ?? test.result_2]
  .filter((part) => part !== null && part !== undefined && String(part).trim() !== '')
  .map(escapeHtml).join(' / ') || '<strong>Pending</strong>';
const age = (record) => {
  const pieces = [['age_years', 'y'], ['age_months', 'm'], ['age_days', 'd']]
    .filter(([key]) => record[key] !== null && record[key] !== undefined && record[key] !== '')
    .map(([key, unit]) => `${record[key]}${unit}`);
  return pieces.join(' ') || (record.age ?? '—');
};

function buildReport(record) {
  const samples = Array.isArray(record.samples) ? record.samples : [];
  const title = titles[samples[0]?.dataset || record.dataset] || 'Laboratory Test Report';
  const allDates = samples.flatMap((sample) => (sample.tests || []).map((test) => test.result_date).filter(Boolean));
  const reportDate = allDates.sort().at(-1) || record.date;
  const sampleSections = samples.map((sample) => {
    const isEpid = epidemiology.has(sample.dataset || record.dataset);
    const rows = (sample.tests || []).map((test, index) => `
      <tr><td>${index + 1}</td><td>${show(test.test || test.name)}</td><td>${result(test)}</td><td>${show(fmt(test.result_date))}</td><td>${show(test.remarks)}</td></tr>`).join('');
    return `<section class="sample">
      <div class="sample-info"><span><b>Specimen No.:</b> ${show(sample.lab_number)}</span>
      ${isEpid ? `<span><b>EPID No.:</b> ${show(record.epid_number || sample.epid_number)}</span>` : ''}
      <span><b>Specimen:</b> ${show(sample.sample_type)}</span></div>
      <table><thead><tr><th>Sl.</th><th>Test</th><th>Result</th><th>Result Date</th><th>Test Remarks</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">No tests recorded</td></tr>'}</tbody></table>
      ${sample.remarks ? `<p><b>Sample Remarks:</b> ${show(sample.remarks)}</p>` : ''}
    </section>`;
  }).join('');
  const safeLogo = escapeHtml(new URL(logo, window.location.origin).href);
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>Individual Laboratory Report</title>
    <style>
      @page { size: A4 portrait; margin: 13mm; }
      * { box-sizing: border-box; }
      body { font-family: Arial, sans-serif; color: #111; margin: 0; font-size: 11px; }
      .actions { padding: 12px; background: #eef6f5; text-align: center; }
      .actions button { background: #0f766e; color: white; border: 0; border-radius: 8px; padding: 12px 20px; font-weight: bold; }
      .page { max-width: 210mm; margin: 0 auto; padding: 12mm; background: white; }
      header { display: flex; align-items: center; justify-content: center; gap: 12px; border-bottom: 2px solid #111; padding-bottom: 14px; text-align: center; }
      header img { width: 92px; height: 92px; object-fit: contain; }
      h1 { font-size: 16px; margin: 0; text-transform: uppercase; }
      h2 { font-size: 13px; margin: 6px 0; text-transform: uppercase; }
      h3 { font-size: 13px; margin: 10px 0 0; }
      .patient { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 18px 0; }
      .patient div { overflow-wrap: anywhere; }
      .sample { margin-top: 16px; break-inside: auto; }
      .sample-info { display: flex; gap: 15px; flex-wrap: wrap; padding: 8px; border: 1px solid #111; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      th, td { border: 1px solid #111; padding: 7px; text-align: left; overflow-wrap: anywhere; }
      thead { display: table-header-group; }
      tr { break-inside: avoid; }
      footer { border-top: 1px solid #999; margin-top: 24px; padding-top: 7px; display: flex; justify-content: space-between; gap: 12px; color: #555; font-size: 9px; }
      @media print { .actions { display: none; } .page { padding: 0; max-width: none; } }
      @media screen and (max-width: 550px) { .page { min-width: 700px; } body { overflow-x: auto; } }
    </style></head><body>
    <div class="actions"><button onclick="window.print()">Print / Save as PDF</button></div>
    <main class="page"><header><img src="${safeLogo}" alt="Laboratory logo"/><div>
      <h1>State Public Health and Clinical Laboratory, Trivandrum</h1>
      <h2>Molecular Diagnosis Section</h2><h3>${show(title)}</h3></div></header>
      <div class="patient"><div><b>Name:</b> ${show(record.name)}</div><div><b>Age:</b> ${show(age(record))}</div>
      <div><b>Sex:</b> ${show(record.sex)}</div><div><b>Referred from:</b> ${show(record.requesting_institution)}</div>
      <div><b>District:</b> ${show(record.district)}</div><div><b>Received on:</b> ${show(fmt(record.date))}</div></div>
      ${sampleSections || '<p>No samples recorded.</p>'}
      ${record.report_remarks ? `<p><b>Remarks:</b> ${show(record.report_remarks)}</p>` : ''}
      <footer><span>${show(fmt(reportDate))}</span><span>Computer-generated report – Signature not required</span></footer>
    </main></body></html>`;
}

export async function openMobilePatientReport(recordId) {
  // Open synchronously on the user's tap so mobile browsers do not block the tab.
  const reportWindow = window.open('', '_blank');
  if (!reportWindow) {
    window.alert('Please allow pop-ups for this site to view the patient report.');
    return;
  }
  reportWindow.document.write('<!doctype html><html><body><p>Loading patient report…</p></body></html>');
  reportWindow.document.close();
  try {
    // GET only: never issue or update reference snapshots and never write patient data.
    const response = await mobileApi.get(`/records/${encodeURIComponent(recordId)}`);
    reportWindow.document.open();
    reportWindow.document.write(buildReport(response.data));
    reportWindow.document.close();
  } catch (error) {
    reportWindow.document.open();
    reportWindow.document.write('<!doctype html><html><body><p>Unable to load patient report. Please close this tab and try again.</p></body></html>');
    reportWindow.document.close();
  }
}

import { mobileApi } from '@/lib/mobileApi';
import logo from '@/assets/mds-logo.png';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// Mobile Viewer reports are read-only. Never issue reference snapshots or modify records.
const TITLES = {
  routine: 'Laboratory Test Report',
  mr_surveillance: 'Measles / Rubella Surveillance Sample Report',
  diphtheria: 'Diphtheria Surveillance Report',
  pertussis: 'Pertussis Surveillance Report',
  rabies: 'National Rabies Control Programme - Rabies Surveillance Report',
  fla: 'Amoebic Meningoencephalitis Report',
  special_serology: 'Special Serology Report',
  typhoid_surveillance: 'Typhoid Surveillance Report',
};
const EPID_DATASETS = new Set(['mr_surveillance', 'diphtheria', 'pertussis', 'typhoid_surveillance']);
const isPresent = (value) => value !== null && value !== undefined && String(value).trim() !== '';
const rawText = (value, fallback = '—') => isPresent(value) ? String(value) : fallback;
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const show = (value) => escapeHtml(rawText(value));
const fmt = (value) => {
  if (!value) return '—';
  const str = String(value).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : str;
};
const age = (record) => {
  const pieces = [['age_years', 'y'], ['age_months', 'm'], ['age_days', 'd']]
    .filter(([key]) => isPresent(record[key]))
    .map(([key, unit]) => `${record[key]}${unit}`);
  return pieces.join(' ') || rawText(record.age);
};
const testResult = (test) => {
  const values = [test.result1 ?? test.result_1, test.result2 ?? test.result_2]
    .filter(isPresent).map(String);
  return values.length ? values.join(' / ') : 'Pending';
};
const reportDate = (record) => {
  const dates = (record.samples || []).flatMap((sample) =>
    (sample.tests || []).map((test) => test.result_date).filter(Boolean)
  );
  return dates.sort().at(-1) || record.date;
};
const datasetFor = (sample, record) => sample.dataset || record.dataset || '';
const titleFor = (record) => TITLES[datasetFor((record.samples || [])[0] || {}, record)] || 'Laboratory Test Report';
const referenceRemarks = (test, sample, record, references) => {
  const dataset = datasetFor(sample, record).toLowerCase();
  const testName = String(test.test || test.name || '').toLowerCase();
  const reference = (references || []).find((item) =>
    String(item.dataset || '').toLowerCase() === dataset &&
    String(item.test || '').toLowerCase() === testName &&
    item.display_on_report !== false
  );
  const normal = reference && isPresent(reference.normal_range)
    ? `Normal Range: ${reference.normal_range}${isPresent(reference.unit) ? ` ${reference.unit}` : ''}` : '';
  return [normal, reference?.reference_remarks, test.remarks].filter(isPresent).join('; ') || '—';
};

// Prefer the existing frozen snapshot. If none exists, use current test references.
// Both requests are GET only. Missing references must not prevent report generation.
async function loadReferences(record) {
  if (Array.isArray(record.report_reference_snapshot)) return record.report_reference_snapshot;
  try {
    const response = await mobileApi.get('/test-references');
    return Array.isArray(response.data) ? response.data : [];
  } catch (error) {
    console.warn('Test references unavailable for report:', error?.message || error);
    return [];
  }
}

// Browser report uses the same information and includes all pending tests.
function buildReport(record, references) {
  const samples = Array.isArray(record.samples) ? record.samples : [];
  const sampleSections = samples.map((sample) => {
    const isEpid = EPID_DATASETS.has(datasetFor(sample, record));
    const rows = (sample.tests || []).map((test, index) => `
      <tr><td>${index + 1}</td><td>${show(test.test || test.name)}</td>
      <td><strong>${show(testResult(test))}</strong></td><td>${show(fmt(test.result_date))}</td>
      <td>${show(referenceRemarks(test, sample, record, references))}</td></tr>`).join('');
    return `<section class="sample">
      <div class="sample-info"><span><b>Specimen No.:</b> ${show(sample.lab_number)}</span>
      ${isEpid ? `<span><b>EPID No.:</b> ${show(record.epid_number || sample.epid_number)}</span>` : ''}
      <span><b>Specimen:</b> ${show(sample.sample_type)}</span></div>
      <table><thead><tr><th>Sl.</th><th>Test</th><th>Result</th><th>Result Date</th><th>Test Remarks</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">No tests recorded</td></tr>'}</tbody></table>
      ${isPresent(sample.remarks) ? `<p><b>Sample Remarks:</b> ${show(sample.remarks)}</p>` : ''}
    </section>`;
  }).join('');
  const safeLogo = escapeHtml(new URL(logo, window.location.origin).href);
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>Individual Laboratory Report</title>
    <style>
      @page { size: A4 portrait; margin: 10mm; }
      * { box-sizing: border-box; }
      body { font-family: Arial, sans-serif; color: #111; margin: 0; font-size: 11px; }
      .actions { padding: 12px; background: #eef6f5; text-align: center; }
      .actions button { background: #0f766e; color: white; border: 0; border-radius: 8px; padding: 12px 20px; font-weight: bold; }
      .page { max-width: 210mm; margin: 0 auto; padding: 10mm; background: white; }
      header { position: relative; min-height: 180px; border-bottom: 2px solid #111; padding: 20px 0 14px; text-align: center; }
      header img { position: absolute; left: 0; top: 0; width: 140px; height: 140px; object-fit: contain; }
      .heading { margin-left: 130px; }
      h1 { font-size: 18px; margin: 0; text-transform: uppercase; }
      h2 { font-size: 15px; margin: 8px 0; text-transform: uppercase; }
      h3 { font-size: 15px; margin: 12px 0 0; }
      .patient { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; font-size: 13px; margin: 18px 0; }
      .patient div { overflow-wrap: anywhere; }
      .sample { margin-top: 16px; }
      .sample-info { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid #111; }
      .sample-info span { padding: 8px; border-right: 1px solid #111; }
      .sample-info span:last-child { border-right: none; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      th, td { border: 1px solid #111; padding: 7px; text-align: left; overflow-wrap: anywhere; }
      thead { display: table-header-group; }
      tr { break-inside: avoid; }
      footer { border-top: 1px solid #cbd5e1; margin-top: 24px; padding-top: 7px; display: flex; justify-content: space-between; gap: 12px; color: #64748b; font-size: 9px; }
      @media print { .actions { display: none; } .page { padding: 0; max-width: none; } }
      @media screen and (max-width: 550px) { .page { min-width: 700px; } body { overflow-x: auto; } }
    </style></head><body>
    <div class="actions"><button onclick="window.print()">Print / Save as PDF</button></div>
    <main class="page"><header><img src="${safeLogo}" alt="Laboratory logo"/><div class="heading">
      <h1>State Public Health and Clinical Laboratory, Trivandrum</h1>
      <h2>Molecular Diagnosis Section</h2><h3>${show(titleFor(record))}</h3></div></header>
      <div class="patient"><div><b>Name:</b> ${show(record.name)}</div><div><b>Age:</b> ${show(age(record))}</div>
      <div><b>Sex:</b> ${show(record.sex)}</div><div><b>Referred from:</b> ${show(record.requesting_institution)}</div>
      <div><b>District:</b> ${show(record.district)}</div><div><b>Received on:</b> ${show(fmt(record.date))}</div></div>
      ${sampleSections || '<p>No samples recorded.</p>'}
      ${isPresent(record.report_remarks) ? `<p><b>Remarks:</b> ${show(record.report_remarks)}</p>` : ''}
      <footer><span>${show(fmt(reportDate(record)))}</span><span>Computer-generated report – Signature not required</span></footer>
    </main></body></html>`;
}

// Prepare a small JPEG for the PDF instead of embedding the full-resolution PNG.
// Preserve the original aspect ratio to avoid stretching the laboratory seal.
async function loadLogoForPdf() {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const maxDimension = 500;
        const scale = Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight));
        const width = Math.max(1, Math.round(img.naturalWidth * scale));
        const height = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Unable to prepare laboratory logo');
        // JPEG has no transparency. White matches the report background.
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);
        context.drawImage(img, 0, 0, width, height);
        resolve({
          data: canvas.toDataURL('image/jpeg', 0.82),
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
      } catch (error) {
        reject(error);
      }
    };
    img.onerror = () => reject(new Error('Unable to load laboratory logo'));
    img.src = logo;
  });
}

// jsPDF's built-in Helvetica font is Latin-only. Replace unsupported typographic
// symbols to avoid corrupt glyphs; other non-Latin scripts require a bundled font.
const pdfText = (value) => rawText(value).replace(/[—–]/g, '-').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/−/g, '-');

async function shareAndroidReport(record, references) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PAGE_WIDTH = 210;
  const PAGE_HEIGHT = 297;
  const LEFT = 10;
  const RIGHT = 200;
  const BOTTOM = 278;
  let y = 10;

  const drawWrapped = (text, x, top, width, fontSize = 10, bold = false, lineHeight = 4.8, align = 'left') => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(fontSize);
    const lines = pdf.splitTextToSize(pdfText(text), width);
    pdf.text(lines, align === 'center' ? x + width / 2 : x, top, { align });
    return top + Math.max(1, lines.length) * lineHeight;
  };
  const newPageIfNeeded = (required = 12) => {
    if (y + required > BOTTOM) {
      pdf.addPage();
      y = 14;
    }
  };
  const drawHeader = async () => {
    let logoData;
    try { logoData = await loadLogoForPdf(); } catch (error) {
      console.warn('Report logo unavailable:', error?.message || error);
    }
    if (logoData) {
      const maxWidth = 43;
      const maxHeight = 43;
      const ratio = Math.min(maxWidth / logoData.width, maxHeight / logoData.height);
      const logoWidth = logoData.width * ratio;
      const logoHeight = logoData.height * ratio;
      const logoX = 10 + (maxWidth - logoWidth) / 2;
      const logoY = 9 + (maxHeight - logoHeight) / 2;
      try { pdf.addImage(logoData.data, 'JPEG', logoX, logoY, logoWidth, logoHeight, undefined, 'MEDIUM'); } catch (error) {
        console.warn('Unable to embed report logo:', error?.message || error);
      }
    }
    const headingX = 56;
    const headingWidth = 140;
    let headingY = 19;
    headingY = drawWrapped('STATE PUBLIC HEALTH AND CLINICAL LABORATORY, TRIVANDRUM', headingX, headingY, headingWidth, 12, true, 6, 'center');
    headingY = drawWrapped('MOLECULAR DIAGNOSIS SECTION', headingX, headingY + 2, headingWidth, 11, true, 5, 'center');
    drawWrapped(titleFor(record), headingX, headingY + 4, headingWidth, 11, true, 5, 'center');
    pdf.setDrawColor(0);
    pdf.setLineWidth(0.55);
    pdf.line(LEFT, 58, RIGHT, 58);
    y = 66;
  };
  await drawHeader();

  const details = [
    ['Name', record.name], ['Age', age(record)], ['Sex', record.sex],
    ['Referred from', record.requesting_institution], ['District', record.district], ['Received on', fmt(record.date)],
  ];
  for (let index = 0; index < details.length; index += 3) {
    const cells = details.slice(index, index + 3);
    const heights = cells.map(([label, value], column) => {
      const x = LEFT + column * 63.3;
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9);
      pdf.text(`${label}:`, x, y);
      const labelWidth = pdf.getTextWidth(`${label}: `);
      const lines = pdf.splitTextToSize(pdfText(value), Math.max(14, 61 - labelWidth));
      pdf.setFont('helvetica', 'normal');
      pdf.text(lines, x + labelWidth, y);
      return Math.max(1, lines.length) * 5;
    });
    y += Math.max(...heights) + 4;
  }
  y += 3;

  const samples = Array.isArray(record.samples) ? record.samples : [];
  for (const sample of samples) {
    newPageIfNeeded(35);
    const isEpid = EPID_DATASETS.has(datasetFor(sample, record));
    const cells = isEpid
      ? [['Specimen No.', sample.lab_number], ['EPID No.', record.epid_number || sample.epid_number], ['Specimen', sample.sample_type]]
      : [['Specimen No.', sample.lab_number], ['Specimen', sample.sample_type]];
    const cellWidth = (RIGHT - LEFT) / cells.length;
    const linesByCell = cells.map(([label, value]) => ({
      label,
      lines: pdf.splitTextToSize(pdfText(value), cellWidth - 5),
    }));
    const boxHeight = Math.max(14, ...linesByCell.map((cell) => 9 + cell.lines.length * 4));
    newPageIfNeeded(boxHeight + 15);
    cells.forEach((cell, index) => {
      const x = LEFT + index * cellWidth;
      pdf.setLineWidth(0.25);
      pdf.rect(x, y, cellWidth, boxHeight);
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8);
      pdf.text(cell[0].toUpperCase(), x + 2.5, y + 4);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9);
      pdf.text(linesByCell[index].lines, x + 2.5, y + 9);
    });
    y += boxHeight + 3;

    const tests = Array.isArray(sample.tests) ? sample.tests : [];
    const body = tests.length
      ? tests.map((test, index) => [
          String(index + 1),
          pdfText(test.test || test.name),
          pdfText(testResult(test)),
          pdfText(fmt(test.result_date)),
          pdfText(referenceRemarks(test, sample, record, references)),
        ])
      : [['', 'No tests recorded', '', '', '']];

    autoTable(pdf, {
      startY: y,
      head: [['Sl.', 'Test', 'Result', 'Result Date', 'Test Remarks']],
      body,
      theme: 'grid',
      margin: { left: LEFT, right: 10, top: 14, bottom: 20 },
      tableWidth: 190,
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2, lineColor: [0, 0, 0], lineWidth: 0.2, overflow: 'linebreak', textColor: [0, 0, 0], valign: 'top' },
      headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: 'bold', lineWidth: 0.25 },
      columnStyles: {
        0: { cellWidth: 12, halign: 'center' },
        1: { cellWidth: 49 },
        2: { cellWidth: 43, fontStyle: 'bold' },
        3: { cellWidth: 28 },
        4: { cellWidth: 58 },
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 2 && data.cell.raw === 'Pending') {
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });
    y = pdf.lastAutoTable.finalY + 5;
    if (isPresent(sample.remarks)) {
      const lines = pdf.splitTextToSize(`Sample Remarks: ${pdfText(sample.remarks)}`, 188);
      newPageIfNeeded(lines.length * 5 + 5);
      y = drawWrapped(`Sample Remarks: ${sample.remarks}`, LEFT, y, 188, 9, false, 5) + 2;
    }
    y += 4;
  }

  if (!samples.length) {
    y = drawWrapped('No samples recorded.', LEFT, y, 180, 10) + 4;
  }
  if (isPresent(record.report_remarks)) {
    const lines = pdf.splitTextToSize(pdfText(record.report_remarks), 190);
    newPageIfNeeded(lines.length * 5 + 12);
    y = drawWrapped('Remarks:', LEFT, y, 190, 10, true, 5) + 1;
    y = drawWrapped(record.report_remarks, LEFT, y, 190, 9, false, 5);
  }

  const pageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(203, 213, 225);
    pdf.setLineWidth(0.2);
    pdf.line(LEFT, 283, RIGHT, 283);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(100, 116, 139);
    pdf.text(pdfText(fmt(reportDate(record))), LEFT, 288);
    pdf.text(`${page} of ${pageCount}`, PAGE_WIDTH / 2, 288, { align: 'center' });
    pdf.text('Computer-generated report - Signature not required', RIGHT, 288, { align: 'right' });
    pdf.setTextColor(0, 0, 0);
  }

  const base64 = pdf.output('datauristring').split(',')[1];
  const fileName = `MDS-Lab-Report-${Date.now()}.pdf`;
  const saved = await Filesystem.writeFile({
    path: fileName,
    data: base64,
    directory: Directory.Cache,
  });
  await Share.share({
    title: 'MDS Laboratory Report',
    url: saved.uri,
    dialogTitle: 'Save or share laboratory report',
  });
}

export async function openMobilePatientReport(recordId) {
  if (Capacitor.isNativePlatform()) {
    try {
      const response = await mobileApi.get(`/records/${encodeURIComponent(recordId)}`);
      const references = await loadReferences(response.data);
      await shareAndroidReport(response.data, references);
    } catch (error) {
      console.error('Android PDF report failed:', error);
      window.alert('Unable to generate or share the PDF report.');
    }
    return;
  }

  // Open synchronously on tap so mobile browsers do not block the new tab.
  const reportWindow = window.open('', '_blank');
  if (!reportWindow) {
    window.alert('Please allow pop-ups for this site to view the patient report.');
    return;
  }
  reportWindow.document.write('<!doctype html><html><body><p>Loading patient report…</p></body></html>');
  reportWindow.document.close();
  try {
    const response = await mobileApi.get(`/records/${encodeURIComponent(recordId)}`);
    const references = await loadReferences(response.data);
    reportWindow.document.open();
    reportWindow.document.write(buildReport(response.data, references));
    reportWindow.document.close();
  } catch (error) {
    reportWindow.document.open();
    reportWindow.document.write('<!doctype html><html><body><p>Unable to load patient report. Please close this tab and try again.</p></body></html>');
    reportWindow.document.close();
  }
}

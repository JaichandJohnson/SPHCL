export const AUTH = {
  loginButton: "login-google-button",
  logoutButton: "logout-button",
};
export const NAV = {
  dashboard: "nav-dashboard",
  dataEntry: "nav-data-entry",
  records: "nav-records",
  reports: "nav-reports",
  bulkImport: "nav-bulk-import",
  bulkResult: "nav-bulk-result",
  settings: "nav-settings",
};
export const RECORDS = {
  labNumber: "input-lab-number",
  date: "input-date",
  name: "input-name",
  age: "input-age",
  district: "select-district",
  test: "select-test",
  sampleType: "select-sample-type",
  resultName: (i) => `input-result-name-${i}`,
  resultValue: (i) => `input-result-value-${i}`,
  addResultRow: "add-dynamic-result-row",
  removeResultRow: (i) => `remove-result-row-${i}`,
  resultDate: "input-result-date",
  submit: "submit-lab-record-button",
  cancel: "cancel-lab-record-button",
  remarks: "input-remarks",
};
export const TABLE = {
  root: "records-table",
  row: (id) => `record-row-${id}`,
  edit: (id) => `edit-record-${id}`,
  delete: (id) => `delete-record-${id}`,
  select: (id) => `select-record-${id}`,
  selectAll: "select-all-records",
};
export const REPORT = {
  filterTest: "filter-test",
  filterDistrict: "filter-district",
  filterSampleType: "filter-sample-type",
  filterResult: "filter-result-contains",
  filterFrom: "filter-date-from",
  filterTo: "filter-date-to",
  apply: "apply-filters-button",
  reset: "reset-filters-button",
  exportCsv: "export-csv-button",
  exportXlsx: "export-xlsx-button",
  saveDrive: "save-drive-button",
};
export const IMPORT = {
  fileInput: "csv-file-input",
  uploadButton: "upload-csv-button",
  result: "import-result-box",
};
export const BULK = {
  testFilter: "bulk-test-filter",
  applyOpen: "open-bulk-apply-button",
  resultName: (i) => `bulk-result-name-${i}`,
  resultValue: (i) => `bulk-result-value-${i}`,
  addResult: "bulk-add-result-row",
  resultDate: "bulk-result-date",
  applyConfirm: "bulk-apply-confirm-button",
};

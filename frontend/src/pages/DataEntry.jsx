import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { scheduleDriveSync } from "@/lib/drive";
import { useNavigate, useParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CheckCircle,
  FloppyDisk,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Trash,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { RECORDS } from "@/constants/testIds";
import { localDateValue, millisecondsUntilNextDay } from "@/lib/localDate";

const DATASETS = [
  { key: "routine", label: "Routine", prefix: "MDS" },
  { key: "mr_surveillance", label: "MR Surveillance", prefix: "MR" },
  { key: "diphtheria", label: "Diphtheria", prefix: "WD" },
  { key: "pertussis", label: "Pertussis", prefix: "WP" },
  { key: "rabies", label: "Rabies", prefix: "R" },
  { key: "fla", label: "FLA", prefix: "FLA" },
  { key: "special_serology", label: "Special Serology", prefix: "VPD" },
  { key: "typhoid_surveillance", label: "Typhoid Surveillance", prefix: "TY" },
];

const EPID_TAGS = {
  mr_surveillance: "MR",
  diphtheria: "DTH",
  pertussis: "PTS",
};

const DISTRICT_CODES = {
  trivandrum: "TRM",
  thiruvananthapuram: "TRM",
  kollam: "KLM",
  pathanamthitta: "PTM",
  idukki: "IDK",
  alappuzha: "APZ",
  kottayam: "KOT",
  ernakulam: "ENK",
  thrissur: "THR",
  palakkad: "PLK",
  malappuram: "MPM",
  kozhikode: "KZK",
  kannur: "KNU",
  wayanad: "WYD",
  kasaragod: "KSG",
  kasargod: "KSG",
  lakshadweep: "LKD",
};

const PATIENT_EPID_DATASETS = new Set([
  "mr_surveillance",
  "diphtheria",
  "pertussis",
]);

const DEFAULT_SAMPLE_BY_DATASET = {
  special_serology: "Serum",
  typhoid_surveillance: "Whole Blood",
  diphtheria: "Throat Swab",
};

const patientEpidDataset = (form, defaultDataset) => {
  const values = [
    ...(form.samples || []).map((sample) => sample.dataset),
    defaultDataset,
  ];
  return values.find((value) =>
    PATIENT_EPID_DATASETS.has(value)
  ) || "";
};

const getSavedDataset = () =>
  localStorage.getItem("mds_last_dataset") || "routine";

const makeId = (prefix) =>
  `${prefix}_${crypto.randomUUID?.() || Date.now()}`;

const newTest = (name = "", sources = []) => ({
  id: makeId("test"),
  test: name,
  result1: "",
  result2: "",
  result_date: "",
  remarks: "",
  sources,
});

const newSample = (dataset = getSavedDataset()) => ({
  id: makeId("sample"),
  dataset,
  lab_number: "",
  epid_number: "",
  sample_type: DEFAULT_SAMPLE_BY_DATASET[dataset] || "",
  tests: [],
  assigned_panels: [],
  remarks: "",
  testSearch: "",
});

const emptyForm = (dataset = getSavedDataset()) => ({
  dataset,
  date: localDateValue(),
  name: "",
  age: "",
  sex: "",
  district: "Trivandrum",
  requesting_institution: "",
  epid_number: "",
  samples: [],
  remarks: "",
});

const datasetInfo = (key) =>
  DATASETS.find((item) => item.key === key) || DATASETS[0];

const epidPrefix = (dataset, district) => {
  const tag = EPID_TAGS[dataset];
  const normalizedDistrict = String(district || "").trim().toLowerCase();
  const code = DISTRICT_CODES[normalizedDistrict];

  if (!tag || !code) return "";

  const year = String(new Date().getFullYear()).slice(-2);

  return normalizedDistrict === "lakshadweep"
    ? `${tag} IND LK LKD ${year}`
    : `${tag} IND KE ${code} ${year}`;
};

const epidSuffix = (fullValue, dataset, district) => {
  const prefix = epidPrefix(dataset, district);
  const value = String(fullValue || "").trim();

  if (!prefix) return value;
  if (value.startsWith(prefix)) {
    return value.slice(prefix.length).trim();
  }
  return value;
};

const normalizeTest = (test, recordResultDate = "") => ({
  id: test.id || makeId("test"),
  test: test.test || test.name || "",
  result1: test.result1 || test.result_1 || test.result || "",
  result2: test.result2 || test.result_2 || "",
  result_date: test.result_date || recordResultDate || "",
  remarks: test.remarks || "",
  sources: test.sources || [],
});

const normalizeSamples = (record) => {
  if (Array.isArray(record.samples) && record.samples.length) {
    return record.samples.map((sample) => ({
      id: sample.id || makeId("sample"),
      dataset: sample.dataset || record.dataset || "routine",
      lab_number: sample.lab_number || "",
      epid_number: sample.epid_number || "",
      sample_type: sample.sample_type || "",
      tests: (sample.tests || []).map((test) =>
        normalizeTest(test, record.result_date)
      ),
      assigned_panels: sample.assigned_panels || [],
      remarks: sample.remarks || "",
      testSearch: "",
    }));
  }

  const tests = (record.tests || []).map((test) =>
    normalizeTest(test, record.result_date)
  );

  return record.sample_type || tests.length
    ? [
        {
          id: makeId("sample"),
          dataset: record.dataset || "routine",
          lab_number: record.lab_number || "",
          epid_number: record.epid_number || "",
          sample_type: record.sample_type || "",
          tests,
          assigned_panels: [],
          remarks: "",
          testSearch: "",
        },
      ]
    : [];
};

export default function DataEntry() {
  const { id } = useParams();
  const nav = useNavigate();
  const nameRef = useRef(null);

  const [form, setForm] = useState(emptyForm());
  const [defaultDataset, setDefaultDataset] = useState(getSavedDataset());
  const [opts, setOpts] = useState({
    test: [],
    district: [],
    sample_type: [],
    tests_by_dataset: {},
    sample_types_by_dataset: {},
    sample_mappings_by_dataset: {},
    panels_by_dataset: {},
  });
  const [institutions, setInstitutions] = useState([]);
  const [saving, setSaving] = useState(false);

  const [sampleDialogOpen, setSampleDialogOpen] = useState(false);
  const [editingSampleIndex, setEditingSampleIndex] = useState(-1);
  const [sampleDraft, setSampleDraft] = useState(
    newSample(getSavedDataset())
  );

  const [patientDialogOpen, setPatientDialogOpen] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [patientMatches, setPatientMatches] = useState([]);
  const [patientSearching, setPatientSearching] = useState(false);

  useEffect(() => {
    if (!id) {
      window.setTimeout(() => nameRef.current?.focus(), 0);
    }
  }, [id]);

  useEffect(() => {
    let timer;

    const schedule = () => {
      timer = window.setTimeout(() => {
        const today = localDateValue();
        setForm((current) => {
          const previousDefault = localDateValue(
            new Date(Date.now() - 24 * 60 * 60 * 1000)
          );
          return !id && current.date === previousDefault
            ? { ...current, date: today }
            : current;
        });
        schedule();
      }, millisecondsUntilNextDay());
    };

    schedule();
    return () => window.clearTimeout(timer);
  }, [id]);

  useEffect(() => {
    const load = async () => {
      try {
        const optionsResponse = await api.get("/options");
        setOpts((current) => ({
          ...current,
          ...optionsResponse.data,
        }));

        if (id) {
          const response = await api.get(`/records/${id}`);
          const record = response.data;
          const loadedDataset =
            record.samples?.[0]?.dataset ||
            record.dataset ||
            "routine";

          setDefaultDataset(loadedDataset);
          setForm({
            dataset: loadedDataset,
            date: record.date || "",
            name: record.name || "",
            age: record.age ?? "",
            sex: record.sex || "",
            district: record.district || "Trivandrum",
            requesting_institution:
              record.requesting_institution || "",
            epid_number: record.epid_number || "",
            samples: normalizeSamples(record),
            remarks: record.remarks || "",
          });
        }
      } catch (error) {
        console.error(error);
        toast.error("Failed to load New Record data");
      }
    };

    load();
  }, [id]);

  useEffect(() => {
    const query = form.requesting_institution.trim();
    if (!query) {
      setInstitutions([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        const response = await api.get("/institutions", {
          params: { search: query },
        });
        setInstitutions(response.data?.items || response.data || []);
      } catch {
        setInstitutions([]);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [form.requesting_institution]);

  const mappingsForDataset = (dataset) =>
    opts.sample_mappings_by_dataset?.[dataset] || [];

  const sampleTypesForDataset = (dataset) => {
    const mappings = mappingsForDataset(dataset);
    if (mappings.length) {
      return mappings
        .map((mapping) => mapping.sample_type)
        .filter(Boolean);
    }

    const values = opts.sample_types_by_dataset?.[dataset];
    return Array.isArray(values) && values.length
      ? values
      : opts.sample_type || [];
  };

  const mappingForDraft = useMemo(
    () =>
      mappingsForDataset(sampleDraft.dataset).find(
        (mapping) =>
          String(mapping.sample_type || "").toLowerCase() ===
          String(sampleDraft.sample_type || "").toLowerCase()
      ),
    [sampleDraft.dataset, sampleDraft.sample_type, opts]
  );

  const testsForDraft = useMemo(() => {
    if (mappingForDraft) return mappingForDraft.tests || [];

    const values = opts.tests_by_dataset?.[sampleDraft.dataset];
    return Array.isArray(values) && values.length
      ? values
      : opts.test || [];
  }, [mappingForDraft, opts, sampleDraft.dataset]);

  const selectableItems = useMemo(() => {
    if (!sampleDraft.sample_type) return [];

    const query = String(sampleDraft.testSearch || "")
      .trim()
      .toLowerCase();

    const explicitlyMappedPanels = new Set(
      mappingForDraft?.panels || []
    );
    const allowedTests = new Set(
      (testsForDraft || []).map((test) =>
        String(test || "").trim().toLowerCase()
      )
    );
    const hasExplicitPanelMapping =
      explicitlyMappedPanels.size > 0;

    const uniquePanels = new Map();

    (
      opts.panels_by_dataset?.[sampleDraft.dataset] || []
    ).forEach((panel) => {
      const panelTests = [...new Set(
        (panel.tests || [])
          .map((test) => String(test || "").trim())
          .filter(Boolean)
      )];

      const fullyCompatible =
        panelTests.length > 0 &&
        allowedTests.size > 0 &&
        panelTests.every((test) =>
          allowedTests.has(test.toLowerCase())
        );

      const permitted = hasExplicitPanelMapping
        ? explicitlyMappedPanels.has(panel.id)
        : fullyCompatible;

      if (!permitted) return;

      const key =
        panel.id || String(panel.name || "").trim().toLowerCase();
      if (!key || uniquePanels.has(key)) return;

      uniquePanels.set(key, {
        key: `panel::${panel.id}`,
        name: panel.name,
        kind: "panel",
        tests: panelTests,
      });
    });

    const panels = [...uniquePanels.values()].sort((left, right) =>
      String(left.name).localeCompare(String(right.name), undefined, {
        sensitivity: "base",
      })
    );

    const tests = [...new Set(testsForDraft)]
      .sort((left, right) =>
        String(left).localeCompare(String(right), undefined, {
          sensitivity: "base",
        })
      )
      .map((test) => ({
        key: `test::${test}`,
        name: test,
        kind: "test",
        tests: [],
      }));

    return [...panels, ...tests].filter(
      (item) =>
        !query ||
        String(item.name).toLowerCase().includes(query)
    );
  }, [
    opts,
    sampleDraft.dataset,
    sampleDraft.testSearch,
    mappingForDraft,
    testsForDraft,
  ]);

  const updateDefaultDataset = (dataset) => {
    localStorage.setItem("mds_last_dataset", dataset);
    setDefaultDataset(dataset);
    setForm((current) => ({ ...current, dataset }));
  };

  const searchExistingPatients = async () => {
    const query = patientSearch.trim();

    if (!query) {
      toast.error("Enter a patient name, patient ID, lab number or EPID number");
      return;
    }

    setPatientSearching(true);

    try {
      const response = await api.get("/records", {
        params: {
          search: query,
          page: 1,
          page_size: 50,
        },
      });

      setPatientMatches(response.data?.items || []);

      if (!(response.data?.items || []).length) {
        toast.info("No matching patients found");
      }
    } catch {
      toast.error("Failed to search existing patients");
    } finally {
      setPatientSearching(false);
    }
  };

  const selectExistingPatient = (record) => {
    setPatientDialogOpen(false);
    nav(`/entry/${record.id}`);
  };

  const openNewSample = () => {
    setEditingSampleIndex(-1);
    setSampleDraft(newSample(defaultDataset));
    setSampleDialogOpen(true);
  };

  const openEditSample = (index) => {
    setEditingSampleIndex(index);
    setSampleDraft(structuredClone(form.samples[index]));
    setSampleDialogOpen(true);
  };

  const assignPanelToDraft = (next, panel) => {
    if (!panel) return next;

    next.assigned_panels = next.assigned_panels || [];
    next.tests = next.tests || [];

    if (
      !next.assigned_panels.some(
        (item) => item.panel_id === panel.id
      )
    ) {
      next.assigned_panels.push({
        panel_id: panel.id,
        panel_name: panel.name,
        tests: [...new Set(panel.tests || [])],
        source: "sample_mapping",
      });
    }

    (panel.tests || []).forEach((name) => {
      const existing = next.tests.find(
        (test) => test.test === name
      );
      const source = {
        type: "panel",
        id: panel.id,
        name: panel.name,
      };

      if (existing) {
        existing.sources = existing.sources || [];
        if (
          !existing.sources.some(
            (item) =>
              item.type === "panel" &&
              item.id === panel.id
          )
        ) {
          existing.sources.push(source);
        }
      } else {
        next.tests.push(newTest(name, [source]));
      }
    });

    return next;
  };

  const updateDraft = (key, value) => {
    setSampleDraft((current) => {
      const next = { ...current, [key]: value };

      if (key === "dataset") {
        next.sample_type = DEFAULT_SAMPLE_BY_DATASET[value] || "";
        next.tests = [];
        next.assigned_panels = [];
        next.epid_number = "";
        next.testSearch = "";
      }

      if (key === "sample_type") {
        const mapping = mappingsForDataset(next.dataset).find(
          (item) =>
            String(item.sample_type || "").toLowerCase() ===
            String(value || "").toLowerCase()
        );

        const allowed = new Set(mapping?.tests || []);
        const allowedPanels = new Set(mapping?.panels || []);

        next.assigned_panels = (
          next.assigned_panels || []
        ).filter((panel) =>
          allowedPanels.has(panel.panel_id)
        );

        next.tests = (next.tests || []).filter((test) => {
          const panelSources = (test.sources || []).filter(
            (source) => source.type === "panel"
          );
          const hasAllowedPanelSource = panelSources.some(
            (source) => allowedPanels.has(source.id)
          );
          const hasNonPanelSource = (test.sources || []).some(
            (source) => source.type !== "panel"
          );

          return (
            allowed.has(test.test) ||
            hasAllowedPanelSource ||
            hasNonPanelSource
          );
        });

        if (mapping?.auto_assign) {
          const existing = new Set(
            next.tests.map((test) => test.test)
          );
          next.tests = [
            ...next.tests,
            ...(mapping.tests || [])
              .filter((test) => !existing.has(test))
              .map((test) =>
                newTest(test, [
                  {
                    type: "mapping",
                    id: `${next.dataset}:${value}`,
                    name: value,
                  },
                ])
              ),
          ];
        }

        if (mapping?.auto_assign_panels) {
          const panelLookup = new Map(
            (
              opts.panels_by_dataset?.[next.dataset] || []
            ).map((panel) => [panel.id, panel])
          );

          (mapping.panels || []).forEach((panelId) => {
            assignPanelToDraft(next, panelLookup.get(panelId));
          });
        }

        next.testSearch = "";
      }

      return next;
    });
  };

  const addSelection = (value) => {
    if (!value) return;

    setSampleDraft((current) => {
      const next = structuredClone(current);
      if (value.startsWith("panel::")) {
        const panelId = value.slice(7);
        const explicitlyMapped = new Set(
          mappingForDraft?.panels || []
        );
        const panel = (
          opts.panels_by_dataset?.[next.dataset] || []
        ).find((item) => item.id === panelId);

        if (!panel) return current;

        const allowedTests = new Set(
          (testsForDraft || []).map((test) =>
            String(test || "").trim().toLowerCase()
          )
        );
        const fullyCompatible =
          (panel.tests || []).length > 0 &&
          (panel.tests || []).every((test) =>
            allowedTests.has(
              String(test || "").trim().toLowerCase()
            )
          );

        if (
          explicitlyMapped.size > 0
            ? !explicitlyMapped.has(panelId)
            : !fullyCompatible
        ) {
          toast.error(
            "This panel is not valid for the selected sample type"
          );
          return current;
        }

        assignPanelToDraft(next, panel);
      } else {
        const name = value.startsWith("test::")
          ? value.slice(6)
          : value;

        if (!next.tests.some((test) => test.test === name)) {
          next.tests.push(
            newTest(name, [{ type: "manual", id: null, name: null }])
          );
        } else {
          toast.info("The selected test is already added");
          return current;
        }
      }

      next.testSearch = "";
      return next;
    });
  };

  const removeDraftTest = (index) => {
    setSampleDraft((current) => ({
      ...current,
      tests: current.tests.filter(
        (_, testIndex) => testIndex !== index
      ),
    }));
  };

  const saveSampleDraft = () => {
    if (!sampleDraft.dataset || !sampleDraft.sample_type) {
      toast.error("Select the dataset and sample type");
      return;
    }

    if (!sampleDraft.tests.length) {
      toast.error("Select at least one test");
      return;
    }

    if (
      EPID_TAGS[sampleDraft.dataset] &&
      !epidPrefix(sampleDraft.dataset, form.district)
    ) {
      toast.error(
        "The selected district does not have a configured EPID code"
      );
      return;
    }

    const prefix = epidPrefix(
      sampleDraft.dataset,
      form.district
    );
    const suffix = epidSuffix(
      sampleDraft.epid_number,
      sampleDraft.dataset,
      form.district
    );
    const savedDraft = {
      ...sampleDraft,
      epid_number:
        prefix && suffix ? `${prefix} ${suffix}` : prefix || "",
      testSearch: "",
    };

    setForm((current) => {
      const samples = [...current.samples];

      if (editingSampleIndex >= 0) {
        samples[editingSampleIndex] = savedDraft;
      } else {
        samples.push(savedDraft);
      }

      return {
        ...current,
        dataset: samples[0]?.dataset || current.dataset,
        samples,
      };
    });

    setSampleDialogOpen(false);
  };

  const removeSample = (index) => {
    setForm((current) => ({
      ...current,
      samples: current.samples.filter(
        (_, sampleIndex) => sampleIndex !== index
      ),
    }));
  };

  const save = async (event) => {
    event.preventDefault();

    if (!form.name || !form.date || !form.district) {
      toast.error("Patient Name, Date and District are required");
      return;
    }

    if (!form.samples.length) {
      toast.error("Add at least one sample");
      return;
    }

    setSaving(true);

    try {
      const samples = form.samples.map((sample) => ({
        id: sample.id,
        dataset: sample.dataset,
        lab_number: sample.lab_number || null,
        sample_type: sample.sample_type,
        remarks: sample.remarks || null,
        assigned_panels: sample.assigned_panels || [],
        tests: sample.tests.map((test) => ({
          id: test.id,
          test: test.test,
          result1: test.result1 || "",
          result2: test.result2 || "",
          result_date: test.result_date || null,
          remarks: test.remarks || null,
          sources: test.sources || [],
        })),
      }));

      const firstSample = samples[0];
      const firstTests = firstSample.tests || [];

      const payload = {
        dataset: firstSample.dataset,
        date: form.date,
        name: form.name,
        age: form.age === "" ? null : Number(form.age),
        sex: form.sex || null,
        district: form.district,
        requesting_institution:
          form.requesting_institution || null,
        epid_number: form.epid_number || null,
        samples,
        remarks: form.remarks || null,

        sample_type: firstSample.sample_type,
        tests: firstTests,
        test: firstTests[0]?.test || "",
        result_date: firstTests[0]?.result_date || null,
        results: firstTests.map((test) => ({
          name: test.result1 || "",
          value: test.result2 || "",
        })),
      };

      const response = id
        ? await api.put(`/records/${id}`, payload)
        : await api.post("/records", payload);

      toast.success(id ? "Record updated" : "Record saved");
      scheduleDriveSync();

      if (id) {
        nav("/records");
        return;
      }

      const savedRecord = response.data || {};
      setForm(emptyForm(defaultDataset));
      window.setTimeout(() => nameRef.current?.focus(), 0);

      const numbers = (savedRecord.samples || [])
        .map((sample) => sample.lab_number)
        .filter(Boolean);

      if (numbers.length) {
        toast.success(`Lab Number${numbers.length > 1 ? "s" : ""}: ${numbers.join(", ")}`, {
          duration: 6000,
        });
      }
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const prefixForDraft = epidPrefix(
    sampleDraft.dataset,
    form.district
  );
  const suffixForDraft = epidSuffix(
    sampleDraft.epid_number,
    sampleDraft.dataset,
    form.district
  );

  return (
    <div className="max-w-7xl">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            {id ? "Edit" : "New"}
          </div>
          <h1 className="mt-1 font-heading text-3xl font-semibold text-slate-900">
            {id ? "Update Record" : "New Lab Record"}
          </h1>
        </div>

        {!id && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setPatientSearch("");
              setPatientMatches([]);
              setPatientDialogOpen(true);
            }}
          >
            <UsersThree size={17} className="mr-2" />
            Add Sample to Existing Patient
          </Button>
        )}
      </div>

      <Card className="rounded-2xl border border-slate-200 bg-white/95 p-6 shadow-sm">
        <form
          onSubmit={save}
          className="grid grid-cols-1 gap-5 md:grid-cols-2"
        >
          <div className="md:col-span-2">
            <Label className="text-xs font-semibold uppercase tracking-[0.05em] text-slate-500">
              Default Dataset for New Samples
            </Label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {DATASETS.map((dataset) => (
                <label
                  key={dataset.key}
                  className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-2 text-xs font-medium transition ${
                    defaultDataset === dataset.key
                      ? "border-blue-300 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  <input
                    type="radio"
                    name="default-dataset"
                    checked={defaultDataset === dataset.key}
                    onChange={() =>
                      updateDefaultDataset(dataset.key)
                    }
                  />
                  {dataset.label}
                </label>
              ))}
            </div>
          </div>

          <Field label="Patient Name *">
            <Input
              ref={nameRef}
              autoFocus={!id}
              data-testid={RECORDS.name}
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
          </Field>

          <Field label="Date *">
            <Input
              data-testid={RECORDS.date}
              type="date"
              value={form.date}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  date: event.target.value,
                }))
              }
            />
          </Field>

          <Field label="Age">
            <Input
              data-testid={RECORDS.age}
              type="number"
              min="0"
              value={form.age}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  age: event.target.value,
                }))
              }
            />
          </Field>

          <Field label="Sex">
            <select
              value={form.sex}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  sex: event.target.value,
                }))
              }
              className="w-full rounded border bg-white p-2"
            >
              <option value="">Select sex</option>
              <option value="Female">Female</option>
              <option value="Male">Male</option>
              <option value="Other">Other</option>
              <option value="Not specified">Not specified</option>
            </select>
          </Field>

          <Field label="District *">
            <select
              value={form.district}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  district: event.target.value,
                }))
              }
              className="w-full rounded border bg-white p-2"
            >
              <option value="">Select district</option>
              {!opts.district.includes("Trivandrum") && (
                <option value="Trivandrum">Trivandrum</option>
              )}
              {opts.district.map((district) => (
                <option key={district} value={district}>
                  {district}
                </option>
              ))}
            </select>
          </Field>

          {PATIENT_EPID_DATASETS.has(
            patientEpidDataset(form, defaultDataset)
          ) && (
            <Field label="EPID Number">
              <div className="flex">
                <div className="flex items-center whitespace-nowrap rounded-l border border-r-0 bg-slate-50 px-3 text-sm font-medium text-slate-700">
                  {epidPrefix(
                    patientEpidDataset(form, defaultDataset),
                    form.district
                  ) || "Select a valid district"}
                </div>
                <Input
                  value={epidSuffix(
                    form.epid_number,
                    patientEpidDataset(form, defaultDataset),
                    form.district
                  )}
                  onChange={(event) => {
                    const ds = patientEpidDataset(
                      form,
                      defaultDataset
                    );
                    const prefix = epidPrefix(ds, form.district);
                    setForm((current) => ({
                      ...current,
                      epid_number: prefix
                        ? `${prefix} ${event.target.value}`.trim()
                        : event.target.value,
                    }));
                  }}
                  placeholder="Enter serial number"
                  className="rounded-l-none"
                />
              </div>
            </Field>
          )}

          <Field label="Requesting Institution">
            <Input
              list="institution-suggestions"
              value={form.requesting_institution}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  requesting_institution: event.target.value,
                }))
              }
              placeholder="Type or select a previous institution"
            />
            <datalist id="institution-suggestions">
              {institutions.map((item) => {
                const value =
                  typeof item === "string"
                    ? item
                    : item.value || item.name;
                return value ? (
                  <option key={value} value={value} />
                ) : null;
              })}
            </datalist>
          </Field>

          <div className="space-y-3 md:col-span-2">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs font-semibold uppercase tracking-[0.05em] text-slate-500">
                  Samples *
                </Label>
                <p className="mt-1 text-xs text-slate-500">
                  Add samples in the popup. Different samples may use different datasets.
                </p>
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={openNewSample}
              >
                <Plus size={16} className="mr-2" />
                Add Sample
              </Button>
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      <th className="px-3 py-2">Lab No.</th>
                      <th className="px-3 py-2">Dataset</th>
                      <th className="px-3 py-2">Sample</th>
                      <th className="px-3 py-2">Tests</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.samples.length === 0 && (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-3 py-8 text-center text-slate-500"
                        >
                          No samples added.
                        </td>
                      </tr>
                    )}

                    {form.samples.map((sample, index) => (
                      <tr
                        key={sample.id}
                        className="border-t border-slate-100"
                      >
                        <td className="px-3 py-2 font-mono text-xs">
                          {sample.lab_number || "Auto"}
                        </td>
                        <td className="px-3 py-2">
                          {datasetInfo(sample.dataset).label}
                        </td>
                        <td className="px-3 py-2">
                          {sample.sample_type}
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium">
                            {sample.tests.length} test
                            {sample.tests.length === 1 ? "" : "s"}
                          </div>
                          {(sample.assigned_panels || []).length > 0 && (
                            <div className="mt-0.5 text-xs font-medium text-indigo-700">
                              {(sample.assigned_panels || [])
                                .map((panel) => panel.panel_name)
                                .join(", ")}
                            </div>
                          )}
                          <div className="max-w-md truncate text-xs text-slate-500">
                            {sample.tests
                              .map((test) => test.test)
                              .join(", ")}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditSample(index)}
                          >
                            <PencilSimple size={16} />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeSample(index)}
                            className="text-slate-500 hover:text-red-600"
                          >
                            <Trash size={16} />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="md:col-span-2">
            <Field label="Overall Remarks">
              <Textarea
                data-testid={RECORDS.remarks}
                rows={3}
                value={form.remarks}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    remarks: event.target.value,
                  }))
                }
              />
            </Field>
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 md:col-span-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => nav("/records")}
            >
              <X size={14} className="mr-1.5" />
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="bg-blue-600 text-white hover:bg-blue-700"
            >
              <FloppyDisk size={16} className="mr-2" />
              {saving
                ? "Saving…"
                : id
                  ? "Update Record"
                  : "Save Record"}
            </Button>
          </div>
        </form>
      </Card>

      <Dialog
        open={patientDialogOpen}
        onOpenChange={setPatientDialogOpen}
      >
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Sample to Existing Patient</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <MagnifyingGlass
                size={17}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <Input
                autoFocus
                value={patientSearch}
                onChange={(event) =>
                  setPatientSearch(event.target.value)
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    searchExistingPatients();
                  }
                }}
                placeholder="Patient name, patient ID, lab number or EPID number"
                className="pl-9"
              />
            </div>

            <Button
              type="button"
              onClick={searchExistingPatients}
              disabled={patientSearching}
              className="bg-blue-600 text-white hover:bg-blue-700"
            >
              {patientSearching ? "Searching…" : "Search"}
            </Button>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2">Patient</th>
                  <th className="px-3 py-2">Patient ID</th>
                  <th className="px-3 py-2">District</th>
                  <th className="px-3 py-2">Existing Samples</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>

              <tbody>
                {!patientSearching && patientMatches.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-8 text-center text-slate-500"
                    >
                      Search for an existing patient to add another sample.
                    </td>
                  </tr>
                )}

                {patientMatches.map((record) => (
                  <tr
                    key={record.id}
                    className="border-t border-slate-100"
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-900">
                        {record.name}
                      </div>
                      <div className="text-xs text-slate-500">
                        {record.age ?? "—"} years · {record.sex || "—"}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {record.patient_id || "—"}
                    </td>
                    <td className="px-3 py-2">
                      {record.district || "—"}
                    </td>
                    <td className="px-3 py-2">
                      {(record.samples || []).length}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => selectExistingPatient(record)}
                      >
                        Select Patient
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setPatientDialogOpen(false)}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={sampleDialogOpen}
        onOpenChange={setSampleDialogOpen}
      >
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingSampleIndex >= 0
                ? "Edit Sample"
                : "Add Sample"}
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Dataset *">
              <select
                value={sampleDraft.dataset}
                onChange={(event) =>
                  updateDraft("dataset", event.target.value)
                }
                className="w-full rounded border bg-white p-2"
              >
                {DATASETS.map((dataset) => (
                  <option key={dataset.key} value={dataset.key}>
                    {dataset.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Lab Number">
              <Input
                readOnly
                value={
                  sampleDraft.lab_number ||
                  `${datasetInfo(sampleDraft.dataset).prefix} - auto generated on save`
                }
                className="bg-slate-50 text-slate-500"
              />
            </Field>

            <Field label="Sample Type *">
              <select
                value={sampleDraft.sample_type}
                onChange={(event) =>
                  updateDraft("sample_type", event.target.value)
                }
                className="w-full rounded border bg-white p-2"
              >
                <option value="">Select sample type</option>
                {sampleTypesForDataset(sampleDraft.dataset).map(
                  (sampleType) => (
                    <option key={sampleType} value={sampleType}>
                      {sampleType}
                    </option>
                  )
                )}
              </select>
            </Field>

            {sampleDraft.sample_type && mappingForDraft && (
              <div className="md:col-span-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
                {mappingForDraft.auto_assign
                  ? "The mapped tests were assigned automatically. You may remove tests that are not required."
                  : "Only tests mapped to this sample type are available."}
              </div>
            )}

            <div className="md:col-span-2">
              <div className="mb-3 flex justify-end">
                <Button
                  type="button"
                  onClick={saveSampleDraft}
                  className="bg-blue-600 text-white hover:bg-blue-700"
                >
                  Save Sample
                </Button>
              </div>
              <Label className="text-xs font-semibold uppercase tracking-[0.05em] text-slate-500">
                Valid Mapped Tests *
              </Label>

              <div className="mt-2 space-y-3 rounded-xl border border-slate-200 p-3">
                <div className="relative">
                  <MagnifyingGlass
                    size={17}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <Input
                    value={sampleDraft.testSearch}
                    onChange={(event) =>
                      updateDraft(
                        "testSearch",
                        event.target.value
                      )
                    }
                    placeholder="Search and select a test or panel"
                    className="pl-9"
                  />
                </div>

                <div className="grid max-h-56 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                  {selectableItems.map((item) => {
                    const alreadyAdded =
                      item.kind === "test" &&
                      sampleDraft.tests.some(
                        (test) => test.test === item.name
                      );

                    return (
                      <button
                        type="button"
                        key={item.key}
                        disabled={alreadyAdded}
                        onClick={() => addSelection(item.key)}
                        className={`rounded-lg border px-3 py-2 text-left text-sm ${
                          alreadyAdded
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : item.kind === "panel"
                              ? "border-indigo-200 bg-indigo-50 text-indigo-900 hover:bg-indigo-100"
                              : "border-slate-200 bg-white hover:border-teal-300 hover:bg-teal-50"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {alreadyAdded && (
                            <CheckCircle
                              size={16}
                              weight="fill"
                            />
                          )}
                          <span className="font-medium">
                            {item.name}
                          </span>
                        </div>
                        {item.kind === "panel" && (
                          <div className="mt-1 text-[11px] text-indigo-600">
                            {item.tests.length} tests
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        <th className="px-3 py-2">Selected Test / Source</th>
                        <th className="px-3 py-2 text-right">
                          Remove
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sampleDraft.tests.length === 0 && (
                        <tr>
                          <td
                            colSpan={2}
                            className="px-3 py-6 text-center text-slate-500"
                          >
                            No tests selected.
                          </td>
                        </tr>
                      )}

                      {sampleDraft.tests.map((test, index) => (
                        <tr
                          key={test.id}
                          className="border-t border-slate-100"
                        >
                          <td className="px-3 py-2 font-medium">
                            {test.test}
                            <div className="text-[11px] font-normal text-slate-500">
                              {(test.sources || [])
                                .map((source) =>
                                  source.type === "panel"
                                    ? `Panel: ${source.name}`
                                    : source.type === "mapping"
                                      ? "Auto-assigned mapping"
                                      : "Manually selected"
                                )
                                .join(" · ")}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                removeDraftTest(index)
                              }
                            >
                              <Trash size={16} />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="md:col-span-2">
              <Field label="Sample Remarks">
                <Textarea
                  rows={2}
                  value={sampleDraft.remarks || ""}
                  onChange={(event) =>
                    updateDraft("remarks", event.target.value)
                  }
                />
              </Field>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setSampleDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={saveSampleDraft}
              className="bg-blue-600 text-white hover:bg-blue-700"
            >
              Save Sample
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const Field = ({ label, children }) => (
  <div>
    <Label className="text-xs font-semibold uppercase tracking-[0.05em] text-slate-500">
      {label}
    </Label>
    <div className="mt-1.5">{children}</div>
  </div>
);

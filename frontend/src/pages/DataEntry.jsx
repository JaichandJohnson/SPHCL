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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, PencilSimple, Trash, FloppyDisk, X } from "@phosphor-icons/react";
import { RECORDS } from "@/constants/testIds";

const EPID_CODES = {
  "Trivandrum":"TRM","Thiruvananthapuram":"TRM","Kollam":"KLM","Pathanamthitta":"PTM",
  "Idukki":"IDK","Alappuzha":"APZ","Kottayam":"KOT","Ernakulam":"ENK","Thrissur":"THR",
  "Palakkad":"PLK","Malappuram":"MPM","Kozhikode":"KZK","Kannur":"KNU","Wayanad":"WYD",
  "Kasaragod":"KSG","Kasargod":"KSG","Lakshadweep":"LKD"
};
const EPID_TAGS={mr_surveillance:"MR",diphtheria:"DTH",pertussis:"PTS"};
const epidPrefix=(dataset,district)=>{
  const tag=EPID_TAGS[dataset]; const code=EPID_CODES[district];
  if(!tag||!code) return "";
  return district==="Lakshadweep"?`${tag} IND LK LKD`:`${tag} IND KE ${code}`;
};
const uid=(p)=>`${p}_${crypto.randomUUID?.()||Date.now()}`;
const newTest=(name="")=>({id:uid("test"),test:name,result1:"",result2:"",result_date:"",remarks:""});
const newSample=()=>({id:uid("sample"),dataset:"routine",lab_number:"",epid_number:"",sample_type:"",tests:[],remarks:""});
const empty=()=>({date:new Date().toISOString().slice(0,10),name:"",age:"",sex:"",district:"Trivandrum",requesting_institution:"",samples:[],remarks:""});
const norm=(r)=>(r.samples||[]).map(s=>({...s,dataset:s.dataset||r.dataset||"routine",epid_number:s.epid_number||r.epid_number||"",tests:(s.tests||[]).map(t=>({...newTest(),...t}))}));

export default function DataEntry(){
 const{id}=useParams(); const nav=useNavigate(); const nameRef=useRef(null);
 const[form,setForm]=useState(empty()); const[opts,setOpts]=useState({datasets:[],district:[],sample_mappings_by_dataset:{},sample_types_by_dataset:{},tests_by_dataset:{}}); const[saving,setSaving]=useState(false);
 const[open,setOpen]=useState(false); const[editIndex,setEditIndex]=useState(-1); const[draft,setDraft]=useState(newSample());

 useEffect(()=>{(async()=>{try{const o=await api.get("/options");setOpts(o.data);if(id){const r=await api.get(`/records/${id}`);const d=r.data;setForm({date:d.date||"",name:d.name||"",age:d.age??"",sex:d.sex||"",district:d.district||"Trivandrum",requesting_institution:d.requesting_institution||"",samples:norm(d),remarks:d.remarks||""});}}catch{toast.error("Failed to load data");}})();},[id]);
 const datasets=opts.datasets||opts.dataset||[];
 const mappings=opts.sample_mappings_by_dataset?.[draft.dataset]||[];
 const sampleTypes=mappings.length?mappings.map(x=>x.sample_type):(opts.sample_types_by_dataset?.[draft.dataset]||opts.sample_type||[]);
 const mapping=mappings.find(x=>String(x.sample_type).toLowerCase()===String(draft.sample_type).toLowerCase());
 const tests=mapping?.tests||opts.tests_by_dataset?.[draft.dataset]||opts.test||[];

 const openNew=()=>{setEditIndex(-1);setDraft(newSample());setOpen(true);};
 const openEdit=(i)=>{setEditIndex(i);setDraft(JSON.parse(JSON.stringify(form.samples[i])));setOpen(true);};
 const changeDraft=(k,v)=>{setDraft(d=>{const n={...d,[k]:v};if(k==="dataset"){n.sample_type="";n.tests=[];n.epid_number="";}if(k==="sample_type"){const mm=(opts.sample_mappings_by_dataset?.[n.dataset]||[]).find(x=>x.sample_type===v);n.tests=mm?.auto_assign?(mm.tests||[]).map(newTest):[];}return n;});};
 const saveDraft=()=>{if(!draft.dataset||!draft.sample_type||!draft.tests.length)return toast.error("Select dataset, sample type and at least one test");setForm(f=>{const a=[...f.samples];if(editIndex>=0)a[editIndex]=draft;else a.push(draft);return{...f,samples:a};});setOpen(false);};
 const toggleTest=(name)=>setDraft(d=>({...d,tests:d.tests.some(t=>t.test===name)?d.tests.filter(t=>t.test!==name):[...d.tests,newTest(name)]}));
 const remove=(i)=>setForm(f=>({...f,samples:f.samples.filter((_,x)=>x!==i)}));

 const save=async(e)=>{e.preventDefault();if(!form.name||!form.district||!form.samples.length)return toast.error("Patient name, district and at least one sample are required");setSaving(true);try{const payload={...form,age:form.age===""?null:Number(form.age),dataset:form.samples[0].dataset,samples:form.samples.map(s=>({...s,epid_number:EPID_TAGS[s.dataset]?(s.epid_number||"").trim():null}))};if(id)await api.put(`/records/${id}`,payload);else await api.post("/records",payload);toast.success(id?"Record updated":"Record saved");scheduleDriveSync();nav("/records");}catch(err){toast.error(err?.response?.data?.detail||"Save failed");}finally{setSaving(false);}};
 return <div className="max-w-6xl"><div className="mb-5"><div className="text-xs uppercase text-slate-500">{id?"Edit":"New"}</div><h1 className="text-3xl font-semibold">{id?"Update Record":"New Lab Record"}</h1></div>
 <Card className="p-5"><form onSubmit={save} className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <Field label="Date *"><Input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></Field>
 <Field label="Patient Name *"><Input ref={nameRef} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></Field>
 <Field label="Age"><Input type="number" min="0" value={form.age} onChange={e=>setForm({...form,age:e.target.value})}/></Field>
 <Field label="Sex"><select className="w-full border rounded p-2" value={form.sex} onChange={e=>setForm({...form,sex:e.target.value})}><option value="">Select</option><option>Female</option><option>Male</option><option>Other</option></select></Field>
 <Field label="District *"><select className="w-full border rounded p-2" value={form.district} onChange={e=>setForm({...form,district:e.target.value})}><option value="">Select district</option>{opts.district?.map(x=><option key={x}>{x}</option>)}</select></Field>
 <Field label="Requesting Institution"><Input value={form.requesting_institution} onChange={e=>setForm({...form,requesting_institution:e.target.value})}/></Field>
 <div className="md:col-span-2"><div className="flex justify-between items-center mb-2"><div><Label>Samples *</Label><p className="text-xs text-slate-500">Each sample can use a different dataset.</p></div><Button type="button" variant="outline" onClick={openNew}><Plus size={16} className="mr-2"/>Add Sample</Button></div>
 <div className="border rounded overflow-hidden"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="p-2 text-left">Lab #</th><th className="p-2 text-left">Dataset</th><th className="p-2 text-left">Sample</th><th className="p-2 text-left">Tests</th><th className="p-2 text-left">EPID</th><th className="p-2"></th></tr></thead><tbody>{!form.samples.length&&<tr><td colSpan="6" className="p-6 text-center text-slate-500">No samples added.</td></tr>}{form.samples.map((s,i)=><tr key={s.id} className="border-t"><td className="p-2 font-mono">{s.lab_number||"Auto"}</td><td className="p-2">{datasets.find(d=>d.key===s.dataset)?.name||s.dataset}</td><td className="p-2">{s.sample_type}</td><td className="p-2">{s.tests.map(t=>t.test).join(", ")}</td><td className="p-2">{s.epid_number||"—"}</td><td className="p-2 text-right"><Button type="button" variant="ghost" size="icon" onClick={()=>openEdit(i)}><PencilSimple size={16}/></Button><Button type="button" variant="ghost" size="icon" onClick={()=>remove(i)}><Trash size={16}/></Button></td></tr>)}</tbody></table></div></div>
 <div className="md:col-span-2"><Field label="Remarks"><Textarea rows={3} value={form.remarks} onChange={e=>setForm({...form,remarks:e.target.value})}/></Field></div>
 <div className="md:col-span-2 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={()=>nav("/records")}><X size={14} className="mr-1"/>Cancel</Button><Button disabled={saving} className="bg-blue-600"><FloppyDisk size={16} className="mr-2"/>{saving?"Saving…":id?"Update Record":"Save Record"}</Button></div>
 </form></Card>
 <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>{editIndex>=0?"Edit Sample":"Add Sample"}</DialogTitle></DialogHeader><div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <Field label="Dataset *"><select className="w-full border rounded p-2" value={draft.dataset} onChange={e=>changeDraft("dataset",e.target.value)}>{datasets.map(d=><option key={d.key} value={d.key}>{d.name}</option>)}</select></Field>
 <Field label="Lab Number"><Input readOnly value={draft.lab_number||"Auto generated on save"} className="bg-slate-50"/></Field>
 <Field label="Sample Type *"><select className="w-full border rounded p-2" value={draft.sample_type} onChange={e=>changeDraft("sample_type",e.target.value)}><option value="">Select sample</option>{sampleTypes.map(x=><option key={x}>{x}</option>)}</select></Field>
 {EPID_TAGS[draft.dataset]&&<Field label="EPID Number"><div className="flex"><span className="border rounded-l px-3 py-2 bg-slate-50 whitespace-nowrap">{epidPrefix(draft.dataset,form.district)}</span><Input className="rounded-l-none" value={(draft.epid_number||"").replace(epidPrefix(draft.dataset,form.district),"").trim()} onChange={e=>changeDraft("epid_number",`${epidPrefix(draft.dataset,form.district)} ${e.target.value}`.trim())} placeholder="Enter remaining number"/></div></Field>}
 <div className="md:col-span-2"><Label>Tests *</Label><div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-2 max-h-52 overflow-y-auto">{tests.map(x=><label key={x} className="border rounded p-2 text-sm"><input type="checkbox" className="mr-2" checked={draft.tests.some(t=>t.test===x)} onChange={()=>toggleTest(x)}/>{x}</label>)}</div></div>
 <div className="md:col-span-2"><Field label="Sample Remarks"><Textarea rows={2} value={draft.remarks||""} onChange={e=>changeDraft("remarks",e.target.value)}/></Field></div></div><DialogFooter><Button variant="ghost" onClick={()=>setOpen(false)}>Cancel</Button><Button onClick={saveDraft}>Save Sample</Button></DialogFooter></Dialog>
 </div>;
}
const Field=({label,children})=><div><Label className="text-xs font-semibold uppercase text-slate-500">{label}</Label><div className="mt-1.5">{children}</div></div>;

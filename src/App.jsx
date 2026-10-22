import { useState, useEffect, useCallback, useMemo } from "react";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const EXPENSE_CATEGORIES = [
  "Material dental","Laboratorio","Renta","Servicios","Personal",
  "Equipo","Medicamentos","Limpieza","Administrativo","Otro"
];
const PERSONAL_CATEGORIES = ["Alimentación","Transporte","Salud","Entretenimiento","Ropa","Hogar","Otro personal"];
const PAYMENT_METHODS = ["Efectivo","Transferencia","T. Débito","T. Crédito","Otro"];
const COMMISSION_RATE = { "Efectivo":0, "Transferencia":0, "T. Débito":0.00754, "T. Crédito":0.00754, "Otro":0 };
const OWNER_OPTIONS = ["Consultorio","Personal (Iván)"];
const COLORS = {
  bg: "#F8FAFB", card: "#FFFFFF", nav: "#1A2332",
  green: "#00B37E", red: "#E5534B", amber: "#F5A623",
  blue: "#3B82F6", purple: "#8B5CF6", gray: "#8B92A5", grayLight: "#E8ECF0",
  text: "#1A2332", textSoft: "#6B7280"
};
const CONFIG_KEY = "dental_config_v2";

// ─── RESPONSIVE HOOK ──────────────────────────────────────────────────────────
function useWindowWidth() {
  const [w, setW] = useState(typeof window!=="undefined" ? window.innerWidth : 480);
  useEffect(()=>{
    const handler = ()=>setW(window.innerWidth);
    window.addEventListener("resize",handler);
    return ()=>window.removeEventListener("resize",handler);
  },[]);
  return w;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
const monthKey = (date) => String(date).slice(0,7);

// ─── LÓGICA DE DEPÓSITOS DE TERMINAL ───────────────────────────────────────────
// Regla: lunes a jueves -> deposita al día siguiente.
// viernes o sábado -> deposita el lunes siguiente.
// Dado un depositDate (hoy), regresa la lista de fechas de cobro que depositan ese día.
function getChargeDatesForDeposit(depositDateStr) {
  const d = new Date(depositDateStr + "T00:00:00");
  const dow = d.getDay(); // 0=domingo,1=lunes,...6=sábado
  const chargeDates = [];

  // Si hoy es lunes (1), el depósito incluye: viernes anterior, sábado anterior, y domingo anterior (por si acaso)
  if (dow === 1) {
    for (let back = 1; back <= 3; back++) {
      const cd = new Date(d);
      cd.setDate(cd.getDate() - back);
      // viernes(5), sábado(6), domingo(0)
      if ([5,6,0].includes(cd.getDay())) chargeDates.push(formatDateStr(cd));
    }
  } else {
    // Para martes-viernes, el cobro de ayer deposita hoy (si ayer fue lun-jue)
    const cd = new Date(d);
    cd.setDate(cd.getDate() - 1);
    const cdDow = cd.getDay();
    if (cdDow >= 1 && cdDow <= 4) chargeDates.push(formatDateStr(cd));
  }
  return chargeDates;
}

function formatDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function getDayLabel(dateStr) {
  const days = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
  const d = new Date(dateStr + "T00:00:00");
  return days[d.getDay()];
}

const formatMXN = (n) => new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN",maximumFractionDigits:0}).format(n||0);
const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);
const monthName = (key) => { const [y,m] = key.split("-"); return new Date(+y,+m-1,1).toLocaleString("es-MX",{month:"long",year:"numeric"}); };

const loadConfig = () => { try { return JSON.parse(localStorage.getItem(CONFIG_KEY)||"{}"); } catch { return {}; } };
const saveConfigLocal = (c) => localStorage.setItem(CONFIG_KEY, JSON.stringify(c));

// ─── SHEETS API ───────────────────────────────────────────────────────────────
async function sheetsRequest(webhookUrl, params) {
  return new Promise((resolve) => {
    if (!webhookUrl) { resolve({ ok:false, reason:"no_webhook" }); return; }
    try {
      const qs = Object.entries(params)
        .map(([k,v]) => `${k}=${encodeURIComponent(typeof v==="object"?JSON.stringify(v):v)}`)
        .join("&");
      const img = new Image();
      img.onload = img.onerror = () => resolve({ ok:true });
      img.src = `${webhookUrl}?${qs}`;
      setTimeout(()=>resolve({ ok:true }), 6000);
    } catch(e) { resolve({ ok:false, reason:e.message }); }
  });
}

async function fetchRecords(webhookUrl) {
  if (!webhookUrl) return [];
  try {
    const res = await fetch(`${webhookUrl}?action=getAll`, { method:"GET", mode:"cors" });
    const data = await res.json();
    return data.records || [];
  } catch { return []; }
}

// ─── UI PRIMITIVES ────────────────────────────────────────────────────────────
function RingProgress({ value, max, color, size=56 }) {
  const r=(size-8)/2, circ=2*Math.PI*r, pct = max>0 ? Math.min(value/max,1) : 0;
  return (
    <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={COLORS.grayLight} strokeWidth={4}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={4}
        strokeDasharray={circ} strokeDashoffset={circ*(1-pct)} strokeLinecap="round"
        style={{transition:"stroke-dashoffset 0.6s ease"}}/>
    </svg>
  );
}

function KpiCard({ label, value, sub, color, ring, ringMax, icon }) {
  return (
    <div style={{background:COLORS.card,borderRadius:16,padding:"16px 18px",
      boxShadow:"0 1px 4px rgba(0,0,0,0.07)",display:"flex",alignItems:"center",gap:14,flex:"1 1 140px",minWidth:140}}>
      <div style={{flexShrink:0}}>
        {ring!=null ? <RingProgress value={ring} max={ringMax} color={color}/>
          : <div style={{width:44,height:44,borderRadius:12,background:color+"20",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>{icon}</div>}
      </div>
      <div>
        <div style={{fontSize:11,color:COLORS.gray,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>{label}</div>
        <div style={{fontSize:20,fontWeight:700,color:COLORS.text,fontVariantNumeric:"tabular-nums",lineHeight:1}}>{value}</div>
        {sub && <div style={{fontSize:11,color:COLORS.gray,marginTop:3}}>{sub}</div>}
      </div>
    </div>
  );
}

function Sheet({ open, onClose, title, children }) {
  const handleOverlayClick = (e) => {
    // Solo cierra si el toque fue exactamente en el overlay, no en el contenido
    if (e.target === e.currentTarget) onClose();
  };
  return (
    <>
      <div onPointerDown={handleOverlayClick}
        style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",
          opacity:open?1:0,pointerEvents:open?"auto":"none",zIndex:40,transition:"opacity 0.25s"}}/>
      <div onPointerDown={e=>e.stopPropagation()}
        style={{position:"fixed",bottom:0,left:0,right:0,background:COLORS.card,
          borderRadius:"24px 24px 0 0",zIndex:50,maxHeight:"92vh",overflowY:"auto",paddingBottom:32,
          transform:open?"translateY(0)":"translateY(100%)",transition:"transform 0.3s cubic-bezier(0.4,0,0.2,1)"}}>
        <div style={{display:"flex",justifyContent:"center",padding:"12px 0 8px"}}>
          <div style={{width:36,height:4,borderRadius:2,background:COLORS.grayLight}}/>
        </div>
        <div style={{padding:"0 20px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
            <h2 style={{margin:0,fontSize:18,fontWeight:700,color:COLORS.text}}>{title}</h2>
            <button onClick={onClose} style={{border:"none",background:COLORS.grayLight,borderRadius:8,
              width:32,height:32,cursor:"pointer",fontSize:16,color:COLORS.gray}}>✕</button>
          </div>
          {children}
        </div>
      </div>
    </>
  );
}

function Field({ label, error, children }) {
  return (
    <div style={{marginBottom:14}}>
      <label style={{fontSize:12,fontWeight:600,color:COLORS.textSoft,display:"block",marginBottom:5,
        textTransform:"uppercase",letterSpacing:"0.05em"}}>{label}</label>
      {children}
      {error && <div style={{fontSize:11,color:COLORS.red,marginTop:3}}>{error}</div>}
    </div>
  );
}

const inputStyle = {width:"100%",padding:"12px 14px",borderRadius:10,border:`1.5px solid ${COLORS.grayLight}`,
  fontSize:15,outline:"none",boxSizing:"border-box",fontFamily:"inherit",color:COLORS.text,background:"#fff"};
const selectStyle = {...inputStyle, appearance:"none"};

function PillGroup({ options, value, onChange, colors }) {
  return (
    <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
      {options.map((o,i)=>{
        const activeColor = colors?.[i] || COLORS.nav, isActive = value===o;
        return (
          <button key={o} onClick={()=>onChange(o)}
            style={{padding:"8px 14px",borderRadius:20,border:"none",cursor:"pointer",
              fontSize:13,fontWeight:600,transition:"all 0.15s",
              background:isActive?activeColor:COLORS.grayLight,
              color:isActive?"#fff":COLORS.textSoft}}>
            {o}
          </button>
        );
      })}
    </div>
  );
}

// Autocomplete input for patient names
function AutocompleteInput({ value, onChange, suggestions, placeholder, error, onSelectPatient }) {
  const [focused, setFocused] = useState(false);
  const filtered = value.trim().length > 0
    ? suggestions.filter(s => s.toLowerCase().includes(value.toLowerCase())).slice(0,5)
    : [];

  return (
    <div style={{position:"relative"}}>
      <input style={{...inputStyle, borderColor: error?COLORS.red:COLORS.grayLight}}
        placeholder={placeholder} value={value}
        onChange={e=>onChange(e.target.value)}
        onFocus={()=>setFocused(true)}
        onBlur={()=>setTimeout(()=>setFocused(false),150)}/>
      {focused && filtered.length>0 && (
        <div style={{position:"absolute",top:"100%",left:0,right:0,background:"#fff",
          border:`1px solid ${COLORS.grayLight}`,borderRadius:10,marginTop:4,zIndex:20,
          boxShadow:"0 4px 16px rgba(0,0,0,0.1)",overflow:"hidden"}}>
          {filtered.map(name=>(
            <div key={name} onClick={()=>{ onSelectPatient(name); setFocused(false); }}
              style={{padding:"10px 14px",fontSize:14,cursor:"pointer",color:COLORS.text,
                borderBottom:`1px solid ${COLORS.grayLight}`}}>
              👤 {name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── INCOME FORM ──────────────────────────────────────────────────────────────
function IncomeForm({ onSave, onClose, patientNames, lastTreatmentByPatient, allRecords }) {
  const [f, setF] = useState({
    patient:"", treatment:"", amount:"", paymentMethod:"Efectivo",
    partialPayment:false, paid:"", notes:"", date:today(),
    requiresInvoice:false, owner:"Consultorio"
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const paidAmount = f.partialPayment ? (+f.paid||0) : (+f.amount||0);
  const pending = Math.max(0,(+f.amount||0)-paidAmount);
  const commission = COMMISSION_RATE[f.paymentMethod]||0;
  const commissionAmt = paidAmount * commission;

  // Check if this patient has existing pending balance
  const existingPending = useMemo(() => {
    if (!f.patient.trim() || !allRecords) return 0;
    return allRecords
      .filter(r => r.type==="income" && r.patient.toLowerCase()===f.patient.toLowerCase().trim())
      .reduce((s,r) => s+(+r.pending||0), 0);
  }, [f.patient, allRecords]);

  const validate = () => {
    const e = {};
    if (!f.patient.trim()) e.patient = "Requerido";
    if (!f.treatment.trim()) e.treatment = "Requerido";
    if (!f.amount||isNaN(+f.amount)||+f.amount<=0) e.amount = "Monto inválido";
    if (f.partialPayment && (f.paid===""||isNaN(+f.paid)||+f.paid<0)) e.paid = "Cantidad inválida";
    if (f.partialPayment && +f.paid>+f.amount) e.paid = "No puede superar el total";
    return e;
  };

  const handleSave = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaving(true);
    await onSave({
      id:genId(), type:"income", date:f.date,
      patient:f.patient.trim(), treatment:f.treatment.trim(),
      amount:+f.amount, paymentMethod:f.paymentMethod,
      paid:paidAmount, pending, notes:f.notes,
      requiresInvoice:f.requiresInvoice, owner:f.owner,
      createdAt:Date.now()
    });
    setSaving(false);
    onClose();
  };

  const set = (k,v) => { setF(p=>({...p,[k]:v})); setErrors(p=>({...p,[k]:undefined})); };

  const handleSelectPatient = (name) => {
    const lastTreatment = lastTreatmentByPatient[name];
    setF(p=>({...p, patient:name, treatment: lastTreatment || p.treatment}));
  };

  return (
    <div>
      <Field label="Pertenece a">
        <PillGroup options={OWNER_OPTIONS} value={f.owner} onChange={v=>set("owner",v)} colors={[COLORS.green,COLORS.purple]}/>
      </Field>

      <Field label="Paciente / Descripción" error={errors.patient}>
        {f.owner==="Consultorio" ? (
          <AutocompleteInput value={f.patient} onChange={v=>set("patient",v)}
            suggestions={patientNames} placeholder="Nombre del paciente"
            error={errors.patient} onSelectPatient={handleSelectPatient}/>
        ) : (
          <input style={{...inputStyle,borderColor:errors.patient?COLORS.red:COLORS.grayLight}}
            placeholder="Descripción del ingreso" value={f.patient} onChange={e=>set("patient",e.target.value)}/>
        )}
        {f.owner==="Consultorio" && patientNames.includes(f.patient) && (
          <div style={{fontSize:11,color:COLORS.blue,marginTop:4}}>✓ Paciente con historial previo</div>
        )}
        {existingPending > 0 && (
          <div style={{background:"#FFF8ED",border:"1.5px solid #F5A623",borderRadius:10,padding:"10px 12px",marginTop:6,display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:18}}>⚠️</span>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:"#F5A623"}}>Este paciente tiene adeudo pendiente</div>
              <div style={{fontSize:12,color:"#6B7280"}}>Saldo por cobrar: <strong style={{color:"#F5A623"}}>{formatMXN(existingPending)}</strong></div>
            </div>
          </div>
        )}
      </Field>

      <Field label={f.owner==="Consultorio"?"Tratamiento realizado":"Concepto"} error={errors.treatment}>
        <input style={{...inputStyle,borderColor:errors.treatment?COLORS.red:COLORS.grayLight}}
          placeholder={f.owner==="Consultorio"?"Ej. Resina molar, limpieza…":"Ej. Honorarios, venta, etc."}
          value={f.treatment} onChange={e=>set("treatment",e.target.value)}/>
      </Field>

      {f.owner==="Consultorio" && (
        <div onClick={()=>set("requiresInvoice",!f.requiresInvoice)}
          style={{display:"flex",alignItems:"center",gap:12,marginBottom:14,
            background:f.requiresInvoice?"#EFF6FF":COLORS.grayLight+"55",
            borderRadius:10,padding:"12px 14px",cursor:"pointer",
            border:`1.5px solid ${f.requiresInvoice?COLORS.blue:"transparent"}`,transition:"all 0.15s"}}>
          <div style={{width:22,height:22,borderRadius:6,flexShrink:0,
            border:`2px solid ${f.requiresInvoice?COLORS.blue:COLORS.gray}`,
            background:f.requiresInvoice?COLORS.blue:"#fff",
            display:"flex",alignItems:"center",justifyContent:"center"}}>
            {f.requiresInvoice && <span style={{color:"#fff",fontSize:14,lineHeight:1}}>✓</span>}
          </div>
          <div>
            <div style={{fontSize:14,fontWeight:600,color:f.requiresInvoice?COLORS.blue:COLORS.text}}>Requiere factura</div>
            <div style={{fontSize:11,color:COLORS.gray}}>El paciente solicitó comprobante fiscal</div>
          </div>
        </div>
      )}

      <Field label="Monto total" error={errors.amount}>
        <input style={{...inputStyle,borderColor:errors.amount?COLORS.red:COLORS.grayLight}}
          placeholder="0" type="number" inputMode="decimal" value={f.amount} onChange={e=>set("amount",e.target.value)}/>
      </Field>

      <Field label="Método de pago">
        <PillGroup options={PAYMENT_METHODS} value={f.paymentMethod} onChange={v=>set("paymentMethod",v)}/>
      </Field>

      {commissionAmt>0 && +f.amount>0 && (
        <div style={{background:"#F0F9FF",borderRadius:10,padding:"9px 13px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:12,color:COLORS.blue}}>Comisión (0.65%+IVA = 0.754%)</span>
          <span style={{fontWeight:700,fontSize:13,color:COLORS.blue}}>{formatMXN(commissionAmt)}</span>
        </div>
      )}

      {+f.amount>0 && (
        <div onClick={()=>{set("partialPayment",!f.partialPayment);set("paid","");}}
          style={{display:"flex",alignItems:"center",gap:12,marginBottom:f.partialPayment?10:14,
            background:f.partialPayment?"#FFF8ED":COLORS.grayLight+"55",
            borderRadius:10,padding:"12px 14px",cursor:"pointer",
            border:`1.5px solid ${f.partialPayment?COLORS.amber:"transparent"}`}}>
          <div style={{width:22,height:22,borderRadius:6,flexShrink:0,
            border:`2px solid ${f.partialPayment?COLORS.amber:COLORS.gray}`,
            background:f.partialPayment?COLORS.amber:"#fff",
            display:"flex",alignItems:"center",justifyContent:"center"}}>
            {f.partialPayment && <span style={{color:"#fff",fontSize:14,lineHeight:1}}>✓</span>}
          </div>
          <div>
            <div style={{fontSize:14,fontWeight:600,color:f.partialPayment?COLORS.amber:COLORS.text}}>Pago parcial</div>
            <div style={{fontSize:11,color:COLORS.gray}}>
              {f.partialPayment?"Captura el monto abonado hoy":`Pago completo: ${formatMXN(+f.amount||0)}`}
            </div>
          </div>
        </div>
      )}

      {f.partialPayment && (
        <Field label="Cantidad abonada hoy" error={errors.paid}>
          <input style={{...inputStyle,borderColor:errors.paid?COLORS.red:COLORS.amber}}
            placeholder="0" type="number" inputMode="decimal" autoFocus value={f.paid} onChange={e=>set("paid",e.target.value)}/>
        </Field>
      )}

      {pending>0 && +f.amount>0 && (
        <div style={{background:"#FFF8ED",borderRadius:10,padding:"10px 14px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontSize:16}}>⏳</span>
            <span style={{fontSize:13,color:COLORS.amber,fontWeight:600}}>Saldo pendiente</span>
          </div>
          <span style={{fontSize:15,fontWeight:700,color:COLORS.amber}}>{formatMXN(pending)}</span>
        </div>
      )}

      <Field label="Notas (opcional)">
        <input style={inputStyle} placeholder="Observaciones..." value={f.notes} onChange={e=>set("notes",e.target.value)}/>
      </Field>
      <Field label="Fecha">
        <input style={inputStyle} type="date" value={f.date} onChange={e=>set("date",e.target.value)}/>
      </Field>

      <button onClick={handleSave} disabled={saving}
        style={{width:"100%",padding:"15px",borderRadius:12,border:"none",
          background:saving?COLORS.grayLight:COLORS.green,color:saving?COLORS.gray:"#fff",
          fontSize:16,fontWeight:700,cursor:"pointer",marginTop:6}}>
        {saving?"Guardando...":"✓ Guardar ingreso"}
      </button>
    </div>
  );
}

// ─── EXPENSE FORM ─────────────────────────────────────────────────────────────
function ExpenseForm({ onSave, onClose }) {
  const [f, setF] = useState({ concept:"", category:"", amount:"", paymentMethod:"Efectivo", notes:"", date:today(), owner:"Consultorio" });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const validate = () => {
    const e = {};
    if (!f.concept.trim()) e.concept = "Requerido";
    if (!f.category) e.category = "Requerido";
    if (!f.amount||isNaN(+f.amount)||+f.amount<=0) e.amount = "Monto inválido";
    return e;
  };

  const handleSave = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaving(true);
    await onSave({
      id:genId(), type:"expense", date:f.date,
      concept:f.concept.trim(), category:f.category,
      amount:+f.amount, paymentMethod:f.paymentMethod,
      notes:f.notes, owner:f.owner, createdAt:Date.now()
    });
    setSaving(false);
    onClose();
  };

  const set = (k,v) => { setF(p=>({...p,[k]:v})); setErrors(p=>({...p,[k]:undefined})); };

  return (
    <div>
      <Field label="Pertenece a">
        <PillGroup options={OWNER_OPTIONS} value={f.owner} onChange={v=>set("owner",v)} colors={[COLORS.green,COLORS.purple]}/>
      </Field>
      <Field label="Concepto" error={errors.concept}>
        <input style={{...inputStyle,borderColor:errors.concept?COLORS.red:COLORS.grayLight}}
          placeholder={f.owner==="Consultorio"?"Ej. Materiales, laboratorio…":"Ej. Gasolina, comida…"}
          value={f.concept} onChange={e=>set("concept",e.target.value)}/>
      </Field>
      <Field label="Categoría" error={errors.category}>
        <select style={{...selectStyle,borderColor:errors.category?COLORS.red:COLORS.grayLight}}
          value={f.category} onChange={e=>set("category",e.target.value)}>
          <option value="">Seleccionar...</option>
          {(f.owner==="Consultorio"?EXPENSE_CATEGORIES:PERSONAL_CATEGORIES).map(c=><option key={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="Monto" error={errors.amount}>
        <input style={{...inputStyle,borderColor:errors.amount?COLORS.red:COLORS.grayLight}}
          placeholder="0" type="number" inputMode="decimal" value={f.amount} onChange={e=>set("amount",e.target.value)}/>
      </Field>
      <Field label="Método de pago">
        <PillGroup options={PAYMENT_METHODS} value={f.paymentMethod} onChange={v=>set("paymentMethod",v)}/>
      </Field>
      <Field label="Notas (opcional)">
        <input style={inputStyle} placeholder="Observaciones..." value={f.notes} onChange={e=>set("notes",e.target.value)}/>
      </Field>
      <Field label="Fecha">
        <input style={inputStyle} type="date" value={f.date} onChange={e=>set("date",e.target.value)}/>
      </Field>
      <button onClick={handleSave} disabled={saving}
        style={{width:"100%",padding:"15px",borderRadius:12,border:"none",
          background:saving?COLORS.grayLight:COLORS.red,color:saving?COLORS.gray:"#fff",
          fontSize:16,fontWeight:700,cursor:"pointer",marginTop:6}}>
        {saving?"Guardando...":"✓ Guardar gasto"}
      </button>
    </div>
  );
}

// ─── SETTLE PAYMENT MODAL CONTENT ─────────────────────────────────────────────
function SettleForm({ record, onSettle, onClose }) {
  const [amount, setAmount] = useState(String(record.pending));
  const [paymentMethod, setPaymentMethod] = useState(record.paymentMethod || "Efectivo");
  const [requiresInvoice, setRequiresInvoice] = useState(false);
  const [saving, setSaving] = useState(false);
  const numAmount = +amount || 0;
  const isValid = numAmount > 0 && numAmount <= record.pending;
  const commission = COMMISSION_RATE[paymentMethod] || 0;
  const commissionAmt = numAmount * commission;

  const handleSettle = async () => {
    if (!isValid) return;
    setSaving(true);
    await onSettle(record, numAmount, paymentMethod, requiresInvoice);
    setSaving(false);
    onClose();
  };

  return (
    <div>
      <div style={{background:COLORS.grayLight+"55",borderRadius:12,padding:"12px 14px",marginBottom:16}}>
        <div style={{fontWeight:700,fontSize:15}}>{record.patient}</div>
        <div style={{fontSize:13,color:COLORS.textSoft,marginTop:2}}>{record.treatment} · {record.date}</div>
        <div style={{fontSize:13,color:COLORS.amber,fontWeight:600,marginTop:6}}>
          Saldo pendiente: {formatMXN(record.pending)}
        </div>
      </div>
      <Field label="Cantidad abonada ahora">
        <input style={inputStyle} type="number" inputMode="decimal" autoFocus
          value={amount} onChange={e=>setAmount(e.target.value)}/>
      </Field>
      <button onClick={()=>setAmount(String(record.pending))}
        style={{width:"100%",padding:"10px",borderRadius:10,border:`1px solid ${COLORS.green}`,
          background:"#fff",color:COLORS.green,fontSize:13,fontWeight:600,cursor:"pointer",marginBottom:14}}>
        Pagar saldo completo ({formatMXN(record.pending)})
      </button>

      <Field label="Método de pago de este abono">
        <PillGroup options={PAYMENT_METHODS} value={paymentMethod} onChange={setPaymentMethod}/>
      </Field>

      {commissionAmt > 0 && (
        <div style={{background:"#F0F9FF",borderRadius:10,padding:"9px 13px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:12,color:COLORS.blue}}>Comisión (0.65%+IVA = 0.754%)</span>
          <span style={{fontWeight:700,fontSize:13,color:COLORS.blue}}>{formatMXN(commissionAmt)}</span>
        </div>
      )}

      <div onClick={()=>setRequiresInvoice(!requiresInvoice)}
        style={{display:"flex",alignItems:"center",gap:12,marginBottom:14,
          background:requiresInvoice?"#EFF6FF":COLORS.grayLight+"55",
          borderRadius:10,padding:"12px 14px",cursor:"pointer",
          border:`1.5px solid ${requiresInvoice?COLORS.blue:"transparent"}`,transition:"all 0.15s"}}>
        <div style={{width:22,height:22,borderRadius:6,flexShrink:0,
          border:`2px solid ${requiresInvoice?COLORS.blue:COLORS.gray}`,
          background:requiresInvoice?COLORS.blue:"#fff",
          display:"flex",alignItems:"center",justifyContent:"center"}}>
          {requiresInvoice && <span style={{color:"#fff",fontSize:14,lineHeight:1}}>✓</span>}
        </div>
        <div>
          <div style={{fontSize:14,fontWeight:600,color:requiresInvoice?COLORS.blue:COLORS.text}}>Requiere factura</div>
          <div style={{fontSize:11,color:COLORS.gray}}>El paciente solicitó comprobante de este abono</div>
        </div>
      </div>

      {numAmount > 0 && numAmount < record.pending && (
        <div style={{fontSize:13,color:COLORS.amber,marginBottom:14,textAlign:"center"}}>
          Quedará pendiente: {formatMXN(record.pending - numAmount)}
        </div>
      )}
      <button onClick={handleSettle} disabled={!isValid||saving}
        style={{width:"100%",padding:"15px",borderRadius:12,border:"none",
          background:(!isValid||saving)?COLORS.grayLight:COLORS.green,
          color:(!isValid||saving)?COLORS.gray:"#fff",fontSize:16,fontWeight:700,cursor:"pointer"}}>
        {saving?"Guardando...":"✓ Registrar pago"}
      </button>
    </div>
  );
}

// ─── RECORD ROW ───────────────────────────────────────────────────────────────
function RecordRow({ r, onDelete, onEdit }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isIncome = r.type==="income";
  const isPersonal = r.owner==="Personal (Iván)";

  const handleDelete = async () => { setDeleting(true); await onDelete(r); setDeleting(false); setConfirmDelete(false); };

  return (
    <div style={{position:"relative"}}>
      <div style={{background:COLORS.card,borderRadius:12,padding:"12px 14px",
        boxShadow:"0 1px 3px rgba(0,0,0,0.06)",display:"flex",alignItems:"center",gap:12,
        opacity:deleting?0.4:1,transition:"opacity 0.2s"}}>
        <div style={{width:40,height:40,borderRadius:10,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,
          background:isPersonal?COLORS.purple+"18":isIncome?COLORS.green+"18":COLORS.red+"18"}}>
          {isPersonal?"👤":isIncome?"💰":"🧾"}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{fontWeight:600,fontSize:14,color:COLORS.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
              {isIncome?r.patient:r.concept}
            </div>
            {isPersonal && <span style={{fontSize:10,background:COLORS.purple+"18",color:COLORS.purple,borderRadius:4,padding:"1px 5px",fontWeight:600,flexShrink:0}}>Personal</span>}
          </div>
          <div style={{fontSize:12,color:COLORS.gray,display:"flex",alignItems:"center",gap:4}}>
            {isIncome?r.treatment:r.category} · {r.paymentMethod}
            {isIncome&&r.requiresInvoice&&<span style={{fontSize:10,background:COLORS.blue+"18",color:COLORS.blue,borderRadius:4,padding:"1px 5px",fontWeight:600}}>CFDI</span>}
          </div>
          {isIncome&&(+r.pending||0)>0&&<div style={{fontSize:11,color:COLORS.amber,fontWeight:600}}>Pendiente: {formatMXN(r.pending)}</div>}
        </div>
        <div style={{textAlign:"right",flexShrink:0}}>
          <div style={{fontWeight:700,fontSize:15,color:isIncome?(isPersonal?COLORS.purple:COLORS.green):COLORS.red}}>
            {isIncome?"+":"-"}{formatMXN(isIncome?r.paid:r.amount)}
          </div>
          <div style={{fontSize:11,color:COLORS.gray}}>{r.date}</div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:4}}>
          <button onClick={()=>onEdit&&onEdit(r)}
            style={{border:"none",background:COLORS.blue+"15",borderRadius:8,width:32,height:32,cursor:"pointer",
              fontSize:14,color:COLORS.blue,display:"flex",alignItems:"center",justifyContent:"center"}}>✏️</button>
          <button onClick={()=>setConfirmDelete(true)}
            style={{border:"none",background:COLORS.red+"15",borderRadius:8,width:32,height:32,cursor:"pointer",
              fontSize:15,color:COLORS.red,display:"flex",alignItems:"center",justifyContent:"center"}}>🗑</button>
        </div>
      </div>
      {confirmDelete && (
        <div style={{position:"absolute",inset:0,background:COLORS.card,borderRadius:12,
          boxShadow:"0 2px 12px rgba(0,0,0,0.12)",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",zIndex:10}}>
          <div style={{fontSize:13,color:COLORS.text,fontWeight:600}}>¿Eliminar este registro?</div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>setConfirmDelete(false)} style={{padding:"7px 14px",borderRadius:8,border:`1px solid ${COLORS.grayLight}`,background:"#fff",fontSize:13,cursor:"pointer",color:COLORS.textSoft}}>Cancelar</button>
            <button onClick={handleDelete} disabled={deleting} style={{padding:"7px 14px",borderRadius:8,border:"none",background:deleting?COLORS.grayLight:COLORS.red,color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>{deleting?"...":"Eliminar"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PATIENT HISTORY ──────────────────────────────────────────────────────────
function PatientHistory({ records }) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(null);
  const patients = [...new Set(records.filter(r=>r.type==="income"&&r.owner!=="Personal (Iván)").map(r=>r.patient))].sort();
  const filtered = q ? patients.filter(p=>p.toLowerCase().includes(q.toLowerCase())) : patients;
  const patientRecords = selected ? records.filter(r=>r.type==="income"&&r.patient===selected) : [];
  const totalPaid = patientRecords.reduce((s,r)=>s+(+r.paid||0),0);
  const totalPending = patientRecords.reduce((s,r)=>s+(+r.pending||0),0);

  if (selected) return (
    <div>
      <button onClick={()=>setSelected(null)} style={{...inputStyle,width:"auto",padding:"8px 14px",marginBottom:16,cursor:"pointer"}}>← Volver</button>
      <h3 style={{margin:"0 0 4px",fontSize:17,fontWeight:700}}>{selected}</h3>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        <div style={{flex:1,background:COLORS.green+"18",borderRadius:10,padding:"10px 12px",textAlign:"center"}}>
          <div style={{fontSize:11,color:COLORS.gray,marginBottom:2}}>PAGADO</div>
          <div style={{fontWeight:700,color:COLORS.green,fontSize:15}}>{formatMXN(totalPaid)}</div>
        </div>
        <div style={{flex:1,background:COLORS.amber+"18",borderRadius:10,padding:"10px 12px",textAlign:"center"}}>
          <div style={{fontSize:11,color:COLORS.gray,marginBottom:2}}>PENDIENTE</div>
          <div style={{fontWeight:700,color:COLORS.amber,fontSize:15}}>{formatMXN(totalPending)}</div>
        </div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {patientRecords.map(r=>(
          <div key={r.id} style={{background:COLORS.card,border:`1px solid ${COLORS.grayLight}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{fontWeight:600,fontSize:13}}>{r.treatment}</div>
            <div style={{fontSize:12,color:COLORS.gray}}>{r.date} · {r.paymentMethod}</div>
            <div style={{fontSize:13,marginTop:4}}>
              <span style={{color:COLORS.green}}>Pagado: {formatMXN(r.paid)}</span>
              {(+r.pending||0)>0&&<span style={{color:COLORS.amber,marginLeft:12}}>Pendiente: {formatMXN(r.pending)}</span>}
            </div>
            {r.requiresInvoice&&<div style={{fontSize:11,color:COLORS.blue,marginTop:3,fontWeight:600}}>🧾 Requiere factura</div>}
            {r.notes&&<div style={{fontSize:12,color:COLORS.gray,marginTop:2}}>{r.notes}</div>}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div>
      <input style={{...inputStyle,marginBottom:12}} placeholder="🔍 Buscar paciente..." value={q} onChange={e=>setQ(e.target.value)} autoFocus/>
      {filtered.length===0 ? <div style={{textAlign:"center",color:COLORS.gray,padding:20}}>Sin resultados</div>
        : filtered.map(p=>(
          <button key={p} onClick={()=>setSelected(p)} style={{width:"100%",textAlign:"left",background:COLORS.card,border:`1px solid ${COLORS.grayLight}`,borderRadius:10,padding:"12px 14px",marginBottom:8,cursor:"pointer",fontSize:15,color:COLORS.text}}>👤 {p}</button>
        ))
      }
    </div>
  );
}

// ─── DAILY BAR CHART ─────────────────────────────────────────────────────────
function DailyBarChart({ data, maxVal, todayDay, selectedMonth }) {
  const [tooltip, setTooltip] = useState(null); // {day, amount, x, y}

  const handleTap = (e, d) => {
    e.stopPropagation();
    if (d.amount === 0) { setTooltip(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({ day:d.day, date:d.date, amount:d.amount,
      x: rect.left + rect.width/2, y: rect.top });
  };

  return (
    <div style={{position:"relative"}} onClick={()=>setTooltip(null)}>
      <div style={{display:"flex",alignItems:"flex-end",gap:2,height:90,paddingBottom:4,overflowX:"auto"}}>
        {data.map(d=>{
          const isToday = d.day===todayDay && selectedMonth===monthKey(today());
          const isSelected = tooltip?.day===d.day;
          const barH = d.amount>0 ? Math.max((d.amount/maxVal)*76,4) : 0;
          return (
            <div key={d.day} style={{display:"flex",flexDirection:"column",alignItems:"center",minWidth:8,flex:1,cursor:d.amount>0?"pointer":"default"}}
              onPointerDown={e=>d.amount>0&&handleTap(e,d)}>
              <div style={{width:"100%",
                background:isSelected?COLORS.amber:d.amount>0?(isToday?COLORS.blue:COLORS.green):COLORS.grayLight+"80",
                borderRadius:"3px 3px 0 0",height:barH,transition:"height 0.3s ease,background 0.15s",
                border:isToday?`1.5px solid ${COLORS.blue}`:"none"}}/>
              {d.day%5===0||d.day===1
                ? <div style={{fontSize:7,color:COLORS.gray,marginTop:2,userSelect:"none"}}>{d.day}</div>
                : <div style={{height:11}}/>}
            </div>
          );
        })}
      </div>
      {tooltip && (
        <div style={{position:"fixed",
          top: Math.max(8, tooltip.y - 68),
          left: Math.max(8, Math.min(tooltip.x - 70, (typeof window!=="undefined"?window.innerWidth:400)-148)),
          background:COLORS.nav,color:"#fff",borderRadius:10,padding:"8px 14px",
          zIndex:100,pointerEvents:"none",boxShadow:"0 4px 16px rgba(0,0,0,0.25)",minWidth:140}}>
          <div style={{fontSize:12,opacity:0.75,marginBottom:2}}>{tooltip.date} · Día {tooltip.day}</div>
          <div style={{fontSize:16,fontWeight:700}}>{formatMXN(tooltip.amount)}</div>
          <div style={{fontSize:10,opacity:0.6,marginTop:2}}>Toca fuera para cerrar</div>
        </div>
      )}
    </div>
  );
}

// ─── KPIs TAB ─────────────────────────────────────────────────────────────────
function KpiBar({ label, value, max, color }) {
  const pct = max>0 ? (value/max)*100 : 0;
  return (
    <div style={{marginBottom:10}}>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:4}}>
        <span style={{color:COLORS.textSoft}}>{label}</span>
        <span style={{fontWeight:600,color:COLORS.text}}>{formatMXN(value)}</span>
      </div>
      <div style={{background:COLORS.grayLight,borderRadius:4,height:6}}>
        <div style={{background:color,borderRadius:4,height:6,width:`${pct}%`,transition:"width 0.5s ease"}}/>
      </div>
    </div>
  );
}

function KpisTab({ records, selectedMonth }) {
  const monthRecords = records.filter(r=>monthKey(r.date)===selectedMonth);
  const incomeRecords = monthRecords.filter(r=>r.type==="income");
  const expenseRecords = monthRecords.filter(r=>r.type==="expense");

  const clinicIncome = incomeRecords.filter(r=>r.owner!=="Personal (Iván)");
  const clinicExpense = expenseRecords.filter(r=>r.owner!=="Personal (Iván)");
  const clinicIncomeTotal = clinicIncome.reduce((s,r)=>s+(+r.paid||0),0);
  const clinicExpenseTotal = clinicExpense.reduce((s,r)=>s+(+r.amount||0),0);
  const netProfit = clinicIncomeTotal - clinicExpenseTotal;

  const uniquePatients = new Set(clinicIncome.map(r=>r.patient)).size;
  const avgTicket = clinicIncome.length>0 ? clinicIncomeTotal/clinicIncome.length : 0;

  const cardIncome = incomeRecords.filter(r=>r.paymentMethod==="T. Débito"||r.paymentMethod==="T. Crédito");
  const totalCommissions = cardIncome.reduce((s,r)=>s+(+r.paid||0),0) * 0.00754;

  // Histórico 6 meses
  const now = new Date();
  const history = [];
  for (let m=5; m>=0; m--) {
    const d = new Date(now.getFullYear(), now.getMonth()-m, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    const incM = records.filter(r=>r.type==="income"&&monthKey(r.date)===ym&&r.owner!=="Personal (Iván)");
    const expM = records.filter(r=>r.type==="expense"&&monthKey(r.date)===ym&&r.owner!=="Personal (Iván)");
    const incTotal = incM.reduce((s,r)=>s+(+r.paid||0),0);
    const expTotal = expM.reduce((s,r)=>s+(+r.amount||0),0);
    history.push({ month: ym, income: incTotal, expense: expTotal });
  }
  const maxHistory = Math.max(...history.map(h=>Math.max(h.income,h.expense)), 1);

  // Por categoría
  const byCategory = EXPENSE_CATEGORIES.map(cat => ({
    category: cat,
    amount: clinicExpense.filter(r=>r.category===cat).reduce((s,r)=>s+(+r.amount||0),0)
  })).filter(c=>c.amount>0).sort((a,b)=>b.amount-a.amount);
  const maxCategory = Math.max(...byCategory.map(c=>c.amount), 1);

  // Por método de pago
  const byPayment = PAYMENT_METHODS.map(m => ({
    method: m,
    amount: incomeRecords.filter(r=>r.paymentMethod===m).reduce((s,r)=>s+(+r.paid||0),0)
  })).filter(p=>p.amount>0);
  const totalPaymentIncome = byPayment.reduce((s,p)=>s+p.amount,0);

  // Ingresos diarios del mes seleccionado
  const daysInMonth = new Date(+selectedMonth.slice(0,4), +selectedMonth.slice(5,7), 0).getDate();
  const dailyIncome = Array.from({length:daysInMonth},(_,i)=>{
    const day = String(i+1).padStart(2,"0");
    const dateStr = `${selectedMonth}-${day}`;
    const amt = clinicIncome.filter(r=>String(r.date)===dateStr).reduce((s,r)=>s+(+r.paid||0),0);
    return { day:i+1, date:dateStr, amount:amt };
  });
  const maxDay = Math.max(...dailyIncome.map(d=>d.amount),1);
  const todayDay = new Date().getDate();

  return (
    <div style={{padding:"16px"}}>
      <div style={{display:"flex",flexWrap:"wrap",gap:10,marginBottom:16}}>
        <KpiCard label="Ganancia neta" value={formatMXN(netProfit)} color={netProfit>=0?COLORS.green:COLORS.red} icon={netProfit>=0?"📈":"📉"}/>
        <KpiCard label="Ticket promedio" value={formatMXN(avgTicket)} color={COLORS.blue} icon="🎫" sub={`${uniquePatients} pacientes`}/>
        <KpiCard label="Comisiones tarjeta" value={formatMXN(totalCommissions)} color={COLORS.purple} icon="💳" sub="0.754%"/>
        <KpiCard label="Gasto promedio" value={formatMXN(clinicExpense.length>0?clinicExpenseTotal/clinicExpense.length:0)} color={COLORS.amber} icon="🧾"/>
      </div>

      {/* Daily income chart */}
      <div style={{background:COLORS.card,borderRadius:14,padding:"14px 16px",marginBottom:14,boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}>
        <div style={{fontWeight:700,fontSize:13,marginBottom:4}}>📅 Ingresos diarios — {monthName(selectedMonth)}</div>
        <div style={{fontSize:11,color:COLORS.gray,marginBottom:12}}>Consultorio · barra = día de trabajo</div>
        <DailyBarChart data={dailyIncome} maxVal={maxDay} todayDay={todayDay} selectedMonth={selectedMonth}/>
        <div style={{display:"flex",gap:12,marginTop:8,fontSize:11,color:COLORS.gray}}>
          <div style={{display:"flex",alignItems:"center",gap:4}}><div style={{width:10,height:10,borderRadius:2,background:COLORS.green}}/> Consultorio</div>
          <div style={{display:"flex",alignItems:"center",gap:4}}><div style={{width:10,height:10,borderRadius:2,background:COLORS.blue}}/> Hoy</div>
        </div>
      </div>

      <div style={{background:COLORS.card,borderRadius:14,padding:"14px 16px",marginBottom:14,boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}>
        <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>Ingresos vs Gastos — últimos 6 meses</div>
        {history.map(h=>(
          <div key={h.month} style={{marginBottom:12}}>
            <div style={{fontSize:12,color:COLORS.textSoft,marginBottom:4,fontWeight:600}}>{monthName(h.month)}</div>
            <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:3}}>
              <div style={{width:50,fontSize:10,color:COLORS.green}}>Ingreso</div>
              <div style={{flex:1,background:COLORS.grayLight,borderRadius:3,height:8}}>
                <div style={{background:COLORS.green,borderRadius:3,height:8,width:`${(h.income/maxHistory)*100}%`}}/>
              </div>
              <div style={{width:70,fontSize:11,textAlign:"right",fontWeight:600}}>{formatMXN(h.income)}</div>
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <div style={{width:50,fontSize:10,color:COLORS.red}}>Gasto</div>
              <div style={{flex:1,background:COLORS.grayLight,borderRadius:3,height:8}}>
                <div style={{background:COLORS.red,borderRadius:3,height:8,width:`${(h.expense/maxHistory)*100}%`}}/>
              </div>
              <div style={{width:70,fontSize:11,textAlign:"right",fontWeight:600}}>{formatMXN(h.expense)}</div>
            </div>
          </div>
        ))}
      </div>

      {byCategory.length>0 && (
        <div style={{background:COLORS.card,borderRadius:14,padding:"14px 16px",marginBottom:14,boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}>
          <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>Gastos por categoría (mes)</div>
          {byCategory.map(c=><KpiBar key={c.category} label={c.category} value={c.amount} max={maxCategory} color={COLORS.red}/>)}
        </div>
      )}

      {byPayment.length>0 && (
        <div style={{background:COLORS.card,borderRadius:14,padding:"14px 16px",marginBottom:14,boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}>
          <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>Ingresos por método de pago (mes)</div>
          {byPayment.map(p=><KpiBar key={p.method} label={p.method} value={p.amount} max={totalPaymentIncome} color={COLORS.blue}/>)}
        </div>
      )}
    </div>
  );
}

// ─── EDIT FORM ────────────────────────────────────────────────────────────────
function EditForm({ record, onSave, onClose }) {
  const isIncome = record.type === "income";
  const [f, setF] = useState({
    patient:   record.patient  || "",
    concept:   record.concept  || "",
    treatment: record.treatment|| "",
    category:  record.category || "",
    amount:    String(record.amount || ""),
    paid:      String(record.paid   || ""),
    pending:   String(record.pending|| ""),
    paymentMethod: record.paymentMethod || "Efectivo",
    requiresInvoice: record.requiresInvoice || false,
    owner:     record.owner    || "Consultorio",
    date:      record.date     || today(),
    notes:     record.notes    || "",
  });
  const [saving, setSaving] = useState(false);

  const set = (k,v) => setF(p=>({...p,[k]:v}));

  const handleSave = async () => {
    setSaving(true);
    const updated = {
      ...record,
      paymentMethod: f.paymentMethod,
      requiresInvoice: f.requiresInvoice,
      notes: f.notes,
      date: f.date,
      owner: f.owner,
      // For income: allow editing paid/pending/amount
      ...(isIncome ? {
        patient: f.patient,
        treatment: f.treatment,
        amount: +f.amount || record.amount,
        paid: +f.paid || record.paid,
        pending: +f.pending || 0,
      } : {
        concept: f.concept,
        category: f.category,
        amount: +f.amount || record.amount,
      })
    };
    await onSave(updated);
    setSaving(false);
    onClose();
  };

  return (
    <div>
      <div style={{background:"#EFF6FF",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:13,color:COLORS.blue}}>
        ✏️ Editando registro — solo se actualiza en la app. Para reflejarlo en Sheets, el registro se eliminará y recreará automáticamente.
      </div>

      {isIncome ? (
        <>
          <Field label="Paciente">
            <input style={inputStyle} value={f.patient} onChange={e=>set("patient",e.target.value)}/>
          </Field>
          <Field label="Tratamiento">
            <input style={inputStyle} value={f.treatment} onChange={e=>set("treatment",e.target.value)}/>
          </Field>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
            <Field label="Total">
              <input style={inputStyle} type="number" inputMode="decimal" value={f.amount} onChange={e=>set("amount",e.target.value)}/>
            </Field>
            <Field label="Pagado">
              <input style={inputStyle} type="number" inputMode="decimal" value={f.paid} onChange={e=>set("paid",e.target.value)}/>
            </Field>
            <Field label="Pendiente">
              <input style={inputStyle} type="number" inputMode="decimal" value={f.pending} onChange={e=>set("pending",e.target.value)}/>
            </Field>
          </div>
        </>
      ) : (
        <>
          <Field label="Concepto">
            <input style={inputStyle} value={f.concept} onChange={e=>set("concept",e.target.value)}/>
          </Field>
          <Field label="Categoría">
            <select style={selectStyle} value={f.category} onChange={e=>set("category",e.target.value)}>
              {(f.owner==="Consultorio"?EXPENSE_CATEGORIES:PERSONAL_CATEGORIES).map(c=><option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Monto">
            <input style={inputStyle} type="number" inputMode="decimal" value={f.amount} onChange={e=>set("amount",e.target.value)}/>
          </Field>
        </>
      )}

      <Field label="Método de pago">
        <PillGroup options={PAYMENT_METHODS} value={f.paymentMethod} onChange={v=>set("paymentMethod",v)}/>
      </Field>

      {isIncome && (
        <div onClick={()=>set("requiresInvoice",!f.requiresInvoice)}
          style={{display:"flex",alignItems:"center",gap:12,marginBottom:14,
            background:f.requiresInvoice?"#EFF6FF":COLORS.grayLight+"55",
            borderRadius:10,padding:"12px 14px",cursor:"pointer",
            border:`1.5px solid ${f.requiresInvoice?COLORS.blue:"transparent"}`}}>
          <div style={{width:22,height:22,borderRadius:6,flexShrink:0,
            border:`2px solid ${f.requiresInvoice?COLORS.blue:COLORS.gray}`,
            background:f.requiresInvoice?COLORS.blue:"#fff",
            display:"flex",alignItems:"center",justifyContent:"center"}}>
            {f.requiresInvoice && <span style={{color:"#fff",fontSize:14,lineHeight:1}}>✓</span>}
          </div>
          <div style={{fontSize:14,fontWeight:600,color:f.requiresInvoice?COLORS.blue:COLORS.text}}>Requiere factura</div>
        </div>
      )}

      <Field label="Pertenece a">
        <PillGroup options={OWNER_OPTIONS} value={f.owner} onChange={v=>set("owner",v)} colors={[COLORS.green,COLORS.purple]}/>
      </Field>

      <Field label="Notas">
        <input style={inputStyle} value={f.notes} onChange={e=>set("notes",e.target.value)}/>
      </Field>

      <Field label="Fecha">
        <input style={inputStyle} type="date" value={f.date} onChange={e=>set("date",e.target.value)}/>
      </Field>

      <button onClick={handleSave} disabled={saving}
        style={{width:"100%",padding:"15px",borderRadius:12,border:"none",
          background:saving?COLORS.grayLight:COLORS.blue,color:saving?COLORS.gray:"#fff",
          fontSize:16,fontWeight:700,cursor:"pointer",marginTop:6}}>
        {saving?"Guardando...":"✓ Guardar cambios"}
      </button>
    </div>
  );
}

// ─── RECURRING EXPENSES ───────────────────────────────────────────────────────
const RECURRING_KEY = "dental_recurring_v2";

// Plantillas de categorías con ícono
const RECURRING_TEMPLATES = [
  { category:"Hipoteca/Renta",     icon:"🏠", color:"#3B82F6" },
  { category:"Terreno",            icon:"🌳", color:"#10B981" },
  { category:"Mantenimiento",      icon:"🔧", color:"#F59E0B" },
  { category:"Internet",           icon:"🌐", color:"#6366F1" },
  { category:"Luz",                icon:"⚡", color:"#EAB308" },
  { category:"Agua",               icon:"💧", color:"#06B6D4" },
  { category:"Telefonía Movistar", icon:"📱", color:"#EC4899" },
  { category:"Telefonía Telcel",   icon:"📱", color:"#8B5CF6" },
  { category:"Streaming",          icon:"🎬", color:"#EF4444" },
  { category:"Carro",              icon:"🚗", color:"#64748B" },
  { category:"Seguro",             icon:"🛡️", color:"#0EA5E9" },
  { category:"Otro fijo",          icon:"📌", color:"#78716C" },
];

function loadRecurring() { try { return JSON.parse(localStorage.getItem(RECURRING_KEY)||"[]"); } catch { return []; } }
function saveRecurring(r) { localStorage.setItem(RECURRING_KEY, JSON.stringify(r)); }

function RecurringExpenses({ onApply }) {
  const [items, setItems] = useState(loadRecurring);
  const [editingId, setEditingId] = useState(null); // null = adding new, string = editing existing
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ concept:"", category:"Hipoteca/Renta", amount:"", paymentMethod:"Transferencia", dayOfMonth:"" });
  const [applyStatus, setApplyStatus] = useState(null);
  const [applyingId, setApplyingId] = useState(null);

  const setF = (k,v) => setForm(p=>({...p,[k]:v}));

  const openAdd = () => {
    setEditingId(null);
    setForm({ concept:"", category:"Hipoteca/Renta", amount:"", paymentMethod:"Transferencia", dayOfMonth:"" });
    setShowForm(true);
  };

  const openEdit = (item) => {
    setEditingId(item.id);
    setForm({ concept:item.concept, category:item.category, amount:String(item.amount), paymentMethod:item.paymentMethod, dayOfMonth:String(item.dayOfMonth||"") });
    setShowForm(true);
  };

  const handleSave = () => {
    if (!form.concept.trim() || !form.amount || +form.amount <= 0) return;
    let newItems;
    if (editingId) {
      newItems = items.map(i=>i.id===editingId ? {...i,...form,amount:+form.amount,dayOfMonth:+form.dayOfMonth||null} : i);
    } else {
      newItems = [...items, { id:genId(), ...form, amount:+form.amount, dayOfMonth:+form.dayOfMonth||null }];
    }
    setItems(newItems);
    saveRecurring(newItems);
    setShowForm(false);
  };

  const handleDelete = (id) => {
    const newItems = items.filter(i=>i.id!==id);
    setItems(newItems);
    saveRecurring(newItems);
  };

  const handleApplyAll = async () => {
    setApplyStatus("applying");
    await onApply(items);
    setApplyStatus("done");
    setTimeout(()=>setApplyStatus(null), 3000);
  };

  const handleApplyOne = async (item) => {
    setApplyingId(item.id);
    await onApply([item]);
    setApplyingId(null);
  };

  const total = items.reduce((s,i)=>s+i.amount,0);
  const getTemplate = (cat) => RECURRING_TEMPLATES.find(t=>t.category===cat) || RECURRING_TEMPLATES[RECURRING_TEMPLATES.length-1];

  // Group by category for display
  const grouped = RECURRING_TEMPLATES.map(t=>({
    ...t,
    items: items.filter(i=>i.category===t.category)
  })).filter(g=>g.items.length>0);

  return (
    <div style={{padding:"16px"}}>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <div style={{fontWeight:700,fontSize:16,color:COLORS.text}}>Gastos fijos recurrentes</div>
          <div style={{fontSize:12,color:COLORS.gray,marginTop:2}}>{items.length} gasto{items.length!==1?"s":""} · Total: <strong style={{color:COLORS.purple}}>{formatMXN(total)}</strong>/mes</div>
        </div>
        <button onClick={openAdd}
          style={{padding:"10px 18px",borderRadius:12,border:"none",background:COLORS.nav,
            color:"#fff",fontSize:14,fontWeight:600,cursor:"pointer"}}>+ Nuevo</button>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div style={{background:"#F8FAFB",borderRadius:14,padding:"16px",marginBottom:16,
          border:`1.5px solid ${COLORS.nav}20`}}>
          <div style={{fontWeight:700,fontSize:14,marginBottom:12,color:COLORS.text}}>
            {editingId ? "Editar gasto fijo" : "Nuevo gasto fijo"}
          </div>

          {/* Category grid */}
          <Field label="Categoría">
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:0}}>
              {RECURRING_TEMPLATES.map(t=>{
                const active = form.category===t.category;
                return (
                  <div key={t.category} onClick={()=>setF("category",t.category)}
                    style={{borderRadius:10,padding:"8px 6px",textAlign:"center",cursor:"pointer",
                      border:`1.5px solid ${active?t.color:COLORS.grayLight}`,
                      background:active?t.color+"15":"#fff",transition:"all 0.15s"}}>
                    <div style={{fontSize:20}}>{t.icon}</div>
                    <div style={{fontSize:10,fontWeight:600,color:active?t.color:COLORS.textSoft,marginTop:2,lineHeight:1.2}}>{t.category}</div>
                  </div>
                );
              })}
            </div>
          </Field>

          <Field label="Nombre / descripción">
            <input style={inputStyle} placeholder={`Ej. ${form.category} BBVA`}
              value={form.concept} onChange={e=>setF("concept",e.target.value)}/>
          </Field>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <Field label="Monto mensual">
              <input style={inputStyle} type="number" inputMode="decimal" placeholder="0"
                value={form.amount} onChange={e=>setF("amount",e.target.value)}/>
            </Field>
            <Field label="Día del mes">
              <input style={inputStyle} type="number" inputMode="numeric" placeholder="Ej. 6, 15..."
                min="1" max="31" value={form.dayOfMonth} onChange={e=>setF("dayOfMonth",e.target.value)}/>
            </Field>
          </div>

          <Field label="Método de pago">
            <PillGroup options={PAYMENT_METHODS} value={form.paymentMethod} onChange={v=>setF("paymentMethod",v)}/>
          </Field>

          <div style={{display:"flex",gap:8,marginTop:4}}>
            <button onClick={()=>setShowForm(false)}
              style={{flex:1,padding:"12px",borderRadius:10,border:`1px solid ${COLORS.grayLight}`,
                background:"#fff",fontSize:14,cursor:"pointer",color:COLORS.textSoft}}>Cancelar</button>
            <button onClick={handleSave}
              style={{flex:2,padding:"12px",borderRadius:10,border:"none",background:COLORS.nav,
                color:"#fff",fontSize:14,fontWeight:600,cursor:"pointer"}}>
              {editingId?"Guardar cambios":"Agregar"}
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {items.length===0 && !showForm && (
        <div style={{textAlign:"center",padding:32,color:COLORS.gray,fontSize:14,background:COLORS.card,borderRadius:14}}>
          Sin gastos fijos aún.<br/>
          <span style={{fontSize:12}}>Agrega hipoteca, internet, luz, etc. para registrarlos rápido cada mes.</span>
        </div>
      )}

      {/* Grouped items */}
      {grouped.map(group=>(
        <div key={group.category} style={{marginBottom:12}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
            <span style={{fontSize:16}}>{group.icon}</span>
            <span style={{fontSize:12,fontWeight:700,color:group.color,textTransform:"uppercase",letterSpacing:"0.05em"}}>{group.category}</span>
          </div>
          {group.items.map(item=>(
            <div key={item.id} style={{background:COLORS.card,borderRadius:12,padding:"12px 14px",
              boxShadow:"0 1px 3px rgba(0,0,0,0.06)",display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:600,fontSize:14,color:COLORS.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{item.concept}</div>
                <div style={{fontSize:11,color:COLORS.gray,marginTop:1}}>
                  {item.paymentMethod}
                  {item.dayOfMonth ? ` · Día ${item.dayOfMonth} de cada mes` : ""}
                </div>
              </div>
              <div style={{fontWeight:700,fontSize:15,color:group.color,flexShrink:0}}>{formatMXN(item.amount)}</div>
              <button onClick={()=>handleApplyOne(item)} disabled={applyingId===item.id}
                style={{border:"none",background:COLORS.green+"15",borderRadius:8,padding:"6px 10px",
                  cursor:"pointer",fontSize:12,fontWeight:600,color:COLORS.green,flexShrink:0}}>
                {applyingId===item.id?"...":"↓ Reg."}
              </button>
              <button onClick={()=>openEdit(item)}
                style={{border:"none",background:COLORS.blue+"15",borderRadius:8,width:30,height:30,
                  cursor:"pointer",fontSize:13,color:COLORS.blue,display:"flex",alignItems:"center",justifyContent:"center"}}>✏️</button>
              <button onClick={()=>handleDelete(item.id)}
                style={{border:"none",background:COLORS.red+"15",borderRadius:8,width:30,height:30,
                  cursor:"pointer",fontSize:14,color:COLORS.red,display:"flex",alignItems:"center",justifyContent:"center"}}>🗑</button>
            </div>
          ))}
        </div>
      ))}

      {/* Apply all button */}
      {items.length>0 && (
        <div style={{marginTop:8}}>
          <button onClick={handleApplyAll} disabled={applyStatus==="applying"}
            style={{width:"100%",padding:"14px",borderRadius:12,border:"none",
              background:applyStatus==="done"?COLORS.green:applyStatus==="applying"?COLORS.grayLight:COLORS.purple,
              color:applyStatus==="applying"?COLORS.gray:"#fff",fontSize:15,fontWeight:700,cursor:"pointer"}}>
            {applyStatus==="applying"?"Registrando..."
              :applyStatus==="done"?"✓ Registrados correctamente"
              :`Registrar todos (${formatMXN(total)}) hoy`}
          </button>
          <p style={{fontSize:11,color:COLORS.gray,textAlign:"center",marginTop:6}}>
            O usa el botón "↓ Reg." para registrar uno por uno
          </p>
        </div>
      )}
    </div>
  );
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
function Settings({ config, onChange, onClearLocal }) {
  const [url, setUrl] = useState(config?.webhookUrl||"");
  const [saved, setSaved] = useState(false);
  const handleSave = () => { onChange({...config,webhookUrl:url}); setSaved(true); setTimeout(()=>setSaved(false),2000); };
  return (
    <div>
      <Field label="URL del Webhook (Apps Script)">
        <input style={inputStyle} placeholder="https://script.google.com/macros/s/..." value={url} onChange={e=>setUrl(e.target.value)}/>
      </Field>
      <button onClick={handleSave} style={{width:"100%",padding:"14px",borderRadius:12,border:"none",
        background:saved?COLORS.green:COLORS.nav,color:"#fff",fontSize:15,fontWeight:700,cursor:"pointer",marginBottom:12}}>
        {saved?"✓ Guardado":"Guardar configuración"}
      </button>
      <button onClick={onClearLocal} style={{width:"100%",padding:"12px",borderRadius:12,border:`1px solid ${COLORS.red}`,
        background:"#fff",color:COLORS.red,fontSize:14,fontWeight:600,cursor:"pointer"}}>
        🗑 Limpiar datos locales de prueba
      </button>
      <p style={{fontSize:11,color:COLORS.gray,marginTop:8,textAlign:"center"}}>Los datos en Google Sheets no se afectan.</p>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function DentalApp() {
  const [tab, setTab] = useState("dashboard");
  const windowWidth = useWindowWidth();
  const isTablet = windowWidth >= 768;
  const appMaxWidth = isTablet ? 700 : 480;
  const [records, setRecords] = useState([]);
  const [config, setConfig] = useState(loadConfig);
  const [loading, setLoading] = useState(false);
  const [sheetIncome, setSheetIncome] = useState(false);
  const [sheetExpense, setSheetExpense] = useState(false);
  const [sheetPatients, setSheetPatients] = useState(false);
  const [sheetSettings, setSheetSettings] = useState(false);
  const [sheetRecurring, setSheetRecurring] = useState(false);
  const [settleRecord, setSettleRecord] = useState(null);
  const [editRecord, setEditRecord] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(monthKey(today()));
  const [syncStatus, setSyncStatus] = useState(null);

  const loadFromSheets = useCallback(async () => {
    if (!config?.webhookUrl) return;
    setLoading(true);
    const recs = await fetchRecords(config.webhookUrl);
    setRecords(recs);
    setLoading(false);
  }, [config?.webhookUrl]);

  useEffect(()=>{ loadFromSheets(); },[loadFromSheets]);

  const currentMonth = monthKey(today());
  const todayStr = today();

  const availableMonths = [...new Set(records.map(r=>monthKey(r.date)))].sort().reverse();
  if (!availableMonths.includes(currentMonth)) availableMonths.unshift(currentMonth);

  const monthRecords = records.filter(r=>monthKey(r.date)===selectedMonth);
  const incomeRecords = monthRecords.filter(r=>r.type==="income");
  const expenseRecords = monthRecords.filter(r=>r.type==="expense");

  // Hoy — busca en TODOS los registros, no solo el mes seleccionado
  const todayIncome = records.filter(r=>r.type==="income"&&String(r.date)===todayStr).reduce((s,r)=>s+(+r.paid||0),0);
  const todayExpenses = records.filter(r=>r.type==="expense"&&String(r.date)===todayStr).reduce((s,r)=>s+(+r.amount||0),0);

  // Depósito esperado hoy de terminal (tarjetas cobradas en días previos según calendario bancario)
  const chargeDatesForToday = getChargeDatesForDeposit(todayStr);
  const cardChargesIncoming = records.filter(r => {
    if (r.type !== "income") return false;
    const isCard = r.paymentMethod === "T. Débito" || r.paymentMethod === "T. Crédito";
    const dateMatch = chargeDatesForToday.includes(String(r.date));
    return isCard && dateMatch;
  });
  const expectedDepositGross = cardChargesIncoming.reduce((s,r)=>s+(+r.paid||0),0);
  const expectedDepositCommission = cardChargesIncoming.reduce((s,r)=>s+((+r.paid||0)*COMMISSION_RATE[r.paymentMethod]),0);
  const expectedDepositNet = expectedDepositGross - expectedDepositCommission;

  const clinicIncome = incomeRecords.filter(r=>r.owner!=="Personal (Iván)").reduce((s,r)=>s+(+r.paid||0),0);
  const personalIncome = incomeRecords.filter(r=>r.owner==="Personal (Iván)").reduce((s,r)=>s+(+r.paid||0),0);
  const clinicExpenses = expenseRecords.filter(r=>r.owner!=="Personal (Iván)").reduce((s,r)=>s+(+r.amount||0),0);
  const personalExpenses = expenseRecords.filter(r=>r.owner==="Personal (Iván)").reduce((s,r)=>s+(+r.amount||0),0);

  const totalIncome = incomeRecords.reduce((s,r)=>s+(+r.paid||0),0);
  const totalExpenses = expenseRecords.reduce((s,r)=>s+(+r.amount||0),0);
  const netProfit = clinicIncome - clinicExpenses;
  const totalPending = incomeRecords.reduce((s,r)=>s+(+r.pending||0),0);

  // Pendientes: busca en TODOS los registros, no solo el mes actual
  const pendingPatients = records.filter(r=>r.type==="income"&&(+r.pending||0)>0)
    .sort((a,b)=>(a.patient||"").localeCompare(b.patient||""));

  const patients = new Set(incomeRecords.filter(r=>r.owner!=="Personal (Iván)").map(r=>r.patient)).size;
  const byPayment = PAYMENT_METHODS.reduce((acc,m)=>{ acc[m]=incomeRecords.filter(r=>r.paymentMethod===m).reduce((s,r)=>s+(+r.paid||0),0); return acc; },{});
  const totalCommissions = incomeRecords.reduce((s,r)=>s+((+r.paid||0)*(COMMISSION_RATE[r.paymentMethod]||0)),0);

  // TODOS los registros (ingresos + gastos) ordenados, no solo income
  const recentAll = [...monthRecords].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).slice(0,20);

  // Listas para autocompletado
  const patientNames = useMemo(()=>[...new Set(records.filter(r=>r.type==="income"&&r.owner!=="Personal (Iván)").map(r=>r.patient))].filter(Boolean).sort(), [records]);
  const lastTreatmentByPatient = useMemo(()=>{
    const map = {};
    records.filter(r=>r.type==="income").sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)).forEach(r=>{ map[r.patient]=r.treatment; });
    return map;
  }, [records]);

  const saveRecord = async (record) => {
    setRecords(prev=>[...prev,record]);
    setSyncStatus("syncing");
    await sheetsRequest(config.webhookUrl,{action:"save",type:record.type,row:record});
    setSyncStatus("ok");
    setTimeout(()=>setSyncStatus(null),3000);
    setTimeout(()=>loadFromSheets(),2500);
  };

  const deleteRecord = async (record) => {
    setRecords(prev=>prev.filter(r=>r.id!==record.id));
    setSyncStatus("syncing");
    await sheetsRequest(config.webhookUrl,{action:"delete",type:record.type,id:record.id});
    setSyncStatus("ok");
    setTimeout(()=>setSyncStatus(null),3000);
    setTimeout(()=>loadFromSheets(),2500);
  };

  const settlePayment = async (record, amount, paymentMethod, requiresInvoice) => {
    // Optimistic update
    setRecords(prev=>prev.map(r=>{
      if (r.id !== record.id) return r;
      const newPending = Math.max(0, (+r.pending||0) - amount);
      const newPaid = (+r.paid||0) + ((+r.pending||0) - newPending);
      return { ...r, pending:newPending, paid:newPaid };
    }));
    setSyncStatus("syncing");
    await sheetsRequest(config.webhookUrl,{
      action:"settlePending", id:record.id, amount,
      paymentMethod: paymentMethod || record.paymentMethod,
      requiresInvoice: requiresInvoice ? "Si" : "No"
    });
    setSyncStatus("ok");
    setTimeout(()=>setSyncStatus(null),3000);
    setTimeout(()=>loadFromSheets(),2500);
  };

  const handleConfigChange = (newConfig) => { setConfig(newConfig); saveConfigLocal(newConfig); };
  const handleClearLocal = () => {
    if (!confirm("¿Borrar datos locales? Los datos en Google Sheets no se afectan.")) return;
    setRecords([]);
    setTimeout(()=>loadFromSheets(),500);
  };

  const updateRecord = async (updated) => {
    // Delete old, save new (keeps Sheets clean)
    setRecords(prev=>prev.map(r=>r.id===updated.id?updated:r));
    setSyncStatus("syncing");
    await sheetsRequest(config.webhookUrl,{action:"delete",type:updated.type,id:updated.id});
    await new Promise(r=>setTimeout(r,400));
    await sheetsRequest(config.webhookUrl,{action:"save",type:updated.type,row:updated});
    setSyncStatus("ok");
    setTimeout(()=>setSyncStatus(null),3000);
    setTimeout(()=>loadFromSheets(),2500);
  };

  const applyRecurring = async (items) => {
    for (const item of items) {
      const record = {
        id: genId(), type:"expense", date: today(),
        concept: item.concept, category: item.category,
        amount: item.amount, paymentMethod: item.paymentMethod,
        notes: "Gasto fijo mensual", owner: "Personal (Iván)",
        createdAt: Date.now()
      };
      setRecords(prev=>[...prev, record]);
      await sheetsRequest(config.webhookUrl,{action:"save",type:"expense",row:record});
      await new Promise(r=>setTimeout(r,300)); // pequeña pausa entre cada uno
    }
    setTimeout(()=>loadFromSheets(),2000);
  };

  return (
    <div style={{fontFamily:"'Inter',system-ui,sans-serif",background:COLORS.bg,minHeight:"100vh",maxWidth:appMaxWidth,margin:"0 auto",paddingBottom:80}}>

      <div style={{background:COLORS.nav,padding:"18px 20px 14px",position:"sticky",top:0,zIndex:30,boxShadow:"0 2px 8px rgba(0,0,0,0.15)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{color:"#fff",fontWeight:800,fontSize:17,letterSpacing:"-0.02em"}}>🦷 Clínica Dental</div>
            <div style={{color:"rgba(255,255,255,0.55)",fontSize:12,marginTop:1}}>{monthName(selectedMonth)}</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {loading&&<div style={{fontSize:11,color:"#FCD34D"}}>⏳</div>}
            {syncStatus==="syncing"&&<div style={{fontSize:11,color:"#FCD34D"}}>⏳ Sync</div>}
            {syncStatus==="ok"&&<div style={{fontSize:11,color:COLORS.green}}>✓ Sheets</div>}
            <button onClick={loadFromSheets} style={{background:"rgba(255,255,255,0.12)",border:"none",color:"#fff",borderRadius:8,padding:"5px 8px",cursor:"pointer",fontSize:13}}>↻</button>
            <select value={selectedMonth} onChange={e=>setSelectedMonth(e.target.value)}
              style={{background:"rgba(255,255,255,0.12)",border:"none",color:"#fff",borderRadius:8,padding:"6px 10px",fontSize:12,cursor:"pointer",outline:"none"}}>
              {availableMonths.map(m=>(<option key={m} value={m} style={{color:COLORS.text,background:"#fff"}}>{monthName(m)}</option>))}
            </select>
          </div>
        </div>
      </div>

      {!config?.webhookUrl&&(
        <div style={{background:"#FFF8ED",border:`1px solid ${COLORS.amber}`,margin:16,borderRadius:12,padding:"12px 14px",display:"flex",gap:10,alignItems:"center"}}>
          <span style={{fontSize:20}}>⚠️</span>
          <div>
            <div style={{fontWeight:600,fontSize:13,color:COLORS.amber}}>Sin conexión a Google Sheets</div>
            <div style={{fontSize:12,color:COLORS.textSoft}}>Ve a ⚙️ Config y pega tu URL del webhook.</div>
          </div>
        </div>
      )}

      {tab==="dashboard"&&(
        <div style={{padding:"16px 16px 0"}}>

          {/* ── CAPTURA RÁPIDA ── lo más importante, primero */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
            <button onClick={()=>setSheetIncome(true)}
              style={{padding:"18px 10px",borderRadius:16,border:"none",background:COLORS.green,
                color:"#fff",fontSize:15,fontWeight:700,cursor:"pointer",
                boxShadow:"0 4px 20px rgba(0,179,126,0.35)",display:"flex",flexDirection:"column",
                alignItems:"center",gap:6,touchAction:"manipulation"}}>
              <span style={{fontSize:28}}>＋</span>
              <span>Ingreso</span>
              <span style={{fontSize:11,fontWeight:400,opacity:0.85}}>Paciente / tratamiento</span>
            </button>
            <button onClick={()=>setSheetExpense(true)}
              style={{padding:"18px 10px",borderRadius:16,border:"none",background:COLORS.red,
                color:"#fff",fontSize:15,fontWeight:700,cursor:"pointer",
                boxShadow:"0 4px 20px rgba(229,83,75,0.35)",display:"flex",flexDirection:"column",
                alignItems:"center",gap:6,touchAction:"manipulation"}}>
              <span style={{fontSize:28}}>－</span>
              <span>Gasto</span>
              <span style={{fontSize:11,fontWeight:400,opacity:0.85}}>Consultorio / personal</span>
            </button>
          </div>

          {/* ── HOY resumen ── */}
          <div style={{background:COLORS.nav+"0D",borderRadius:12,padding:"10px 14px",marginBottom:16,display:"flex",gap:16}}>
            <div style={{flex:1,textAlign:"center"}}>
              <div style={{fontSize:11,color:COLORS.gray,fontWeight:600}}>HOY INGRESOS</div>
              <div style={{fontWeight:700,color:COLORS.green,fontSize:16}}>{formatMXN(todayIncome)}</div>
            </div>
            <div style={{width:1,background:COLORS.grayLight}}/>
            <div style={{flex:1,textAlign:"center"}}>
              <div style={{fontSize:11,color:COLORS.gray,fontWeight:600}}>HOY GASTOS</div>
              <div style={{fontWeight:700,color:COLORS.red,fontSize:16}}>{formatMXN(todayExpenses)}</div>
            </div>
          </div>

          {/* Depósito de terminal esperado hoy */}
          {cardChargesIncoming.length > 0 && (
            <div style={{background:"#F0F9FF",border:`1px solid ${COLORS.blue}30`,borderRadius:12,
              padding:"12px 14px",marginBottom:16}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <div style={{fontWeight:700,fontSize:13,color:COLORS.blue}}>💳 Depósito de terminal esperado hoy</div>
                <div style={{fontSize:11,color:COLORS.gray}}>{cardChargesIncoming.length} cobro{cardChargesIncoming.length>1?"s":""}</div>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:3}}>
                <span style={{color:COLORS.textSoft}}>Monto cobrado (bruto)</span>
                <span style={{fontWeight:600,color:COLORS.text}}>{formatMXN(expectedDepositGross)}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:6}}>
                <span style={{color:COLORS.textSoft}}>Comisión (0.65%+IVA)</span>
                <span style={{fontWeight:600,color:COLORS.red}}>−{formatMXN(expectedDepositCommission)}</span>
              </div>
              <div style={{borderTop:`1px solid ${COLORS.blue}20`,paddingTop:6,display:"flex",justifyContent:"space-between"}}>
                <span style={{fontSize:13,fontWeight:700,color:COLORS.blue}}>Neto a recibir hoy</span>
                <span style={{fontSize:16,fontWeight:700,color:COLORS.blue}}>{formatMXN(expectedDepositNet)}</span>
              </div>
              <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:4}}>
                {cardChargesIncoming.map(r=>(
                  <div key={r.id} style={{fontSize:11,color:COLORS.gray,display:"flex",justifyContent:"space-between"}}>
                    <span>{r.patient} · {getDayLabel(r.date)} {r.date.slice(8,10)} ({r.paymentMethod})</span>
                    <span>{formatMXN(r.paid)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{fontSize:11,fontWeight:700,color:COLORS.gray,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Consultorio</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:10,marginBottom:14}}>
            <KpiCard label="Ingresos" value={formatMXN(clinicIncome)} color={COLORS.green} ring={clinicIncome} ringMax={Math.max(clinicIncome,clinicExpenses,1)} sub={`${patients} pacientes`}/>
            <KpiCard label="Gastos" value={formatMXN(clinicExpenses)} color={COLORS.red} ring={clinicExpenses} ringMax={Math.max(clinicIncome,clinicExpenses,1)}/>
            <KpiCard label="Ganancia neta" value={formatMXN(netProfit)} color={netProfit>=0?COLORS.green:COLORS.red} icon={netProfit>=0?"📈":"📉"}/>
            <KpiCard label="Por cobrar" value={formatMXN(totalPending)} color={COLORS.amber} icon="⏳" sub={pendingPatients.length>0?`${pendingPatients.length} pacientes`:undefined}/>
          </div>

          {(personalIncome>0||personalExpenses>0)&&(
            <>
              <div style={{fontSize:11,fontWeight:700,color:COLORS.purple,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Personal (Iván)</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:10,marginBottom:14}}>
                <KpiCard label="Ingresos" value={formatMXN(personalIncome)} color={COLORS.purple} ring={personalIncome} ringMax={Math.max(personalIncome,personalExpenses,1)}/>
                <KpiCard label="Gastos" value={formatMXN(personalExpenses)} color={COLORS.red} ring={personalExpenses} ringMax={Math.max(personalIncome,personalExpenses,1)}/>
                <KpiCard label="Balance" value={formatMXN(personalIncome-personalExpenses)} color={(personalIncome-personalExpenses)>=0?COLORS.purple:COLORS.red} icon="👤"/>
              </div>
            </>
          )}

          <div style={{background:COLORS.card,borderRadius:14,padding:"14px 16px",marginBottom:14,boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={{fontWeight:700,fontSize:13,color:COLORS.text}}>Ingresos por método de pago</div>
              {totalCommissions>0&&<div style={{fontSize:11,color:COLORS.blue,fontWeight:600,background:"#EFF6FF",borderRadius:6,padding:"3px 8px"}}>Comisiones: {formatMXN(totalCommissions)}</div>}
            </div>
            {PAYMENT_METHODS.map(m=>{
              const v=byPayment[m],pct=totalIncome>0?(v/totalIncome)*100:0;
              const rate=COMMISSION_RATE[m]||0,comm=v*rate;
              if(v===0) return null;
              return(
                <div key={m} style={{marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:4}}>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <span style={{color:COLORS.textSoft}}>{m}</span>
                      {rate>0&&<span style={{fontSize:10,color:COLORS.blue,background:"#EFF6FF",borderRadius:4,padding:"1px 5px",fontWeight:600}}>-0.754%</span>}
                    </div>
                    <div style={{textAlign:"right"}}>
                      <span style={{fontWeight:600,color:COLORS.text}}>{formatMXN(v)}</span>
                      {comm>0&&<div style={{fontSize:10,color:COLORS.blue}}>−{formatMXN(comm)}</div>}
                    </div>
                  </div>
                  <div style={{background:COLORS.grayLight,borderRadius:4,height:5}}>
                    <div style={{background:rate>0?COLORS.blue:COLORS.green,borderRadius:4,height:5,width:`${pct}%`,transition:"width 0.5s ease"}}/>
                  </div>
                </div>
              );
            })}
            {totalIncome===0&&<div style={{color:COLORS.gray,fontSize:13,textAlign:"center",padding:8}}>Sin ingresos este mes</div>}
          </div>

          {pendingPatients.length>0&&(
            <div style={{background:"linear-gradient(135deg,#FFFBEB,#FEF3C7)",border:`2px solid ${COLORS.amber}40`,
              borderRadius:16,padding:"14px 16px",marginBottom:16,
              boxShadow:"0 2px 12px rgba(245,166,35,0.15)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontWeight:800,fontSize:14,color:"#92400E"}}>
                  💰 Por cobrar
                </div>
                <div style={{background:COLORS.amber,color:"#fff",borderRadius:20,padding:"3px 10px",
                  fontSize:12,fontWeight:700}}>
                  {pendingPatients.length} paciente{pendingPatients.length!==1?"s":""}
                </div>
              </div>
              {pendingPatients.slice(0,6).map(r=>(
                <div key={r.id} onClick={()=>setSettleRecord(r)}
                  style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                    padding:"10px 12px",marginBottom:6,borderRadius:10,
                    background:"rgba(255,255,255,0.7)",cursor:"pointer",
                    border:`1px solid ${COLORS.amber}20`,
                    touchAction:"manipulation"}}>
                  <div>
                    <div style={{color:COLORS.text,fontWeight:700,fontSize:14}}>{r.patient}</div>
                    <div style={{fontSize:11,color:COLORS.gray,marginTop:1}}>{r.treatment}</div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                    <span style={{fontWeight:800,color:"#92400E",fontSize:15}}>{formatMXN(r.pending)}</span>
                    <span style={{fontSize:12,background:COLORS.green,color:"#fff",borderRadius:8,
                      padding:"6px 12px",fontWeight:700,whiteSpace:"nowrap"}}>Cobrar →</span>
                  </div>
                </div>
              ))}
              {pendingPatients.length>6&&(
                <div style={{textAlign:"center",fontSize:12,color:COLORS.gray,marginTop:4}}>
                  +{pendingPatients.length-6} más en historial
                </div>
              )}
            </div>
          )}

          <div style={{marginBottom:8}}>
            <div style={{fontWeight:700,fontSize:13,color:COLORS.text,marginBottom:10}}>Últimos registros</div>
            {recentAll.length===0
              ? <div style={{textAlign:"center",color:COLORS.gray,padding:32,background:COLORS.card,borderRadius:14,fontSize:14}}>
                  Aún no hay registros este mes.<br/><span style={{fontSize:12}}>Usa los botones de abajo para comenzar.</span>
                </div>
              : <div style={{display:"flex",flexDirection:"column",gap:8}}>{recentAll.map(r=><RecordRow key={r.id} r={r} onDelete={deleteRecord} onEdit={setEditRecord}/>)}</div>
            }
          </div>
        </div>
      )}

      {tab==="history"&&(
        <div style={{padding:"16px"}}>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {[...monthRecords].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).map(r=>(
              <RecordRow key={r.id} r={r} onDelete={deleteRecord} onEdit={setEditRecord}/>
            ))}
            {monthRecords.length===0&&<div style={{textAlign:"center",color:COLORS.gray,padding:40}}>Sin registros este mes</div>}
          </div>
        </div>
      )}

      {tab==="kpis"&&<KpisTab records={records} selectedMonth={selectedMonth}/>}

      <nav style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:appMaxWidth,background:COLORS.card,borderTop:`1px solid ${COLORS.grayLight}`,display:"flex",zIndex:35,boxShadow:"0 -2px 12px rgba(0,0,0,0.08)",paddingBottom:"env(safe-area-inset-bottom)"}}>
        {[
          {id:"dashboard",icon:"📊",label:"Inicio"},
          {id:"history",icon:"📋",label:"Historial"},
          {id:"kpis",icon:"📈",label:"KPIs"},
          {id:"recurring",icon:"🔁",label:"Fijos"},
          {id:"patients",icon:"👤",label:"Pacientes"},
          {id:"settings",icon:"⚙️",label:"Config"},
        ].map(t=>(
          <button key={t.id} onClick={()=>{
            if(t.id==="patients"){setSheetPatients(true);return;}
            if(t.id==="settings"){setSheetSettings(true);return;}
            if(t.id==="recurring"){setSheetRecurring(true);return;}
            setTab(t.id);
          }}
            style={{flex:1,padding:"10px 0 8px",border:"none",background:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
            <span style={{fontSize:18}}>{t.icon}</span>
            <span style={{fontSize:9,fontWeight:600,color:tab===t.id?COLORS.nav:COLORS.gray}}>{t.label}</span>
            {tab===t.id&&<div style={{width:16,height:2,borderRadius:1,background:COLORS.nav}}/>}
          </button>
        ))}
      </nav>

      <Sheet open={sheetIncome} onClose={()=>setSheetIncome(false)} title="Nuevo ingreso">
        {sheetIncome && <IncomeForm key={Date.now()} onSave={saveRecord} onClose={()=>setSheetIncome(false)} patientNames={patientNames} lastTreatmentByPatient={lastTreatmentByPatient} allRecords={records}/>}
      </Sheet>
      <Sheet open={sheetExpense} onClose={()=>setSheetExpense(false)} title="Nuevo gasto">
        {sheetExpense && <ExpenseForm key={Date.now()} onSave={saveRecord} onClose={()=>setSheetExpense(false)}/>}
      </Sheet>
      <Sheet open={sheetPatients} onClose={()=>setSheetPatients(false)} title="Pacientes">
        <PatientHistory records={records}/>
      </Sheet>
      <Sheet open={sheetSettings} onClose={()=>setSheetSettings(false)} title="Configuración">
        <Settings config={config} onChange={handleConfigChange} onClearLocal={handleClearLocal}/>
      </Sheet>
      <Sheet open={sheetRecurring} onClose={()=>setSheetRecurring(false)} title="Gastos fijos recurrentes">
        <RecurringExpenses onApply={applyRecurring}/>
      </Sheet>
      <Sheet open={!!settleRecord} onClose={()=>setSettleRecord(null)} title="Registrar pago">
        {settleRecord && <SettleForm record={settleRecord} onSettle={settlePayment} onClose={()=>setSettleRecord(null)}/>}
      </Sheet>
      <Sheet open={!!editRecord} onClose={()=>setEditRecord(null)} title="Editar registro">
        {editRecord && <EditForm key={editRecord.id} record={editRecord} onSave={updateRecord} onClose={()=>setEditRecord(null)}/>}
      </Sheet>
    </div>
  );
}

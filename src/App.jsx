import React, { useMemo, useState, useEffect } from 'react'
import * as XLSX from 'xlsx'

// --- ID helper + safety shim ---------------------------------
const uid = () =>
  (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `id_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`

// If any old code still calls crypto.uid(), make it point to uid()
try {
  if (typeof crypto !== 'undefined' && typeof crypto.uid !== 'function') {
    // @ts-ignore
    crypto.uid = uid
  }
} catch (_) { /* ignore if crypto object is non-extensible */ }

// ===============================================================

/*************************
 * Minimal Annual Leave Web App (MVP+)
 * - Excel/CSV import with column mapping
 * - Approval workflow: Pending → Approved / Declined (with approver + timestamp)
 * - Gantt calendar, grouped by Campus
 * - Per-campus concurrency limits (no-overlap guard applies to Approved items)
 * - Filter by Campus, Status, Role
 * - Local storage persistence + JSON import/export
 *************************/

/***** Date helpers *****/
const toDate = (v) => (v instanceof Date ? v : new Date(v))
const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x }
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x }
const fmtYMD = (d) => {
  const x = toDate(d)
  const y = x.getFullYear();
  const m = String(x.getMonth()+1).padStart(2,'0');
  const day = String(x.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`
}
const rangeDays = (start, end) => {
  const out=[]; let d=startOfDay(start)
  const last=startOfDay(end)
  while (d.getTime() <= last.getTime()) { out.push(new Date(d)); d = addDays(d,1) }
  return out
}
const overlaps = (aStart, aEnd, bStart, bEnd) => {
  const s1 = startOfDay(aStart).getTime()
  const e1 = startOfDay(aEnd).getTime()
  const s2 = startOfDay(bStart).getTime()
  const e2 = startOfDay(bEnd).getTime()
  return s1 <= e2 && s2 <= e1
}
const clamp = (n, min, max) => Math.max(min, Math.min(n, max))

/***** Data model *****/
const DEFAULT_CAMPUSES = ["Melbourne","Sydney","Brisbane","Adelaide","Perth"]
const STATUSES = ["Pending","Approved","Declined"]

const seed = () => {
  const today = startOfDay(new Date())
  const nextWeek = addDays(today, 7)
  return {
    campuses: DEFAULT_CAMPUSES,
    campusLimits: Object.fromEntries(DEFAULT_CAMPUSES.map(c => [c, 1])),
    leaves: [
      { id: uid(), name: 'Alex', campus: 'Melbourne', role:'Advisor', start: fmtYMD(nextWeek), end: fmtYMD(addDays(nextWeek,4)), status:'Pending' },
      { id: uid(), name: 'Priya', campus: 'Sydney', role:'Reception', start: fmtYMD(addDays(nextWeek,2)), end: fmtYMD(addDays(nextWeek,6)), status:'Approved', approver:'System', decidedAt: new Date().toISOString() },
    ],
  }
}

/***** Storage *****/
const LS_KEY = 'leavePlannerStateV2'
const loadState = () => {
  try {
    const s = localStorage.getItem(LS_KEY)
    if (!s) return seed()
    return JSON.parse(s)
  } catch { return seed() }
}
const saveState = (state) => localStorage.setItem(LS_KEY, JSON.stringify(state))

/***** UI atoms *****/
const Badge = ({children, className=''}) => (
  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${className}`}>{children}</span>
)
const statusClasses = (st) => st==='Approved' ? 'bg-green-50 text-green-700 border-green-200' : st==='Declined' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-amber-50 text-amber-700 border-amber-200'
const TextInput = (props) => (<input {...props} className={`w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${props.className||''}`} />)
const Select = ({options=[], ...props}) => (
  <select {...props} className={`w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${props.className||''}`}>
    {options.map(opt => typeof opt === 'string' ? <option key={opt} value={opt}>{opt}</option> : <option key={opt.value} value={opt.value}>{opt.label}</option>)}
  </select>
)
const Button = ({children, variant='primary', ...props}) => {
  const base = 'rounded-xl px-3 py-2 text-sm font-medium';
  const styles = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700',
    ghost: 'bg-transparent text-gray-700 hover:bg-gray-100',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    subtle: 'bg-slate-100 text-slate-700 hover:bg-slate-200',
  }[variant]
  return <button {...props} className={`${base} ${styles} ${props.className||''}`}>{children}</button>
}
const Section = ({title, children, right}) => (
  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 md:p-6">
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {right}
    </div>
    {children}
  </div>
)

/***** App *****/
function usePersistentState() { const [state, setState] = useState(loadState()); useEffect(()=>saveState(state),[state]); return [state, setState] }

function App(){
  const [state, setState] = usePersistentState()
  const {campuses, campusLimits, leaves} = state

  // Filters and view window
  const [filterCampus, setFilterCampus] = useState('All')
  const [filterStatus, setFilterStatus] = useState('All')
  const [filterRole, setFilterRole] = useState('All')

  // Timeline window (start/end)
  const today = startOfDay(new Date())
  const [winStart, setWinStart] = useState(fmtYMD(addDays(today, -7)))
  const [winEnd, setWinEnd] = useState(fmtYMD(addDays(today, 60)))

  const filteredLeaves = useMemo(()=> leaves.filter(l =>
    (filterCampus==='All' || l.campus===filterCampus) &&
    (filterStatus==='All' || l.status===filterStatus) &&
    (filterRole==='All' || (l.role||'')===filterRole)
  ), [leaves, filterCampus, filterStatus, filterRole])

  const roles = useMemo(()=> Array.from(new Set(leaves.map(l => l.role).filter(Boolean))), [leaves])

  // Conflict detection (Approved only)
  const conflictMap = useMemo(()=>{
    const map = {}
    for (const c of campuses) map[c] = {}
    for (const l of leaves.filter(x => x.status==='Approved')) {
      const days = rangeDays(toDate(l.start), toDate(l.end))
      for (const d of days) {
        const key = fmtYMD(d)
        map[l.campus][key] = (map[l.campus][key]||0)+1
      }
    }
    return map
  }, [leaves, campuses])

  const [form, setForm] = useState({ name:'', campus: campuses[0]||'', role:'', start:'', end:'', status:'Pending' })

  const validateNoOverlap = (candidate, ignoreId=null) => {
    const s = toDate(candidate.start); const e = toDate(candidate.end)
    if (s > e) return { ok:false, reason: 'Start date must be before end date.' }
    const limit = campusLimits[candidate.campus] || 1
    const conflictingApproved = leaves.filter(l => l.campus===candidate.campus && (ignoreId? l.id!==ignoreId : true) && l.status==='Approved' && overlaps(l.start, l.end, s, e))
    if (conflictingApproved.length >= limit) {
      return { ok:false, reason:`Limit of ${limit} concurrent leave reached at ${candidate.campus} for the selected dates.` }
    }
    const pendingClash = leaves.some(l => l.campus===candidate.campus && (ignoreId? l.id!==ignoreId : true) && l.status==='Pending' && overlaps(l.start, l.end, s, e))
    return { ok:true, warn: pendingClash ? 'Warning: pending requests overlap in this window.' : '' }
  }

  const addLeave = (e) => {
    e.preventDefault()
    const cand = {...form}
    if (!cand.name || !cand.campus || !cand.start || !cand.end) { alert('Please complete all required fields.'); return }
    const check = validateNoOverlap(cand)
    if (!check.ok) { alert(check.reason); return }
    if (check.warn) { if (!confirm(check.warn + ' Continue?')) return }
    setState(s => ({...s, leaves:[...s.leaves, { id: uid(), ...cand }]}))
    setForm({ name:'', campus: campuses[0]||'', role:'', start:'', end:'', status:'Pending' })
  }

  const updateLeave = (id, patch) => setState(s => ({...s, leaves: s.leaves.map(x => x.id===id ? {...x, ...patch} : x)}))
  const deleteLeave = (id) => { if (confirm('Delete this leave?')) setState(s => ({...s, leaves: s.leaves.filter(x => x.id!==id)})) }

  // Approval actions
  const approve = (l, approver='Manager') => {
    const check = validateNoOverlap({...l, status:'Approved'}, l.id)
    if (!check.ok) { alert(check.reason); return }
    updateLeave(l.id, { status:'Approved', approver, decidedAt: new Date().toISOString() })
  }
  const decline = (l, approver='Manager') => updateLeave(l.id, { status:'Declined', approver, decidedAt: new Date().toISOString() })
  const resetPending = (l) => updateLeave(l.id, { status:'Pending', approver: undefined, decidedAt: undefined })

  // Import/Export JSON
  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], {type:'application/json'})
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'leave-planner.json'; a.click(); URL.revokeObjectURL(url)
  }
  const importJSON = (file) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result)
        if (!data || !Array.isArray(data.leaves)) throw new Error('Invalid file')
        setState(data)
      } catch (e) { alert('Could not import file: ' + e.message) }
    }
    reader.readAsText(file)
  }

  // Excel/CSV import with mapping
  const [mapping, setMapping] = useState({ name:'', role:'', campus:'', start:'', end:'', status:'' })
  const [sheetPreview, setSheetPreview] = useState({ headers:[], rows:[] })
  const [pendingTable, setPendingTable] = useState(null)

  const onExcel = async (file) => {
    const data = await file.arrayBuffer()
    const wb = XLSX.read(data)
    const ws = wb.Sheets[wb.SheetNames[0]]
    const json = XLSX.utils.sheet_to_json(ws, { header:1, raw:true, defval:'' })
    const [header, ...rows] = json
    setSheetPreview({ headers: header||[], rows: rows.slice(0,20) })
    const lower = (s) => String(s).toLowerCase()
    const guess = (needle) => (header||[]).find(h => lower(h).includes(needle)) || ''
    setMapping({
      name: guess('name') || guess('staff') || guess('employee'),
      role: guess('role') || guess('position') || '',
      campus: guess('campus') || guess('location') || '',
      start: guess('start') || guess('from') || guess('leave start') || guess('begin'),
      end: guess('end') || guess('to') || guess('leave end') || guess('finish'),
      status: guess('status') || '',
    })
    setPendingTable({ header, rows })
  }

  const confirmExcelImport = () => {
    if (!pendingTable) return
    const colIndex = (name) => (pendingTable.header||[]).findIndex(h => h===name)
    const idx = Object.fromEntries(Object.entries(mapping).map(([k,v]) => [k, colIndex(v)]))
    const required = ['name','campus','start','end']
    for (const r of required) { if (idx[r]===-1) { alert(`Please map a column for ${r}.`); return } }

    const rows = pendingTable.rows
    const imported = []
    for (const r of rows) {
      const name = r[idx.name]; if (!name) continue
      const campus = r[idx.campus] || campuses[0] || 'Campus'
      const role = idx.role!==-1 ? r[idx.role] : ''
      const status = normalizeStatus(idx.status!==-1 ? r[idx.status] : 'Pending')
      const {start, end} = normalizeDates(r[idx.start], r[idx.end])
      if (!start || !end) continue
      imported.push({ id: uid(), name:String(name).trim(), campus:String(campus).trim(), role:String(role||'').trim(), start, end, status })
    }
    if (imported.length===0) { alert('No valid rows found.'); return }
    setState(s => ({...s, leaves:[...s.leaves, ...imported]}))
    setPendingTable(null); setSheetPreview({headers:[], rows:[]})
    alert(`Imported ${imported.length} rows.`)
  }

  const normalizeStatus = (v) => {
    const t = String(v||'').toLowerCase()
    if (t.startsWith('appr')) return 'Approved'
    if (t.startsWith('decl') || t.startsWith('rej')) return 'Declined'
    return 'Pending'
  }
  const normalizeDates = (s, e) => {
    const asDate = (x) => {
      if (x instanceof Date) return x
      if (typeof x === 'number' && XLSX && XLSX.SSF && XLSX.SSF.parse_date_code) {
        const dt = XLSX.SSF.parse_date_code(x); if (!dt) return null; return new Date(Date.UTC(dt.y, dt.m-1, dt.d))
      }
      const d = new Date(x)
      return isNaN(d.getTime()) ? null : d
    }
    const ds = asDate(s), de = asDate(e)
    return { start: ds? fmtYMD(ds):'', end: de? fmtYMD(de):'' }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white text-slate-900">
      <div className="max-w-7xl mx-auto p-4 md:p-8">
        <header className="mb-6">
          <h1 className="text-2xl md:text-3xl font-bold">Annual Leave Planner</h1>
          <p className="text-sm text-slate-600 mt-1">Excel-importable leave manager with approvals and a Gantt calendar grouped by campus.</p>
        </header>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* LEFT: Add & Settings */}
          <div className="space-y-6">
            <Section title="Add Leave">
              <form onSubmit={addLeave} className="grid grid-cols-1 gap-3">
                <div>
                  <label className="text-sm font-medium">Staff Name</label>
                  <TextInput placeholder="e.g., Jamie Chen" value={form.name} onChange={e=>setForm(f=>({...f, name:e.target.value}))} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium">Campus</label>
                    <Select value={form.campus} onChange={e=>setForm(f=>({...f, campus:e.target.value}))} options={campuses} />
                  </div>
                  <div className="flex items-end">
                    <Button type="button" variant="ghost" onClick={()=>{
                      const name = prompt('New campus name:')?.trim(); if (!name) return; if (campuses.includes(name)) return alert('Campus exists');
                      setState(s => ({...s, campuses:[...s.campuses, name], campusLimits:{...s.campusLimits, [name]:1}}))
                    }}>+ Add campus</Button>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium">Role (optional)</label>
                  <TextInput placeholder="e.g., Advisor" value={form.role} onChange={e=>setForm(f=>({...f, role:e.target.value}))} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium">Start</label>
                    <TextInput type="date" value={form.start} onChange={e=>setForm(f=>({...f, start:e.target.value}))} />
                  </div>
                  <div>
                    <label className="text-sm font-medium">End</label>
                    <TextInput type="date" value={form.end} onChange={e=>setForm(f=>({...f, end:e.target.value}))} />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium">Status</label>
                  <Select value={form.status} onChange={e=>setForm(f=>({...f, status:e.target.value}))} options={STATUSES} />
                </div>
                <div className="flex items-center gap-2">
                  <Button type="submit">Add</Button>
                  <Button type="button" variant="subtle" onClick={()=>setForm({ name:'', campus: campuses[0]||'', role:'', start:'', end:'', status:'Pending' })}>Reset</Button>
                </div>
              </form>
            </Section>

            <Section title="Campus Limits">
              <div className="space-y-2">
                {campuses.map(c => (
                  <div key={c} className="flex items-center gap-3">
                    <div className="w-32 font-medium">{c}</div>
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-slate-600">Max concurrent Approved</label>
                      <TextInput type="number" min={1} max={50} value={campusLimits[c]||1} onChange={e=>{
                        const n = clamp(parseInt(e.target.value||'1',10) || 1, 1, 50)
                        setState(s => ({...s, campusLimits:{...s.campusLimits, [c]:n}}))
                      }} className="w-24" />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 text-xs text-slate-500">Set to <b>1</b> to prevent any overlap at a campus. Pending requests won’t block approval but will show a warning.</div>
            </Section>

            <Section title="Import / Export" right={<Button variant="ghost" onClick={exportJSON}>Export JSON</Button>}>
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-medium mb-1">Import Excel/CSV</div>
                  <input type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(e)=> e.target.files?.[0] && onExcel(e.target.files[0])} />
                </div>
                {sheetPreview.headers.length>0 && (
                  <div className="border rounded-xl p-3">
                    <div className="text-sm font-semibold mb-2">Map columns</div>
                    <div className="grid grid-cols-2 gap-3">
                      {Object.entries(mapping).map(([k,v])=> (
                        <div key={k}>
                          <div className="text-xs text-slate-600 mb-1">{k.toUpperCase()}</div>
                          <Select value={v} onChange={e=>setMapping(m=>({...m, [k]: e.target.value}))} options={sheetPreview.headers.map(h=>({label:h, value:h}))} />
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <Button onClick={confirmExcelImport}>Import</Button>
                      <Button variant="ghost" onClick={()=>{ setPendingTable(null); setSheetPreview({headers:[], rows:[]}) }}>Cancel</Button>
                    </div>
                    <div className="mt-3 text-xs text-slate-500">Preview shows first 20 rows for mapping.</div>
                  </div>
                )}
                <div className="text-xs text-slate-500">You can also import/export JSON to sync data across browsers.</div>
                <div>
                  <div className="text-sm font-medium mb-1">Import JSON</div>
                  <input type="file" accept="application/json" onChange={(e)=> e.target.files?.[0] && importJSON(e.target.files[0])} />
                </div>
              </div>
            </Section>
          </div>

          {/* RIGHT: Filters, Gantt, Table */}
          <div className="xl:col-span-2 space-y-6">
            <Section title="Filters & Window" right={
              <div className="flex flex-wrap items-center gap-2">
                <Select value={filterCampus} onChange={e=>setFilterCampus(e.target.value)} options={["All", ...campuses]} />
                <Select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} options={["All", ...STATUSES]} />
                <Select value={filterRole} onChange={e=>setFilterRole(e.target.value)} options={["All", ...roles]} />
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-600">From</label>
                  <TextInput type="date" value={winStart} onChange={e=>setWinStart(e.target.value)} className="w-36" />
                  <label className="text-xs text-slate-600">To</label>
                  <TextInput type="date" value={winEnd} onChange={e=>setWinEnd(e.target.value)} className="w-36" />
                </div>
              </div>
            }>
              <GanttByCampus
                campuses={campuses}
                leaves={filteredLeaves}
                windowStart={toDate(winStart)}
                windowEnd={toDate(winEnd)}
                campusLimits={campusLimits}
              />
            </Section>

            <Section title="All Leave">
              <LeaveTable 
                leaves={filteredLeaves}
                campuses={campuses}
                onDelete={deleteLeave}
                onApprove={approve}
                onDecline={decline}
                onReset={resetPending}
                onUpdate={updateLeave}
              />
            </Section>
          </div>
        </div>

        <footer className="mt-8 text-xs text-slate-500">
          Built with ❤️ — data is stored locally in your browser. Export JSON for backup. To deploy as a small web app, upload to Vercel (build: npm run build, output: dist).
        </footer>
      </div>
    </div>
  )
}

/***** Gantt View grouped by campus *****/
function GanttByCampus({campuses, leaves, windowStart, windowEnd, campusLimits}){
  const byCampus = useMemo(()=>{
    const map = {}; for (const c of campuses) map[c] = []
    for (const l of leaves) map[l.campus] = (map[l.campus]||[]).concat(l)
    return map
  }, [leaves, campuses])

  const dayMs = 24*3600*1000
  const totalDays = Math.max(1, Math.round((startOfDay(windowEnd) - startOfDay(windowStart))/dayMs) + 1)
  const colWidth = 28
  const laneHeight = 28

  const xForDate = (d) => clamp(Math.round((startOfDay(d) - startOfDay(windowStart))/dayMs) * colWidth, 0, totalDays*colWidth)
  const widthForSpan = (s,e) => Math.max(colWidth, (Math.round((startOfDay(e)-startOfDay(s))/dayMs)+1) * colWidth)

  return (
    <div className="overflow-auto">
      <div className="min-w-max">
        <div className="sticky top-0 bg-white z-10">
          <div className="flex">
            <div className="w-64"></div>
            {rangeDays(windowStart, windowEnd).map(d => (
              <div key={d.toISOString()} className="w-[28px] text-[10px] text-center text-slate-500 border-b">{d.getDate()}</div>
            ))}
          </div>
        </div>
        {campuses.map(campus => (
          <div key={campus} className="border rounded-xl overflow-hidden mb-4">
            <div className="bg-slate-50 flex items-center justify-between px-3 py-2 text-sm font-semibold">
              <div>{campus} <span className="text-xs font-normal text-slate-500">(limit {campusLimits[campus]||1})</span></div>
            </div>
            <div>
              <div className="flex">
                <div className="w-64 border-r bg-white"></div>
                {Array.from({length: totalDays}).map((_,i)=> (
                  <div key={i} className={`w-[28px] h-[10px] border-b ${i%7===0? 'bg-slate-50' : ''}`}></div>
                ))}
              </div>
              {(byCampus[campus]||[]).map((l, idx) => {
                const s = toDate(l.start), e = toDate(l.end)
                if (!overlaps(s, e, windowStart, windowEnd)) return null
                const left = xForDate(new Date(Math.max(s, windowStart)))
                const width = widthForSpan(new Date(Math.max(s, windowStart)), new Date(Math.min(e, windowEnd)))
                const top = (idx+1)*laneHeight
                const color = l.status==='Approved' ? 'bg-green-500/80' : l.status==='Declined' ? 'bg-rose-400/80' : 'bg-amber-400/80'
                return (
                  <div key={l.id} className="relative">
                    <div className="absolute left-0 top-0 w-64 h-[28px] flex items-center px-3 text-sm border-b bg-white">
                      <div className="truncate font-medium mr-2" title={`${l.name} · ${l.role||''}`}>{l.name}</div>
                      {l.role ? <Badge className="bg-slate-100 text-slate-700 border-slate-200">{l.role}</Badge> : null}
                    </div>
                    <div className="ml-64" style={{ height: laneHeight }}>
                      <div className={`absolute rounded-md h-5 ${color} text-[10px] text-white px-2 flex items-center`} style={{ left: 64 + left, top: 4 + top, width }} title={`${l.name} • ${fmtYMD(s)} → ${fmtYMD(e)} • ${l.status}`}>
                        {fmtYMD(s)} → {fmtYMD(e)}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/***** Table *****/
function LeaveTable({leaves, campuses, onDelete, onApprove, onDecline, onReset, onUpdate}){
  const [q, setQ] = useState('')
  const filtered = useMemo(()=> leaves.filter(l => {
    const t = q.toLowerCase()
    return !t || l.name.toLowerCase().includes(t) || (l.role||'').toLowerCase().includes(t) || l.campus.toLowerCase().includes(t)
  }), [leaves, q])

  return (
    <div className="overflow-auto">
      <div className="flex items-center justify-between mb-3">
        <TextInput placeholder="Search name, role, campus..." value={q} onChange={e=>setQ(e.target.value)} className="w-64" />
      </div>
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-slate-600">
            <th className="p-2 border-b">Name</th>
            <th className="p-2 border-b">Campus</th>
            <th className="p-2 border-b">Role</th>
            <th className="p-2 border-b">Start</th>
            <th className="p-2 border-b">End</th>
            <th className="p-2 border-b">Status</th>
            <th className="p-2 border-b w-64">Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length===0 && <tr><td colSpan={7} className="p-4 text-center text-slate-500">No records</td></tr>}
          {filtered.map(l => (
            <tr key={l.id} className="odd:bg-slate-50/50">
              <td className="p-2 border-b font-medium">{l.name}</td>
              <td className="p-2 border-b">
                <Select value={l.campus} onChange={e=>onUpdate(l.id, { campus:e.target.value })} options={campuses} />
              </td>
              <td className="p-2 border-b">
                <TextInput value={l.role||''} onChange={e=>onUpdate(l.id, { role:e.target.value })} />
              </td>
              <td className="p-2 border-b">
                <TextInput type="date" value={l.start} onChange={e=>onUpdate(l.id, { start:e.target.value })} />
              </td>
              <td className="p-2 border-b">
                <TextInput type="date" value={l.end} onChange={e=>onUpdate(l.id, { end:e.target.value })} />
              </td>
              <td className="p-2 border-b">
                <Badge className={statusClasses(l.status)}>{l.status}</Badge>
                {l.approver && (
                  <div className="text-[10px] text-slate-500">by {l.approver} on {new Date(l.decidedAt).toLocaleString()}</div>
                )}
              </td>
              <td className="p-2 border-b">
                <div className="flex flex-wrap gap-2">
                  {l.status!=='Approved' && <Button onClick={()=>onApprove(l)} title="Approve">Approve</Button>}
                  {l.status!=='Declined' && <Button variant="subtle" onClick={()=>onDecline(l)} title="Decline">Decline</Button>}
                  {l.status!=='Pending' && <Button variant="ghost" onClick={()=>onReset(l)} title="Reset">Reset</Button>}
                  <Button variant="danger" onClick={()=>onDelete(l.id)} title="Delete">Delete</Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default App

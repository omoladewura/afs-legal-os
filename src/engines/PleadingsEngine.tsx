/**
 * AFS Legal OS V2 — Pleadings Engine (Phase 7A → Phase 3A)
 *
 * Phase 3A — full court-router replacing the "Writ only" guard:
 *   TRACK 1: Writ of Summons
 *     Claimant: Originating Process · SoC · Witness Statement
 *               · SoD Monitor · Counterclaim Response · Default Flag
 *     Defendant: SoD Drafter · Counterclaim Builder · Prelim Objection · Reply Monitor
 *   TRACK 2: Originating Summons
 *     FOR:     Originating Summons + Affidavit in Support + Written Address
 *     AGAINST: Counter-Affidavit + Written Address in Opposition
 *   FALLTHROUGH: Named holding panel for 3B-3E processes
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { Case } from '@/types';
import { T } from '@/constants/tokens';
import { useAI } from '@/hooks/useAI';
import { useCaseContext } from '@/hooks/useCaseContext';
import { buildRoleSystemPrompt } from '@/utils/rolePrompt';
import { getPartyLabels } from '@/utils/getPartyLabels';
import { loadBlindSpot, saveBlindSpot } from '@/storage/helpers';
import { Md, ErrorBlock } from '@/components/common/ui';
import { COUNSEL_ROLE_COLORS } from '@/types';

interface Props { activeCase: Case; }
interface CounterclaimIntel { flag: boolean; summary?: string; }
type ClaimSubTab   = 'originating_process' | 'soc_drafter' | 'witness_statement' | 'sod_monitor' | 'counterclaim_response' | 'default_flag';
type DefSubTab     = 'sod_drafter' | 'counterclaim_builder' | 'preliminary_objection' | 'reply_monitor';
type OSClaimSubTab = 'os_drafter' | 'os_affidavit' | 'os_written_address';
type OSDefSubTab   = 'os_counter_affidavit' | 'os_written_address_opp';
type SubTab        = ClaimSubTab | DefSubTab | OSClaimSubTab | OSDefSubTab;

interface PleadingItem { id: string; type: string; side: 'ours'|'theirs'; filedDate: string; status: string; notes: string; }

interface SavedData {
  origProcessType?: string; origProcessContext?: string; origProcessDraft?: string;
  witnessName?: string; witnessRole?: string; witnessContext?: string; witnessStatDraft?: string;
  socContext?: string; socDraft?: string;
  sodReceivedDate?: string; sodFiled?: boolean;
  dtccContext?: string; dtccDraft?: string;
  sodContext?: string; sodDraft?: string;
  counterclaimContext?: string; counterclaimDraft?: string;
  objectionContext?: string; objectionDraft?: string;
  replyReceived?: boolean; replyDate?: string;
  osDraftContext?: string; osDraft?: string;
  osAffidavitContext?: string; osAffidavitDraft?: string;
  osAddressContext?: string; osAddressDraft?: string;
  osCounterContext?: string; osCounterDraft?: string;
  osOppAddressContext?: string; osOppAddressDraft?: string;
  pleadingItems?: PleadingItem[];
  serviceDate?: string; lastUpdated?: string;
}

const MODULE = 'pleadings_engine';
const DEFAULT_DATA: SavedData = {
  origProcessType:'', origProcessContext:'', origProcessDraft:'',
  witnessName:'', witnessRole:'', witnessContext:'', witnessStatDraft:'',
  socContext:'', socDraft:'', sodReceivedDate:'', sodFiled:false,
  dtccContext:'', dtccDraft:'', sodContext:'', sodDraft:'',
  counterclaimContext:'', counterclaimDraft:'', objectionContext:'', objectionDraft:'',
  replyReceived:false, replyDate:'',
  osDraftContext:'', osDraft:'', osAffidavitContext:'', osAffidavitDraft:'',
  osAddressContext:'', osAddressDraft:'', osCounterContext:'', osCounterDraft:'',
  osOppAddressContext:'', osOppAddressDraft:'',
  pleadingItems:[], serviceDate:'', lastUpdated:'',
};

function Btn({label,onClick,loading=false,accent='#4090d0',off=false}:{label:string;onClick:()=>void;loading?:boolean;accent?:string;off?:boolean}) {
  return <button onClick={onClick} disabled={loading||off} style={{background:loading||off?'#101018':`linear-gradient(135deg,#000000,${accent})`,color:loading||off?'#2a2a38':'#f0ece0',border:'none',borderRadius:6,padding:'11px 26px',fontSize:14,fontFamily:"'Times New Roman', Times, serif",cursor:loading||off?'not-allowed':'pointer',fontWeight:600,letterSpacing:'.04em'}}>{loading?'⟳ Working…':label}</button>;
}

function ResultBlock({title,content,onClear,accent='#4090d0'}:{title:string;content:string;onClear:()=>void;accent?:string}) {
  return (
    <div style={{marginTop:18,background:'#08080e',border:`1px solid ${accent}30`,borderRadius:8,padding:'18px 20px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <span style={{fontSize:10,color:accent,fontFamily:"'Times New Roman', Times, serif",letterSpacing:'.12em',textTransform:'uppercase',fontWeight:700}}>{title}</span>
        <div style={{display:'flex',gap:10}}>
          <button onClick={()=>navigator.clipboard?.writeText(content)} style={{background:'transparent',border:`1px solid ${accent}30`,color:accent,fontSize:11,cursor:'pointer',fontFamily:"'Times New Roman', Times, serif",borderRadius:4,padding:'3px 10px'}}>copy</button>
          <button onClick={onClear} style={{background:'transparent',border:'none',color:T.mute,fontSize:11,cursor:'pointer',fontFamily:"'Times New Roman', Times, serif"}}>clear ×</button>
        </div>
      </div>
      <Md text={content} />
    </div>
  );
}

function SubTabBar({tabs,active,onSelect,accent}:{tabs:{id:string;label:string}[];active:string;onSelect:(id:string)=>void;accent:string}) {
  return (
    <div style={{display:'flex',gap:4,marginBottom:24,flexWrap:'wrap'}}>
      {tabs.map(t=>(
        <button key={t.id} onClick={()=>onSelect(t.id)} style={{background:active===t.id?`${accent}18`:'transparent',border:`1px solid ${active===t.id?accent:'#cccccc'}`,color:active===t.id?accent:T.mute,borderRadius:5,padding:'6px 14px',fontSize:12,cursor:'pointer',fontFamily:"'Times New Roman', Times, serif",letterSpacing:'.04em',transition:'all .15s'}}>{t.label}</button>
      ))}
    </div>
  );
}

function Label({text}:{text:string}) {
  return <label style={{display:'block',fontSize:11,color:T.mute,fontFamily:"'Times New Roman', Times, serif",letterSpacing:'.08em',textTransform:'uppercase',marginBottom:6}}>{text}</label>;
}

function Textarea({value,onChange,rows=4,placeholder=''}:{value:string;onChange:(v:string)=>void;rows?:number;placeholder?:string}) {
  return <textarea value={value} onChange={e=>onChange(e.target.value)} rows={rows} placeholder={placeholder} style={{width:'100%',background:'#08080e',border:'1px solid #cccccc',borderRadius:6,padding:'10px 14px',color:T.fg,fontSize:13,fontFamily:"'Times New Roman', Times, serif",resize:'vertical',boxSizing:'border-box',outline:'none'}} />;
}

function Input({value,onChange,placeholder='',type='text'}:{value:string;onChange:(v:string)=>void;placeholder?:string;type?:string}) {
  return <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={{width:'100%',background:'#08080e',border:'1px solid #cccccc',borderRadius:6,padding:'8px 12px',color:T.fg,fontSize:13,fontFamily:"'Times New Roman', Times, serif",boxSizing:'border-box',outline:'none'}} />;
}

function SectionTitle({text,accent}:{text:string;accent:string}) {
  return <div style={{fontSize:11,color:accent,fontFamily:"'Times New Roman', Times, serif",letterSpacing:'.12em',textTransform:'uppercase',fontWeight:700,marginBottom:14,borderBottom:`1px solid ${accent}20`,paddingBottom:8}}>{text}</div>;
}

function StatusBadge({status}:{status:string}) {
  const map:Record<string,string>={Filed:'#40a878',Received:'#4090d0',Overdue:'#c05050',Pending:'#c09030',Settled:'#8060c0'};
  const col=map[status]??'#606070';
  return <span style={{fontSize:9,color:col,border:`1px solid ${col}40`,borderRadius:3,padding:'1px 6px',fontFamily:"'Times New Roman', Times, serif",letterSpacing:'.06em',textTransform:'uppercase',fontWeight:700}}>{status}</span>;
}

function daysSince(dateStr:string):number|null {
  if(!dateStr) return null;
  const d=new Date(dateStr);
  if(isNaN(d.getTime())) return null;
  return Math.floor((Date.now()-d.getTime())/(1000*60*60*24));
}

// ─── PLEADING TRACKER ────────────────────────────────────────────────────────
function PleadingTracker({items,onUpdate,accent}:{items:PleadingItem[];onUpdate:(items:PleadingItem[])=>void;accent:string}) {
  const [newType,setNewType]=useState('');
  const [newSide,setNewSide]=useState<'ours'|'theirs'>('ours');
  const [newDate,setNewDate]=useState('');
  const [newStatus,setNewStatus]=useState('Filed');
  const [newNotes,setNewNotes]=useState('');
  const add=()=>{
    if(!newType.trim()) return;
    onUpdate([...items,{id:`pl_${Date.now()}`,type:newType.trim(),side:newSide,filedDate:newDate,status:newStatus,notes:newNotes}]);
    setNewType('');setNewDate('');setNewNotes('');
  };
  const remove=(id:string)=>onUpdate(items.filter(i=>i.id!==id));
  const updateStatus=(id:string,status:string)=>onUpdate(items.map(i=>i.id===id?{...i,status}:i));
  return (
    <div>
      {items.length>0&&(
        <div style={{marginBottom:20}}>
          {items.map(item=>(
            <div key={item.id} style={{background:'#ffffff',border:'1px solid #cccccc',borderRadius:8,padding:'14px 16px',marginBottom:10,display:'flex',alignItems:'flex-start',gap:14}}>
              <div style={{flex:1}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,flexWrap:'wrap'}}>
                  <span style={{fontSize:13,color:T.text,fontFamily:"'Times New Roman', Times, serif",fontWeight:600}}>{item.type}</span>
                  <span style={{fontSize:10,color:item.side==='ours'?accent:'#888',fontFamily:"'Times New Roman', Times, serif",letterSpacing:'.04em'}}>{item.side==='ours'?'(our filing)':'(opposing)'}</span>
                  <StatusBadge status={item.status}/>
                  {item.filedDate&&<span style={{fontSize:10,color:T.mute,fontFamily:"'Times New Roman', Times, serif"}}>{item.filedDate}</span>}
                </div>
                {item.notes&&<p style={{fontSize:12,color:T.sub,fontFamily:"'Times New Roman', Times, serif",margin:0,lineHeight:1.5}}>{item.notes}</p>}
              </div>
              <div style={{display:'flex',gap:6,flexShrink:0}}>
                <select value={item.status} onChange={e=>updateStatus(item.id,e.target.value)} style={{background:'#08080e',border:'1px solid #cccccc',borderRadius:4,padding:'4px 8px',color:T.mute,fontSize:11,fontFamily:"'Times New Roman', Times, serif",cursor:'pointer'}}>
                  {['Filed','Received','Overdue','Pending','Settled'].map(s=><option key={s} value={s}>{s}</option>)}
                </select>
                <button onClick={()=>remove(item.id)} style={{background:'transparent',border:'1px solid #2a0808',color:'#804040',fontSize:11,borderRadius:4,padding:'4px 8px',cursor:'pointer',fontFamily:"'Times New Roman', Times, serif"}}>×</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{background:'#08080e',border:`1px solid ${accent}20`,borderRadius:8,padding:'16px 18px'}}>
        <SectionTitle text="Add Pleading Entry" accent={accent}/>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
          <div><Label text="Pleading Type"/><Input value={newType} onChange={setNewType} placeholder="e.g. Statement of Claim"/></div>
          <div><Label text="Date Filed / Received"/><Input type="date" value={newDate} onChange={setNewDate}/></div>
          <div>
            <Label text="Filed By"/>
            <select value={newSide} onChange={e=>setNewSide(e.target.value as 'ours'|'theirs')} style={{background:'#08080e',border:'1px solid #cccccc',borderRadius:6,padding:'8px 12px',color:T.fg,fontSize:13,fontFamily:"'Times New Roman', Times, serif",outline:'none',cursor:'pointer',width:'100%'}}>
              <option value="ours">Our Side</option><option value="theirs">Opposing Side</option>
            </select>
          </div>
          <div>
            <Label text="Status"/>
            <select value={newStatus} onChange={e=>setNewStatus(e.target.value)} style={{background:'#08080e',border:'1px solid #cccccc',borderRadius:6,padding:'8px 12px',color:T.fg,fontSize:13,fontFamily:"'Times New Roman', Times, serif",outline:'none',cursor:'pointer',width:'100%'}}>
              {['Filed','Received','Overdue','Pending','Settled'].map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div style={{marginBottom:12}}><Label text="Notes"/><Input value={newNotes} onChange={setNewNotes} placeholder="Optional notes"/></div>
        <Btn label="Add Entry" onClick={add} accent={accent} off={!newType.trim()}/>
      </div>
    </div>
  );
}
// ─── ORIGINATING PROCESS DRAFTER (Claimant / Writ track) ────────────────────
const PROCESS_TYPES=[
  {id:'writ_of_summons',label:'Writ of Summons',desc:'Standard originating process for most civil claims. Endorsement sets out cause of action and reliefs.'},
  {id:'originating_summons',label:'Originating Summons',desc:'For matters unlikely to be disputed on facts — questions of law, document construction, estates, mortgages.'},
  {id:'originating_motion',label:'Originating Motion',desc:'For applications authorised by statute — fundamental rights enforcement, elections, judicial review.'},
  {id:'petition',label:'Petition',desc:'Divorce/matrimonial proceedings, winding-up of companies, election petitions.'},
];

function OriginatingProcessDrafter({data,onSave,accent,ai,systemCtx}:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const [processType,setProcessType]=useState(data.origProcessType??'');
  const [context,setContext]=useState(data.origProcessContext??'');
  const [draft,setDraft]=useState(data.origProcessDraft??'');
  const {ask,loading,error}=ai;
  const selected=PROCESS_TYPES.find(p=>p.id===processType);
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const caseName=aCase?.caseName??'';
    const court=aCase?.court??'High Court';
    const {partyA,partyB}=getPartyLabels(aCase);
    const structureMap:Record<string,string>={
      writ_of_summons:`1. Header: In the [Court] holden at [City] — Suit No: [to be assigned]\n2. Parties: BETWEEN [${partyA.toUpperCase()} NAME] — ${partyA} AND [${partyB.toUpperCase()} NAME] — ${partyB}\n3. WRIT OF SUMMONS preamble ordering defendant to enter appearance\n4. ENDORSEMENT OF CLAIM: numbered paragraphs stating claim, cause of action, reliefs\n5. Endorsement of amount claimed (if monetary)\n6. Issued at [Registry] — Registrar signature block\n7. Solicitor's endorsement`,
      originating_summons:`1. Header — Suit No: [to be assigned]\n2. In the matter of: [subject/statute]\n3. Parties: [Applicant] — Applicant / [Respondent] — Respondent\n4. Let [Respondent] attend before the Court…\n5. QUESTIONS FOR DETERMINATION: numbered legal questions\n6. RELIEFS SOUGHT: numbered list\n7. GROUNDS: statutory/legal basis\n8. Affidavit in support reference\n9. Solicitor's endorsement`,
      originating_motion:`1. Header — Suit No: [to be assigned]\n2. Parties or ex parte\n3. NOTICE OF MOTION — statutory basis\n4. Application paragraph\n5. Orders/declarations sought: numbered\n6. Grounds: numbered\n7. Documents relied on\n8. Solicitor's endorsement`,
      petition:`1. Header — Petition No: [to be assigned]\n2. In the matter of: [subject]\n3. Petitioner and Respondent\n4. PETITION: jurisdication, background, grounds with particulars\n5. Prayers: numbered reliefs\n6. Verifying affidavit reference\n7. Solicitor's endorsement`,
    };
    const prompt=`You are acting as Nigerian civil litigation counsel for the ${partyA} side.\n\nMatter: ${caseName}\nCourt: ${court}\nOriginating Process: ${selected?.label??processType}\n\nCounsel instructions:\n${context}\n\nDraft a complete ${selected?.label??processType} in correct Nigerian form.\n\nSTRUCTURE:\n${structureMap[processType]??'Use the correct Nigerian form for the court specified.'}\n\nRequirements:\n- Use correct court heading\n- Suit number placeholder [to be assigned]\n- Formal Nigerian court language\n- Every relief specifically stated\n- Counsel endorsement block\n- Flag missing particulars with [COUNSEL TO SUPPLY: description]\n\nReturn the complete draft only.`;
    const result=await ask({system:systemCtx,userMsg:prompt,maxTokens:2500});
    if(result){setDraft(result);onSave({origProcessType:processType,origProcessContext:context,origProcessDraft:result});}
  },[processType,context,ask,onSave,selected]);

  return (
    <div>
      <SectionTitle text="Originating Process Drafter" accent={accent}/>
      <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",marginBottom:18,lineHeight:1.6}}>Select the correct originating process. The AI will draft the full process in Nigerian court form for the court on record.</p>
      <div style={{marginBottom:20}}>
        <Label text="Select Originating Process Type"/>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(240px, 1fr))',gap:10}}>
          {PROCESS_TYPES.map(p=>(
            <button key={p.id} onClick={()=>{setProcessType(p.id);onSave({origProcessType:p.id});}} style={{background:processType===p.id?`${accent}12`:'#ffffff',border:`1.5px solid ${processType===p.id?accent:'#cccccc'}`,borderRadius:7,padding:'14px 16px',cursor:'pointer',textAlign:'left',transition:'all .15s'}}>
              <div style={{fontSize:13,color:processType===p.id?accent:T.text,fontFamily:"'Times New Roman', Times, serif",fontWeight:600,marginBottom:5}}>{p.label}</div>
              <p style={{fontSize:11,color:T.mute,fontFamily:"'Times New Roman', Times, serif",lineHeight:1.5,margin:0}}>{p.desc}</p>
            </button>
          ))}
        </div>
      </div>
      {processType&&(
        <>
          <div style={{background:`${accent}08`,border:`1px solid ${accent}20`,borderRadius:7,padding:'12px 16px',marginBottom:18}}>
            <p style={{fontSize:12,color:accent,fontFamily:"'Times New Roman', Times, serif",margin:0,lineHeight:1.6}}><strong>Selected:</strong> {selected?.label} — {selected?.desc}</p>
          </div>
          <div style={{marginBottom:16}}>
            <Label text="Parties, Cause of Action, Reliefs & Special Instructions"/>
            <Textarea value={context} onChange={setContext} rows={8} placeholder="Set out: full names/descriptions of all parties, court and division, cause of action, every relief sought (numbered), relevant statute or rule, amounts, pre-action notices complied with."/>
          </div>
          <Btn label={`Draft ${selected?.label??'Originating Process'}`} onClick={run} loading={loading} accent={accent} off={!context.trim()}/>
        </>
      )}
      {error&&<ErrorBlock message={error}/>}
      {draft&&<ResultBlock title={`${selected?.label??'Originating Process'} — Draft`} content={draft} onClear={()=>{setDraft('');onSave({origProcessDraft:''}); }} accent={accent}/>}
    </div>
  );
}

// ─── WITNESS STATEMENT DRAFTER ───────────────────────────────────────────────
function WitnessStatementDrafter({data,onSave,accent,ai,systemCtx}:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const [witnessName,setWitnessName]=useState(data.witnessName??'');
  const [witnessRole,setWitnessRole]=useState(data.witnessRole??'');
  const [context,setContext]=useState(data.witnessContext??'');
  const [draft,setDraft]=useState(data.witnessStatDraft??'');
  const {ask,loading,error}=ai;
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const caseName=aCase?.caseName??'';
    const court=aCase?.court??'High Court';
    const intPkg=(aCase?.intelligence_data?.intPkg??'').substring(0,3000);
    const {partyA}=getPartyLabels(aCase);
    const prompt=`You are acting as Nigerian civil litigation counsel for the ${partyA} side.\n\nMatter: ${caseName}\nCourt: ${court}\nWitness: ${witnessName} (${witnessRole||`witness for the ${partyA}`})\n\nIntelligence Package:\n${intPkg||'Not available — use the context below.'}\n\nWitness-specific facts:\n${context}\n\nDraft a complete Witness Statement on Oath in Nigerian High Court format.\n\nSTRUCTURE:\n1. Heading: IN THE [COURT] HOLDEN AT [CITY] — Suit No / parties\n2. WITNESS STATEMENT ON OATH OF [FULL NAME]\n3. Deponent introduction: "I, [FULL NAME], of [address], do hereby make oath and state as follows:"\n4. Personal details paragraph\n5. Substantive testimony — numbered paragraphs:\n   - ONE factual point per paragraph\n   - First person throughout\n   - Reference exhibits as Exhibit "A", "B"…\n   - Distinguish direct knowledge from information/belief\n   - Cover all material facts for each head of claim\n6. List of exhibits\n7. Deponent's closing affirmation\n8. Signature block\n9. Jurat: SWORN to at [City] this [day] day of [month], [year] / Before me: ___ / Commissioner for Oaths\n\nReturn complete draft only.`;
    const result=await ask({system:systemCtx,userMsg:prompt,maxTokens:2500});
    if(result){setDraft(result);onSave({witnessName,witnessRole,witnessContext:context,witnessStatDraft:result});}
  },[witnessName,witnessRole,context,ask,onSave]);

  return (
    <div>
      <SectionTitle text="Witness Statement on Oath" accent={accent}/>
      <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",marginBottom:18,lineHeight:1.6}}>Draft a complete sworn witness statement. The AI draws from the Intelligence Package and the facts you provide.</p>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
        <div><Label text="Witness Full Name"/><Input value={witnessName} onChange={setWitnessName} placeholder="e.g. Chukwuemeka Obi"/></div>
        <div><Label text="Witness Role / Capacity"/><Input value={witnessRole} onChange={setWitnessRole} placeholder="e.g. 1st Claimant, Managing Director"/></div>
      </div>
      <div style={{marginBottom:16}}>
        <Label text="Facts to Be Covered in the Statement"/>
        <Textarea value={context} onChange={setContext} rows={8} placeholder="Key facts: what the witness saw/did/heard, documents in their possession (list them — they become exhibits), transactions they were party to, what they can say about each head of claim."/>
      </div>
      <div style={{marginBottom:20,background:'#08080e',border:`1px solid ${accent}15`,borderRadius:6,padding:'10px 14px'}}>
        <p style={{fontSize:11,color:T.mute,fontFamily:"'Times New Roman', Times, serif",margin:0,lineHeight:1.6}}>⚖ This statement must be sworn before a Commissioner for Oaths before filing. Confirm all averments with the deponent before swearing.</p>
      </div>
      <Btn label="Draft Witness Statement on Oath" onClick={run} loading={loading} accent={accent} off={!witnessName.trim()||!context.trim()}/>
      {error&&<ErrorBlock message={error}/>}
      {draft&&<ResultBlock title={`Witness Statement — ${witnessName||'Draft'}`} content={draft} onClear={()=>{setDraft('');onSave({witnessStatDraft:''}); }} accent={accent}/>}
    </div>
  );
}

// ─── SOC DRAFTER ─────────────────────────────────────────────────────────────
function SoCDrafter({data,onSave,accent,ai,systemCtx}:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const [context,setContext]=useState(data.socContext??'');
  const [draft,setDraft]=useState(data.socDraft??'');
  const {ask,loading,error}=ai;
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const {partyA,partyB}=getPartyLabels(aCase);
    const prompt=`You are acting as Nigerian civil litigation counsel for the ${partyA} side.\n\nMatter: ${aCase?.caseName??''}\n\nCounsel context:\n${context}\n\nDraft a complete Statement of Claim in Nigerian High Court format:\n1. Opening paragraph identifying parties and court\n2. Facts in numbered paragraphs (material facts only, not evidence)\n3. Legal basis / cause of action\n4. Wherefore clause listing all reliefs\n\nNigerian pleading rules: plead material facts not evidence; every relief specifically pleaded; damages particularised; formal language; numbered paragraphs.\nLabel claimant as "${partyA}" and defendant as "${partyB}".\n\nReturn full draft Statement of Claim.`;
    const result=await ask({system:systemCtx,userMsg:prompt,maxTokens:2000});
    if(result){setDraft(result);onSave({socContext:context,socDraft:result});}
  },[context,ask,onSave]);
  return (
    <div>
      <SectionTitle text="Statement of Claim Drafter" accent={accent}/>
      <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",marginBottom:18,lineHeight:1.6}}>Provide the material facts, parties, cause of action, and reliefs sought. The AI drafts a complete Statement of Claim in Nigerian High Court format.</p>
      <div style={{marginBottom:16}}><Label text="Case Facts, Parties & Reliefs Sought"/><Textarea value={context} onChange={setContext} rows={8} placeholder="Set out the material facts: who the parties are, what happened, the cause of action, and every relief you are seeking. Include relevant dates and amounts."/></div>
      <Btn label="Draft Statement of Claim" onClick={run} loading={loading} accent={accent} off={!context.trim()}/>
      {error&&<ErrorBlock message={error}/>}
      {draft&&<ResultBlock title="Statement of Claim — Draft" content={draft} onClear={()=>{setDraft('');onSave({socDraft:''}); }} accent={accent}/>}
    </div>
  );
}
// ─── SOD MONITOR ─────────────────────────────────────────────────────────────
function SoDMonitor({data,onSave,accent,ai,systemCtx}:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const [serviceDate,setServiceDate]=useState(data.serviceDate??'');
  const [sodReceivedDate,setSodReceivedDate]=useState(data.sodReceivedDate??'');
  const [sodFiled,setSodFiled]=useState(data.sodFiled??false);
  const [pleadingItems,setPleadingItems]=useState<PleadingItem[]>(data.pleadingItems??[]);
  const [advice,setAdvice]=useState('');
  const {ask,loading,error}=ai;
  const days=daysSince(serviceDate);
  const defaultAvailable=!sodFiled&&days!==null&&days>=30;
  const defaultRisk=!sodFiled&&days!==null&&days>=21&&days<30;
  const save=(patch:Partial<SavedData>)=>onSave({serviceDate,sodReceivedDate,sodFiled,pleadingItems,...patch});
  const getAdvice=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const {partyA,partyB}=getPartyLabels(aCase);
    const prompt=`You are Nigerian civil litigation counsel for the ${partyA} side.\n\nService date: ${serviceDate||'not recorded'}\nDays since service: ${days??'unknown'}\nSoD filed by ${partyB}: ${sodFiled?'YES':'NO'}\nSoD received: ${sodReceivedDate||'N/A'}\n\nAdvise on:\n1. Whether default judgment is available and the procedural basis (High Court Rules)\n2. Correct motion to file — judgment in default of appearance or defence\n3. Exact steps and documents required\n4. If SoD filed — ${partyA}'s next step (counterclaim response, CMC prep)\n\nApply Nigerian High Court (Civil Procedure) Rules. Be specific and practical.`;
    const result=await ask({system:systemCtx,userMsg:prompt,maxTokens:1200});
    if(result) setAdvice(result);
  },[serviceDate,sodFiled,sodReceivedDate,days,ask]);
  return (
    <div>
      <SectionTitle text="Statement of Defence Monitor" accent={accent}/>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))',gap:12,marginBottom:24}}>
        <div style={{background:'#ffffff',border:`1px solid ${defaultAvailable?'#c05050':'#cccccc'}`,borderRadius:8,padding:'16px 18px'}}>
          <div style={{fontSize:9,color:T.mute,fontFamily:"'Times New Roman', Times, serif",letterSpacing:'.1em',textTransform:'uppercase',marginBottom:8}}>Default Judgment</div>
          <div style={{fontSize:18,color:defaultAvailable?'#c05050':defaultRisk?'#c09030':'#40a860',fontFamily:"'Times New Roman', Times, serif",fontWeight:600}}>
            {defaultAvailable?'⚠ Available':defaultRisk?'◎ Approaching':sodFiled?'✓ SoD Filed':'— Monitoring'}
          </div>
          {days!==null&&<div style={{fontSize:11,color:T.mute,fontFamily:"'Times New Roman', Times, serif",marginTop:6}}>{days} days since service</div>}
        </div>
        <div style={{background:'#ffffff',border:'1px solid #cccccc',borderRadius:8,padding:'16px 18px'}}>
          <div style={{fontSize:9,color:T.mute,fontFamily:"'Times New Roman', Times, serif",letterSpacing:'.1em',textTransform:'uppercase',marginBottom:8}}>SoD Status</div>
          <div style={{fontSize:18,color:sodFiled?'#40a860':'#c05050',fontFamily:"'Times New Roman', Times, serif",fontWeight:600}}>{sodFiled?'✓ Filed':'✗ Not Filed'}</div>
          {sodFiled&&sodReceivedDate&&<div style={{fontSize:11,color:T.mute,fontFamily:"'Times New Roman', Times, serif",marginTop:6}}>Received {sodReceivedDate}</div>}
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
        <div><Label text="Date of Service on Defendant"/><Input type="date" value={serviceDate} onChange={v=>{setServiceDate(v);save({serviceDate:v});}}/></div>
        <div><Label text="Date SoD Received (if filed)"/><Input type="date" value={sodReceivedDate} onChange={v=>{setSodReceivedDate(v);save({sodReceivedDate:v});}}/></div>
      </div>
      <div style={{marginBottom:20}}>
        <label style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer'}}>
          <input type="checkbox" checked={sodFiled} onChange={e=>{setSodFiled(e.target.checked);save({sodFiled:e.target.checked});}} style={{width:16,height:16,cursor:'pointer',accentColor:accent}}/>
          <span style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif"}}>Defendant has filed Statement of Defence</span>
        </label>
      </div>
      <div style={{marginBottom:24}}><Btn label="Get Procedural Advice" onClick={getAdvice} loading={loading} accent={accent} off={!serviceDate}/></div>
      {error&&<ErrorBlock message={error}/>}
      {advice&&<ResultBlock title="Procedural Advice — Default Position" content={advice} onClear={()=>setAdvice('')} accent={accent}/>}
      <div style={{marginTop:28}}>
        <SectionTitle text="Pleadings Tracker" accent={accent}/>
        <PleadingTracker items={pleadingItems} onUpdate={items=>{setPleadingItems(items);save({pleadingItems:items});}} accent={accent}/>
      </div>
    </div>
  );
}

// ─── COUNTERCLAIM RESPONSE ───────────────────────────────────────────────────
function CounterclaimResponse({data,onSave,accent,ai,systemCtx}:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const [context,setContext]=useState(data.dtccContext??'');
  const [draft,setDraft]=useState(data.dtccDraft??'');
  const {ask,loading,error}=ai;
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const {partyA,partyB}=getPartyLabels(aCase);
    const prompt=`You are Nigerian civil litigation counsel for the ${partyA} side (respondent to the counterclaim).\n\nMatter: ${aCase?.caseName??''}\n\nCounterclaim details:\n${context}\n\nDraft a complete Defence to Counterclaim:\n1. Traverse (deny) each counterclaim allegation not admitted\n2. Raise affirmative defences\n3. Specifically admit facts that are admitted\n4. Plead any set-off or abatement if applicable\n5. Wherefore — dismiss counterclaim with costs\n\nLabel "${partyA}" / "${partyB}". Nigerian pleading rules. Number every paragraph.`;
    const result=await ask({system:systemCtx,userMsg:prompt,maxTokens:1500});
    if(result){setDraft(result);onSave({dtccContext:context,dtccDraft:result});}
  },[context,ask,onSave]);
  return (
    <div>
      <SectionTitle text="Defence to Counterclaim Drafter" accent={accent}/>
      <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",marginBottom:18,lineHeight:1.6}}>Summarise the counterclaim allegations and available defences. The AI drafts a Defence to Counterclaim in Nigerian High Court format.</p>
      <div style={{marginBottom:16}}><Label text="Counterclaim Allegations & Available Defences"/><Textarea value={context} onChange={setContext} rows={7} placeholder="Set out what the defendant claims in the counterclaim, the reliefs they seek, and grounds on which the counterclaim should be resisted."/></div>
      <Btn label="Draft Defence to Counterclaim" onClick={run} loading={loading} accent={accent} off={!context.trim()}/>
      {error&&<ErrorBlock message={error}/>}
      {draft&&<ResultBlock title="Defence to Counterclaim — Draft" content={draft} onClear={()=>{setDraft('');onSave({dtccDraft:''});}} accent={accent}/>}
    </div>
  );
}

// ─── DEFAULT FLAG ────────────────────────────────────────────────────────────
function DefaultFlag({data,onSave,accent,ai,systemCtx}:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const [serviceDate,setServiceDate]=useState(data.serviceDate??'');
  const [sodFiled,setSodFiled]=useState(data.sodFiled??false);
  const [court,setCourt]=useState('');
  const [draft,setDraft]=useState('');
  const {ask,loading,error}=ai;
  const days=daysSince(serviceDate);
  const defaultAvailable=!sodFiled&&days!==null&&days>=30;
  const draftMotion=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const {partyA,partyB}=getPartyLabels(aCase);
    const prompt=`You are Nigerian civil litigation counsel for the ${partyA}.\n\nCourt: ${court||'High Court'}\nService date: ${serviceDate}\nDays since service: ${days}\nSoD filed: ${sodFiled?'Yes':'No'}\n${partyA} / ${partyB}\n\nDraft a complete Motion for Judgment in Default of Defence:\n1. Motion on Notice heading with parties and court\n2. Application paragraph citing relevant High Court Rules provision\n3. Supporting affidavit structure (deponent, facts, exhibits required)\n4. List of proposed exhibits (proof of service, SoC copy, etc.)\n5. Relief(s) sought\n6. Certificate of service\n\nApply relevant Nigerian High Court Civil Procedure Rules for default judgment in default of defence.`;
    const result=await ask({system:systemCtx,userMsg:prompt,maxTokens:1500});
    if(result) setDraft(result);
  },[court,serviceDate,days,sodFiled,ask]);
  return (
    <div>
      <SectionTitle text="Default Judgment Readiness" accent={accent}/>
      <div style={{background:defaultAvailable?'#1a0808':'#ffffff',border:`1px solid ${defaultAvailable?'#c05050':'#cccccc'}`,borderRadius:10,padding:'20px 22px',marginBottom:24}}>
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:10}}>
          <span style={{fontSize:22,color:defaultAvailable?'#c05050':T.mute}}>{defaultAvailable?'⚠':days!==null&&days>=21&&!sodFiled?'◎':'◦'}</span>
          <div>
            <div style={{fontSize:14,color:defaultAvailable?'#c05050':T.sub,fontFamily:"'Times New Roman', Times, serif",fontWeight:600}}>
              {defaultAvailable?'Default Judgment Available':days!==null&&days>=21&&!sodFiled?'Approaching Default Window':sodFiled?'SoD Filed — No Default':'Monitor Service Date'}
            </div>
            {days!==null&&<div style={{fontSize:12,color:T.mute,fontFamily:"'Times New Roman', Times, serif",marginTop:4}}>{days} day{days!==1?'s':''} since service{!sodFiled&&days<30?` — default available in ${30-days} day${30-days!==1?'s':''}`:''}</div>}
          </div>
        </div>
        {defaultAvailable&&<p style={{fontSize:12,color:'#c05050',fontFamily:"'Times New Roman', Times, serif",margin:0,lineHeight:1.5}}>No Statement of Defence filed within 30 days of service. You may apply for judgment in default of defence under the applicable High Court Rules.</p>}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
        <div><Label text="Date of Service"/><Input type="date" value={serviceDate} onChange={v=>{setServiceDate(v);onSave({serviceDate:v});}}/></div>
        <div><Label text="Court"/><Input value={court} onChange={setCourt} placeholder="e.g. High Court of Lagos State"/></div>
      </div>
      <div style={{marginBottom:20}}>
        <label style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer'}}>
          <input type="checkbox" checked={sodFiled} onChange={e=>{setSodFiled(e.target.checked);onSave({sodFiled:e.target.checked});}} style={{width:16,height:16,cursor:'pointer',accentColor:accent}}/>
          <span style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif"}}>Defendant has filed a Statement of Defence</span>
        </label>
      </div>
      <Btn label="Draft Default Judgment Motion" onClick={draftMotion} loading={loading} accent={accent} off={!serviceDate||sodFiled}/>
      {!defaultAvailable&&!sodFiled&&serviceDate&&<p style={{fontSize:12,color:T.mute,fontFamily:"'Times New Roman', Times, serif",marginTop:10}}>Default judgment motion will be available after 30 days from service date.</p>}
      {error&&<ErrorBlock message={error}/>}
      {draft&&<ResultBlock title="Default Judgment Motion — Draft" content={draft} onClear={()=>setDraft('')} accent={accent}/>}
    </div>
  );
}
// ─── SOD DRAFTER ─────────────────────────────────────────────────────────────
function SoDDrafter({data,onSave,accent,ai,systemCtx,ccIntel}:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string;ccIntel?:CounterclaimIntel}) {
  const [context,setContext]=useState(data.sodContext??'');
  const [draft,setDraft]=useState(data.sodDraft??'');
  const {ask,loading,error}=ai;
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const {partyA,partyB}=getPartyLabels(aCase);
    const ccInstruction=ccIntel?.flag
      ?`4. Counterclaim — INCLUDE: Intelligence Engine identified viable counterclaim. Draft full Counterclaim section:\n   a. Counterclaim heading\n   b. Material facts (numbered)\n   c. Cause of action\n   d. Reliefs claimed by ${partyB}-counterclaimant\n   Intelligence: ${ccIntel.summary??'Independent cause of action arising from the same transaction.'}`
      :`4. Counterclaim (if applicable — draft if facts warrant cross-relief)`;
    const prompt=`You are Nigerian civil litigation counsel for the ${partyB} side.\n\nMatter: ${aCase?.caseName??''}\n\nDefence context:\n${context}\n\nDraft a complete Statement of Defence:\n1. Opening paragraph\n2. Traverse each SoC paragraph (admit / deny / not admitted)\n3. Affirmative defences in numbered paragraphs\n${ccInstruction}\n5. Wherefore — dismiss with costs${ccIntel?.flag?'; judgment on counterclaim':''}\n\nLabel "${partyA}" / "${partyB}". Nigerian pleading rules. Number every paragraph.`;
    const result=await ask({system:systemCtx,userMsg:prompt,maxTokens:ccIntel?.flag?2800:2000});
    if(result){setDraft(result);onSave({sodContext:context,sodDraft:result});}
  },[context,ccIntel,ask,onSave]);
  return (
    <div>
      <SectionTitle text="Statement of Defence Drafter" accent={accent}/>
      <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",marginBottom:18,lineHeight:1.6}}>Provide the claimant's allegations, available defences, admissions, and whether a counterclaim is warranted.</p>
      <div style={{marginBottom:16}}><Label text="Claimant's Allegations, Available Defences & Admissions"/><Textarea value={context} onChange={setContext} rows={8} placeholder="Summarise the SoC allegations paragraph by paragraph, what is admitted, what is denied, and what affirmative defences apply."/></div>
      <Btn label="Draft Statement of Defence" onClick={run} loading={loading} accent={accent} off={!context.trim()}/>
      {error&&<ErrorBlock message={error}/>}
      {draft&&<ResultBlock title="Statement of Defence — Draft" content={draft} onClear={()=>{setDraft('');onSave({sodDraft:''});}} accent={accent}/>}
      {ccIntel?.flag&&(
        <div style={{marginTop:20,background:'#0a1a0a',border:'1px solid #40a87840',borderRadius:8,padding:'13px 17px',display:'flex',gap:10,alignItems:'flex-start'}}>
          <span style={{fontSize:14,flexShrink:0}}>⚖</span>
          <p style={{fontSize:12,color:'#b0d4b0',fontFamily:"'Times New Roman', Times, serif",margin:0,lineHeight:1.6}}><strong style={{color:'#40a878'}}>Counterclaim flagged by Intelligence:</strong> {ccIntel.summary??'Potential independent cause of action detected — consider the Counterclaim Builder tab before filing the SoD.'}</p>
        </div>
      )}
    </div>
  );
}

// ─── COUNTERCLAIM BUILDER ────────────────────────────────────────────────────
function CounterclaimBuilder({data,onSave,accent,ai,systemCtx,ccIntel}:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string;ccIntel?:CounterclaimIntel}) {
  const seed=ccIntel?.flag&&ccIntel.summary?`Intelligence Engine detected: ${ccIntel.summary}\n\n[Expand with: specific reliefs sought, amounts, additional facts]`:'';
  const [context,setContext]=useState(data.counterclaimContext||seed);
  const [draft,setDraft]=useState(data.counterclaimDraft??'');
  const {ask,loading,error}=ai;
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const {partyA,partyB}=getPartyLabels(aCase);
    const intPrefix=ccIntel?.flag&&ccIntel.summary?`INTELLIGENCE NOTE: "${ccIntel.summary}". Use as foundation.\n\n`:'';
    const prompt=`You are Nigerian civil litigation counsel for the ${partyB}.\n\nMatter: ${aCase?.caseName??''}\n\n${intPrefix}Counterclaim facts:\n${context}\n\nDraft complete Counterclaim for inclusion in Statement of Defence:\n1. Counterclaim heading\n2. Material facts (numbered)\n3. Cause of action\n4. Reliefs claimed — numbered, specific amounts/orders\n5. Wherefore the ${partyB}-counterclaimant claims [reliefs]\n\nLabel "${partyA}" / "${partyB}". Nigerian pleading rules. Part of Statement of Defence.`;
    const result=await ask({system:systemCtx,userMsg:prompt,maxTokens:1500});
    if(result){setDraft(result);onSave({counterclaimContext:context,counterclaimDraft:result});}
  },[context,ccIntel,ask,onSave]);
  return (
    <div>
      <SectionTitle text="Counterclaim Builder" accent={accent}/>
      {ccIntel?.flag&&(
        <div style={{background:'#0a1a0a',border:'1px solid #40a87840',borderRadius:8,padding:'14px 18px',marginBottom:20,display:'flex',gap:12,alignItems:'flex-start'}}>
          <span style={{fontSize:16,flexShrink:0}}>⚖</span>
          <div>
            <div style={{fontSize:10,color:'#40a878',fontFamily:"'Times New Roman', Times, serif",letterSpacing:'.1em',textTransform:'uppercase',fontWeight:700,marginBottom:5}}>Intelligence — Counterclaim Detected</div>
            <p style={{fontSize:13,color:'#b0d4b0',fontFamily:"'Times New Roman', Times, serif",margin:0,lineHeight:1.6}}>{ccIntel.summary??'The Intelligence Engine identified facts that may support an independent counterclaim.'}</p>
          </div>
        </div>
      )}
      <div style={{marginBottom:16}}><Label text="Counterclaim Facts & Reliefs Sought"/><Textarea value={context} onChange={setContext} rows={7} placeholder="Describe: defendant's cause of action against the claimant, material facts, and specific reliefs to be claimed (damages, declarations, injunctions, etc.)."/></div>
      <Btn label="Draft Counterclaim" onClick={run} loading={loading} accent={accent} off={!context.trim()}/>
      {error&&<ErrorBlock message={error}/>}
      {draft&&<ResultBlock title="Counterclaim — Draft" content={draft} onClear={()=>{setDraft('');onSave({counterclaimDraft:''});}} accent={accent}/>}
    </div>
  );
}

// ─── PRELIMINARY OBJECTION DRAFTER ──────────────────────────────────────────
function PreliminaryObjDrafter({data,onSave,accent,ai,systemCtx}:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const [context,setContext]=useState(data.objectionContext??'');
  const [draft,setDraft]=useState(data.objectionDraft??'');
  const {ask,loading,error}=ai;
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const {partyA,partyB}=getPartyLabels(aCase);
    const prompt=`You are Nigerian civil litigation counsel for the ${partyB}.\n\nMatter: ${aCase?.caseName??''}\n\nGrounds and case details:\n${context}\n\nAnalyse preliminary objection grounds and draft:\n\nAssess each ground:\n1. Jurisdiction — subject matter or parties\n2. Competence of originating process\n3. Limitation — expired under Limitation Law\n4. Locus standi — does ${partyA} have standing\n5. Non-disclosure of cause of action\n6. Failure of pre-conditions — statutory notices\n7. Improper parties — misjoinder/non-joinder\n\nDraft:\nA. Notice of Preliminary Objection\nB. Points of Argument on each valid ground with Nigerian authorities\nC. Relief sought — suit struck out/dismissed with costs\n\nLabel "${partyA}" / "${partyB}". Apply Nigerian High Court Rules.`;
    const result=await ask({system:systemCtx,userMsg:prompt,maxTokens:2000});
    if(result){setDraft(result);onSave({objectionContext:context,objectionDraft:result});}
  },[context,ask,onSave]);
  return (
    <div>
      <SectionTitle text="Preliminary Objection Grounds & Draft" accent={accent}/>
      <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",marginBottom:18,lineHeight:1.6}}>Describe the case and suspected procedural defects. The AI will assess all objection grounds and draft the Notice and Points of Argument.</p>
      <div style={{marginBottom:16}}><Label text="Case Facts, Originating Process Details & Suspected Defects"/><Textarea value={context} onChange={setContext} rows={7} placeholder="Describe: claimant's cause of action, originating process used, court seized, relevant dates (when cause arose, when writ filed), and any apparent procedural irregularities."/></div>
      <Btn label="Analyse Grounds & Draft Objection" onClick={run} loading={loading} accent={accent} off={!context.trim()}/>
      {error&&<ErrorBlock message={error}/>}
      {draft&&<ResultBlock title="Preliminary Objection — Grounds & Draft" content={draft} onClear={()=>{setDraft('');onSave({objectionDraft:''});}} accent={accent}/>}
    </div>
  );
}

// ─── REPLY MONITOR ───────────────────────────────────────────────────────────
function ReplyMonitor({data,onSave,accent}:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string}) {
  const [replyReceived,setReplyReceived]=useState(data.replyReceived??false);
  const [replyDate,setReplyDate]=useState(data.replyDate??'');
  const [pleadingItems,setPleadingItems]=useState<PleadingItem[]>(data.pleadingItems??[]);
  const save=(patch:Partial<SavedData>)=>onSave({replyReceived,replyDate,pleadingItems,...patch});
  const daysAwaiting=!replyReceived?daysSince(data.sodReceivedDate??''):null;
  return (
    <div>
      <SectionTitle text="Reply Monitor" accent={accent}/>
      <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",marginBottom:18,lineHeight:1.6}}>Track the claimant's Reply to the Statement of Defence. A Reply is not obligatory unless new matters were raised. If a Counterclaim was included, the claimant must file a Defence to Counterclaim.</p>
      <div style={{background:'#ffffff',border:`1px solid ${replyReceived?'#40a860':'#c0903050'}`,borderRadius:8,padding:'16px 18px',marginBottom:20}}>
        <div style={{fontSize:14,color:replyReceived?'#40a860':'#c09030',fontFamily:"'Times New Roman', Times, serif",fontWeight:600,marginBottom:6}}>{replyReceived?'✓ Reply Received':'— Awaiting Claimant Reply'}</div>
        {daysAwaiting!==null&&!replyReceived&&<div style={{fontSize:12,color:T.mute,fontFamily:"'Times New Roman', Times, serif"}}>{daysAwaiting} days since SoD filed</div>}
        {replyReceived&&replyDate&&<div style={{fontSize:12,color:T.mute,fontFamily:"'Times New Roman', Times, serif"}}>Received on {replyDate}</div>}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
        <div>
          <label style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer'}}>
            <input type="checkbox" checked={replyReceived} onChange={e=>{setReplyReceived(e.target.checked);save({replyReceived:e.target.checked});}} style={{width:16,height:16,cursor:'pointer',accentColor:accent}}/>
            <span style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif"}}>Reply received from claimant</span>
          </label>
        </div>
        {replyReceived&&<div><Label text="Date Reply Received"/><Input type="date" value={replyDate} onChange={v=>{setReplyDate(v);save({replyDate:v});}}/></div>}
      </div>
      <div style={{marginTop:24}}>
        <SectionTitle text="Pleadings Tracker" accent={accent}/>
        <PleadingTracker items={pleadingItems} onUpdate={items=>{setPleadingItems(items);save({pleadingItems:items});}} accent={accent}/>
      </div>
      <div style={{marginTop:20,background:'#08080e',border:`1px solid ${accent}20`,borderRadius:8,padding:'16px 18px'}}>
        <SectionTitle text="Pleadings Closure Note" accent={accent}/>
        <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",margin:0,lineHeight:1.7}}>Under Nigerian High Court Rules, pleadings close after the Statement of Defence (or Reply if filed). Once pleadings are closed, the matter proceeds to the Case Management Conference (CMC).</p>
      </div>
    </div>
  );
}
// ─── PHASE 3A: ORIGINATING SUMMONS TRACK — FOR SIDE ────────────────────────

function OSDrafter({data,onSave,accent,ai,systemCtx}:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const [context,setContext]=useState(data.osDraftContext??'');
  const [draft,setDraft]=useState(data.osDraft??'');
  const {ask,loading,error}=ai;
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const {partyA,partyB}=getPartyLabels(aCase);
    const prompt=`You are Nigerian civil litigation counsel for the ${partyA} (Applicant).\n\nMatter: ${aCase?.caseName??''}\nCourt: ${aCase?.court??'High Court'}\n\nCounsel instructions:\n${context}\n\nDraft a complete Originating Summons in correct Nigerian High Court form.\n\nSTRUCTURE:\n1. IN THE [COURT] HOLDEN AT [CITY] — Suit No: [to be assigned]\n   IN THE MATTER OF: [applicable statute or subject matter]\n   BETWEEN: [${partyA.toUpperCase()} NAME] — Applicant AND [${partyB.toUpperCase()} NAME] — Respondent\n\n2. ORIGINATING SUMMONS\n   Let [Respondent/all persons concerned] attend before the Court on the hearing of an application by the Applicant for:\n\n3. QUESTIONS FOR DETERMINATION: (numbered — each must be answerable as a legal proposition without disputed facts)\n\n4. RELIEFS SOUGHT: (numbered declarations/orders for each question, plus costs)\n\n5. GROUNDS: (statutory or common-law basis for jurisdiction and each question)\n\n6. AND TAKE NOTICE that the Applicant will rely on:\n   (i) Affidavit in Support of [Deponent], sworn [date]\n   (ii) [Other documents]\n   (iii) Further affidavit(s) and written address to be filed\n\n7. Solicitor's endorsement: Drawn and filed by [Counsel], [Firm], [Address]\n\nRequirements:\n- Questions must be legal propositions, not factual disputes\n- Each question has a corresponding relief\n- Reference enabling rule/statute/order authorising commencement by OS\n- Flag missing details: [COUNSEL TO SUPPLY: description]\n\nReturn complete Originating Summons draft only.`;
    const result=await ask({system:systemCtx,userMsg:prompt,maxTokens:2000});
    if(result){setDraft(result);onSave({osDraftContext:context,osDraft:result});}
  },[context,ask,onSave]);
  return (
    <div>
      <SectionTitle text="Originating Summons" accent={accent}/>
      <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",marginBottom:18,lineHeight:1.6}}>For matters involving questions of law or document construction unlikely to involve disputed facts. Provide the legal questions, reliefs sought, and statutory basis.</p>
      <div style={{marginBottom:14,background:`${accent}08`,border:`1px solid ${accent}20`,borderRadius:7,padding:'12px 16px'}}>
        <p style={{fontSize:12,color:accent,fontFamily:"'Times New Roman', Times, serif",margin:0,lineHeight:1.6}}><strong>When to use:</strong> Questions of law · Document construction · Estate administration · Mortgage enforcement · Trustee applications · Undisputed facts.</p>
      </div>
      <div style={{marginBottom:16}}><Label text="Parties, Legal Questions, Reliefs & Statutory Basis"/><Textarea value={context} onChange={setContext} rows={9} placeholder="Provide: full names of Applicant/Respondent and capacities, court and division, subject matter (e.g. 'construction of Clause 7 of the Agreement dated...'), enabling statute/rule, legal questions (numbered), corresponding reliefs (numbered), documents to be construed."/></div>
      <Btn label="Draft Originating Summons" onClick={run} loading={loading} accent={accent} off={!context.trim()}/>
      {error&&<ErrorBlock message={error}/>}
      {draft&&<ResultBlock title="Originating Summons — Draft" content={draft} onClear={()=>{setDraft('');onSave({osDraft:''});}} accent={accent}/>}
    </div>
  );
}

function OSAffidavitDrafter({data,onSave,accent,ai,systemCtx}:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const [context,setContext]=useState(data.osAffidavitContext??'');
  const [draft,setDraft]=useState(data.osAffidavitDraft??'');
  const {ask,loading,error}=ai;
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const {partyA}=getPartyLabels(aCase);
    const osDraft=data.osDraft??'';
    const prompt=`You are Nigerian civil litigation counsel for the ${partyA} (Applicant).\n\nMatter: ${aCase?.caseName??''}\nCourt: ${aCase?.court??'High Court'}\n\nOriginating Summons (already drafted):\n${osDraft?osDraft.substring(0,1500):'[Not yet drafted — use facts below]'}\n\nDeponent details and facts from counsel:\n${context}\n\nDraft a complete Affidavit in Support of the Originating Summons.\n\nSTRUCTURE:\n1. Heading identical to OS — "AFFIDAVIT IN SUPPORT OF ORIGINATING SUMMONS"\n2. "I, [FULL NAME], of [address], [occupation], do hereby make oath and state as follows:"\n3. Capacity paragraph\n4. Substantive paragraphs (numbered):\n   - Each fact supporting the OS grounds\n   - Identify exhibits: "Exhibited hereto and marked Exhibit 'A' is a copy of [document]…"\n   - Keep to facts — no legal argument\n   - Attribute hearsay to source\n5. Closing: "The contents of this affidavit are true to the best of my knowledge, information and belief."\n6. Signature block and Jurat: SWORN to at [City] this [day] day of [month], [year] / Before me: ___ / Commissioner for Oaths\n\nReturn complete Affidavit in Support draft only.`;
    const result=await ask({system:systemCtx,userMsg:prompt,maxTokens:2000});
    if(result){setDraft(result);onSave({osAffidavitContext:context,osAffidavitDraft:result});}
  },[context,data.osDraft,ask,onSave]);
  return (
    <div>
      <SectionTitle text="Affidavit in Support" accent={accent}/>
      <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",marginBottom:18,lineHeight:1.6}}>Draft the Affidavit in Support of the Originating Summons. If the OS has been drafted in the previous tab, it will inform this draft automatically.</p>
      {data.osDraft&&<div style={{marginBottom:14,background:'#0a180a',border:'1px solid #40a87830',borderRadius:7,padding:'10px 14px'}}><p style={{fontSize:11,color:'#40a878',fontFamily:"'Times New Roman', Times, serif",margin:0}}>✓ Originating Summons draft detected — the affidavit will be structured to support it.</p></div>}
      <div style={{marginBottom:16}}><Label text="Deponent Details & Facts to Be Deposed To"/><Textarea value={context} onChange={setContext} rows={8} placeholder="Provide: deponent's full name, address, occupation; relationship to Applicant; all facts to depose to (in order); documents to be exhibited; any hearsay facts and their source."/></div>
      <Btn label="Draft Affidavit in Support" onClick={run} loading={loading} accent={accent} off={!context.trim()}/>
      {error&&<ErrorBlock message={error}/>}
      {draft&&<ResultBlock title="Affidavit in Support — Draft" content={draft} onClear={()=>{setDraft('');onSave({osAffidavitDraft:''}); }} accent={accent}/>}
    </div>
  );
}

function OSWrittenAddress({data,onSave,accent,ai,systemCtx}:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const [context,setContext]=useState(data.osAddressContext??'');
  const [draft,setDraft]=useState(data.osAddressDraft??'');
  const {ask,loading,error}=ai;
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const {partyA,partyB}=getPartyLabels(aCase);
    const osDraft=data.osDraft??'';
    const prompt=`You are Nigerian civil litigation counsel for the ${partyA} (Applicant).\n\nMatter: ${aCase?.caseName??''}\nCourt: ${aCase?.court??'High Court'}\n\nOriginating Summons questions and reliefs:\n${osDraft?osDraft.substring(0,2000):'[Not yet drafted — use context below]'}\n\nCounsel's legal arguments and authorities:\n${context}\n\nDraft a complete Written Address in support of the Originating Summons.\n\nSTRUCTURE:\n1. Cover heading: IN THE [COURT] — Suit No / parties / APPLICANT'S WRITTEN ADDRESS\n2. INTRODUCTION: nature of application and what the court is asked to determine\n3. ISSUES FOR DETERMINATION: restate OS questions as issues\n4. STATEMENT OF FACTS: brief factual background (cross-reference Affidavit in Support)\n5. ARGUMENTS — for each issue:\n   a. Applicable legal principle\n   b. At least two Nigerian authorities (cases or statutes)\n   c. Apply principle to facts\n   d. Conclude in Applicant's favour\n6. CONCLUSION: all issues resolved for Applicant + order sought\n7. AUTHORITIES RELIED UPON: chronological list\n\nRequirements: formal court language; every proposition supported by authority; apply don't just quote; flag [COUNSEL TO INSERT: citation] where needed.\n\nReturn complete Written Address draft only.`;
    const result=await ask({system:systemCtx,userMsg:prompt,maxTokens:2500});
    if(result){setDraft(result);onSave({osAddressContext:context,osAddressDraft:result});}
  },[context,data.osDraft,ask,onSave]);
  return (
    <div>
      <SectionTitle text="Written Address" accent={accent}/>
      <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",marginBottom:18,lineHeight:1.6}}>Draft the Applicant's Written Address in support of the Originating Summons. The AI will structure arguments around the legal questions and draw from the OS draft if available.</p>
      {data.osDraft&&<div style={{marginBottom:14,background:'#0a180a',border:'1px solid #40a87830',borderRadius:7,padding:'10px 14px'}}><p style={{fontSize:11,color:'#40a878',fontFamily:"'Times New Roman', Times, serif",margin:0}}>✓ Originating Summons draft detected — Written Address will be structured around its questions and reliefs.</p></div>}
      <div style={{marginBottom:16}}><Label text="Legal Arguments, Authorities & Instructions"/><Textarea value={context} onChange={setContext} rows={8} placeholder="Provide: key legal arguments for each question, specific cases/statutes to rely on, adverse authorities to distinguish, special matters (urgency, interlocutory restraint, etc.)."/></div>
      <Btn label="Draft Written Address" onClick={run} loading={loading} accent={accent} off={!context.trim()}/>
      {error&&<ErrorBlock message={error}/>}
      {draft&&<ResultBlock title="Written Address (Applicant) — Draft" content={draft} onClear={()=>{setDraft('');onSave({osAddressDraft:''}); }} accent={accent}/>}
    </div>
  );
}

// ─── PHASE 3A: ORIGINATING SUMMONS TRACK — AGAINST SIDE ─────────────────────

function OSCounterAffidavit({data,onSave,accent,ai,systemCtx}:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const [context,setContext]=useState(data.osCounterContext??'');
  const [draft,setDraft]=useState(data.osCounterDraft??'');
  const {ask,loading,error}=ai;
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const {partyA,partyB}=getPartyLabels(aCase);
    const prompt=`You are Nigerian civil litigation counsel for the ${partyB} (Respondent).\n\nMatter: ${aCase?.caseName??''}\nCourt: ${aCase?.court??'High Court'}\n\nRespondent's factual position and paragraphs to dispute:\n${context}\n\nDraft a complete Counter-Affidavit.\n\nSTRUCTURE:\n1. Heading identical to OS — "COUNTER-AFFIDAVIT OF [DEPONENT NAME]"\n2. "I, [FULL NAME], of [address], [occupation], do hereby make oath and state as follows:"\n3. Capacity paragraph\n4. Substantive paragraphs — for each paragraph of Applicant's affidavit:\n   (a) ADMIT: "I admit the averments in paragraph [X]…"\n   (b) DENY: "I deny the averments in paragraph [X]… and state that…"\n   (c) NO KNOWLEDGE: "I am not in a position to admit or deny paragraph [X] and put the Applicant to strict proof"\n5. New facts: "IN FURTHER ANSWER to the Originating Summons, I state as follows:"\n6. Respondent exhibits labelled R1, R2…\n7. Closing affirmation and Jurat\n\nNigerian rules: paragraph-by-paragraph response; new facts under separate sub-heading; exhibits with Respondent prefix; facts only.\n\nReturn complete Counter-Affidavit draft only.`;
    const result=await ask({system:systemCtx,userMsg:prompt,maxTokens:2000});
    if(result){setDraft(result);onSave({osCounterContext:context,osCounterDraft:result});}
  },[context,ask,onSave]);
  return (
    <div>
      <SectionTitle text="Counter-Affidavit" accent={accent}/>
      <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",marginBottom:18,lineHeight:1.6}}>Draft the Respondent's Counter-Affidavit in response to the Applicant's Affidavit in Support. Provide the Respondent's factual position and any new facts to be introduced.</p>
      <div style={{marginBottom:16}}><Label text="Respondent's Deponent, Factual Position & Paragraphs to Dispute"/><Textarea value={context} onChange={setContext} rows={9} placeholder="Provide: deponent's name/address/occupation/capacity; summary of applicant's affidavit paragraphs to admit/deny; for each denial: the true factual position; new facts the Respondent relies on; documents to exhibit (R1, R2…)."/></div>
      <Btn label="Draft Counter-Affidavit" onClick={run} loading={loading} accent={accent} off={!context.trim()}/>
      {error&&<ErrorBlock message={error}/>}
      {draft&&<ResultBlock title="Counter-Affidavit — Draft" content={draft} onClear={()=>{setDraft('');onSave({osCounterDraft:''}); }} accent={accent}/>}
    </div>
  );
}

function OSWrittenAddressOpp({data,onSave,accent,ai,systemCtx}:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const [context,setContext]=useState(data.osOppAddressContext??'');
  const [draft,setDraft]=useState(data.osOppAddressDraft??'');
  const {ask,loading,error}=ai;
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const {partyA,partyB}=getPartyLabels(aCase);
    const prompt=`You are Nigerian civil litigation counsel for the ${partyB} (Respondent).\n\nMatter: ${aCase?.caseName??''}\nCourt: ${aCase?.court??'High Court'}\n\nGrounds of opposition and legal arguments:\n${context}\n\nDraft a complete Written Address in Opposition to the Originating Summons.\n\nSTRUCTURE:\n1. Cover heading: IN THE [COURT] — Suit No / parties / RESPONDENT'S WRITTEN ADDRESS IN OPPOSITION\n2. INTRODUCTION: Respondent opposes; state grounds\n3. PRELIMINARY OBJECTION (if any): jurisdiction, wrong originating process, locus standi\n4. ISSUES FOR DETERMINATION (Respondent's formulation — reframe to support dismissal)\n5. STATEMENT OF FACTS (Respondent's version — cross-reference Counter-Affidavit)\n6. ARGUMENTS — for each issue:\n   a. Respondent's legal principle\n   b. At least two Nigerian authorities\n   c. Apply to facts\n   d. Distinguish Applicant's authorities\n   e. Conclude in Respondent's favour\n7. CONCLUSION: all issues against Applicant; OS dismissed with costs\n8. AUTHORITIES RELIED UPON: chronological list\n\nRequirements: formal court language; every proposition supported by authority; flag [COUNSEL TO INSERT: citation] where needed.\n\nReturn complete Written Address in Opposition draft only.`;
    const result=await ask({system:systemCtx,userMsg:prompt,maxTokens:2500});
    if(result){setDraft(result);onSave({osOppAddressContext:context,osOppAddressDraft:result});}
  },[context,ask,onSave]);
  return (
    <div>
      <SectionTitle text="Written Address in Opposition" accent={accent}/>
      <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",marginBottom:18,lineHeight:1.6}}>Draft the Respondent's Written Address in Opposition. Include any preliminary objection, the Respondent's formulation of the issues, and all legal arguments against the application.</p>
      <div style={{marginBottom:16}}><Label text="Grounds of Opposition, Legal Arguments & Authorities"/><Textarea value={context} onChange={setContext} rows={9} placeholder="Provide: any preliminary objection; Respondent's version of the issues; legal arguments against Applicant's position for each question; authorities to rely on; Applicant's authorities to distinguish."/></div>
      <Btn label="Draft Written Address in Opposition" onClick={run} loading={loading} accent={accent} off={!context.trim()}/>
      {error&&<ErrorBlock message={error}/>}
      {draft&&<ResultBlock title="Written Address in Opposition — Draft" content={draft} onClear={()=>{setDraft('');onSave({osOppAddressDraft:''}); }} accent={accent}/>}
    </div>
  );
}
// ─── PHASE 3A: OS ENGINE CONTAINER ──────────────────────────────────────────
function OriginatingSummonsEngine({activeCase,data,onSave,accent,ai,systemCtx}:{activeCase:Case;data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const isClaim=activeCase.counsel_role==='claimant_side';
  const forTabs:[{id:OSClaimSubTab;label:string}]=[
    {id:'os_drafter',label:'Originating Summons'},
    {id:'os_affidavit',label:'Affidavit in Support'},
    {id:'os_written_address',label:'Written Address'},
  ] as any;
  const againstTabs:[{id:OSDefSubTab;label:string}]=[
    {id:'os_counter_affidavit',label:'Counter-Affidavit'},
    {id:'os_written_address_opp',label:'Written Address in Opposition'},
  ] as any;
  const tabs=(isClaim?forTabs:againstTabs) as {id:string;label:string}[];
  const [activeTab,setActiveTab]=useState<string>(isClaim?'os_drafter':'os_counter_affidavit');
  const sp={data,onSave,accent,ai,systemCtx};
  const checklist=isClaim
    ?[{label:'Originating Summons',done:!!data.osDraft},{label:'Affidavit in Support',done:!!data.osAffidavitDraft},{label:'Written Address',done:!!data.osAddressDraft}]
    :[{label:'Counter-Affidavit',done:!!data.osCounterDraft},{label:'Written Address in Opposition',done:!!data.osOppAddressDraft}];
  return (
    <div style={{animation:'fadeUp .3s ease'}}>
      <div style={{marginBottom:24}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
          <span style={{fontSize:18,color:accent}}>📜</span>
          <h3 style={{fontSize:18,color:T.text,fontFamily:"'Times New Roman', Times, serif",fontWeight:300,margin:0}}>Originating Summons Track</h3>
          <span style={{fontSize:9,padding:'3px 8px',borderRadius:3,fontFamily:"'Times New Roman', Times, serif",fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',background:`${accent}15`,border:`1px solid ${accent}30`,color:accent}}>
            {isClaim?'Applicant (For)':'Respondent (Against)'}
          </span>
        </div>
        <p style={{fontSize:13,color:T.mute,fontFamily:"'Times New Roman', Times, serif",margin:0}}>
          {isClaim?'Draft the Originating Summons, Affidavit in Support, and Written Address for the Applicant.':'Draft the Counter-Affidavit and Written Address in Opposition for the Respondent.'}
        </p>
      </div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:22}}>
        {checklist.map(item=>(
          <span key={item.label} style={{fontSize:11,padding:'4px 10px',borderRadius:4,fontFamily:"'Times New Roman', Times, serif",background:item.done?'#0a180a':'#f8f8f8',border:`1px solid ${item.done?'#40a87850':'#cccccc'}`,color:item.done?'#40a878':T.mute}}>
            {item.done?'✓':'○'} {item.label}
          </span>
        ))}
      </div>
      <SubTabBar tabs={tabs} active={activeTab} onSelect={setActiveTab} accent={accent}/>
      {isClaim&&activeTab==='os_drafter'&&<OSDrafter {...sp}/>}
      {isClaim&&activeTab==='os_affidavit'&&<OSAffidavitDrafter {...sp}/>}
      {isClaim&&activeTab==='os_written_address'&&<OSWrittenAddress {...sp}/>}
      {!isClaim&&activeTab==='os_counter_affidavit'&&<OSCounterAffidavit {...sp}/>}
      {!isClaim&&activeTab==='os_written_address_opp'&&<OSWrittenAddressOpp {...sp}/>}
    </div>
  );
}

// ─── WRIT TRACK SUB-TABS WRAPPER ─────────────────────────────────────────────
function WritSubTabs({isClaim,claimTabs,defTabs,accent,sharedProps,ccIntel}:{isClaim:boolean;claimTabs:{id:string;label:string}[];defTabs:{id:string;label:string}[];accent:string;sharedProps:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string};ccIntel?:CounterclaimIntel}) {
  const tabs=isClaim?claimTabs:defTabs;
  const [activeTab,setActiveTab]=useState<SubTab>(isClaim?'originating_process':'sod_drafter');
  return (
    <div style={{animation:'fadeUp .3s ease'}}>
      <div style={{marginBottom:24}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
          <span style={{fontSize:18,color:accent}}>📜</span>
          <h3 style={{fontSize:18,color:T.text,fontFamily:"'Times New Roman', Times, serif",fontWeight:300,margin:0}}>Pleadings Engine</h3>
          <span style={{fontSize:9,padding:'3px 8px',borderRadius:3,fontFamily:"'Times New Roman', Times, serif",fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',background:`${accent}15`,border:`1px solid ${accent}30`,color:accent}}>
            {isClaim?'Claimant Side':'Defendant Side'}
          </span>
        </div>
        <p style={{fontSize:13,color:T.mute,fontFamily:"'Times New Roman', Times, serif",margin:0}}>
          {isClaim?"Draft originating processes, pleadings, and witness statements. Monitor the defendant's response and track default judgment opportunities.":"Draft your defence, build counterclaims, identify preliminary objection grounds, and track pleadings."}
        </p>
      </div>
      <SubTabBar tabs={tabs} active={activeTab} onSelect={id=>setActiveTab(id as SubTab)} accent={accent}/>
      <div>
        {isClaim&&activeTab==='originating_process'&&<OriginatingProcessDrafter {...sharedProps}/>}
        {isClaim&&activeTab==='soc_drafter'&&<SoCDrafter {...sharedProps}/>}
        {isClaim&&activeTab==='witness_statement'&&<WitnessStatementDrafter {...sharedProps}/>}
        {isClaim&&activeTab==='sod_monitor'&&<SoDMonitor {...sharedProps}/>}
        {isClaim&&activeTab==='counterclaim_response'&&<CounterclaimResponse {...sharedProps}/>}
        {isClaim&&activeTab==='default_flag'&&<DefaultFlag {...sharedProps}/>}
        {!isClaim&&activeTab==='sod_drafter'&&<SoDDrafter {...sharedProps} ccIntel={ccIntel}/>}
        {!isClaim&&activeTab==='counterclaim_builder'&&<CounterclaimBuilder {...sharedProps} ccIntel={ccIntel}/>}
        {!isClaim&&activeTab==='preliminary_objection'&&<PreliminaryObjDrafter {...sharedProps}/>}
        {!isClaim&&activeTab==='reply_monitor'&&<ReplyMonitor data={sharedProps.data} onSave={sharedProps.onSave} accent={accent}/>}
      </div>
    </div>
  );
}

// ─── MAIN ENGINE — COURT ROUTER ──────────────────────────────────────────────
export function PleadingsEngine({activeCase}:Props) {
  const isClaim=activeCase.counsel_role==='claimant_side';
  const accent=activeCase.counsel_role?COUNSEL_ROLE_COLORS[activeCase.counsel_role].col:'#4090d0';
  (window as any).__afsActiveCase=activeCase;

  const ccIntel:CounterclaimIntel|undefined=(()=>{
    const cd=(activeCase as any).intelligence_data?.counterclaim_detected as {flag?:boolean;summary?:string}|undefined;
    if(!cd) return undefined;
    return {flag:!!cd.flag,summary:cd.summary};
  })();

  const [data,setData]=useState<SavedData>(DEFAULT_DATA);
  const [loaded,setLoaded]=useState(false);
  const ai=useAI(activeCase);
  const {fullContext}=useCaseContext(activeCase,{query:activeCase?.caseName??'',engine:'PleadingsEngine'});
  const systemCtx=buildRoleSystemPrompt(activeCase.matter_track,activeCase.counsel_role)+fullContext;

  useEffect(()=>{
    let live=true;
    loadBlindSpot<SavedData>(activeCase.id,MODULE,DEFAULT_DATA).then(d=>{if(live){setData(d);setLoaded(true);}});
    return ()=>{live=false;};
  },[activeCase.id]);

  const onSave=useCallback((patch:Partial<SavedData>)=>{
    setData(prev=>{
      const next={...prev,...patch,lastUpdated:new Date().toISOString()};
      saveBlindSpot(activeCase.id,MODULE,next);
      return next;
    });
  },[activeCase.id]);

  if(!loaded) return <div style={{padding:40,color:T.mute,fontFamily:"'Times New Roman', Times, serif",fontSize:13}}>Loading Pleadings Engine…</div>;

  if(activeCase.counsel_role!=='claimant_side'&&activeCase.counsel_role!=='defendant_side') {
    return <div style={{padding:32,background:'#08080e',border:'1px solid #cccccc',borderRadius:8}}><p style={{fontSize:13,color:T.mute,fontFamily:"'Times New Roman', Times, serif"}}>The Pleadings Engine is only available on civil matters. This matter is on the criminal track.</p></div>;
  }

  const op=activeCase.originating_process;
  const sp={data,onSave,accent,ai,systemCtx};

  // ── TRACK 2: Originating Summons ──────────────────────────────────────────
  if(op==='originating_summons') {
    return <OriginatingSummonsEngine activeCase={activeCase} {...sp}/>;
  }

  // ── TRACK 1: Writ of Summons (default civil track) ────────────────────────
  if(!op||op==='writ_of_summons') {
    const claimTabs=[
      {id:'originating_process',label:'Originating Process'},
      {id:'soc_drafter',label:'SoC Drafter'},
      {id:'witness_statement',label:'Witness Statement'},
      {id:'sod_monitor',label:'SoD Monitor'},
      {id:'counterclaim_response',label:'Counterclaim Response'},
      {id:'default_flag',label:'Default Flag'},
    ];
    const defTabs=[
      {id:'sod_drafter',label:'SoD Drafter'},
      {id:'counterclaim_builder',label:ccIntel?.flag?'Counterclaim Builder ⚖':'Counterclaim Builder'},
      {id:'preliminary_objection',label:'Preliminary Objection'},
      {id:'reply_monitor',label:'Reply Monitor'},
    ];
    return <WritSubTabs isClaim={isClaim} claimTabs={claimTabs} defTabs={defTabs} accent={accent} sharedProps={sp} ccIntel={ccIntel}/>;
  }

  // ── FALLTHROUGH: specialist processes (3B–3E not yet deployed) ────────────
  const processLabel=op.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  const nextPhase=
    op==='winding_up_petition'||op.startsWith('nicn')?'3B':
    ['customary_summons','magistrate_plaint','magistrate_default','small_claims'].includes(op)?'3C':
    ['election_petition','tax_appeal','ist_application'].includes(op)?'3D':
    op==='arbitration_notice'?'3E':'3B';
  return (
    <div style={{padding:'32px 28px',background:'#fafaf8',border:'1px solid #cccccc',borderRadius:6,fontFamily:"'Times New Roman', Times, serif"}}>
      <p style={{fontSize:11,color:'#888888',letterSpacing:'.14em',textTransform:'uppercase',marginBottom:8}}>Coming in Next Phase</p>
      <p style={{fontSize:16,color:'#111111',fontWeight:700,marginBottom:10}}>{processLabel} Engine</p>
      <p style={{fontSize:13,color:'#555555',lineHeight:1.7,marginBottom:0}}>
        The specialist engine for <strong>{processLabel}</strong> matters will be available after Phase {nextPhase} is deployed. The case record, Intelligence Package, and all other tabs are fully functional.
      </p>
    </div>
  );
}

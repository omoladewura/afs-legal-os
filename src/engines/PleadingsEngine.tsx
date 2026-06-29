/**
 * AFS Legal OS V2 — Pleadings Engine (Phase 3D)
 * Phase 4 integrity audit complete. 29 June 2026.
 *
 * Phase 3D — Specialized Tribunals
 *   ELECTION PETITIONS TRIBUNAL: Pre-Filing window · For (Petitioner) · Against (Respondent)
 *   TAX APPEAL TRIBUNAL: Pre-Filing window · For (Appellant) · Against (Respondent)
 *   INVESTMENTS & SECURITIES TRIBUNAL (IST): For (Applicant) · Against (Respondent)
 *
 * All Phase 3A / 3B / 3C / 3E / 4A functionality preserved intact.
 *
 * KNOWN ARCHITECTURAL DEBT (low immediate risk — flag for future refactor):
 *   window.__afsActiveCase — PleadingsEngine sets this global on every render;
 *   AIDrafter and other inline drafters read it from the global on button click.
 *   Race-condition risk is minimal (set on parent render, read on user interaction),
 *   but the pattern should be replaced with prop-drilling or context in a future pass.
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { Case } from '@/types';
import { T } from '@/constants/tokens';
import { useAI } from '@/hooks/useAI';
import { useCaseContext } from '@/hooks/useCaseContext';
import { buildRoleSystemPrompt } from '@/utils/rolePrompt';
import { getPartyLabels } from '@/utils/getPartyLabels';
import { loadBlindSpot, saveBlindSpot, loadMatrimonialData } from '@/storage/helpers';
import type { MatrimonialCaseData } from '@/matrimonial/types';
import { Md, ErrorBlock } from '@/components/common/ui';
import { COUNSEL_ROLE_COLORS } from '@/types';

interface Props { activeCase: Case; }
interface CounterclaimIntel { flag: boolean; summary?: string; }

/**
 * Gap 9 fix — Pleadings Engine → Intelligence Engine wiring.
 *
 * Reads activeCase.intelligence_data (the Intelligence Engine's vetted final output)
 * and assembles a labelled context block that every specialist drafter can inject
 * into its prompt as the primary source of facts. Returns '' when no intelligence
 * data is available, in which case engines fall back to the lawyer's manual context
 * exactly as before.
 */
function buildIntelligenceBlock(aCase: any): string {
  const id = aCase?.intelligence_data;
  if (!id) return '';
  const fmt = (v: any): string => Array.isArray(v) ? v.join('; ') : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  const parts: string[] = [];
  // Generic / cross-engine fields (SoC / SoD / OS / Preliminary Objection)
  if (id.parties) parts.push(`Parties & Capacities: ${fmt(id.parties)}`);
  if (id.cause_of_action) parts.push(`Cause of Action: ${fmt(id.cause_of_action)}`);
  if (id.material_facts) parts.push(`Material Facts (in sequence): ${fmt(id.material_facts)}`);
  if (id.reliefs_sought) parts.push(`Reliefs Sought: ${fmt(id.reliefs_sought)}`);
  if (id.limitation_analysis ?? id.limitation_status) parts.push(`Limitation Status: ${fmt(id.limitation_analysis ?? id.limitation_status)}`);
  if (id.damages_computation) parts.push(`Damages Computation: ${fmt(id.damages_computation)}`);
  if (id.claimant_allegations) parts.push(`Claimant's Extracted Allegations: ${fmt(id.claimant_allegations)}`);
  if (id.available_defences) parts.push(`Available Defences Identified: ${fmt(id.available_defences)}`);
  if (id.counterclaim_detected?.summary) parts.push(`Counterclaim: ${fmt(id.counterclaim_detected.summary)}`);
  if (id.legal_questions) parts.push(`Legal Questions Formulated: ${fmt(id.legal_questions)}`);
  if (id.statutory_basis) parts.push(`Statutory Basis: ${fmt(id.statutory_basis)}`);
  if (id.locus_standi) parts.push(`Locus Standi Flags: ${fmt(id.locus_standi)}`);
  if (id.originating_process_competence) parts.push(`Originating Process Competence Assessment: ${fmt(id.originating_process_competence)}`);
  // Winding-Up
  if (id.debt_amount) parts.push(`Debt Amount: ${fmt(id.debt_amount)}`);
  if (id.demand_history) parts.push(`Demand History: ${fmt(id.demand_history)}`);
  if (id.company_details) parts.push(`Company Details: ${fmt(id.company_details)}`);
  if (id.insolvency_indicators) parts.push(`Insolvency Indicators: ${fmt(id.insolvency_indicators)}`);
  // Election Petition
  if (id.electoral_irregularities) parts.push(`Electoral Irregularities Identified: ${fmt(id.electoral_irregularities)}`);
  if (id.units_affected) parts.push(`Units Affected: ${fmt(id.units_affected)}`);
  if (id.scores_in_dispute) parts.push(`Scores in Dispute: ${fmt(id.scores_in_dispute)}`);
  if (id.grounds_formulated) parts.push(`Grounds Already Formulated: ${fmt(id.grounds_formulated)}`);
  // TAT
  if (id.tax_type) parts.push(`Tax Type: ${fmt(id.tax_type)}`);
  if (id.assessment_figures) parts.push(`Assessment Figures: ${fmt(id.assessment_figures)}`);
  if (id.disputed_amounts) parts.push(`Disputed Amounts: ${fmt(id.disputed_amounts)}`);
  if (id.grounds_of_objection) parts.push(`Grounds of Objection Already Analysed: ${fmt(id.grounds_of_objection)}`);
  // IST
  if (id.capital_market_violation) parts.push(`Capital Market Violation Identified: ${fmt(id.capital_market_violation)}`);
  if (id.sec_correspondence) parts.push(`SEC Correspondence History: ${fmt(id.sec_correspondence)}`);
  if (id.reliefs_available_isa) parts.push(`Reliefs Available under ISA 2007: ${fmt(id.reliefs_available_isa)}`);
  // Narrative fallback — always include if present, capped, appended last
  if (id.intPkg) parts.push(`Intelligence Narrative:\n${String(id.intPkg).substring(0, 3000)}`);
  if (!parts.length) return '';
  return parts.join('\n\n');
}

/** Wraps a lawyer's manual context textarea value together with the Intelligence Engine block,
 *  labelling the intelligence block as the primary/foundational source. */
function withIntelligence(intelBlock: string, manualCtx: string): string {
  if (!intelBlock) return manualCtx;
  return `INTELLIGENCE ENGINE OUTPUT (vetted facts — do not contradict):\n${intelBlock}\n\nAdditional facts from counsel (supplemental):\n${manualCtx || '(none — relying on Intelligence Engine output above)'}`;
}
type ClaimSubTab   = 'originating_process' | 'soc_drafter' | 'witness_statement' | 'sod_monitor' | 'counterclaim_response' | 'default_flag' | 'reply_to_sod';
type DefSubTab     = 'sod_drafter' | 'counterclaim_builder' | 'preliminary_objection' | 'reply_monitor';
type SubTab        = ClaimSubTab | DefSubTab;

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
  replyToSodContext?: string; replyToSodDraft?: string;
  osDraftContext?: string; osDraft?: string;
  osAffidavitContext?: string; osAffidavitDraft?: string;
  osAddressContext?: string; osAddressDraft?: string;
  osCounterContext?: string; osCounterDraft?: string;
  osOppAddressContext?: string; osOppAddressDraft?: string;
  pleadingItems?: PleadingItem[];    // claimant-side tracker (SoDMonitor)
  defPleadingItems?: PleadingItem[]; // defendant-side tracker (ReplyMonitor)
  serviceDate?: string; lastUpdated?: string;
  // 3B — Winding Up
  wuDemandContext?: string; wuDemandDraft?: string;
  wuPetitionContext?: string; wuPetitionDraft?: string;
  wuAffirmContext?: string; wuAffirmDraft?: string;
  wuLiquidatorContext?: string; wuLiquidatorDraft?: string;
  wuGazetteContext?: string; wuGazetteDraft?: string;
  wuOppMemoContext?: string; wuOppMemoDraft?: string;
  wuOppAffidavitContext?: string; wuOppAffidavitDraft?: string;
  wuOppAddressContext?: string; wuOppAddressDraft?: string;
  wuThirdPartyContext?: string; wuThirdPartyDraft?: string;
  wuThirdPartyAffContext?: string; wuThirdPartyAffDraft?: string;
  // 3B — NICN Complaint Form 1
  nicnComplaintContext?: string; nicnComplaintDraft?: string;
  nicnWitnessListContext?: string; nicnWitnessListDraft?: string;
  nicnWitnessStmtContext?: string; nicnWitnessStmtDraft?: string;
  nicnDocScheduleContext?: string; nicnDocScheduleDraft?: string;
  nicnDefMemoContext?: string; nicnDefMemoDraft?: string;
  nicnDefStmtContext?: string; nicnDefStmtDraft?: string;
  nicnDefWitnessContext?: string; nicnDefWitnessDraft?: string;
  nicnDefDocContext?: string; nicnDefDocDraft?: string;
  // 3B — NICN Originating Summons Form 2
  nicnOSDraftContext?: string; nicnOSDraft?: string;
  nicnOSAffidavitContext?: string; nicnOSAffidavitDraft?: string;
  nicnOSAddressContext?: string; nicnOSAddressDraft?: string;
  nicnOSCounterContext?: string; nicnOSCounterDraft?: string;
  nicnOSOppAddressContext?: string; nicnOSOppAddressDraft?: string;
  // 3B — NICN Judicial Review
  nicnJRMotionContext?: string; nicnJRMotionDraft?: string;
  nicnJRStmtContext?: string; nicnJRStmtDraft?: string;
  nicnJRAffidavitContext?: string; nicnJRAffidavitDraft?: string;
  nicnJRAddressContext?: string; nicnJRAddressDraft?: string;
  nicnJRCounterContext?: string; nicnJRCounterDraft?: string;
  nicnJROppAddressContext?: string; nicnJROppAddressDraft?: string;
  // 3B — NICN Appeal
  nicnAplNoticeContext?: string; nicnAplNoticeDraft?: string;
  nicnAplGroundsContext?: string; nicnAplGroundsDraft?: string;
  nicnAplBriefContext?: string; nicnAplBriefDraft?: string;
  nicnRespBriefContext?: string; nicnRespBriefDraft?: string;
  // 3C — Customary Court
  custSummonsContext?: string; custSummonsDraft?: string;
  custComplaintContext?: string; custComplaintDraft?: string;
  custWrapperContext?: string; custWrapperDraft?: string;
  custDefAppearanceContext?: string; custDefAppearanceDraft?: string;
  custDefStmtContext?: string; custDefStmtDraft?: string;
  // 3C — Magistrate Court Track A (Ordinary Summons)
  magAPraecipeContext?: string; magAPraecipeDraft?: string;
  magAParticularsContext?: string; magAParticularsDraft?: string;
  magAPlaintNoteContext?: string; magAPlaintNoteDraft?: string;
  magAWitnessContext?: string; magAWitnessDraft?: string;
  magADefAppearanceContext?: string; magADefAppearanceDraft?: string;
  magADefCounterContext?: string; magADefCounterDraft?: string;
  // 3C — Magistrate Court Track B (Default Summons / Debt Recovery)
  magBPraecipeContext?: string; magBPraecipeDraft?: string;
  magBParticularsContext?: string; magBParticularsDraft?: string;
  magBPlaintNoteContext?: string; magBPlaintNoteDraft?: string;
  magBDefIntentContext?: string; magBDefIntentDraft?: string;
  magBDefAffidavitContext?: string; magBDefAffidavitDraft?: string;
  // 3C — Small Claims Court
  scaDemandContext?: string; scaDemandDraft?: string;
  scaClaimFormContext?: string; scaClaimFormDraft?: string;
  scaDefResponseContext?: string; scaDefResponseDraft?: string;
  // 3D — Election Petitions Tribunal
  eptPetitionContext?: string; eptPetitionDraft?: string;
  eptGroundsContext?: string; eptGroundsDraft?: string;
  eptWitnessListContext?: string; eptWitnessListDraft?: string;
  eptDepositionsContext?: string; eptDepositionsDraft?: string;
  eptDocScheduleContext?: string; eptDocScheduleDraft?: string;
  eptAddressContext?: string; eptAddressDraft?: string;
  eptRespReplyContext?: string; eptRespReplyDraft?: string;
  eptRespWitnessContext?: string; eptRespWitnessDraft?: string;
  eptRespDocContext?: string; eptRespDocDraft?: string;
  eptRespAddressContext?: string; eptRespAddressDraft?: string;
  // 3D — Tax Appeal Tribunal
  tatNoticeContext?: string; tatNoticeDraft?: string;
  tatGroundsContext?: string; tatGroundsDraft?: string;
  tatStmtFactsContext?: string; tatStmtFactsDraft?: string;
  tatDocListContext?: string; tatDocListDraft?: string;
  tatSubmissionContext?: string; tatSubmissionDraft?: string;
  tatRespStmtContext?: string; tatRespStmtDraft?: string;
  tatRespDocContext?: string; tatRespDocDraft?: string;
  tatRespSubmissionContext?: string; tatRespSubmissionDraft?: string;
  // 3D — IST
  istApplicationContext?: string; istApplicationDraft?: string;
  istStmtFactsContext?: string; istStmtFactsDraft?: string;
  istWitnessListContext?: string; istWitnessListDraft?: string;
  istWitnessStmtContext?: string; istWitnessStmtDraft?: string;
  istDocScheduleContext?: string; istDocScheduleDraft?: string;
  istAddressContext?: string; istAddressDraft?: string;
  istRespStmtContext?: string; istRespStmtDraft?: string;
  istRespWitnessContext?: string; istRespWitnessDraft?: string;
  istRespDocContext?: string; istRespDocDraft?: string;
  istRespAddressContext?: string; istRespAddressDraft?: string;
  // 3E — Arbitral Panel (AMA)
  arbNoticeContext?: string; arbNoticeDraft?: string;
  arbClaimContext?: string; arbClaimDraft?: string;
  arbDefenceContext?: string; arbDefenceDraft?: string;
  arbClaimantAddressContext?: string; arbClaimantAddressDraft?: string;
  arbRespondentAddressContext?: string; arbRespondentAddressDraft?: string;
  // 4A — Matrimonial Petition (MCR)
  matPetitionContext?: string; matPetitionDraft?: string;
  matComplianceCertContext?: string; matComplianceCertDraft?: string;
  matVerifyingAffContext?: string; matVerifyingAffDraft?: string;
  matNonCollusionContext?: string; matNonCollusionDraft?: string;
  matS30MotionContext?: string; matS30MotionDraft?: string;
  matCoRespNoticeContext?: string; matCoRespNoticeDraft?: string;
  matForm10Context?: string; matForm10Draft?: string;
  matAnswerContext?: string; matAnswerDraft?: string;
  matCondPleasContext?: string; matCondPleaDraft?: string;
  matS30ObjContext?: string; matS30ObjDraft?: string;
  matCrossPetitionContext?: string; matCrossPetitionDraft?: string;
}

const MODULE = 'pleadings_engine';
const DEFAULT_DATA: SavedData = {
  // Phase 3A — core writ track
  origProcessType:'', origProcessContext:'', origProcessDraft:'',
  witnessName:'', witnessRole:'', witnessContext:'', witnessStatDraft:'',
  socContext:'', socDraft:'', sodReceivedDate:'', sodFiled:false,
  dtccContext:'', dtccDraft:'', sodContext:'', sodDraft:'',
  counterclaimContext:'', counterclaimDraft:'', objectionContext:'', objectionDraft:'',
  replyReceived:false, replyDate:'',
  replyToSodContext:'', replyToSodDraft:'',
  osDraftContext:'', osDraft:'', osAffidavitContext:'', osAffidavitDraft:'',
  osAddressContext:'', osAddressDraft:'', osCounterContext:'', osCounterDraft:'',
  osOppAddressContext:'', osOppAddressDraft:'',
  pleadingItems:[], defPleadingItems:[], serviceDate:'', lastUpdated:'',
  // 3B — Winding Up
  wuDemandContext:'', wuDemandDraft:'', wuPetitionContext:'', wuPetitionDraft:'',
  wuAffirmContext:'', wuAffirmDraft:'', wuLiquidatorContext:'', wuLiquidatorDraft:'',
  wuGazetteContext:'', wuGazetteDraft:'', wuOppMemoContext:'', wuOppMemoDraft:'',
  wuOppAffidavitContext:'', wuOppAffidavitDraft:'', wuOppAddressContext:'', wuOppAddressDraft:'',
  wuThirdPartyContext:'', wuThirdPartyDraft:'', wuThirdPartyAffContext:'', wuThirdPartyAffDraft:'',
  // 3B — NICN Complaint Form 1
  nicnComplaintContext:'', nicnComplaintDraft:'', nicnWitnessListContext:'', nicnWitnessListDraft:'',
  nicnWitnessStmtContext:'', nicnWitnessStmtDraft:'', nicnDocScheduleContext:'', nicnDocScheduleDraft:'',
  nicnDefMemoContext:'', nicnDefMemoDraft:'', nicnDefStmtContext:'', nicnDefStmtDraft:'',
  nicnDefWitnessContext:'', nicnDefWitnessDraft:'', nicnDefDocContext:'', nicnDefDocDraft:'',
  // 3B — NICN OS Form 2
  nicnOSDraftContext:'', nicnOSDraft:'', nicnOSAffidavitContext:'', nicnOSAffidavitDraft:'',
  nicnOSAddressContext:'', nicnOSAddressDraft:'', nicnOSCounterContext:'', nicnOSCounterDraft:'',
  nicnOSOppAddressContext:'', nicnOSOppAddressDraft:'',
  // 3B — NICN Judicial Review
  nicnJRMotionContext:'', nicnJRMotionDraft:'', nicnJRStmtContext:'', nicnJRStmtDraft:'',
  nicnJRAffidavitContext:'', nicnJRAffidavitDraft:'', nicnJRAddressContext:'', nicnJRAddressDraft:'',
  nicnJRCounterContext:'', nicnJRCounterDraft:'', nicnJROppAddressContext:'', nicnJROppAddressDraft:'',
  // 3B — NICN Appeal
  nicnAplNoticeContext:'', nicnAplNoticeDraft:'', nicnAplGroundsContext:'', nicnAplGroundsDraft:'',
  nicnAplBriefContext:'', nicnAplBriefDraft:'', nicnRespBriefContext:'', nicnRespBriefDraft:'',
  // 3C — Customary Court
  custSummonsContext:'', custSummonsDraft:'', custComplaintContext:'', custComplaintDraft:'',
  custWrapperContext:'', custWrapperDraft:'', custDefAppearanceContext:'', custDefAppearanceDraft:'',
  custDefStmtContext:'', custDefStmtDraft:'',
  // 3C — Magistrate Court Track A
  magAPraecipeContext:'', magAPraecipeDraft:'', magAParticularsContext:'', magAParticularsDraft:'',
  magAPlaintNoteContext:'', magAPlaintNoteDraft:'', magAWitnessContext:'', magAWitnessDraft:'',
  magADefAppearanceContext:'', magADefAppearanceDraft:'', magADefCounterContext:'', magADefCounterDraft:'',
  // 3C — Magistrate Court Track B
  magBPraecipeContext:'', magBPraecipeDraft:'', magBParticularsContext:'', magBParticularsDraft:'',
  magBPlaintNoteContext:'', magBPlaintNoteDraft:'', magBDefIntentContext:'', magBDefIntentDraft:'',
  magBDefAffidavitContext:'', magBDefAffidavitDraft:'',
  // 3C — Small Claims Court
  scaDemandContext:'', scaDemandDraft:'', scaClaimFormContext:'', scaClaimFormDraft:'',
  scaDefResponseContext:'', scaDefResponseDraft:'',
  // 3D — Election Petitions Tribunal
  eptPetitionContext:'', eptPetitionDraft:'', eptGroundsContext:'', eptGroundsDraft:'',
  eptWitnessListContext:'', eptWitnessListDraft:'', eptDepositionsContext:'', eptDepositionsDraft:'',
  eptDocScheduleContext:'', eptDocScheduleDraft:'', eptAddressContext:'', eptAddressDraft:'',
  eptRespReplyContext:'', eptRespReplyDraft:'', eptRespWitnessContext:'', eptRespWitnessDraft:'',
  eptRespDocContext:'', eptRespDocDraft:'', eptRespAddressContext:'', eptRespAddressDraft:'',
  // 3D — Tax Appeal Tribunal
  tatNoticeContext:'', tatNoticeDraft:'', tatGroundsContext:'', tatGroundsDraft:'',
  tatStmtFactsContext:'', tatStmtFactsDraft:'', tatDocListContext:'', tatDocListDraft:'',
  tatSubmissionContext:'', tatSubmissionDraft:'', tatRespStmtContext:'', tatRespStmtDraft:'',
  tatRespDocContext:'', tatRespDocDraft:'', tatRespSubmissionContext:'', tatRespSubmissionDraft:'',
  // 3D — IST
  istApplicationContext:'', istApplicationDraft:'', istStmtFactsContext:'', istStmtFactsDraft:'',
  istWitnessListContext:'', istWitnessListDraft:'', istWitnessStmtContext:'', istWitnessStmtDraft:'',
  istDocScheduleContext:'', istDocScheduleDraft:'', istAddressContext:'', istAddressDraft:'',
  istRespStmtContext:'', istRespStmtDraft:'', istRespWitnessContext:'', istRespWitnessDraft:'',
  istRespDocContext:'', istRespDocDraft:'', istRespAddressContext:'', istRespAddressDraft:'',
  // 3E — Arbitral Panel (AMA)
  arbNoticeContext:'', arbNoticeDraft:'', arbClaimContext:'', arbClaimDraft:'',
  arbDefenceContext:'', arbDefenceDraft:'', arbClaimantAddressContext:'', arbClaimantAddressDraft:'',
  arbRespondentAddressContext:'', arbRespondentAddressDraft:'',
  // 4A — Matrimonial Petition (MCR)
  matPetitionContext:'', matPetitionDraft:'', matComplianceCertContext:'', matComplianceCertDraft:'',
  matVerifyingAffContext:'', matVerifyingAffDraft:'', matNonCollusionContext:'', matNonCollusionDraft:'',
  matS30MotionContext:'', matS30MotionDraft:'', matCoRespNoticeContext:'', matCoRespNoticeDraft:'',
  matForm10Context:'', matForm10Draft:'', matAnswerContext:'', matAnswerDraft:'',
  matCondPleasContext:'', matCondPleaDraft:'', matS30ObjContext:'', matS30ObjDraft:'',
  matCrossPetitionContext:'', matCrossPetitionDraft:'',
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

function ChecklistBanner({items,accent}:{items:{label:string;done:boolean}[];accent:string}) {
  return (
    <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:22}}>
      {items.map(item=>(
        <span key={item.label} style={{fontSize:11,padding:'4px 10px',borderRadius:4,fontFamily:"'Times New Roman', Times, serif",background:item.done?'#0a180a':'#f8f8f8',border:`1px solid ${item.done?'#40a87850':'#cccccc'}`,color:item.done?'#40a878':T.mute}}>
          {item.done?'✓':'○'} {item.label}
        </span>
      ))}
    </div>
  );
}

function AIDrafter({title,description,contextLabel,contextPlaceholder,draftKey,contextKey,data,onSave,accent,ai,systemCtx,prompt,maxTokens=2000,warning}:{
  title:string;description:string;contextLabel:string;contextPlaceholder:string;
  draftKey:keyof SavedData;contextKey:keyof SavedData;
  data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;
  ai:ReturnType<typeof useAI>;systemCtx:string;
  prompt:(context:string,aCase:any,labels:{partyA:string;partyB:string})=>string;
  maxTokens?:number;warning?:string;
}) {
  const [context,setContext]=useState((data[contextKey]??'') as string);
  const [draft,setDraft]=useState((data[draftKey]??'') as string);
  const {ask,loading,error}=ai;
  const aCaseForGate=(window as any).__afsActiveCase;
  const hasIntel=!!buildIntelligenceBlock(aCaseForGate);
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const labels=getPartyLabels(aCase);
    const p=prompt(context,aCase,labels);
    const result=await ask({system:systemCtx,userMsg:p,maxTokens});
    if(result){setDraft(result);onSave({[contextKey]:context,[draftKey]:result} as Partial<SavedData>);}
  },[context,prompt,ask,onSave,systemCtx,maxTokens,contextKey,draftKey]);
  return (
    <div>
      <SectionTitle text={title} accent={accent}/>
      <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",marginBottom:18,lineHeight:1.6}}>{description}</p>
      {warning&&<div style={{marginBottom:14,background:`${accent}08`,border:`1px solid ${accent}20`,borderRadius:7,padding:'12px 16px'}}><p style={{fontSize:12,color:accent,fontFamily:"'Times New Roman', Times, serif",margin:0,lineHeight:1.6}}>{warning}</p></div>}
      <div style={{marginBottom:16}}><Label text={contextLabel}/><Textarea value={context} onChange={setContext} rows={8} placeholder={hasIntel?'Add any facts not captured by the Intelligence Engine above.':contextPlaceholder}/></div>
      <Btn label={`Draft ${title}`} onClick={run} loading={loading} accent={accent} off={!context.trim()&&!hasIntel}/>
      {error&&<ErrorBlock message={error}/>}
      {draft&&<ResultBlock title={`${title} — Draft`} content={draft} onClear={()=>{setDraft('');onSave({[draftKey]:''} as Partial<SavedData>);}} accent={accent}/>}
    </div>
  );
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
  const aCaseForGate=(window as any).__afsActiveCase;
  const hasIntel=!!buildIntelligenceBlock(aCaseForGate);
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const caseName=aCase?.caseName??'';
    const court=aCase?.court??'High Court';
    const {partyA,partyB}=getPartyLabels(aCase);
    const intelBlock=buildIntelligenceBlock(aCase);
    const instructions=withIntelligence(intelBlock,context);
    const structureMap:Record<string,string>={
      writ_of_summons:`1. Header: In the [Court] holden at [City] — Suit No: [to be assigned]\n2. Parties: BETWEEN [${partyA.toUpperCase()} NAME] — ${partyA} AND [${partyB.toUpperCase()} NAME] — ${partyB}\n3. WRIT OF SUMMONS preamble ordering defendant to enter appearance\n4. ENDORSEMENT OF CLAIM: numbered paragraphs stating claim, cause of action, reliefs\n5. Endorsement of amount claimed (if monetary)\n6. Issued at [Registry] — Registrar signature block\n7. Solicitor's endorsement`,
      originating_summons:`1. Header — Suit No: [to be assigned]\n2. In the matter of: [subject/statute]\n3. Parties: [Applicant] — Applicant / [Respondent] — Respondent\n4. Let [Respondent] attend before the Court…\n5. QUESTIONS FOR DETERMINATION: numbered legal questions\n6. RELIEFS SOUGHT: numbered list\n7. GROUNDS: statutory/legal basis\n8. Affidavit in support reference\n9. Solicitor's endorsement`,
      originating_motion:`1. Header — Suit No: [to be assigned]\n2. Parties or ex parte\n3. NOTICE OF MOTION — statutory basis\n4. Application paragraph\n5. Orders/declarations sought: numbered\n6. Grounds: numbered\n7. Documents relied on\n8. Solicitor's endorsement`,
      petition:`1. Header — Petition No: [to be assigned]\n2. In the matter of: [subject]\n3. Petitioner and Respondent\n4. PETITION: jurisdication, background, grounds with particulars\n5. Prayers: numbered reliefs\n6. Verifying affidavit reference\n7. Solicitor's endorsement`,
    };
    const prompt=`You are acting as Nigerian civil litigation counsel for the ${partyA} side.\n\nMatter: ${caseName}\nCourt: ${court}\nOriginating Process: ${selected?.label??processType}\n\nCounsel instructions:\n${instructions}\n\nDraft a complete ${selected?.label??processType} in correct Nigerian form.\n\nSTRUCTURE:\n${structureMap[processType]??'Use the correct Nigerian form for the court specified.'}\n\nRequirements:\n- Use correct court heading\n- Suit number placeholder [to be assigned]\n- Formal Nigerian court language\n- Every relief specifically stated\n- Counsel endorsement block\n- Flag missing particulars with [COUNSEL TO SUPPLY: description]\n\nReturn the complete draft only.`;
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
            <Textarea value={context} onChange={setContext} rows={8} placeholder={hasIntel?'Add any facts not captured by the Intelligence Engine above.':"Set out: full names/descriptions of all parties, court and division, cause of action, every relief sought (numbered), relevant statute or rule, amounts, pre-action notices complied with."}/>
          </div>
          <Btn label={`Draft ${selected?.label??'Originating Process'}`} onClick={run} loading={loading} accent={accent} off={!context.trim()&&!hasIntel}/>
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
  const aCaseForGate=(window as any).__afsActiveCase;
  const hasIntel=!!buildIntelligenceBlock(aCaseForGate);
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const caseName=aCase?.caseName??'';
    const court=aCase?.court??'High Court';
    const intelBlock=buildIntelligenceBlock(aCase);
    const factsSection=withIntelligence(intelBlock,context);
    const origProcess=(data.origProcessDraft??'').substring(0,1000);
    const {partyA}=getPartyLabels(aCase);
    const prompt=`You are acting as Nigerian civil litigation counsel for the ${partyA} side.\n\nMatter: ${caseName}\nCourt: ${court}\nWitness: ${witnessName} (${witnessRole||`witness for the ${partyA}`})\n\nOriginating Process already drafted:\n${origProcess||'Not yet drafted.'}\n\nWitness-specific facts:\n${factsSection}\n\nDraft a complete Witness Statement on Oath in Nigerian High Court format.\n\nSTRUCTURE:\n1. Heading: IN THE [COURT] HOLDEN AT [CITY] — Suit No / parties\n2. WITNESS STATEMENT ON OATH OF [FULL NAME]\n3. Deponent introduction: "I, [FULL NAME], of [address], do hereby make oath and state as follows:"\n4. Personal details paragraph\n5. Substantive testimony — numbered paragraphs:\n   - ONE factual point per paragraph\n   - First person throughout\n   - Reference exhibits as Exhibit "A", "B"…\n   - Distinguish direct knowledge from information/belief\n   - Cover all material facts for each head of claim\n6. List of exhibits\n7. Deponent's closing affirmation\n8. Signature block\n9. Jurat: SWORN to at [City] this [day] day of [month], [year] / Before me: ___ / Commissioner for Oaths\n\nReturn complete draft only.`;
    const result=await ask({system:systemCtx,userMsg:prompt,maxTokens:2500});
    if(result){setDraft(result);onSave({witnessName,witnessRole,witnessContext:context,witnessStatDraft:result});}
  },[witnessName,witnessRole,context,ask,onSave]);

  return (
    <div>
      <SectionTitle text="Witness Statement on Oath" accent={accent}/>
      <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",marginBottom:18,lineHeight:1.6}}>Draft a complete sworn witness statement. The AI draws from the Intelligence Engine output and the facts you provide.</p>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
        <div><Label text="Witness Full Name"/><Input value={witnessName} onChange={setWitnessName} placeholder="e.g. Chukwuemeka Obi"/></div>
        <div><Label text="Witness Role / Capacity"/><Input value={witnessRole} onChange={setWitnessRole} placeholder="e.g. 1st Claimant, Managing Director"/></div>
      </div>
      <div style={{marginBottom:16}}>
        <Label text="Facts to Be Covered in the Statement"/>
        <Textarea value={context} onChange={setContext} rows={8} placeholder={hasIntel?'Add any facts not captured by the Intelligence Engine above.':"Key facts: what the witness saw/did/heard, documents in their possession (list them — they become exhibits), transactions they were party to, what they can say about each head of claim."}/>
      </div>
      <div style={{marginBottom:20,background:'#08080e',border:`1px solid ${accent}15`,borderRadius:6,padding:'10px 14px'}}>
        <p style={{fontSize:11,color:T.mute,fontFamily:"'Times New Roman', Times, serif",margin:0,lineHeight:1.6}}>⚖ This statement must be sworn before a Commissioner for Oaths before filing. Confirm all averments with the deponent before swearing.</p>
      </div>
      <Btn label="Draft Witness Statement on Oath" onClick={run} loading={loading} accent={accent} off={!witnessName.trim()||(!context.trim()&&!hasIntel)}/>
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
  const aCaseForGate=(window as any).__afsActiveCase;
  const hasIntel=!!buildIntelligenceBlock(aCaseForGate);
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const {partyA,partyB}=getPartyLabels(aCase);
    const suitNo=aCase?.suitNo??'[Suit No — to be assigned]';
    const intelBlock=buildIntelligenceBlock(aCase);
    const intPkg=(aCase?.intelligence_data?.intPkg??'').substring(0,3000);
    const origProcess=(data.origProcessDraft??'').substring(0,1000);
    const factsSection=intelBlock?`INTELLIGENCE ENGINE OUTPUT (vetted facts — do not contradict):\n${intelBlock}\n\nAdditional facts from counsel (supplemental):\n${context||'(none — relying on Intelligence Engine output above)'}`:`Intelligence Package:\n${intPkg||'Not available — use the context below.'}\n\nCounsel context:\n${context}`;
    const prompt=`You are acting as Nigerian civil litigation counsel for the ${partyA} side.\n\nMatter: ${aCase?.caseName??''}\nSuit No: ${suitNo}\nParties: ${partyA} v ${partyB}\n\nOriginating Process already drafted:\n${origProcess||'Not yet drafted.'}\n\n${factsSection}\n\nDraft a complete Statement of Claim in Nigerian High Court format:\n1. Opening paragraph identifying parties and court\n2. Facts in numbered paragraphs (material facts only, not evidence)\n3. Legal basis / cause of action\n4. Wherefore clause listing all reliefs\n\nNigerian pleading rules: plead material facts not evidence; every relief specifically pleaded; damages particularised; formal language; numbered paragraphs.\nLabel claimant as "${partyA}" and defendant as "${partyB}".\n\nReturn full draft Statement of Claim.`;
    const result=await ask({system:systemCtx,userMsg:prompt,maxTokens:2000});
    if(result){setDraft(result);onSave({socContext:context,socDraft:result});}
  },[context,ask,onSave]);
  return (
    <div>
      <SectionTitle text="Statement of Claim Drafter" accent={accent}/>
      <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",marginBottom:18,lineHeight:1.6}}>Provide the material facts, parties, cause of action, and reliefs sought. The AI drafts a complete Statement of Claim in Nigerian High Court format.</p>
      <div style={{marginBottom:16}}><Label text="Case Facts, Parties & Reliefs Sought"/><Textarea value={context} onChange={setContext} rows={8} placeholder={hasIntel?'Add any facts not captured by the Intelligence Engine above.':'Set out the material facts: who the parties are, what happened, the cause of action, and every relief you are seeking. Include relevant dates and amounts.'}/></div>
      <Btn label="Draft Statement of Claim" onClick={run} loading={loading} accent={accent} off={!context.trim()&&!hasIntel}/>
      {error&&<ErrorBlock message={error}/>}
      {draft&&<ResultBlock title="Statement of Claim — Draft" content={draft} onClear={()=>{setDraft('');onSave({socDraft:''}); }} accent={accent}/>}
    </div>
  );
}
// ─── SOD MONITOR ─────────────────────────────────────────────────────────────
function SoDMonitor({data,onSave,accent,ai,systemCtx,serviceDate,onServiceDateChange,sodFiled,onSodFiledChange}:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string;serviceDate:string;onServiceDateChange:(v:string)=>void;sodFiled:boolean;onSodFiledChange:(v:boolean)=>void}) {
  const [sodReceivedDate,setSodReceivedDate]=useState(data.sodReceivedDate??'');
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
        <div><Label text="Date of Service on Defendant"/><Input type="date" value={serviceDate} onChange={v=>{onServiceDateChange(v);save({serviceDate:v});}}/></div>
        <div><Label text="Date SoD Received (if filed)"/><Input type="date" value={sodReceivedDate} onChange={v=>{setSodReceivedDate(v);save({sodReceivedDate:v});}}/></div>
      </div>
      <div style={{marginBottom:20}}>
        <label style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer'}}>
          <input type="checkbox" checked={sodFiled} onChange={e=>{onSodFiledChange(e.target.checked);save({sodFiled:e.target.checked});}} style={{width:16,height:16,cursor:'pointer',accentColor:accent}}/>
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
  const aCaseForGate=(window as any).__afsActiveCase;
  const hasIntel=!!buildIntelligenceBlock(aCaseForGate);
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const {partyA,partyB}=getPartyLabels(aCase);
    const suitNo=aCase?.suitNo??'[Suit No — to be assigned]';
    const intelBlock=buildIntelligenceBlock(aCase);
    const facts=withIntelligence(intelBlock,context);
    const prompt=`You are Nigerian civil litigation counsel for the ${partyA} side (respondent to the counterclaim).\n\nMatter: ${aCase?.caseName??''}\nSuit No: ${suitNo}\nParties: ${partyA} v ${partyB}\n\nCounterclaim details:\n${facts}\n\nDraft a complete Defence to Counterclaim:\n1. Traverse (deny) each counterclaim allegation not admitted\n2. Raise affirmative defences\n3. Specifically admit facts that are admitted\n4. Plead any set-off or abatement if applicable\n5. Wherefore — dismiss counterclaim with costs\n\nLabel "${partyA}" / "${partyB}". Nigerian pleading rules. Number every paragraph.`;
    const result=await ask({system:systemCtx,userMsg:prompt,maxTokens:1500});
    if(result){setDraft(result);onSave({dtccContext:context,dtccDraft:result});}
  },[context,ask,onSave]);
  return (
    <div>
      <SectionTitle text="Defence to Counterclaim Drafter" accent={accent}/>
      <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",marginBottom:18,lineHeight:1.6}}>Summarise the counterclaim allegations and available defences. The AI drafts a Defence to Counterclaim in Nigerian High Court format.</p>
      <div style={{marginBottom:16}}><Label text="Counterclaim Allegations & Available Defences"/><Textarea value={context} onChange={setContext} rows={7} placeholder={hasIntel?'Add any facts not captured by the Intelligence Engine above.':"Set out what the defendant claims in the counterclaim, the reliefs they seek, and grounds on which the counterclaim should be resisted."}/></div>
      <Btn label="Draft Defence to Counterclaim" onClick={run} loading={loading} accent={accent} off={!context.trim()&&!hasIntel}/>
      {error&&<ErrorBlock message={error}/>}
      {draft&&<ResultBlock title="Defence to Counterclaim — Draft" content={draft} onClear={()=>{setDraft('');onSave({dtccDraft:''});}} accent={accent}/>}
    </div>
  );
}

// ─── DEFAULT FLAG ────────────────────────────────────────────────────────────
function DefaultFlag({data,onSave,accent,ai,systemCtx,serviceDate,onServiceDateChange,sodFiled,onSodFiledChange}:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string;serviceDate:string;onServiceDateChange:(v:string)=>void;sodFiled:boolean;onSodFiledChange:(v:boolean)=>void}) {
  const [court,setCourt]=useState('');
  const [draft,setDraft]=useState('');
  const {ask,loading,error}=ai;
  const days=daysSince(serviceDate);
  const defaultAvailable=!sodFiled&&days!==null&&days>=30;
  const draftMotion=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const {partyA,partyB}=getPartyLabels(aCase);
    const suitNo=aCase?.suitNo??'[Suit No — to be assigned]';
    const intelBlock=buildIntelligenceBlock(aCase);
    const factsSection=intelBlock?`\n\nINTELLIGENCE ENGINE OUTPUT (vetted facts — do not contradict):\n${intelBlock}`:'';
    const prompt=`You are Nigerian civil litigation counsel for the ${partyA}.\n\nCourt: ${court||'High Court'}\nSuit No: ${suitNo}\nService date: ${serviceDate}\nDays since service: ${days}\nSoD filed: ${sodFiled?'Yes':'No'}\n${partyA} / ${partyB}${factsSection}\n\nDraft a complete Motion for Judgment in Default of Defence:\n1. Motion on Notice heading with parties and court\n2. Application paragraph citing relevant High Court Rules provision\n3. Supporting affidavit structure (deponent, facts, exhibits required)\n4. List of proposed exhibits (proof of service, SoC copy, etc.)\n5. Relief(s) sought\n6. Certificate of service\n\nApply relevant Nigerian High Court Civil Procedure Rules for default judgment in default of defence.`;
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
        <div><Label text="Date of Service"/><Input type="date" value={serviceDate} onChange={v=>{onServiceDateChange(v);onSave({serviceDate:v});}}/></div>
        <div><Label text="Court"/><Input value={court} onChange={setCourt} placeholder="e.g. High Court of Lagos State"/></div>
      </div>
      <div style={{marginBottom:20}}>
        <label style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer'}}>
          <input type="checkbox" checked={sodFiled} onChange={e=>{onSodFiledChange(e.target.checked);onSave({sodFiled:e.target.checked});}} style={{width:16,height:16,cursor:'pointer',accentColor:accent}}/>
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
  const aCaseForGate=(window as any).__afsActiveCase;
  const hasIntel=!!buildIntelligenceBlock(aCaseForGate);
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const {partyA,partyB}=getPartyLabels(aCase);
    const suitNo=aCase?.suitNo??'[Suit No — to be assigned]';
    const intelBlock=buildIntelligenceBlock(aCase);
    const factsSection=withIntelligence(intelBlock,context);
    const ccInstruction=ccIntel?.flag
      ?`4. Counterclaim — INCLUDE: Intelligence Engine identified viable counterclaim. Draft full Counterclaim section:\n   a. Counterclaim heading\n   b. Material facts (numbered)\n   c. Cause of action\n   d. Reliefs claimed by ${partyB}-counterclaimant\n   Intelligence: ${ccIntel.summary??'Independent cause of action arising from the same transaction.'}`
      :`4. Counterclaim (if applicable — draft if facts warrant cross-relief)`;
    const prompt=`You are Nigerian civil litigation counsel for the ${partyB} side.\n\nMatter: ${aCase?.caseName??''}\nSuit No: ${suitNo}\nParties: ${partyA} v ${partyB}\n\nDefence context:\n${factsSection}\n\nDraft a complete Statement of Defence:\n1. Opening paragraph\n2. Traverse each SoC paragraph (admit / deny / not admitted)\n3. Affirmative defences in numbered paragraphs\n${ccInstruction}\n5. Wherefore — dismiss with costs${ccIntel?.flag?'; judgment on counterclaim':''}\n\nLabel "${partyA}" / "${partyB}". Nigerian pleading rules. Number every paragraph.`;
    const result=await ask({system:systemCtx,userMsg:prompt,maxTokens:ccIntel?.flag?2800:2000});
    if(result){setDraft(result);onSave({sodContext:context,sodDraft:result});}
  },[context,ccIntel,ask,onSave]);
  return (
    <div>
      <SectionTitle text="Statement of Defence Drafter" accent={accent}/>
      <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",marginBottom:18,lineHeight:1.6}}>Provide the claimant's allegations, available defences, admissions, and whether a counterclaim is warranted.</p>
      <div style={{marginBottom:16}}><Label text="Claimant's Allegations, Available Defences & Admissions"/><Textarea value={context} onChange={setContext} rows={8} placeholder={hasIntel?'Add any facts not captured by the Intelligence Engine above.':"Summarise the SoC allegations paragraph by paragraph, what is admitted, what is denied, and what affirmative defences apply."}/></div>
      <Btn label="Draft Statement of Defence" onClick={run} loading={loading} accent={accent} off={!context.trim()&&!hasIntel}/>
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
  const aCaseForGate=(window as any).__afsActiveCase;
  const hasIntel=!!buildIntelligenceBlock(aCaseForGate)||!!ccIntel?.flag;
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const {partyA,partyB}=getPartyLabels(aCase);
    const suitNo=aCase?.suitNo??'[Suit No — to be assigned]';
    const intelBlock=buildIntelligenceBlock(aCase);
    const intPrefix=ccIntel?.flag&&ccIntel.summary?`INTELLIGENCE NOTE: "${ccIntel.summary}". Use as foundation.\n\n`:'';
    const facts=withIntelligence(intelBlock,context);
    const prompt=`You are Nigerian civil litigation counsel for the ${partyB}.\n\nMatter: ${aCase?.caseName??''}\nSuit No: ${suitNo}\nParties: ${partyA} v ${partyB}\n\n${intPrefix}Counterclaim facts:\n${facts}\n\nDraft complete Counterclaim for inclusion in Statement of Defence:\n1. Counterclaim heading\n2. Material facts (numbered)\n3. Cause of action\n4. Reliefs claimed — numbered, specific amounts/orders\n5. Wherefore the ${partyB}-counterclaimant claims [reliefs]\n\nLabel "${partyA}" / "${partyB}". Nigerian pleading rules. Part of Statement of Defence.`;
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
      <div style={{marginBottom:16}}><Label text="Counterclaim Facts & Reliefs Sought"/><Textarea value={context} onChange={setContext} rows={7} placeholder={hasIntel?'Add any facts not captured by the Intelligence Engine above.':"Describe: defendant's cause of action against the claimant, material facts, and specific reliefs to be claimed (damages, declarations, injunctions, etc.)."}/></div>
      <Btn label="Draft Counterclaim" onClick={run} loading={loading} accent={accent} off={!context.trim()&&!hasIntel}/>
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
  const aCaseForGate=(window as any).__afsActiveCase;
  const hasIntel=!!buildIntelligenceBlock(aCaseForGate);
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const {partyA,partyB}=getPartyLabels(aCase);
    const suitNo=aCase?.suitNo??'[Suit No — to be assigned]';
    const intelBlock=buildIntelligenceBlock(aCase);
    const facts=withIntelligence(intelBlock,context);
    const prompt=`You are Nigerian civil litigation counsel for the ${partyB}.\n\nMatter: ${aCase?.caseName??''}\nSuit No: ${suitNo}\nParties: ${partyA} v ${partyB}\n\nGrounds and case details:\n${facts}\n\nAnalyse preliminary objection grounds and draft:\n\nAssess each ground:\n1. Jurisdiction — subject matter or parties\n2. Competence of originating process\n3. Limitation — expired under Limitation Law\n4. Locus standi — does ${partyA} have standing\n5. Non-disclosure of cause of action\n6. Failure of pre-conditions — statutory notices\n7. Improper parties — misjoinder/non-joinder\n\nDraft:\nA. Notice of Preliminary Objection\nB. Points of Argument on each valid ground with Nigerian authorities\nC. Relief sought — suit struck out/dismissed with costs\n\nLabel "${partyA}" / "${partyB}". Apply Nigerian High Court Rules.`;
    const result=await ask({system:systemCtx,userMsg:prompt,maxTokens:2000});
    if(result){setDraft(result);onSave({objectionContext:context,objectionDraft:result});}
  },[context,ask,onSave]);
  return (
    <div>
      <SectionTitle text="Preliminary Objection Grounds & Draft" accent={accent}/>
      <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",marginBottom:18,lineHeight:1.6}}>Describe the case and suspected procedural defects. The AI will assess all objection grounds and draft the Notice and Points of Argument.</p>
      <div style={{marginBottom:16}}><Label text="Case Facts, Originating Process Details & Suspected Defects"/><Textarea value={context} onChange={setContext} rows={7} placeholder={hasIntel?'Add any facts not captured by the Intelligence Engine above.':"Describe: claimant's cause of action, originating process used, court seized, relevant dates (when cause arose, when writ filed), and any apparent procedural irregularities."}/></div>
      <Btn label="Analyse Grounds & Draft Objection" onClick={run} loading={loading} accent={accent} off={!context.trim()&&!hasIntel}/>
      {error&&<ErrorBlock message={error}/>}
      {draft&&<ResultBlock title="Preliminary Objection — Grounds & Draft" content={draft} onClear={()=>{setDraft('');onSave({objectionDraft:''});}} accent={accent}/>}
    </div>
  );
}


// ─── REPLY TO SOD DRAFTER ────────────────────────────────────────────────────
function ReplyToSoDDrafter({data,onSave,accent,ai,systemCtx}:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const [context,setContext]=useState(data.replyToSodContext??'');
  const [draft,setDraft]=useState(data.replyToSodDraft??'');
  const {ask,loading,error}=ai;
  const aCaseForGate=(window as any).__afsActiveCase;
  const hasIntel=!!buildIntelligenceBlock(aCaseForGate);
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const {partyA,partyB}=getPartyLabels(aCase);
    const suitNo=aCase?.suitNo??'[Suit No — to be assigned]';
    const sodDraft=data.sodDraft??'';
    const intelBlock=buildIntelligenceBlock(aCase);
    const manualSection=intelBlock?`INTELLIGENCE ENGINE OUTPUT (vetted facts — do not contradict):\n${intelBlock}\n\nCounsel context — new affirmative matters raised in SoD (supplemental):\n${context||'(none — relying on Intelligence Engine output above)'}`:`Counsel context — new affirmative matters raised in SoD:\n${context}`;
    const prompt=`You are Nigerian civil litigation counsel for the ${partyA} (Claimant/Plaintiff).\n\nMatter: ${aCase?.caseName??''}\nSuit No: ${suitNo}\nParties: ${partyA} v ${partyB}\n\nStatement of Defence already filed (for context):\n${sodDraft?sodDraft.substring(0,2500):'[Not yet drafted — use counsel context below]'}\n\n${manualSection}\n\nDraft a complete Reply to Statement of Defence in Nigerian High Court format.\n\nNIGERIAN PLEADING RULES FOR A REPLY:\n- A Reply is confined to new affirmative matters raised in the SoD that were not addressed in the SoC.\n- Do NOT re-traverse denials or general traverses already covered by the SoC.\n- Address each new affirmative defence (e.g. estoppel, limitation, accord and satisfaction, release, set-off, illegality, contributory negligence, volenti non fit injuria) raised by ${partyB} in turn.\n- Admit what cannot be disputed; specifically deny what is disputed; plead any confession and avoidance.\n- If no new affirmative matter is raised, state that the Reply is unnecessary — but where the SoD introduces any positive defence not answered by the SoC, a Reply is obligatory.\n- Follow the standard numbered paragraph format of Nigerian High Court pleadings.\n\nSTRUCTURE:\n1. Heading: IN THE [COURT] HOLDEN AT [CITY]\n   Suit No: ${suitNo}\n   BETWEEN: ${partyA.toUpperCase()} — Claimant/Plaintiff AND ${partyB.toUpperCase()} — Defendant\n2. REPLY TO STATEMENT OF DEFENCE\n3. "The Claimant/Plaintiff, by way of Reply to the Statement of Defence of the Defendant, states as follows:"\n4. Numbered paragraphs — for each affirmative matter in the SoD:\n   (a) Identify the SoD paragraph raising the affirmative matter\n   (b) Admit, deny, or confess and avoid\n   (c) Plead any additional facts that answer the affirmative defence\n5. Closing: "Save as hereinbefore admitted, the Claimant denies each and every allegation in the Statement of Defence as if the same were set out herein and specifically traversed."\n6. Solicitor's endorsement: Drawn and filed by [Counsel], [Firm], [Address], [Date]\n\nFlag [COUNSEL TO SUPPLY] where needed. Return complete Reply to Statement of Defence only.`;
    const result=await ask({system:systemCtx,userMsg:prompt,maxTokens:2000});
    if(result){setDraft(result);onSave({replyToSodContext:context,replyToSodDraft:result});}
  },[context,data.sodDraft,ask,onSave]);
  return (
    <div>
      <SectionTitle text="Reply to Statement of Defence" accent={accent}/>
      <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",marginBottom:18,lineHeight:1.6}}>A Reply addresses only new affirmative matters raised in the SoD — estoppel, limitation, accord and satisfaction, release, set-off, and similar positive defences. If the SoD has been drafted in this session, it will inform the Reply automatically.</p>
      {data.sodDraft&&<div style={{marginBottom:14,background:'#0a180a',border:'1px solid #40a87830',borderRadius:7,padding:'10px 14px'}}><p style={{fontSize:11,color:'#40a878',fontFamily:"'Times New Roman', Times, serif",margin:0}}>✓ Statement of Defence draft detected — Reply will traverse only the new affirmative matters raised therein.</p></div>}
      <div style={{marginBottom:14,background:'#0e0e1a',border:'1px solid #4050a030',borderRadius:7,padding:'10px 14px'}}>
        <p style={{fontSize:11,color:'#8090c0',fontFamily:"'Times New Roman', Times, serif",margin:0,lineHeight:1.6}}>⚖ <strong>Scope rule:</strong> A Reply must not repeat or re-open the SoC. It is confined to new affirmative defences introduced in the SoD. General traverses in the SoD do not require a Reply.</p>
      </div>
      <div style={{marginBottom:16}}><Label text="New Affirmative Matters Raised in the SoD"/><Textarea value={context} onChange={setContext} rows={8} placeholder={hasIntel?'Add any facts not captured by the Intelligence Engine above.':"List the new affirmative defences or positive matters raised in the SoD that were not addressed in the SoC — e.g. 'Defendant pleads limitation under s.8 Limitation Law', 'Defendant pleads accord and satisfaction — payment of ₦X on [date]', 'Defendant pleads promissory estoppel based on [representation]'. Include any facts needed to rebut them."}/></div>
      <Btn label="Draft Reply to Statement of Defence" onClick={run} loading={loading} accent={accent} off={!context.trim()&&!data.sodDraft&&!hasIntel}/>
      {error&&<ErrorBlock message={error}/>}
      {draft&&<ResultBlock title="Reply to Statement of Defence — Draft" content={draft} onClear={()=>{setDraft('');onSave({replyToSodDraft:''}); }} accent={accent}/>}
    </div>
  );
}
// ─── REPLY MONITOR ───────────────────────────────────────────────────────────
function ReplyMonitor({data,onSave,accent}:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string}) {
  const [replyReceived,setReplyReceived]=useState(data.replyReceived??false);
  const [replyDate,setReplyDate]=useState(data.replyDate??'');
  const [pleadingItems,setPleadingItems]=useState<PleadingItem[]>(data.defPleadingItems??[]);
  const save=(patch:Partial<SavedData>)=>onSave({replyReceived,replyDate,defPleadingItems:pleadingItems,...patch});
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
        <PleadingTracker items={pleadingItems} onUpdate={items=>{setPleadingItems(items);save({defPleadingItems:items});}} accent={accent}/>
        <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",margin:0,lineHeight:1.7}}>Under Nigerian High Court Rules, pleadings close after the Statement of Defence (or Reply if filed). Once pleadings are closed, the matter proceeds to the Case Management Conference (CMC).</p>
      </div>
    </div>
  );
}
// ─── WRIT TRACK SUB-TABS WRAPPER ─────────────────────────────────────────────
function WritSubTabs({isClaim,claimTabs,defTabs,accent,sharedProps,ccIntel}:{isClaim:boolean;claimTabs:{id:string;label:string}[];defTabs:{id:string;label:string}[];accent:string;sharedProps:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string};ccIntel?:CounterclaimIntel}) {
  const tabs=isClaim?claimTabs:defTabs;
  const [activeTab,setActiveTab]=useState<SubTab>(isClaim?'originating_process':'sod_drafter');
  // Shared state lifted from SoDMonitor and DefaultFlag to prevent silent divergence
  const [serviceDate,setServiceDate]=useState(sharedProps.data.serviceDate??'');
  const [sodFiled,setSodFiled]=useState(sharedProps.data.sodFiled??false);
  const handleServiceDateChange=(v:string)=>{setServiceDate(v);sharedProps.onSave({serviceDate:v});};
  const handleSodFiledChange=(v:boolean)=>{setSodFiled(v);sharedProps.onSave({sodFiled:v});};
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
        {isClaim&&activeTab==='sod_monitor'&&<SoDMonitor {...sharedProps} serviceDate={serviceDate} onServiceDateChange={handleServiceDateChange} sodFiled={sodFiled} onSodFiledChange={handleSodFiledChange}/>}
        {isClaim&&activeTab==='counterclaim_response'&&<CounterclaimResponse {...sharedProps}/>}
        {isClaim&&activeTab==='default_flag'&&<DefaultFlag {...sharedProps} serviceDate={serviceDate} onServiceDateChange={handleServiceDateChange} sodFiled={sodFiled} onSodFiledChange={handleSodFiledChange}/>}
        {isClaim&&activeTab==='reply_to_sod'&&<ReplyToSoDDrafter {...sharedProps}/>}
        {!isClaim&&activeTab==='sod_drafter'&&<SoDDrafter {...sharedProps} ccIntel={ccIntel}/>}
        {!isClaim&&activeTab==='counterclaim_builder'&&<CounterclaimBuilder {...sharedProps} ccIntel={ccIntel}/>}
        {!isClaim&&activeTab==='preliminary_objection'&&<PreliminaryObjDrafter {...sharedProps}/>}
        {!isClaim&&activeTab==='reply_monitor'&&<ReplyMonitor data={sharedProps.data} onSave={sharedProps.onSave} accent={accent}/>}
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 3B — FEDERAL HIGH COURT: WINDING UP ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

function WUDemandNotice({data,onSave,accent,ai,systemCtx}:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const [context,setContext]=useState(data.wuDemandContext??'');
  const [draft,setDraft]=useState(data.wuDemandDraft??'');
  const {ask,loading,error}=ai;
  const aCaseForGate=(window as any).__afsActiveCase;
  const hasIntel=!!buildIntelligenceBlock(aCaseForGate);
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const {partyA}=getPartyLabels(aCase);
    const intelBlock=buildIntelligenceBlock(aCase);
    const instructions=withIntelligence(intelBlock,context);
    const prompt=`You are Nigerian insolvency counsel acting for ${partyA} (Petitioner/Creditor).\n\nMatter: ${aCase?.caseName??''}\n\nInstructions:\n${instructions}\n\nDraft a complete 21-Day Statutory Demand Notice under CAMA 2020 s.571-572 as pre-condition to winding-up petition on grounds of inability to pay debts.\n\nSTRUCTURE:\n1. [Petitioner letterhead / address]\n2. Date\n3. Addressee: Directors/Secretary of [Company] at [Registered Office]\n4. STATUTORY DEMAND NOTICE\n5. Body: (a) Debt basis and that company has neglected to pay (b) Debt particulars: amount, invoices, dates (c) Demand payment of ₦[amount] within 21 days of service (d) Warning: failure will result in winding-up petition in Federal High Court\n6. Signed: [Counsel/Creditor]\n\nLegal requirements: CAMA 2020 s.571(a) — debt exceeds ₦200,000; demand served at registered office; 3 weeks' neglect. State exact amounts. Flag [COUNSEL TO SUPPLY] for missing particulars.\n\nReturn complete Statutory Demand Notice only.`;
    const result=await ask({system:systemCtx,userMsg:prompt,maxTokens:1500});
    if(result){setDraft(result);onSave({wuDemandContext:context,wuDemandDraft:result});}
  },[context,ask,onSave,systemCtx]);
  return (
    <div>
      <SectionTitle text="21-Day Statutory Demand Notice" accent={accent}/>
      <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",marginBottom:18,lineHeight:1.6}}>Mandatory pre-condition under CAMA 2020 before presenting a winding-up petition on the ground of inability to pay debts. Must be served at the company's registered office. No petition may be filed until 21 days have elapsed.</p>
      <div style={{marginBottom:14,background:`${accent}08`,border:`1px solid ${accent}20`,borderRadius:7,padding:'12px 16px'}}>
        <p style={{fontSize:12,color:accent,fontFamily:"'Times New Roman', Times, serif",margin:0,lineHeight:1.6}}>⚠ <strong>Pre-filing:</strong> Serve at registered office. Retain proof of service (process server's affidavit). Attach as exhibit to Affidavit in Verification.</p>
      </div>
      <div style={{marginBottom:16}}><Label text="Creditor Details, Debt Particulars & Company Information"/><Textarea value={context} onChange={setContext} rows={8} placeholder={hasIntel?'Add any facts not captured by the Intelligence Engine above.':"Provide: creditor full name/address; company name and registered office; nature and amount of debt (invoice nos., dates, judgments); how debt arose; date payment fell due."}/></div>
      <Btn label="Draft Statutory Demand Notice" onClick={run} loading={loading} accent={accent} off={!context.trim()&&!hasIntel}/>
      {error&&<ErrorBlock message={error}/>}
      {draft&&<ResultBlock title="Statutory Demand Notice — Draft" content={draft} onClear={()=>{setDraft('');onSave({wuDemandDraft:''}); }} accent={accent}/>}
    </div>
  );
}

function WUPetition({data,onSave,accent,ai,systemCtx}:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const [context,setContext]=useState(data.wuPetitionContext??'');
  const [draft,setDraft]=useState(data.wuPetitionDraft??'');
  const {ask,loading,error}=ai;
  const aCaseForGate=(window as any).__afsActiveCase;
  const hasIntel=!!buildIntelligenceBlock(aCaseForGate);
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const {partyA,partyB}=getPartyLabels(aCase);
    const intelBlock=buildIntelligenceBlock(aCase);
    const instructions=withIntelligence(intelBlock,context);
    const prompt=`You are Nigerian insolvency counsel for ${partyA} (Petitioner).\n\nMatter: ${aCase?.caseName??''}\n\nInstructions:\n${instructions}\n\nDraft a complete Winding-Up Petition under CAMA 2020 for the Federal High Court.\n\nSTRUCTURE:\n1. IN THE FEDERAL HIGH COURT OF NIGERIA\n   HOLDEN AT [CITY] — PETITION NO: [to be assigned]\n   IN THE MATTER OF [COMPANY NAME] (RC No. [Registration Number])\n   AND IN THE MATTER OF THE COMPANIES AND ALLIED MATTERS ACT 2020\n   BETWEEN: [PETITIONER] — Petitioner AND [COMPANY] — Respondent\n\n2. WINDING-UP PETITION — The Petition of [Petitioner] shows:\n\n3. Numbered paragraphs:\n   (a) Petitioner identity and capacity\n   (b) Company incorporation, registered office, objects\n   (c) The debt: how it arose, amount, when due\n   (d) Statutory Demand Notice served on [date]; 21 days elapsed; neglect confirmed\n   (e) Company's failure to pay, secure, or compound\n   (f) Company unable to pay its debts\n\n4. GROUND(S): CAMA 2020 s.571(a) and/or other applicable grounds\n\n5. PRAYERS: (a) Company wound up by order of Court (b) Liquidator appointed (c) Costs (d) Further orders\n\n6. Verification reference (Affidavit in Verification to follow)\n7. Solicitor endorsement\n\nFlag [COUNSEL TO SUPPLY] for missing particulars. Return complete Petition only.`;
    const result=await ask({system:systemCtx,userMsg:prompt,maxTokens:2500});
    if(result){setDraft(result);onSave({wuPetitionContext:context,wuPetitionDraft:result});}
  },[context,ask,onSave,systemCtx]);
  return (
    <div>
      <SectionTitle text="Winding-Up Petition" accent={accent}/>
      <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",marginBottom:18,lineHeight:1.6}}>Draft the Winding-Up Petition for presentation at the Federal High Court under CAMA 2020. The 21-day demand period must have expired before filing.</p>
      <div style={{marginBottom:16}}><Label text="Petitioner, Company, Debt & Grounds"/><Textarea value={context} onChange={setContext} rows={9} placeholder={hasIntel?'Add any facts not captured by the Intelligence Engine above.':"Provide: petitioner name/address/capacity; company name, RC number, registered office; nature and amount of debt; demand date; company's response (or none); ground relied on (inability to pay, just and equitable, etc.)."}/></div>
      <Btn label="Draft Winding-Up Petition" onClick={run} loading={loading} accent={accent} off={!context.trim()&&!hasIntel}/>
      {error&&<ErrorBlock message={error}/>}
      {draft&&<ResultBlock title="Winding-Up Petition — Draft" content={draft} onClear={()=>{setDraft('');onSave({wuPetitionDraft:''}); }} accent={accent}/>}
    </div>
  );
}

function WUAffidavitVerification({data,onSave,accent,ai,systemCtx}:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const [context,setContext]=useState(data.wuAffirmContext??'');
  const [draft,setDraft]=useState(data.wuAffirmDraft??'');
  const {ask,loading,error}=ai;
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const {partyA}=getPartyLabels(aCase);
    const petition=data.wuPetitionDraft??'';
    const prompt=`You are Nigerian insolvency counsel for ${partyA} (Petitioner).\n\nMatter: ${aCase?.caseName??''}\n\nPetition drafted:\n${petition?petition.substring(0,2000):'[Use facts below]'}\n\nDeponent and exhibit details:\n${context}\n\nDraft a complete Affidavit in Verification of the Winding-Up Petition.\n\nSTRUCTURE:\n1. Heading: AFFIDAVIT IN VERIFICATION OF PETITION\n2. "I, [NAME], of [address], [occupation], make oath and state:"\n3. Capacity paragraph (director/authorised officer/creditor)\n4. Numbered paragraphs:\n   - Petition prepared by or under deponent's direction\n   - Facts in petition true to deponent's knowledge\n   - Exhibit statutory demand (Exhibit A)\n   - Exhibit proof of service (Exhibit B)\n   - Exhibit debt documents (Exhibits C, D…)\n   - Debt remains unpaid\n5. Closing and Jurat\n\nReturn complete Affidavit in Verification only.`;
    const result=await ask({system:systemCtx,userMsg:prompt,maxTokens:1800});
    if(result){setDraft(result);onSave({wuAffirmContext:context,wuAffirmDraft:result});}
  },[context,data.wuPetitionDraft,ask,onSave,systemCtx]);
  return (
    <div>
      <SectionTitle text="Affidavit in Verification" accent={accent}/>
      <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",marginBottom:18,lineHeight:1.6}}>Verifies the Petition and identifies exhibits (demand notice, proof of service, debt documents). Filed simultaneously with the Petition.</p>
      {data.wuPetitionDraft&&<div style={{marginBottom:14,background:'#0a180a',border:'1px solid #40a87830',borderRadius:7,padding:'10px 14px'}}><p style={{fontSize:11,color:'#40a878',fontFamily:"'Times New Roman', Times, serif",margin:0}}>✓ Petition draft detected — affidavit will verify its contents.</p></div>}
      <div style={{marginBottom:16}}><Label text="Deponent Details & Exhibit List"/><Textarea value={context} onChange={setContext} rows={7} placeholder="Provide: deponent's full name, address, occupation, capacity; list of exhibits: statutory demand, proof of service, invoices/agreements, judgment debt if applicable."/></div>
      <Btn label="Draft Affidavit in Verification" onClick={run} loading={loading} accent={accent} off={!context.trim()}/>
      {error&&<ErrorBlock message={error}/>}
      {draft&&<ResultBlock title="Affidavit in Verification — Draft" content={draft} onClear={()=>{setDraft('');onSave({wuAffirmDraft:''}); }} accent={accent}/>}
    </div>
  );
}

function WULiquidatorNotice({data,onSave,accent,ai,systemCtx}:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const [context,setContext]=useState(data.wuLiquidatorContext??'');
  const [draft,setDraft]=useState(data.wuLiquidatorDraft??'');
  const {ask,loading,error}=ai;
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const prompt=`You are Nigerian insolvency counsel.\n\nMatter: ${aCase?.caseName??''}\n\nProposed liquidator:\n${context}\n\nDraft a Notice of Proposed Liquidator for filing with the Winding-Up Petition.\n\nSTRUCTURE:\n1. IN THE FEDERAL HIGH COURT — Petition No / parties\n2. NOTICE OF PROPOSED LIQUIDATOR\n3. The Petitioner gives notice that the person proposed to act as liquidator, in the event a winding-up order is made, is:\n   - Full name\n   - Firm name\n   - Address\n   - Qualifications / ICAN/ANAN number\n4. A Consent to Act of the proposed liquidator is exhibited hereto marked Exhibit [X]\n5. Drawn and filed by: [Counsel/Firm]\n\nReturn complete Notice only.`;
    const result=await ask({system:systemCtx,userMsg:prompt,maxTokens:800});
    if(result){setDraft(result);onSave({wuLiquidatorContext:context,wuLiquidatorDraft:result});}
  },[context,ask,onSave,systemCtx]);
  return (
    <div>
      <SectionTitle text="Notice of Proposed Liquidator" accent={accent}/>
      <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",marginBottom:18,lineHeight:1.6}}>Filed with the Petition. The proposed liquidator must file a written Consent to Act and must be a registered insolvency practitioner.</p>
      <div style={{marginBottom:16}}><Label text="Proposed Liquidator Details"/><Textarea value={context} onChange={setContext} rows={5} placeholder="Provide: proposed liquidator's full name, firm, address, professional qualifications (ICAN/ANAN number), and whether their consent to act letter is available."/></div>
      <Btn label="Draft Liquidator Notice" onClick={run} loading={loading} accent={accent} off={!context.trim()}/>
      {error&&<ErrorBlock message={error}/>}
      {draft&&<ResultBlock title="Notice of Proposed Liquidator — Draft" content={draft} onClear={()=>{setDraft('');onSave({wuLiquidatorDraft:''}); }} accent={accent}/>}
    </div>
  );
}

function WUGazetteEvidence({data,onSave,accent,ai,systemCtx}:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const [context,setContext]=useState(data.wuGazetteContext??'');
  const [draft,setDraft]=useState(data.wuGazetteDraft??'');
  const {ask,loading,error}=ai;
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const {partyA}=getPartyLabels(aCase);
    const prompt=`You are Nigerian insolvency counsel for ${partyA}.\n\nMatter: ${aCase?.caseName??''}\n\nPublication details:\n${context}\n\nDraft the Newspaper/Gazette Advertisement notice for a winding-up petition and provide a publication checklist.\n\nPART 1 — ADVERTISEMENT NOTICE:\nRequirement: Petition must be advertised in the Federal Government Official Gazette and at least one local newspaper not less than 7 clear days before the hearing.\n\nDraft the actual notice:\n- Court and petition number\n- Company name and registered office\n- Petitioner name\n- Hearing date, time and place\n- Invitation to creditors and contributories to attend\n- Petitioner's solicitors contact\n\nPART 2 — FILING CHECKLIST:\n- Advertisement timing (7 clear days minimum)\n- Original advertisement copies for filing\n- Affidavit of publication to be filed before hearing\n\nReturn complete notice and checklist.`;
    const result=await ask({system:systemCtx,userMsg:prompt,maxTokens:1200});
    if(result){setDraft(result);onSave({wuGazetteContext:context,wuGazetteDraft:result});}
  },[context,ask,onSave,systemCtx]);
  return (
    <div>
      <SectionTitle text="Newspaper / Gazette Advertisement" accent={accent}/>
      <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",marginBottom:18,lineHeight:1.6}}>A winding-up petition must be advertised in the Federal Gazette and a local newspaper at least 7 clear days before the hearing. This panel drafts the notice and publication checklist.</p>
      <div style={{marginBottom:16}}><Label text="Hearing Details & Petition Particulars"/><Textarea value={context} onChange={setContext} rows={6} placeholder="Provide: company name and registered office; petition number (if assigned); hearing date, time, court; petitioner's solicitors' contact; preferred newspapers."/></div>
      <Btn label="Draft Advertisement Notice" onClick={run} loading={loading} accent={accent} off={!context.trim()}/>
      {error&&<ErrorBlock message={error}/>}
      {draft&&<ResultBlock title="Advertisement Notice & Checklist — Draft" content={draft} onClear={()=>{setDraft('');onSave({wuGazetteDraft:''}); }} accent={accent}/>}
    </div>
  );
}

function WUOppMemo({data,onSave,accent,ai,systemCtx}:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const [context,setContext]=useState(data.wuOppMemoContext??'');
  const [draft,setDraft]=useState(data.wuOppMemoDraft??'');
  const {ask,loading,error}=ai;
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const {partyB}=getPartyLabels(aCase);
    const prompt=`You are Nigerian insolvency counsel for ${partyB} (Respondent Company).\n\nMatter: ${aCase?.caseName??''}\n\nCompany's position:\n${context}\n\nDraft a Memorandum of Appearance and Notice to Oppose Petition at the Federal High Court.\n\nSTRUCTURE:\n1. IN THE FEDERAL HIGH COURT — Petition No / parties\n2. MEMORANDUM OF APPEARANCE AND NOTICE TO OPPOSE PETITION\n3. TAKE NOTICE that [Company] intends to appear and oppose the petition presented herein.\n4. Brief grounds: debt disputed / paid / no valid demand / abuse of process\n5. Company will file Affidavit in Opposition and Written Address\n6. Counsel endorsement for Respondent Company\n\nReturn complete Memo of Appearance only.`;
    const result=await ask({system:systemCtx,userMsg:prompt,maxTokens:800});
    if(result){setDraft(result);onSave({wuOppMemoContext:context,wuOppMemoDraft:result});}
  },[context,ask,onSave,systemCtx]);
  return (
    <div>
      <SectionTitle text="Memorandum of Appearance" accent={accent}/>
      <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",marginBottom:18,lineHeight:1.6}}>The Respondent company must file a Memorandum of Appearance to signal intention to oppose. Follow with Affidavit in Opposition and Written Address.</p>
      <div style={{marginBottom:16}}><Label text="Company's Position & Grounds of Opposition"/><Textarea value={context} onChange={setContext} rows={6} placeholder="Provide: company's grounds for opposing (debt disputed, paid, no valid demand, abuse of process); details of partial payment; company's current trading status."/></div>
      <Btn label="Draft Memo of Appearance" onClick={run} loading={loading} accent={accent} off={!context.trim()}/>
      {error&&<ErrorBlock message={error}/>}
      {draft&&<ResultBlock title="Memorandum of Appearance — Draft" content={draft} onClear={()=>{setDraft('');onSave({wuOppMemoDraft:''}); }} accent={accent}/>}
    </div>
  );
}

function WUOppAffidavit({data,onSave,accent,ai,systemCtx}:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const [context,setContext]=useState(data.wuOppAffidavitContext??'');
  const [draft,setDraft]=useState(data.wuOppAffidavitDraft??'');
  const {ask,loading,error}=ai;
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const {partyA,partyB}=getPartyLabels(aCase);
    const prompt=`You are Nigerian insolvency counsel for ${partyB} (Respondent Company).\n\nMatter: ${aCase?.caseName??''}\n\nCompany's factual position:\n${context}\n\nDraft a complete Affidavit in Opposition to the Winding-Up Petition.\n\nSTRUCTURE:\n1. AFFIDAVIT IN OPPOSITION TO WINDING-UP PETITION\n2. Deponent introduction (officer of the company)\n3. Numbered paragraphs:\n   (a) Company capacity and deponent's authority\n   (b) Response to each petition paragraph: admit/deny/dispute\n   (c) Debt position: paid? Disputed? Set-off available?\n   (d) Statutory demand defects (if any): wrong address, incorrect amount\n   (e) Company solvency: assets, liabilities, ongoing business\n   (f) Exhibits: payment receipts, board resolution, accounts, correspondence\n4. Jurat\n\nReturn complete Affidavit in Opposition only.`;
    const result=await ask({system:systemCtx,userMsg:prompt,maxTokens:2000});
    if(result){setDraft(result);onSave({wuOppAffidavitContext:context,wuOppAffidavitDraft:result});}
  },[context,ask,onSave,systemCtx]);
  return (
    <div>
      <SectionTitle text="Affidavit in Opposition" accent={accent}/>
      <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",marginBottom:18,lineHeight:1.6}}>Sets out the company's factual response to every material averment in the petition. Attach exhibits (payment records, accounts, correspondence).</p>
      <div style={{marginBottom:16}}><Label text="Company's Factual Position & Response to Petition"/><Textarea value={context} onChange={setContext} rows={9} placeholder="Provide: whether debt is admitted/disputed (and why); any payments made; solvency position (assets vs liabilities); demand defects (if any); exhibits available; deponent's name, title, capacity."/></div>
      <Btn label="Draft Affidavit in Opposition" onClick={run} loading={loading} accent={accent} off={!context.trim()}/>
      {error&&<ErrorBlock message={error}/>}
      {draft&&<ResultBlock title="Affidavit in Opposition — Draft" content={draft} onClear={()=>{setDraft('');onSave({wuOppAffidavitDraft:''}); }} accent={accent}/>}
    </div>
  );
}

function WUOppAddress({data,onSave,accent,ai,systemCtx}:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const [context,setContext]=useState(data.wuOppAddressContext??'');
  const [draft,setDraft]=useState(data.wuOppAddressDraft??'');
  const {ask,loading,error}=ai;
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const {partyA,partyB}=getPartyLabels(aCase);
    const prompt=`You are Nigerian insolvency counsel for ${partyB} (Respondent Company).\n\nMatter: ${aCase?.caseName??''}\n\nLegal arguments:\n${context}\n\nDraft a complete Written Address in Opposition to the Winding-Up Petition.\n\nSTRUCTURE:\n1. RESPONDENT'S WRITTEN ADDRESS IN OPPOSITION TO WINDING-UP PETITION\n2. INTRODUCTION: Respondent opposes; nature of opposition\n3. ISSUES FOR DETERMINATION (framed to support dismissal):\n   Whether debt is established / Whether demand is valid / Whether order is appropriate\n4. STATEMENT OF FACTS (company's version, cross-referencing Affidavit in Opposition)\n5. ARGUMENTS — per issue: legal principle → CAMA/Nigerian authority → apply to facts → conclude\n6. DISCRETION: Even if debt established, court has discretion to refuse — argue solvency, abuse of process, just and equitable factors\n7. CONCLUSION: petition dismissed with costs\n8. AUTHORITIES RELIED UPON\n\nReturn complete Written Address only.`;
    const result=await ask({system:systemCtx,userMsg:prompt,maxTokens:2500});
    if(result){setDraft(result);onSave({wuOppAddressContext:context,wuOppAddressDraft:result});}
  },[context,ask,onSave,systemCtx]);
  return (
    <div>
      <SectionTitle text="Written Address in Opposition" accent={accent}/>
      <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",marginBottom:18,lineHeight:1.6}}>Argues the legal case against the petition. Even where a debt exists, the court has discretion to refuse a winding-up order — address that discretion where applicable.</p>
      <div style={{marginBottom:16}}><Label text="Legal Arguments, Authorities & Grounds"/><Textarea value={context} onChange={setContext} rows={9} placeholder="Provide: main legal grounds; solvency arguments; authorities; whether petition is abuse of process; any alternative relief (instalment payment, scheme of arrangement)."/></div>
      <Btn label="Draft Written Address in Opposition" onClick={run} loading={loading} accent={accent} off={!context.trim()}/>
      {error&&<ErrorBlock message={error}/>}
      {draft&&<ResultBlock title="Written Address in Opposition — Draft" content={draft} onClear={()=>{setDraft('');onSave({wuOppAddressDraft:''}); }} accent={accent}/>}
    </div>
  );
}

function WUThirdPartyAppearance({data,onSave,accent,ai,systemCtx}:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const [context,setContext]=useState(data.wuThirdPartyContext??'');
  const [draft,setDraft]=useState(data.wuThirdPartyDraft??'');
  const {ask,loading,error}=ai;
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const prompt=`You are Nigerian insolvency counsel for a creditor/contributory (Third Party) in:\n\nMatter: ${aCase?.caseName??''}\n\nThird party's position:\n${context}\n\nDraft a Notice of Intention to Appear at the winding-up petition hearing.\n\nSTRUCTURE:\n1. IN THE FEDERAL HIGH COURT — Petition No / parties\n2. NOTICE OF INTENTION TO APPEAR\n3. TAKE NOTICE that [Third Party], being a [creditor/contributory/director] of [Company], intends to appear at the hearing.\n4. Intention: to SUPPORT / OPPOSE the making of a winding-up order (state which)\n5. Nature of claim/debt: brief statement\n6. Signed: [Third Party / Counsel]\n\nReturn complete Notice only.`;
    const result=await ask({system:systemCtx,userMsg:prompt,maxTokens:700});
    if(result){setDraft(result);onSave({wuThirdPartyContext:context,wuThirdPartyDraft:result});}
  },[context,ask,onSave,systemCtx]);
  return (
    <div>
      <SectionTitle text="Notice of Intention to Appear" accent={accent}/>
      <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",marginBottom:18,lineHeight:1.6}}>For creditors, contributories, or other parties wishing to appear at the petition hearing — whether to support or oppose. File before the hearing date.</p>
      <div style={{marginBottom:16}}><Label text="Third Party Identity & Position"/><Textarea value={context} onChange={setContext} rows={5} placeholder="Provide: full name, address, capacity (creditor/contributory/director); whether supporting or opposing the petition; brief description of claim or debt."/></div>
      <Btn label="Draft Notice of Intention to Appear" onClick={run} loading={loading} accent={accent} off={!context.trim()}/>
      {error&&<ErrorBlock message={error}/>}
      {draft&&<ResultBlock title="Notice of Intention to Appear — Draft" content={draft} onClear={()=>{setDraft('');onSave({wuThirdPartyDraft:''}); }} accent={accent}/>}
    </div>
  );
}

function WUAffidavitOfDebt({data,onSave,accent,ai,systemCtx}:{data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const [context,setContext]=useState(data.wuThirdPartyAffContext??'');
  const [draft,setDraft]=useState(data.wuThirdPartyAffDraft??'');
  const {ask,loading,error}=ai;
  const run=useCallback(async()=>{
    const aCase=(window as any).__afsActiveCase;
    const prompt=`You are Nigerian insolvency counsel for a supporting creditor in:\n\nMatter: ${aCase?.caseName??''}\n\nCreditor and debt details:\n${context}\n\nDraft a complete Affidavit of Debt for use in support of the winding-up petition hearing.\n\nSTRUCTURE:\n1. IN THE FEDERAL HIGH COURT — AFFIDAVIT OF DEBT OF [CREDITOR NAME]\n2. Deponent introduction\n3. Numbered paragraphs:\n   (a) Creditor identity and capacity\n   (b) Nature and amount of debt\n   (c) How debt arose (contract, services, goods, judgment)\n   (d) Date due and unpaid\n   (e) Exhibits: invoices, contracts, demand letters, judgment\n   (f) Creditor supports winding-up order\n4. Jurat\n\nReturn complete Affidavit of Debt only.`;
    const result=await ask({system:systemCtx,userMsg:prompt,maxTokens:1200});
    if(result){setDraft(result);onSave({wuThirdPartyAffContext:context,wuThirdPartyAffDraft:result});}
  },[context,ask,onSave,systemCtx]);
  return (
    <div>
      <SectionTitle text="Affidavit of Debt (Supporting Creditor)" accent={accent}/>
      <p style={{fontSize:13,color:T.sub,fontFamily:"'Times New Roman', Times, serif",marginBottom:18,lineHeight:1.6}}>Filed by a creditor supporting the petition. Strengthens the case for a winding-up order where multiple creditors are owed.</p>
      <div style={{marginBottom:16}}><Label text="Creditor Details & Debt Particulars"/><Textarea value={context} onChange={setContext} rows={7} placeholder="Provide: creditor's full name, address, occupation; nature and amount of debt; how debt arose; date due; correspondence or demand sent; exhibits available."/></div>
      <Btn label="Draft Affidavit of Debt" onClick={run} loading={loading} accent={accent} off={!context.trim()}/>
      {error&&<ErrorBlock message={error}/>}
      {draft&&<ResultBlock title="Affidavit of Debt — Draft" content={draft} onClear={()=>{setDraft('');onSave({wuThirdPartyAffDraft:''}); }} accent={accent}/>}
    </div>
  );
}

function WindingUpEngine({activeCase,data,onSave,accent,ai,systemCtx}:{activeCase:Case;data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const isClaim=activeCase.counsel_role==='claimant_side';
  const sp={data,onSave,accent,ai,systemCtx};
  const forTabs=[
    {id:'wu_demand',label:'Statutory Demand'},
    {id:'wu_petition',label:'Winding-Up Petition'},
    {id:'wu_affirmation',label:'Affidavit in Verification'},
    {id:'wu_liquidator',label:'Proposed Liquidator'},
    {id:'wu_gazette',label:'Gazette / Newspaper'},
  ];
  const againstTabs=[
    {id:'wu_memo',label:'Memo of Appearance'},
    {id:'wu_opp_affidavit',label:'Affidavit in Opposition'},
    {id:'wu_opp_address',label:'Written Address in Opp.'},
    {id:'wu_tp_notice',label:'Third Party Notice'},
    {id:'wu_tp_debt',label:'Affidavit of Debt'},
  ];
  const tabs=isClaim?forTabs:againstTabs;
  const [activeTab,setActiveTab]=useState(isClaim?'wu_demand':'wu_memo');
  const forChecklist=[
    {label:'Statutory Demand',done:!!data.wuDemandDraft},
    {label:'Winding-Up Petition',done:!!data.wuPetitionDraft},
    {label:'Affidavit in Verification',done:!!data.wuAffirmDraft},
    {label:'Proposed Liquidator Notice',done:!!data.wuLiquidatorDraft},
    {label:'Gazette Advertisement',done:!!data.wuGazetteDraft},
  ];
  const againstChecklist=[
    {label:'Memo of Appearance',done:!!data.wuOppMemoDraft},
    {label:'Affidavit in Opposition',done:!!data.wuOppAffidavitDraft},
    {label:'Written Address',done:!!data.wuOppAddressDraft},
  ];
  return (
    <div style={{animation:'fadeUp .3s ease'}}>
      <div style={{marginBottom:24}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
          <span style={{fontSize:18,color:accent}}>🏛</span>
          <h3 style={{fontSize:18,color:T.text,fontFamily:"'Times New Roman', Times, serif",fontWeight:300,margin:0}}>Federal High Court — Winding-Up Petition</h3>
          <span style={{fontSize:9,padding:'3px 8px',borderRadius:3,fontFamily:"'Times New Roman', Times, serif",fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',background:`${accent}15`,border:`1px solid ${accent}30`,color:accent}}>
            {isClaim?'Petitioner (For)':'Respondent / Third Party (Against)'}
          </span>
        </div>
        <p style={{fontSize:13,color:T.mute,fontFamily:"'Times New Roman', Times, serif",margin:0}}>CAMA 2020 framework — compulsory winding-up by court on grounds of inability to pay debts or other statutory grounds.</p>
      </div>
      <ChecklistBanner items={isClaim?forChecklist:againstChecklist} accent={accent}/>
      <SubTabBar tabs={tabs} active={activeTab} onSelect={setActiveTab} accent={accent}/>
      {activeTab==='wu_demand'&&<WUDemandNotice {...sp}/>}
      {activeTab==='wu_petition'&&<WUPetition {...sp}/>}
      {activeTab==='wu_affirmation'&&<WUAffidavitVerification {...sp}/>}
      {activeTab==='wu_liquidator'&&<WULiquidatorNotice {...sp}/>}
      {activeTab==='wu_gazette'&&<WUGazetteEvidence {...sp}/>}
      {activeTab==='wu_memo'&&<WUOppMemo {...sp}/>}
      {activeTab==='wu_opp_affidavit'&&<WUOppAffidavit {...sp}/>}
      {activeTab==='wu_opp_address'&&<WUOppAddress {...sp}/>}
      {activeTab==='wu_tp_notice'&&<WUThirdPartyAppearance {...sp}/>}
      {activeTab==='wu_tp_debt'&&<WUAffidavitOfDebt {...sp}/>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 3B — NICN ENGINE (4 MODES)
// ═══════════════════════════════════════════════════════════════════════════════

function NICNComplaintEngine({activeCase,data,onSave,accent,ai,systemCtx}:{activeCase:Case;data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const isClaim=activeCase.counsel_role==='claimant_side';
  const sp={data,onSave,accent,ai,systemCtx};
  const forTabs=[
    {id:'nicn_complaint',label:'Complaint & SoF'},
    {id:'nicn_witness_list',label:'List of Witnesses'},
    {id:'nicn_witness_stmt',label:'Witness Statements on Oath'},
    {id:'nicn_doc_schedule',label:'Document Schedule'},
  ];
  const againstTabs=[
    {id:'nicn_def_memo',label:'Memo of Appearance (Form 11)'},
    {id:'nicn_def_stmt',label:'Statement of Defence'},
    {id:'nicn_def_witness',label:'Witness Statements'},
    {id:'nicn_def_doc',label:'Document Schedule'},
  ];
  const tabs=isClaim?forTabs:againstTabs;
  const [activeTab,setActiveTab]=useState(isClaim?'nicn_complaint':'nicn_def_memo');
  const forChecklist=[
    {label:'Complaint & SoF',done:!!data.nicnComplaintDraft},
    {label:'List of Witnesses',done:!!data.nicnWitnessListDraft},
    {label:'Witness Statements',done:!!data.nicnWitnessStmtDraft},
    {label:'Document Schedule',done:!!data.nicnDocScheduleDraft},
  ];
  const againstChecklist=[
    {label:'Memo of Appearance',done:!!data.nicnDefMemoDraft},
    {label:'Statement of Defence',done:!!data.nicnDefStmtDraft},
    {label:'Witness Statements',done:!!data.nicnDefWitnessDraft},
    {label:'Document Schedule',done:!!data.nicnDefDocDraft},
  ];
  const draftKeys:Record<string,keyof SavedData>={
    nicn_complaint:'nicnComplaintDraft',nicn_witness_list:'nicnWitnessListDraft',
    nicn_witness_stmt:'nicnWitnessStmtDraft',nicn_doc_schedule:'nicnDocScheduleDraft',
    nicn_def_memo:'nicnDefMemoDraft',nicn_def_stmt:'nicnDefStmtDraft',
    nicn_def_witness:'nicnDefWitnessDraft',nicn_def_doc:'nicnDefDocDraft',
  };
  const ctxKeys:Record<string,keyof SavedData>={
    nicn_complaint:'nicnComplaintContext',nicn_witness_list:'nicnWitnessListContext',
    nicn_witness_stmt:'nicnWitnessStmtContext',nicn_doc_schedule:'nicnDocScheduleContext',
    nicn_def_memo:'nicnDefMemoContext',nicn_def_stmt:'nicnDefStmtContext',
    nicn_def_witness:'nicnDefWitnessContext',nicn_def_doc:'nicnDefDocContext',
  };
  const makePrompt=(tabId:string)=>(ctx:string,aCase:any,{partyA,partyB}:{partyA:string;partyB:string})=>{
    const matter=aCase?.caseName??'';
    const intelBlock=buildIntelligenceBlock(aCase);
    if(intelBlock) ctx=`INTELLIGENCE ENGINE OUTPUT (vetted facts — do not contradict):\n${intelBlock}\n\nAdditional facts from counsel (supplemental):\n${ctx||'(none — relying on Intelligence Engine output above)'}`;
    const ps:Record<string,string>={
      nicn_complaint:`You are labour counsel for ${partyA} (Claimant) before the NICN.\n\nMatter: ${matter}\n\nInstructions:\n${ctx}\n\nDraft a complete Integrated Complaint & Statement of Facts (NICN Form 1).\n\nSTRUCTURE:\n1. IN THE NATIONAL INDUSTRIAL COURT OF NIGERIA\n   HOLDEN AT [CITY] — SUIT NO: [to be assigned]\n   BETWEEN: [${partyA.toUpperCase()}] — Claimant AND [${partyB.toUpperCase()}] — Defendant\n\n2. COMPLAINT FORM 1\n3. Claimant details: name, address, occupation, union/employer status\n4. Defendant details: name, address\n5. STATEMENT OF FACTS (numbered):\n   - Employment relationship: commencement, position, salary\n   - CBA/contract terms\n   - Events giving rise to dispute (dates, actions)\n   - Violations of NIC Act/Labour Act/ILO conventions\n   - Attempts at resolution\n   - Loss suffered\n6. RELIEF SOUGHT (numbered): reinstatement, damages, salary arrears, declaration\n7. STATUTORY BASIS: NIC Act 2006/Labour Act/relevant statutes\n8. Signed by Claimant/Counsel\n\nFlag [COUNSEL TO SUPPLY] where needed. Return complete Form 1 only.`,
      nicn_witness_list:`You are labour counsel for ${partyA} before the NICN.\n\nMatter: ${matter}\n\nWitness information:\n${ctx}\n\nDraft the Claimant's List of Witnesses per NICN Rules.\n\nFormat:\n1. Heading: IN THE NICN — Suit No / parties / CLAIMANT'S LIST OF WITNESSES\n2. Table: No. | Name | Address | Occupation | Summary of Evidence\n3. "[${partyA}] reserves the right to call additional witnesses with leave of court."\n4. Signed by Counsel\n\nReturn complete List of Witnesses only.`,
      nicn_witness_stmt:`You are labour counsel for ${partyA} before the NICN.\n\nMatter: ${matter}\n\nWitness details:\n${ctx}\n\nDraft a Witness Statement on Oath (deposition format — used as evidence-in-chief before NICN).\n\nSTRUCTURE:\n1. IN THE NICN — Suit No / parties\n   WITNESS STATEMENT ON OATH OF [NAME] (CW[number])\n2. "I, [NAME], of [address], [occupation], make oath and say:"\n3. Numbered paragraphs: employment history; events (one fact per paragraph); exhibits (CW[X]-[A]…); relief sought\n4. "I make this statement knowing it may be used as evidence before this Honourable Court."\n5. Signed / Jurat\n\nReturn complete Witness Statement only.`,
      nicn_doc_schedule:`You are labour counsel for ${partyA} before the NICN.\n\nMatter: ${matter}\n\nDocuments available:\n${ctx}\n\nDraft the Claimant's Document Schedule.\n\nFormat:\n1. Heading: IN THE NICN — CLAIMANT'S DOCUMENT SCHEDULE\n2. Table: No. | Document Description | Date | Exhibit Mark | Purpose\n3. "Claimant will rely on all documents herein at trial."\n4. Signed by Counsel\n\nReturn complete Document Schedule only.`,
      nicn_def_memo:`You are labour counsel for ${partyB} (Defendant) before the NICN.\n\nMatter: ${matter}\n\nDefendant details:\n${ctx}\n\nDraft a Memorandum of Appearance (NICN Form 11).\n\nSTRUCTURE:\n1. IN THE NICN — Suit No / parties\n2. MEMORANDUM OF APPEARANCE (FORM 11)\n3. TAKE NOTICE that [Defendant] of [address] enters appearance in the above suit.\n4. Defendant denies liability and will file a Statement of Defence.\n5. Counsel endorsement for Defendant\n\nReturn complete Form 11 only.`,
      nicn_def_stmt:`You are labour counsel for ${partyB} (Defendant) before the NICN.\n\nMatter: ${matter}\n\nDefence instructions:\n${ctx}\n\nDraft a complete Statement of Defence.\n\nSTRUCTURE:\n1. IN THE NICN — STATEMENT OF DEFENCE\n2. Defendant denies entitlement save as admitted herein.\n3. Paragraph-by-paragraph response to Form 1: admit/deny/not admitted\n4. Affirmative defences: voluntary resignation; valid dismissal; procedure followed; no contract breach\n5. WHEREFORE: Claim dismissed with costs\n6. Counsel endorsement\n\nReturn complete Statement of Defence only.`,
      nicn_def_witness:`You are labour counsel for ${partyB} before the NICN.\n\nMatter: ${matter}\n\nDefendant witness details:\n${ctx}\n\nDraft a Defendant's Witness Statement on Oath (DW format). Same structure as Claimant's statement: marked DW[number]; exhibits marked DW[X]-[A]; evidence supports defence position; responds to Claimant's evidence where relevant.\n\nReturn complete DW Witness Statement only.`,
      nicn_def_doc:`You are labour counsel for ${partyB} before the NICN.\n\nMatter: ${matter}\n\nDocuments available to Defendant:\n${ctx}\n\nDraft the Defendant's Document Schedule. Same format as Claimant's schedule but headed DEFENDANT'S DOCUMENT SCHEDULE with DW prefix on exhibits.\n\nReturn complete Defendant's Document Schedule only.`,
    };
    return ps[tabId]??`Draft ${tabId} for NICN employment matter: ${matter}. Instructions: ${ctx}`;
  };
  return (
    <div style={{animation:'fadeUp .3s ease'}}>
      <div style={{marginBottom:24}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
          <span style={{fontSize:18,color:accent}}>⚖</span>
          <h3 style={{fontSize:18,color:T.text,fontFamily:"'Times New Roman', Times, serif",fontWeight:300,margin:0}}>NICN — Complaint Form 1</h3>
          <span style={{fontSize:9,padding:'3px 8px',borderRadius:3,fontFamily:"'Times New Roman', Times, serif",fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',background:`${accent}15`,border:`1px solid ${accent}30`,color:accent}}>
            {isClaim?'Claimant (For)':'Defendant (Against)'}
          </span>
        </div>
        <p style={{fontSize:13,color:T.mute,fontFamily:"'Times New Roman', Times, serif",margin:0}}>Employment disputes — wrongful termination, unpaid wages, unfair labour practices, breach of collective bargaining agreement.</p>
      </div>
      <ChecklistBanner items={isClaim?forChecklist:againstChecklist} accent={accent}/>
      <SubTabBar tabs={tabs} active={activeTab} onSelect={setActiveTab} accent={accent}/>
      {tabs.map(t=>activeTab===t.id&&(
        <AIDrafter key={t.id} title={t.label}
          description={`Draft the ${t.label} for this NICN employment matter.`}
          contextLabel="Instructions & Facts" contextPlaceholder={`Provide details for the ${t.label}…`}
          draftKey={draftKeys[t.id]} contextKey={ctxKeys[t.id]}
          data={data} onSave={onSave} accent={accent} ai={ai} systemCtx={systemCtx}
          prompt={makePrompt(t.id)} maxTokens={2000}
        />
      ))}
    </div>
  );
}

function NICNOSEngine({activeCase,data,onSave,accent,ai,systemCtx}:{activeCase:Case;data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const isClaim=activeCase.counsel_role==='claimant_side';
  const sp={data,onSave,accent,ai,systemCtx};
  const forTabs=[
    {id:'nicn_os',label:'Originating Summons'},
    {id:'nicn_os_affidavit',label:'Supporting Affidavit'},
    {id:'nicn_os_address',label:'Written Address'},
  ];
  const againstTabs=[
    {id:'nicn_os_counter',label:'Counter-Affidavit'},
    {id:'nicn_os_opp',label:'Written Address in Opp.'},
  ];
  const tabs=isClaim?forTabs:againstTabs;
  const [activeTab,setActiveTab]=useState(isClaim?'nicn_os':'nicn_os_counter');
  const draftKeys:Record<string,keyof SavedData>={
    nicn_os:'nicnOSDraft',nicn_os_affidavit:'nicnOSAffidavitDraft',nicn_os_address:'nicnOSAddressDraft',
    nicn_os_counter:'nicnOSCounterDraft',nicn_os_opp:'nicnOSOppAddressDraft',
  };
  const ctxKeys:Record<string,keyof SavedData>={
    nicn_os:'nicnOSDraftContext',nicn_os_affidavit:'nicnOSAffidavitContext',nicn_os_address:'nicnOSAddressContext',
    nicn_os_counter:'nicnOSCounterContext',nicn_os_opp:'nicnOSOppAddressContext',
  };
  const makePrompt=(tabId:string)=>(ctx:string,aCase:any,{partyA,partyB}:{partyA:string;partyB:string})=>{
    const matter=aCase?.caseName??'';
    const intelBlock=buildIntelligenceBlock(aCase);
    if(intelBlock) ctx=`INTELLIGENCE ENGINE OUTPUT (vetted facts — do not contradict):\n${intelBlock}\n\nAdditional facts from counsel (supplemental):\n${ctx||'(none — relying on Intelligence Engine output above)'}`;
    const ps:Record<string,string>={
      nicn_os:`You are labour counsel for ${partyA} (Applicant) before the NICN.\n\nMatter: ${matter}\n\nInstructions:\n${ctx}\n\nDraft a complete Originating Summons (NICN Form 2) for CBA/contract interpretation.\n\nSTRUCTURE:\n1. IN THE NATIONAL INDUSTRIAL COURT OF NIGERIA\n   HOLDEN AT [CITY] — Suit No: [to be assigned]\n   IN THE MATTER OF: [CBA/Contract/statute]\n   BETWEEN: [${partyA.toUpperCase()}] — Applicant AND [${partyB.toUpperCase()}] — Respondent\n2. ORIGINATING SUMMONS (FORM 2) — Let [Respondent] attend for hearing of:\n3. QUESTIONS FOR DETERMINATION (numbered legal propositions)\n4. RELIEFS SOUGHT (numbered)\n5. GROUNDS (NIC Act/Labour Act/CBA provisions)\n6. Documents relied on: Supporting Affidavit and Written Address\n7. Counsel endorsement\n\nReturn complete Form 2 only.`,
      nicn_os_affidavit:`You are labour counsel for ${partyA} before the NICN.\n\nMatter: ${matter}\n\nDeponent and facts:\n${ctx}\n\nDraft a Supporting Affidavit for the NICN OS Form 2. Refer to the OS questions; exhibit the CBA/contract being construed; exhibit relevant correspondence; stick to facts.\n\nStandard affidavit structure with NICN heading. Return complete affidavit only.`,
      nicn_os_address:`You are labour counsel for ${partyA} before the NICN.\n\nMatter: ${matter}\n\nLegal arguments:\n${ctx}\n\nDraft a Written Address in support of the NICN Originating Summons.\n\nStructure: Introduction · Issues for Determination · Statement of Facts · Arguments (per issue with NIC Act/Labour Act/ILO Convention authorities) · Conclusion · Authorities.\n\nReturn complete Written Address only.`,
      nicn_os_counter:`You are labour counsel for ${partyB} (Respondent) before the NICN.\n\nMatter: ${matter}\n\nRespondent's position:\n${ctx}\n\nDraft a Counter-Affidavit responding paragraph-by-paragraph to the Supporting Affidavit. Exhibits marked R1, R2… Standard NICN affidavit heading.\n\nReturn complete Counter-Affidavit only.`,
      nicn_os_opp:`You are labour counsel for ${partyB} before the NICN.\n\nMatter: ${matter}\n\nGrounds of opposition:\n${ctx}\n\nDraft a Written Address in Opposition to the NICN OS.\n\nStructure: Introduction · Issues (Respondent's formulation) · Facts · Arguments (with NICN/Labour Act authorities) · Conclusion · Authorities.\n\nReturn complete Written Address in Opposition only.`,
    };
    return ps[tabId]??`Draft ${tabId} for NICN OS matter: ${matter}. Instructions: ${ctx}`;
  };
  const forChecklist=[
    {label:'Originating Summons',done:!!data.nicnOSDraft},
    {label:'Supporting Affidavit',done:!!data.nicnOSAffidavitDraft},
    {label:'Written Address',done:!!data.nicnOSAddressDraft},
  ];
  const againstChecklist=[
    {label:'Counter-Affidavit',done:!!data.nicnOSCounterDraft},
    {label:'Written Address in Opp.',done:!!data.nicnOSOppAddressDraft},
  ];
  return (
    <div style={{animation:'fadeUp .3s ease'}}>
      <div style={{marginBottom:24}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
          <span style={{fontSize:18,color:accent}}>⚖</span>
          <h3 style={{fontSize:18,color:T.text,fontFamily:"'Times New Roman', Times, serif",fontWeight:300,margin:0}}>NICN — Originating Summons Form 2</h3>
          <span style={{fontSize:9,padding:'3px 8px',borderRadius:3,fontFamily:"'Times New Roman', Times, serif",fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',background:`${accent}15`,border:`1px solid ${accent}30`,color:accent}}>
            {isClaim?'Applicant (For)':'Respondent (Against)'}
          </span>
        </div>
        <p style={{fontSize:13,color:T.mute,fontFamily:"'Times New Roman', Times, serif",margin:0}}>CBA/collective agreement interpretation, contract construction, pure legal questions suitable for OS procedure before the NICN.</p>
      </div>
      <ChecklistBanner items={isClaim?forChecklist:againstChecklist} accent={accent}/>
      <SubTabBar tabs={tabs} active={activeTab} onSelect={setActiveTab} accent={accent}/>
      {tabs.map(t=>activeTab===t.id&&(
        <AIDrafter key={t.id} title={t.label}
          description={`Draft the ${t.label} for this NICN Originating Summons matter.`}
          contextLabel="Instructions & Facts" contextPlaceholder={`Provide details for the ${t.label}…`}
          draftKey={draftKeys[t.id]} contextKey={ctxKeys[t.id]}
          data={data} onSave={onSave} accent={accent} ai={ai} systemCtx={systemCtx}
          prompt={makePrompt(t.id)} maxTokens={2000}
        />
      ))}
    </div>
  );
}

function NICNJREngine({activeCase,data,onSave,accent,ai,systemCtx}:{activeCase:Case;data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const isClaim=activeCase.counsel_role==='claimant_side';
  const sp={data,onSave,accent,ai,systemCtx};
  const forTabs=[
    {id:'nicn_jr_motion',label:'Originating Motion'},
    {id:'nicn_jr_stmt',label:'Statement of Facts'},
    {id:'nicn_jr_affidavit',label:'Affidavit in Support'},
    {id:'nicn_jr_address',label:'Written Address'},
  ];
  const againstTabs=[
    {id:'nicn_jr_counter',label:'Counter-Affidavit'},
    {id:'nicn_jr_opp',label:'Written Address in Opp.'},
  ];
  const tabs=isClaim?forTabs:againstTabs;
  const [activeTab,setActiveTab]=useState(isClaim?'nicn_jr_motion':'nicn_jr_counter');
  const draftKeys:Record<string,keyof SavedData>={
    nicn_jr_motion:'nicnJRMotionDraft',nicn_jr_stmt:'nicnJRStmtDraft',nicn_jr_affidavit:'nicnJRAffidavitDraft',
    nicn_jr_address:'nicnJRAddressDraft',nicn_jr_counter:'nicnJRCounterDraft',nicn_jr_opp:'nicnJROppAddressDraft',
  };
  const ctxKeys:Record<string,keyof SavedData>={
    nicn_jr_motion:'nicnJRMotionContext',nicn_jr_stmt:'nicnJRStmtContext',nicn_jr_affidavit:'nicnJRAffidavitContext',
    nicn_jr_address:'nicnJRAddressContext',nicn_jr_counter:'nicnJRCounterContext',nicn_jr_opp:'nicnJROppAddressContext',
  };
  const makePrompt=(tabId:string)=>(ctx:string,aCase:any,{partyA,partyB}:{partyA:string;partyB:string})=>{
    const matter=aCase?.caseName??'';
    const intelBlock=buildIntelligenceBlock(aCase);
    if(intelBlock) ctx=`INTELLIGENCE ENGINE OUTPUT (vetted facts — do not contradict):\n${intelBlock}\n\nAdditional facts from counsel (supplemental):\n${ctx||'(none — relying on Intelligence Engine output above)'}`;
    const ps:Record<string,string>={
      nicn_jr_motion:`You are labour counsel for ${partyA} (Applicant) before the NICN — Judicial Review.\n\nMatter: ${matter}\n\nInstructions:\n${ctx}\n\nDraft a complete Originating Motion for Judicial Review before the NICN.\n\nSTRUCTURE:\n1. IN THE NATIONAL INDUSTRIAL COURT — Suit No / parties\n2. ORIGINATING MOTION — [Applicant] will apply for:\n3. Orders sought (certiorari/mandamus/prohibition/declaration/injunction — numbered)\n4. GROUNDS (numbered): ultra vires; breach of fair hearing/natural justice; error on record; procedural impropriety\n5. Reliance: Statement of Facts + Affidavit in Support + Written Address\n6. Enabling statute (NIC Act/NICN Rules)\n7. Counsel endorsement\n\nReturn complete Originating Motion only.`,
      nicn_jr_stmt:`You are labour counsel for ${partyA} before the NICN — Judicial Review.\n\nMatter: ${matter}\n\nFacts:\n${ctx}\n\nDraft a Statement of Facts in support of the Judicial Review.\n\nSTRUCTURE:\n1. STATEMENT OF FACTS IN SUPPORT OF APPLICATION FOR JUDICIAL REVIEW\n2. Parties\n3. Background (numbered, chronological): decision-maker identity/jurisdiction; decision/omission challenged; procedural history; how Applicant was affected\n4. Grounds: link facts to each ground in the Motion\n5. Why relief is sought\n\nReturn complete Statement of Facts only.`,
      nicn_jr_affidavit:`You are labour counsel for ${partyA} before the NICN — Judicial Review.\n\nMatter: ${matter}\n\nDeponent and facts:\n${ctx}\n\nDraft a complete Affidavit in Support of the Application for Judicial Review. Exhibit the challenged decision/record and relevant correspondence. Facts only; Jurat included.\n\nReturn complete Affidavit in Support only.`,
      nicn_jr_address:`You are labour counsel for ${partyA} before the NICN — Judicial Review.\n\nMatter: ${matter}\n\nLegal arguments:\n${ctx}\n\nDraft a Written Address in Support of the Judicial Review.\n\nStructure: Introduction · Issues · Facts · Arguments (per ground, citing NICN Act/admin law/Nigerian JR authorities) · Relief · Authorities.\n\nReturn complete Written Address only.`,
      nicn_jr_counter:`You are labour counsel for ${partyB} (Respondent) before the NICN — Judicial Review.\n\nMatter: ${matter}\n\nRespondent's position:\n${ctx}\n\nDraft a Counter-Affidavit responding paragraph-by-paragraph to the Affidavit in Support. Exhibit decision record and supporting documents (R1, R2…). Jurat included.\n\nReturn complete Counter-Affidavit only.`,
      nicn_jr_opp:`You are labour counsel for ${partyB} before the NICN — Judicial Review.\n\nMatter: ${matter}\n\nGrounds of opposition:\n${ctx}\n\nDraft a Written Address in Opposition to the Judicial Review.\n\nStructure: Introduction · Issues (Respondent's formulation) · Facts · Arguments (decision within jurisdiction; fair hearing observed; no reviewable error) · Conclusion · Authorities.\n\nReturn complete Written Address in Opposition only.`,
    };
    return ps[tabId]??`Draft ${tabId} for NICN JR matter: ${matter}. Instructions: ${ctx}`;
  };
  const forChecklist=[
    {label:'Originating Motion',done:!!data.nicnJRMotionDraft},
    {label:'Statement of Facts',done:!!data.nicnJRStmtDraft},
    {label:'Affidavit in Support',done:!!data.nicnJRAffidavitDraft},
    {label:'Written Address',done:!!data.nicnJRAddressDraft},
  ];
  const againstChecklist=[
    {label:'Counter-Affidavit',done:!!data.nicnJRCounterDraft},
    {label:'Written Address in Opp.',done:!!data.nicnJROppAddressDraft},
  ];
  return (
    <div style={{animation:'fadeUp .3s ease'}}>
      <div style={{marginBottom:24}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
          <span style={{fontSize:18,color:accent}}>⚖</span>
          <h3 style={{fontSize:18,color:T.text,fontFamily:"'Times New Roman', Times, serif",fontWeight:300,margin:0}}>NICN — Application for Judicial Review</h3>
          <span style={{fontSize:9,padding:'3px 8px',borderRadius:3,fontFamily:"'Times New Roman', Times, serif",fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',background:`${accent}15`,border:`1px solid ${accent}30`,color:accent}}>
            {isClaim?'Applicant (For)':'Respondent (Against)'}
          </span>
        </div>
        <p style={{fontSize:13,color:T.mute,fontFamily:"'Times New Roman', Times, serif",margin:0}}>Review of decisions by labour bodies, employer disciplinary panels, or statutory tribunals within the NICN's supervisory jurisdiction.</p>
      </div>
      <ChecklistBanner items={isClaim?forChecklist:againstChecklist} accent={accent}/>
      <SubTabBar tabs={tabs} active={activeTab} onSelect={setActiveTab} accent={accent}/>
      {tabs.map(t=>activeTab===t.id&&(
        <AIDrafter key={t.id} title={t.label}
          description={`Draft the ${t.label} for this NICN Judicial Review matter.`}
          contextLabel="Instructions & Facts" contextPlaceholder={`Provide details for the ${t.label}…`}
          draftKey={draftKeys[t.id]} contextKey={ctxKeys[t.id]}
          data={data} onSave={onSave} accent={accent} ai={ai} systemCtx={systemCtx}
          prompt={makePrompt(t.id)} maxTokens={2000}
        />
      ))}
    </div>
  );
}

function NICNAppealEngine({activeCase,data,onSave,accent,ai,systemCtx}:{activeCase:Case;data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const isClaim=activeCase.counsel_role==='claimant_side';
  const sp={data,onSave,accent,ai,systemCtx};
  const forTabs=[
    {id:'nicn_apl_notice',label:'Notice of Appeal'},
    {id:'nicn_apl_grounds',label:'Grounds of Appeal'},
    {id:'nicn_apl_brief',label:"Appellant's Brief"},
  ];
  const againstTabs=[
    {id:'nicn_resp_brief',label:"Respondent's Brief"},
  ];
  const tabs=isClaim?forTabs:againstTabs;
  const [activeTab,setActiveTab]=useState(isClaim?'nicn_apl_notice':'nicn_resp_brief');
  const draftKeys:Record<string,keyof SavedData>={
    nicn_apl_notice:'nicnAplNoticeDraft',nicn_apl_grounds:'nicnAplGroundsDraft',
    nicn_apl_brief:'nicnAplBriefDraft',nicn_resp_brief:'nicnRespBriefDraft',
  };
  const ctxKeys:Record<string,keyof SavedData>={
    nicn_apl_notice:'nicnAplNoticeContext',nicn_apl_grounds:'nicnAplGroundsContext',
    nicn_apl_brief:'nicnAplBriefContext',nicn_resp_brief:'nicnRespBriefContext',
  };
  const makePrompt=(tabId:string)=>(ctx:string,aCase:any,{partyA,partyB}:{partyA:string;partyB:string})=>{
    const matter=aCase?.caseName??'';
    const intelBlock=buildIntelligenceBlock(aCase);
    if(intelBlock) ctx=`INTELLIGENCE ENGINE OUTPUT (vetted facts — do not contradict):\n${intelBlock}\n\nAdditional facts from counsel (supplemental):\n${ctx||'(none — relying on Intelligence Engine output above)'}`;
    const ps:Record<string,string>={
      nicn_apl_notice:`You are labour counsel for ${partyA} (Appellant) appealing from a NICN/tribunal decision.\n\nMatter: ${matter}\n\nInstructions:\n${ctx}\n\nDraft a complete Notice of Appeal.\n\nSTRUCTURE:\n1. IN THE NATIONAL INDUSTRIAL COURT OF NIGERIA (APPEAL DIVISION) — Appeal No: [to be assigned]\n   BETWEEN: [${partyA.toUpperCase()}] — Appellant AND [${partyB.toUpperCase()}] — Respondent\n2. NOTICE OF APPEAL: [Appellant] appeals from the decision/judgment of [Lower Court/Tribunal] delivered on [date] in [Suit No] on the grounds in the Schedule hereto.\n3. SCHEDULE OF GROUNDS: [as set out in Grounds of Appeal]\n4. RELIEF SOUGHT: set aside / vary / substitute\n5. Signed by Appellant/Counsel/Date\n\nReturn complete Notice of Appeal only.`,
      nicn_apl_grounds:`You are labour counsel for ${partyA} (Appellant).\n\nMatter: ${matter}\n\nGround details:\n${ctx}\n\nDraft the Grounds of Appeal (schedule to the Notice of Appeal).\n\nEach ground must: be numbered; state the error of law/fact/mixed; be self-contained; not contain argument.\n\nCommon NICN grounds: error in NIC Act/Labour Act/CBA interpretation; breach of fair hearing; perverse factual findings; excessive/inadequate award; wrong exercise of discretion.\n\nReturn complete Grounds of Appeal only.`,
      nicn_apl_brief:`You are labour counsel for ${partyA} (Appellant) before the NICN Appeal Division.\n\nMatter: ${matter}\n\nAppellant's arguments:\n${ctx}\n\nDraft a complete Appellant's Brief of Argument.\n\nSTRUCTURE:\n1. IN THE [COURT] — Appeal No / parties / APPELLANT'S BRIEF OF ARGUMENT\n2. INTRODUCTION: nature of appeal; when judgment delivered; when notice filed\n3. ISSUES FOR DETERMINATION (distilled from grounds — not more than 5)\n4. STATEMENT OF FACTS (Appellant's account of proceedings below)\n5. ARGUMENTS — per issue: principle → Nigerian authorities (NICN/SC/CA) → apply → ground supported\n6. CONCLUSION: appeal allowed; judgment set aside; reliefs sought\n7. AUTHORITIES RELIED UPON\n\nReturn complete Appellant's Brief only.`,
      nicn_resp_brief:`You are labour counsel for ${partyB} (Respondent) before the NICN Appeal Division.\n\nMatter: ${matter}\n\nRespondent's arguments:\n${ctx}\n\nDraft a complete Respondent's Brief of Argument.\n\nSTRUCTURE:\n1. RESPONDENT'S BRIEF OF ARGUMENT\n2. INTRODUCTION: urges dismissal of appeal\n3. PRELIMINARY OBJECTION (if any): improper grounds; out of time\n4. ISSUES FOR DETERMINATION (Respondent's formulation)\n5. STATEMENT OF FACTS (support judgment below)\n6. ARGUMENTS — per issue: principle → authorities → apply → defend lower court findings → distinguish Appellant's authorities\n7. CONCLUSION: appeal dismissed; judgment affirmed; costs\n8. AUTHORITIES RELIED UPON\n\nReturn complete Respondent's Brief only.`,
    };
    return ps[tabId]??`Draft ${tabId} for NICN Appeal: ${matter}. Instructions: ${ctx}`;
  };
  const forChecklist=[
    {label:'Notice of Appeal',done:!!data.nicnAplNoticeDraft},
    {label:'Grounds of Appeal',done:!!data.nicnAplGroundsDraft},
    {label:"Appellant's Brief",done:!!data.nicnAplBriefDraft},
  ];
  const againstChecklist=[
    {label:"Respondent's Brief",done:!!data.nicnRespBriefDraft},
  ];
  return (
    <div style={{animation:'fadeUp .3s ease'}}>
      <div style={{marginBottom:24}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
          <span style={{fontSize:18,color:accent}}>⚖</span>
          <h3 style={{fontSize:18,color:T.text,fontFamily:"'Times New Roman', Times, serif",fontWeight:300,margin:0}}>NICN — Notice of Appeal</h3>
          <span style={{fontSize:9,padding:'3px 8px',borderRadius:3,fontFamily:"'Times New Roman', Times, serif",fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',background:`${accent}15`,border:`1px solid ${accent}30`,color:accent}}>
            {isClaim?'Appellant (For)':'Respondent (Against)'}
          </span>
        </div>
        <p style={{fontSize:13,color:T.mute,fontFamily:"'Times New Roman', Times, serif",margin:0}}>Appeal from NICN trial division decisions or labour arbitration awards within NICN appellate jurisdiction.</p>
      </div>
      <ChecklistBanner items={isClaim?forChecklist:againstChecklist} accent={accent}/>
      <SubTabBar tabs={tabs} active={activeTab} onSelect={setActiveTab} accent={accent}/>
      {tabs.map(t=>activeTab===t.id&&(
        <AIDrafter key={t.id} title={t.label}
          description={`Draft the ${t.label} for this NICN Appeal matter.`}
          contextLabel="Instructions & Arguments" contextPlaceholder={`Provide details for the ${t.label}…`}
          draftKey={draftKeys[t.id]} contextKey={ctxKeys[t.id]}
          data={data} onSave={onSave} accent={accent} ai={ai} systemCtx={systemCtx}
          prompt={makePrompt(t.id)} maxTokens={2500}
        />
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 3C — CUSTOMARY COURT ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

function CustomaryCourtEngine({activeCase,data,onSave,accent,ai,systemCtx}:{activeCase:Case;data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const isClaim=activeCase.counsel_role==='claimant_side';
  const sp={data,onSave,accent,ai,systemCtx};
  const forTabs=[
    {id:'cust_summons',label:'Application for Civil Summons'},
    {id:'cust_complaint',label:'Substance of Complaint'},
    {id:'cust_wrapper',label:'Customary Summons Wrapper'},
  ];
  const againstTabs=[
    {id:'cust_def_appearance',label:'Notice of Appearance'},
    {id:'cust_def_stmt',label:'Statement of Defence'},
  ];
  const tabs=isClaim?forTabs:againstTabs;
  const [activeTab,setActiveTab]=useState(isClaim?'cust_summons':'cust_def_appearance');
  const draftKeys:Record<string,keyof SavedData>={
    cust_summons:'custSummonsDraft',cust_complaint:'custComplaintDraft',cust_wrapper:'custWrapperDraft',
    cust_def_appearance:'custDefAppearanceDraft',cust_def_stmt:'custDefStmtDraft',
  };
  const ctxKeys:Record<string,keyof SavedData>={
    cust_summons:'custSummonsContext',cust_complaint:'custComplaintContext',cust_wrapper:'custWrapperContext',
    cust_def_appearance:'custDefAppearanceContext',cust_def_stmt:'custDefStmtContext',
  };
  const makePrompt=(tabId:string)=>(ctx:string,aCase:any,{partyA,partyB}:{partyA:string;partyB:string})=>{
    const matter=aCase?.caseName??'';
    const intelBlock=buildIntelligenceBlock(aCase);
    if(intelBlock) ctx=`INTELLIGENCE ENGINE OUTPUT (vetted facts — do not contradict):\n${intelBlock}\n\nAdditional facts from counsel (supplemental):\n${ctx||'(none — relying on Intelligence Engine output above)'}`;
    const ps:Record<string,string>={
      cust_summons:`You are counsel for ${partyA} (Complainant) before the Customary Court.\n\nMatter: ${matter}\n\nInstructions:\n${ctx}\n\nDraft an Application for Civil Summons (to compel the Respondent to attend and answer the complaint).\n\nSTRUCTURE:\n1. IN THE CUSTOMARY COURT — [State / Area] / SUIT NO: [to be assigned]\n   BETWEEN: [${partyA.toUpperCase()}] — Complainant AND [${partyB.toUpperCase()}] — Respondent\n2. APPLICATION FOR CIVIL SUMMONS\n3. To the Registrar: I/We apply for a summons to be issued against [Respondent] of [address].\n4. Nature of claim: brief statement of customary law right or obligation relied on\n5. Relief sought: [payment / recovery of property / declaration / injunction under customary law]\n6. Complainant's signature / address\n7. Date\n\nFlag [COUNSEL TO SUPPLY] for missing particulars. Return complete Application only.`,
      cust_complaint:`You are counsel for ${partyA} (Complainant) before the Customary Court.\n\nMatter: ${matter}\n\nInstructions:\n${ctx}\n\nDraft the Substance of Complaint — the narrative factual statement of the customary law grievance.\n\nSTRUCTURE:\n1. Heading: SUBSTANCE OF COMPLAINT\n2. Complainant identifies themselves and states capacity (family head, landowner, party to customary transaction, etc.)\n3. Numbered paragraphs (chronological):\n   (a) Parties' relationship and the customary law context\n   (b) The subject matter (land, bride price, inheritance, chieftaincy, debt under customary law)\n   (c) Events giving rise to dispute (dates, actions, defaults)\n   (d) Attempts at resolution under custom (family meetings, community elders — if any)\n   (e) How Respondent's conduct violates customary law or the agreement between parties\n4. RELIEF SOUGHT (specific and customary): recovery of [land/property], payment of [bride price], recognition of [inheritance right], etc.\n5. Signed by Complainant/Counsel\n\nFlag [COUNSEL TO SUPPLY] where needed. Return complete Substance of Complaint only.`,
      cust_wrapper:`You are counsel for ${partyA} before the Customary Court.\n\nMatter: ${matter}\n\nDetails:\n${ctx}\n\nDraft the Customary Summons Wrapper — the court-issued summons document commanding the Respondent to appear.\n\nSTRUCTURE:\n1. IN THE CUSTOMARY COURT — [State / Area] / SUIT NO: [to be assigned]\n2. CUSTOMARY COURT SUMMONS\n3. To: [${partyB.toUpperCase()}] of [address]:\n   YOU ARE HEREBY SUMMONED to appear before this Court on [date] at [time] at [court address] to answer the complaint of [${partyA}].\n4. Nature of claim: [brief statement]\n5. TAKE NOTICE: failure to appear may result in judgment in your absence.\n6. Dated and sealed: Registrar / President of Customary Court\n\nReturn complete Summons Wrapper only.`,
      cust_def_appearance:`You are counsel for ${partyB} (Respondent) before the Customary Court.\n\nMatter: ${matter}\n\nRespondent details:\n${ctx}\n\nDraft a Notice of Appearance in response to the customary summons.\n\nSTRUCTURE:\n1. IN THE CUSTOMARY COURT — Suit No / parties\n2. NOTICE OF APPEARANCE\n3. TAKE NOTICE that [${partyB}] of [address] appears in answer to the summons issued herein.\n4. Respondent [intends to defend the complaint / intends to file a written Statement of Defence / will defend orally at hearing].\n5. Signed by Respondent / Counsel\n\nReturn complete Notice of Appearance only.`,
      cust_def_stmt:`You are counsel for ${partyB} (Respondent) before the Customary Court.\n\nMatter: ${matter}\n\nDefence instructions:\n${ctx}\n\nDraft a Statement of Defence (where written defence is filed — note: oral defence is also permissible before Customary Courts).\n\nSTRUCTURE:\n1. IN THE CUSTOMARY COURT — STATEMENT OF DEFENCE OF [${partyB.toUpperCase()}]\n2. Respondent denies the complaint save as herein admitted.\n3. Numbered paragraphs responding to each allegation in the Substance of Complaint: admit / deny / explanation under customary law\n4. Respondent's version of customary law position (family meetings, recognised custom, prior agreements)\n5. WHEREFORE: complaint dismissed\n6. Signed by Respondent/Counsel\n\nReturn complete Statement of Defence only.`,
    };
    return ps[tabId]??`Draft ${tabId} for Customary Court matter: ${matter}. Instructions: ${ctx}`;
  };
  const forChecklist=[
    {label:'Application for Civil Summons',done:!!data.custSummonsDraft},
    {label:'Substance of Complaint',done:!!data.custComplaintDraft},
    {label:'Customary Summons Wrapper',done:!!data.custWrapperDraft},
  ];
  const againstChecklist=[
    {label:'Notice of Appearance',done:!!data.custDefAppearanceDraft},
    {label:'Statement of Defence',done:!!data.custDefStmtDraft},
  ];
  return (
    <div style={{animation:'fadeUp .3s ease'}}>
      <div style={{marginBottom:24}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
          <span style={{fontSize:18,color:accent}}>🏡</span>
          <h3 style={{fontSize:18,color:T.text,fontFamily:"'Times New Roman', Times, serif",fontWeight:300,margin:0}}>Customary Court — Civil Summons</h3>
          <span style={{fontSize:9,padding:'3px 8px',borderRadius:3,fontFamily:"'Times New Roman', Times, serif",fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',background:`${accent}15`,border:`1px solid ${accent}30`,color:accent}}>
            {isClaim?'Complainant (For)':'Respondent (Against)'}
          </span>
        </div>
        <p style={{fontSize:13,color:T.mute,fontFamily:"'Times New Roman', Times, serif",margin:0}}>Customary law disputes — land, inheritance, bride price, chieftaincy, family property, and obligations arising under native law and custom. Oral defence is permissible.</p>
      </div>
      <ChecklistBanner items={isClaim?forChecklist:againstChecklist} accent={accent}/>
      <SubTabBar tabs={tabs} active={activeTab} onSelect={setActiveTab} accent={accent}/>
      {tabs.map(t=>activeTab===t.id&&(
        <AIDrafter key={t.id} title={t.label}
          description={`Draft the ${t.label} for this Customary Court matter.`}
          contextLabel="Instructions & Facts" contextPlaceholder={`Provide details for the ${t.label}…`}
          draftKey={draftKeys[t.id]} contextKey={ctxKeys[t.id]}
          data={data} onSave={onSave} accent={accent} ai={ai} systemCtx={systemCtx}
          prompt={makePrompt(t.id)} maxTokens={1800}
        />
      ))}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 3C — MAGISTRATE COURT TRACK A (ORDINARY SUMMONS)
// ═══════════════════════════════════════════════════════════════════════════════

function MagistrateTrackAEngine({activeCase,data,onSave,accent,ai,systemCtx}:{activeCase:Case;data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const isClaim=activeCase.counsel_role==='claimant_side';
  const sp={data,onSave,accent,ai,systemCtx};
  const forTabs=[
    {id:'mag_a_praecipe',label:'Praecipe for Summons (Form 1)'},
    {id:'mag_a_particulars',label:'Particulars of Claim'},
    {id:'mag_a_plaint',label:'Plaint Note (Form 2)'},
    {id:'mag_a_witness',label:'Witness Statements'},
  ];
  const againstTabs=[
    {id:'mag_a_def_appearance',label:'Notice of Appearance'},
    {id:'mag_a_def_counter',label:'Counter-Claim / Special Defence'},
  ];
  const tabs=isClaim?forTabs:againstTabs;
  const [activeTab,setActiveTab]=useState(isClaim?'mag_a_praecipe':'mag_a_def_appearance');
  const draftKeys:Record<string,keyof SavedData>={
    mag_a_praecipe:'magAPraecipeDraft',mag_a_particulars:'magAParticularsDraft',
    mag_a_plaint:'magAPlaintNoteDraft',mag_a_witness:'magAWitnessDraft',
    mag_a_def_appearance:'magADefAppearanceDraft',mag_a_def_counter:'magADefCounterDraft',
  };
  const ctxKeys:Record<string,keyof SavedData>={
    mag_a_praecipe:'magAPraecipeContext',mag_a_particulars:'magAParticularsContext',
    mag_a_plaint:'magAPlaintNoteContext',mag_a_witness:'magAWitnessContext',
    mag_a_def_appearance:'magADefAppearanceContext',mag_a_def_counter:'magADefCounterContext',
  };
  const makePrompt=(tabId:string)=>(ctx:string,aCase:any,{partyA,partyB}:{partyA:string;partyB:string})=>{
    const matter=aCase?.caseName??'';
    const intelBlock=buildIntelligenceBlock(aCase);
    if(intelBlock) ctx=`INTELLIGENCE ENGINE OUTPUT (vetted facts — do not contradict):\n${intelBlock}\n\nAdditional facts from counsel (supplemental):\n${ctx||'(none — relying on Intelligence Engine output above)'}`;
    const ps:Record<string,string>={
      mag_a_praecipe:`You are counsel for ${partyA} (Claimant/Plaintiff) before a Magistrate Court (Southern Nigeria).\n\nMatter: ${matter}\n\nInstructions:\n${ctx}\n\nDraft a Praecipe for Summons (Magistrate Court Form 1) — the request to the registrar to issue a summons.\n\nSTRUCTURE:\n1. IN THE MAGISTRATE COURT — [State] / [Magisterial District] / SUIT NO: [to be assigned]\n   BETWEEN: [${partyA.toUpperCase()}] — Claimant AND [${partyB.toUpperCase()}] — Defendant\n2. PRAECIPE FOR SUMMONS (FORM 1)\n3. To the Registrar:\n   Issue a summons in this suit for service on [Defendant] of [address].\n4. Nature of claim: [brief]\n5. Amount claimed / relief sought\n6. Claimant's address for service\n7. Signed by Claimant/Counsel / Date\n\nFlag [COUNSEL TO SUPPLY] where needed. Return complete Praecipe only.`,
      mag_a_particulars:`You are counsel for ${partyA} (Claimant) before the Magistrate Court.\n\nMatter: ${matter}\n\nInstructions:\n${ctx}\n\nDraft Particulars of Claim — the detailed statement of the claimant's cause of action.\n\nSTRUCTURE:\n1. PARTICULARS OF CLAIM — Suit No / parties\n2. Numbered paragraphs (one fact per paragraph):\n   (a) Parties and their relationship\n   (b) The contract/obligation/duty\n   (c) The breach or wrong\n   (d) Loss and damage suffered\n   (e) Any demand made and response (or none)\n3. CLAIM: the Claimant claims from the Defendant:\n   (a) ₦[amount] [or specific relief]\n   (b) Interest at [rate]% per annum from [date]\n   (c) Costs\n4. Signed by Claimant/Counsel\n\nFlag [COUNSEL TO SUPPLY] where needed. Return complete Particulars of Claim only.`,
      mag_a_plaint:`You are counsel for ${partyA} (Claimant) before the Magistrate Court.\n\nMatter: ${matter}\n\nInstructions:\n${ctx}\n\nDraft the Plaint Note (Magistrate Court Form 2) — the court's record of the claim.\n\nSTRUCTURE:\n1. MAGISTRATE COURT — [State] — PLAINT NOTE (FORM 2)\n2. Suit No: [to be assigned] / Date:\n3. Claimant: Name / Address / Occupation\n4. Defendant: Name / Address / Occupation\n5. Nature of claim: [one sentence]\n6. Amount claimed: ₦[amount] (where monetary)\n7. Relief sought: [specific orders]\n8. Hearing date: [to be fixed by court]\n9. Signed: Registrar (court copy) / Counsel (service copy)\n\nReturn complete Plaint Note only.`,
      mag_a_witness:`You are counsel for ${partyA} (Claimant) before the Magistrate Court.\n\nMatter: ${matter}\n\nWitness details:\n${ctx}\n\nDraft a Witness Statement for use at the Magistrate Court hearing.\n\nSTRUCTURE:\n1. IN THE MAGISTRATE COURT — Suit No / parties\n   WITNESS STATEMENT OF [NAME] (PW[number])\n2. \"I, [NAME], of [address], [occupation], state on oath as follows:\"\n3. Numbered paragraphs:\n   - Identity and relationship to Claimant/matter\n   - Knowledge of events (dates, facts, exhibits)\n   - Reference to documentary exhibits: Exhibit [A], [B]…\n4. \"I make this statement knowing that it may be used as evidence in these proceedings.\"\n5. Signed by witness / Jurat\n\nReturn complete Witness Statement only.`,
      mag_a_def_appearance:`You are counsel for ${partyB} (Defendant) before the Magistrate Court.\n\nMatter: ${matter}\n\nDefendant details:\n${ctx}\n\nDraft a Notice of Appearance in response to the Magistrate Court summons.\n\nSTRUCTURE:\n1. IN THE MAGISTRATE COURT — Suit No / parties\n2. NOTICE OF APPEARANCE\n3. TAKE NOTICE that [${partyB}] of [address] appears in answer to the summons.\n4. Defendant [intends to defend the claim / will file a counterclaim / intends to raise a special defence].\n5. Address for service of Defendant/Counsel\n6. Signed by Defendant/Counsel / Date\n\nReturn complete Notice of Appearance only.`,
      mag_a_def_counter:`You are counsel for ${partyB} (Defendant) before the Magistrate Court.\n\nMatter: ${matter}\n\nDefence / counterclaim instructions:\n${ctx}\n\nDraft a Counter-Claim and/or Special Defence for the Magistrate Court.\n\nSTRUCTURE (use whichever sections apply):\n\nPART A — SPECIAL DEFENCE (if applicable):\n1. SPECIAL DEFENCE — [nature: limitation, estoppel, payment, set-off, accord and satisfaction, etc.]\n2. Numbered paragraphs stating the defence\n3. WHEREFORE: claim dismissed\n\nPART B — COUNTER-CLAIM (if applicable):\n1. COUNTER-CLAIM\n2. Particulars of Defendant's claim against Claimant\n3. DEFENDANT CLAIMS: ₦[amount] / [specific relief] / costs\n\nCounsel endorsement for Defendant.\n\nReturn the applicable sections only.`,
    };
    return ps[tabId]??`Draft ${tabId} for Magistrate Court Track A matter: ${matter}. Instructions: ${ctx}`;
  };
  const forChecklist=[
    {label:'Praecipe for Summons (Form 1)',done:!!data.magAPraecipeDraft},
    {label:'Particulars of Claim',done:!!data.magAParticularsDraft},
    {label:'Plaint Note (Form 2)',done:!!data.magAPlaintNoteDraft},
    {label:'Witness Statements',done:!!data.magAWitnessDraft},
  ];
  const againstChecklist=[
    {label:'Notice of Appearance',done:!!data.magADefAppearanceDraft},
    {label:'Counter-Claim / Special Defence',done:!!data.magADefCounterDraft},
  ];
  return (
    <div style={{animation:'fadeUp .3s ease'}}>
      <div style={{marginBottom:24}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
          <span style={{fontSize:18,color:accent}}>⚖</span>
          <h3 style={{fontSize:18,color:T.text,fontFamily:"'Times New Roman', Times, serif",fontWeight:300,margin:0}}>Magistrate Court — Ordinary Summons (Track A)</h3>
          <span style={{fontSize:9,padding:'3px 8px',borderRadius:3,fontFamily:"'Times New Roman', Times, serif",fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',background:`${accent}15`,border:`1px solid ${accent}30`,color:accent}}>
            {isClaim?'Claimant (For)':'Defendant (Against)'}
          </span>
        </div>
        <p style={{fontSize:13,color:T.mute,fontFamily:"'Times New Roman', Times, serif",margin:0}}>General civil claims within Magistrate Court jurisdiction (Southern Nigeria). Ordinary summons track for contract, tort, and property disputes below the High Court monetary threshold.</p>
      </div>
      <ChecklistBanner items={isClaim?forChecklist:againstChecklist} accent={accent}/>
      <SubTabBar tabs={tabs} active={activeTab} onSelect={setActiveTab} accent={accent}/>
      {tabs.map(t=>activeTab===t.id&&(
        <AIDrafter key={t.id} title={t.label}
          description={`Draft the ${t.label} for this Magistrate Court Track A matter.`}
          contextLabel="Instructions & Facts" contextPlaceholder={`Provide details for the ${t.label}…`}
          draftKey={draftKeys[t.id]} contextKey={ctxKeys[t.id]}
          data={data} onSave={onSave} accent={accent} ai={ai} systemCtx={systemCtx}
          prompt={makePrompt(t.id)} maxTokens={1800}
        />
      ))}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 3C — MAGISTRATE COURT TRACK B (DEFAULT SUMMONS / DEBT RECOVERY)
// ═══════════════════════════════════════════════════════════════════════════════

function MagistrateTrackBEngine({activeCase,data,onSave,accent,ai,systemCtx}:{activeCase:Case;data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const isClaim=activeCase.counsel_role==='claimant_side';
  const sp={data,onSave,accent,ai,systemCtx};
  const forTabs=[
    {id:'mag_b_praecipe',label:'Praecipe'},
    {id:'mag_b_particulars',label:'Particulars of Claim'},
    {id:'mag_b_plaint',label:'Plaint Note'},
  ];
  const againstTabs=[
    {id:'mag_b_def_intent',label:'Notice of Intention to Defend'},
    {id:'mag_b_def_affidavit',label:'Affidavit — Good Defence on Merits'},
  ];
  const tabs=isClaim?forTabs:againstTabs;
  const [activeTab,setActiveTab]=useState(isClaim?'mag_b_praecipe':'mag_b_def_intent');
  const draftKeys:Record<string,keyof SavedData>={
    mag_b_praecipe:'magBPraecipeDraft',mag_b_particulars:'magBParticularsDraft',mag_b_plaint:'magBPlaintNoteDraft',
    mag_b_def_intent:'magBDefIntentDraft',mag_b_def_affidavit:'magBDefAffidavitDraft',
  };
  const ctxKeys:Record<string,keyof SavedData>={
    mag_b_praecipe:'magBPraecipeContext',mag_b_particulars:'magBParticularsContext',mag_b_plaint:'magBPlaintNoteContext',
    mag_b_def_intent:'magBDefIntentContext',mag_b_def_affidavit:'magBDefAffidavitContext',
  };
  const makePrompt=(tabId:string)=>(ctx:string,aCase:any,{partyA,partyB}:{partyA:string;partyB:string})=>{
    const matter=aCase?.caseName??'';
    const intelBlock=buildIntelligenceBlock(aCase);
    if(intelBlock) ctx=`INTELLIGENCE ENGINE OUTPUT (vetted facts — do not contradict):\n${intelBlock}\n\nAdditional facts from counsel (supplemental):\n${ctx||'(none — relying on Intelligence Engine output above)'}`;
    const ps:Record<string,string>={
      mag_b_praecipe:`You are counsel for ${partyA} (Claimant/Creditor) before a Magistrate Court — Default Summons (Debt Recovery) track.\n\nMatter: ${matter}\n\nInstructions:\n${ctx}\n\nDraft a Praecipe for Default Summons — application to issue a default summons for recovery of a liquidated debt.\n\nSTRUCTURE:\n1. IN THE MAGISTRATE COURT — [State] / [Magisterial District] / SUIT NO: [to be assigned]\n   BETWEEN: [${partyA.toUpperCase()}] — Claimant AND [${partyB.toUpperCase()}] — Defendant\n2. PRAECIPE FOR DEFAULT SUMMONS\n3. To the Registrar:\n   Issue a DEFAULT SUMMONS against [Defendant] of [address] for a liquidated debt of ₦[amount].\n4. Brief particulars of debt: [how it arose, when due]\n5. Claimant's address for service\n6. Signed by Claimant/Counsel / Date\n\nFlag [COUNSEL TO SUPPLY] where needed. Return complete Praecipe only.`,
      mag_b_particulars:`You are counsel for ${partyA} (Claimant/Creditor) before the Magistrate Court — Default Summons track.\n\nMatter: ${matter}\n\nInstructions:\n${ctx}\n\nDraft Particulars of Claim for a liquidated debt recovery action.\n\nSTRUCTURE:\n1. PARTICULARS OF CLAIM (LIQUIDATED DEBT) — Suit No / parties\n2. Numbered paragraphs:\n   (a) Parties\n   (b) How the debt arose (contract, loan, services rendered, goods supplied — with dates)\n   (c) Amount due and owing\n   (d) Demand made on [date] and failure to pay\n3. CLAIM: ₦[amount] + interest at [rate]% per annum from [date] + costs\n4. NOTE: This is a liquidated demand — amount is certain and not subject to assessment.\n5. Signed by Claimant/Counsel\n\nFlag [COUNSEL TO SUPPLY] where needed. Return complete Particulars only.`,
      mag_b_plaint:`You are counsel for ${partyA} (Claimant) before the Magistrate Court — Default Summons track.\n\nMatter: ${matter}\n\nDetails:\n${ctx}\n\nDraft the Plaint Note for a Default Summons matter. Same Form 2 structure but mark clearly as DEFAULT SUMMONS for a liquidated claim. Include: court heading; parties; amount; nature (liquidated debt); hearing date (to be fixed); registrar signature block.\n\nReturn complete Plaint Note only.`,
      mag_b_def_intent:`You are counsel for ${partyB} (Defendant/Debtor) before the Magistrate Court — Default Summons track.\n\nMatter: ${matter}\n\nDefendant's position:\n${ctx}\n\nDraft a Notice of Intention to Defend — the document filed to prevent default judgment from being entered against the Defendant.\n\nSTRUCTURE:\n1. IN THE MAGISTRATE COURT — Suit No / parties\n2. NOTICE OF INTENTION TO DEFEND\n3. TAKE NOTICE that [${partyB}] of [address] intends to defend the claim herein.\n4. Brief grounds for defence: [debt disputed / paid / set-off / statute-barred / defective service]\n5. Defendant undertakes to file an Affidavit Disclosing a Good Defence on the Merits.\n6. Signed by Defendant/Counsel / Date\n\nReturn complete Notice only.`,
      mag_b_def_affidavit:`You are counsel for ${partyB} (Defendant/Debtor) before the Magistrate Court — Default Summons track.\n\nMatter: ${matter}\n\nDefendant's factual position:\n${ctx}\n\nDraft an Affidavit Disclosing a Good Defence on the Merits — required to resist default judgment on a liquidated claim.\n\nSTRUCTURE:\n1. IN THE MAGISTRATE COURT — AFFIDAVIT DISCLOSING GOOD DEFENCE ON THE MERITS\n2. \"I, [NAME], of [address], [occupation], make oath and state:\"\n3. Numbered paragraphs:\n   (a) Defendant's identity and capacity\n   (b) The claim is [disputed / fully paid / partially paid]: specific facts\n   (c) Date(s) and mode(s) of payment (if any) with exhibit references\n   (d) Legal defence relied on: set-off / counterclaim / statute of limitations / invalidity of contract\n   (e) Defence is bona fide and not for delay\n4. WHEREFORE: application for leave to defend unconditionally (or conditionally)\n5. Jurat\n\nFlag [COUNSEL TO SUPPLY] where needed. Return complete Affidavit only.`,
    };
    return ps[tabId]??`Draft ${tabId} for Magistrate Court Track B debt recovery matter: ${matter}. Instructions: ${ctx}`;
  };
  const forChecklist=[
    {label:'Praecipe',done:!!data.magBPraecipeDraft},
    {label:'Particulars of Claim',done:!!data.magBParticularsDraft},
    {label:'Plaint Note',done:!!data.magBPlaintNoteDraft},
  ];
  const againstChecklist=[
    {label:'Notice of Intention to Defend',done:!!data.magBDefIntentDraft},
    {label:'Affidavit — Good Defence on Merits',done:!!data.magBDefAffidavitDraft},
  ];
  return (
    <div style={{animation:'fadeUp .3s ease'}}>
      <div style={{marginBottom:24}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
          <span style={{fontSize:18,color:accent}}>💰</span>
          <h3 style={{fontSize:18,color:T.text,fontFamily:"'Times New Roman', Times, serif",fontWeight:300,margin:0}}>Magistrate Court — Default Summons (Track B)</h3>
          <span style={{fontSize:9,padding:'3px 8px',borderRadius:3,fontFamily:"'Times New Roman', Times, serif",fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',background:`${accent}15`,border:`1px solid ${accent}30`,color:accent}}>
            {isClaim?'Claimant / Creditor (For)':'Defendant / Debtor (Against)'}
          </span>
        </div>
        <p style={{fontSize:13,color:T.mute,fontFamily:"'Times New Roman', Times, serif",margin:0}}>Fast-track debt recovery for liquidated claims before the Magistrate Court (Southern Nigeria). Defendant must file a Notice of Intention to Defend and Affidavit of Merits to resist default judgment.</p>
      </div>
      <ChecklistBanner items={isClaim?forChecklist:againstChecklist} accent={accent}/>
      <SubTabBar tabs={tabs} active={activeTab} onSelect={setActiveTab} accent={accent}/>
      {tabs.map(t=>activeTab===t.id&&(
        <AIDrafter key={t.id} title={t.label}
          description={`Draft the ${t.label} for this Magistrate Court Track B (debt) matter.`}
          contextLabel="Instructions & Facts" contextPlaceholder={`Provide details for the ${t.label}…`}
          draftKey={draftKeys[t.id]} contextKey={ctxKeys[t.id]}
          data={data} onSave={onSave} accent={accent} ai={ai} systemCtx={systemCtx}
          prompt={makePrompt(t.id)} maxTokens={1800}
        />
      ))}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 3C — SMALL CLAIMS COURT ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

function SmallClaimsEngine({activeCase,data,onSave,accent,ai,systemCtx}:{activeCase:Case;data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const isClaim=activeCase.counsel_role==='claimant_side';
  const sp={data,onSave,accent,ai,systemCtx};
  const forTabs=[
    {id:'sca_demand',label:'Form SCA 1 — Demand Letter'},
    {id:'sca_claim',label:'Form SCA 2 & SCA 3 — Claim Forms'},
  ];
  const againstTabs=[
    {id:'sca_def_response',label:'Form SCA 5 — Defence / Counterclaim'},
  ];
  const tabs=isClaim?forTabs:againstTabs;
  const [activeTab,setActiveTab]=useState(isClaim?'sca_demand':'sca_def_response');
  const draftKeys:Record<string,keyof SavedData>={
    sca_demand:'scaDemandDraft',sca_claim:'scaClaimFormDraft',sca_def_response:'scaDefResponseDraft',
  };
  const ctxKeys:Record<string,keyof SavedData>={
    sca_demand:'scaDemandContext',sca_claim:'scaClaimFormContext',sca_def_response:'scaDefResponseContext',
  };
  const makePrompt=(tabId:string)=>(ctx:string,aCase:any,{partyA,partyB}:{partyA:string;partyB:string})=>{
    const matter=aCase?.caseName??'';
    const intelBlock=buildIntelligenceBlock(aCase);
    if(intelBlock) ctx=`INTELLIGENCE ENGINE OUTPUT (vetted facts — do not contradict):\n${intelBlock}\n\nAdditional facts from counsel (supplemental):\n${ctx||'(none — relying on Intelligence Engine output above)'}`;
    const ps:Record<string,string>={
      sca_demand:`You are counsel for ${partyA} (Claimant) before the Small Claims Court (Fast-Track Magistrate Division).\n\nMatter: ${matter}\n\nInstructions:\n${ctx}\n\nDraft a 7-Day Letter of Demand (Form SCA 1) — the mandatory pre-filing demand required before issuing small claims proceedings.\n\nSTRUCTURE:\n1. [${partyA}'s address]\n2. Date\n3. [${partyB}'s address]\n4. LETTER OF DEMAND (SMALL CLAIMS — FORM SCA 1)\n5. Dear Sir/Madam,\n6. RE: DEMAND FOR PAYMENT OF ₦[AMOUNT] — [BRIEF DESCRIPTION OF CLAIM]\n7. Body:\n   (a) Basis of claim: [contract, services, goods, loan — with dates and amounts]\n   (b) Total amount owed: ₦[amount] (itemise if multiple heads)\n   (c) DEMAND: payment in full within SEVEN (7) DAYS of this letter\n   (d) Consequence: failure will result in proceedings at the Small Claims Court without further notice\n8. Signed by Claimant/Counsel\n\nPre-filing note: retain proof of delivery. Flag [COUNSEL TO SUPPLY] where needed. Return complete SCA 1 only.`,
      sca_claim:`You are counsel for ${partyA} (Claimant) before the Small Claims Court.\n\nMatter: ${matter}\n\nInstructions:\n${ctx}\n\nDraft Form SCA 2 (Claim Form) and Form SCA 3 (Statement of Claim / Particulars) for filing at the Small Claims Court.\n\nFORM SCA 2 — SMALL CLAIMS COURT CLAIM FORM:\n1. Court heading: SMALL CLAIMS COURT — [State] / [Magistrate District] / SUIT NO: [to be assigned]\n2. Claimant: Full name / address / phone / email\n3. Defendant: Full name / address / phone / email\n4. Amount claimed: ₦[amount]\n5. Brief description of claim (one sentence)\n6. Supporting documents annexed: [list receipts/contracts/invoices]\n7. Claimant's signature / Date\n\nFORM SCA 3 — PARTICULARS OF CLAIM (small claims version):\n1. Heading: PARTICULARS OF CLAIM\n2. Numbered paragraphs (plain language):\n   (a) What the Defendant owes and why\n   (b) Dates, amounts, transactions\n   (c) Demand made: SCA 1 letter dated [date]; no response / partial payment only\n3. CLAIM: ₦[amount] + costs\n4. Annexed evidence: receipts, invoices, agreements, photographs — listed as Exhibit A, B, C…\n\nFlag [COUNSEL TO SUPPLY] where needed. Return both forms clearly delineated.`,
      sca_def_response:`You are counsel for ${partyB} (Defendant) before the Small Claims Court.\n\nMatter: ${matter}\n\nDefendant's position:\n${ctx}\n\nDraft Form SCA 5 — the combined Admission / Defence / Counterclaim response sheet for the Small Claims Court.\n\nFORM SCA 5 — ADMISSION / DEFENCE / COUNTERCLAIM:\n1. Court heading: SMALL CLAIMS COURT — Suit No / parties\n2. SECTION A — DEFENDANT'S RESPONSE (tick and complete the applicable option):\n   ☐ FULL ADMISSION: I admit the full claim of ₦[amount] and propose to pay by [date/instalments]\n   ☐ PARTIAL ADMISSION: I admit ₦[amount] only. Reason for partial admission: [explain]\n   ☐ FULL DEFENCE: I deny the claim entirely. Grounds:\n3. SECTION B — GROUNDS OF DEFENCE (where disputing):\n   Numbered paragraphs: deny each allegation with specific facts; state date(s) and mode(s) of payment if already paid; exhibit receipts/correspondence marked Exhibit D1, D2…\n4. SECTION C — COUNTERCLAIM (if applicable):\n   Defendant's claim against Claimant: ₦[amount] for [brief reason]\n5. Defendant's address for service / phone / email\n6. Signed by Defendant/Counsel / Date\n\nFlag [COUNSEL TO SUPPLY] where needed. Return complete Form SCA 5 only.`,
    };
    return ps[tabId]??`Draft ${tabId} for Small Claims Court matter: ${matter}. Instructions: ${ctx}`;
  };
  const forChecklist=[
    {label:'Form SCA 1 — 7-Day Demand',done:!!data.scaDemandDraft},
    {label:'Form SCA 2 & SCA 3 — Claim Forms',done:!!data.scaClaimFormDraft},
  ];
  const againstChecklist=[
    {label:'Form SCA 5 — Defence / Counterclaim',done:!!data.scaDefResponseDraft},
  ];
  return (
    <div style={{animation:'fadeUp .3s ease'}}>
      <div style={{marginBottom:24}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
          <span style={{fontSize:18,color:accent}}>🗂</span>
          <h3 style={{fontSize:18,color:T.text,fontFamily:"'Times New Roman', Times, serif",fontWeight:300,margin:0}}>Small Claims Court — Fast-Track</h3>
          <span style={{fontSize:9,padding:'3px 8px',borderRadius:3,fontFamily:"'Times New Roman', Times, serif",fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',background:`${accent}15`,border:`1px solid ${accent}30`,color:accent}}>
            {isClaim?'Claimant (For)':'Defendant (Against)'}
          </span>
        </div>
        <p style={{fontSize:13,color:T.mute,fontFamily:"'Times New Roman', Times, serif",margin:0}}>Fast-track Magistrate Division for small civil claims. 7-day pre-filing demand (SCA 1) is mandatory. Simple, plain-language forms. Parties may appear without legal representation.</p>
        {isClaim&&<div style={{marginTop:12,background:`${accent}08`,border:`1px solid ${accent}20`,borderRadius:7,padding:'10px 14px'}}><p style={{fontSize:12,color:accent,fontFamily:"'Times New Roman', Times, serif",margin:0}}>⚠ <strong>Pre-filing:</strong> SCA 1 demand must be served and 7 days must have elapsed before filing SCA 2 & SCA 3. Retain proof of delivery.</p></div>}
      </div>
      <ChecklistBanner items={isClaim?forChecklist:againstChecklist} accent={accent}/>
      <SubTabBar tabs={tabs} active={activeTab} onSelect={setActiveTab} accent={accent}/>
      {tabs.map(t=>activeTab===t.id&&(
        <AIDrafter key={t.id} title={t.label}
          description={`Draft the ${t.label} for this Small Claims Court matter.`}
          contextLabel="Instructions & Facts" contextPlaceholder={`Provide details for the ${t.label}…`}
          draftKey={draftKeys[t.id]} contextKey={ctxKeys[t.id]}
          data={data} onSave={onSave} accent={accent} ai={ai} systemCtx={systemCtx}
          prompt={makePrompt(t.id)} maxTokens={1600}
        />
      ))}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 3D — ELECTION PETITIONS TRIBUNAL ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

function ElectionPetitionEngine({activeCase,data,onSave,accent,ai,systemCtx}:{activeCase:Case;data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const isClaim=activeCase.counsel_role==='claimant_side';
  const sp={data,onSave,accent,ai,systemCtx};
  const forTabs=[
    {id:'ept_petition',label:'Election Petition (TF 001)'},
    {id:'ept_grounds',label:'Grounds of Petition'},
    {id:'ept_witness_list',label:'List of Witnesses'},
    {id:'ept_depositions',label:'Pre-trial Witness Depositions'},
    {id:'ept_doc_schedule',label:'Documentary Evidence Schedule'},
    {id:'ept_address',label:'Written Address'},
  ];
  const againstTabs=[
    {id:'ept_resp_reply',label:"Respondent's Reply to Petition"},
    {id:'ept_resp_witness',label:'List of Witnesses'},
    {id:'ept_resp_dep',label:'Pre-trial Witness Depositions'},
    {id:'ept_resp_doc',label:'Documentary Evidence Schedule'},
    {id:'ept_resp_address',label:'Written Address in Opposition'},
  ];
  const tabs=isClaim?forTabs:againstTabs;
  const [activeTab,setActiveTab]=useState(isClaim?'ept_petition':'ept_resp_reply');
  const draftKeys:Record<string,keyof SavedData>={
    ept_petition:'eptPetitionDraft',ept_grounds:'eptGroundsDraft',ept_witness_list:'eptWitnessListDraft',
    ept_depositions:'eptDepositionsDraft',ept_doc_schedule:'eptDocScheduleDraft',ept_address:'eptAddressDraft',
    ept_resp_reply:'eptRespReplyDraft',ept_resp_witness:'eptRespWitnessDraft',
    ept_resp_dep:'eptRespWitnessDraft',ept_resp_doc:'eptRespDocDraft',ept_resp_address:'eptRespAddressDraft',
  };
  const ctxKeys:Record<string,keyof SavedData>={
    ept_petition:'eptPetitionContext',ept_grounds:'eptGroundsContext',ept_witness_list:'eptWitnessListContext',
    ept_depositions:'eptDepositionsContext',ept_doc_schedule:'eptDocScheduleContext',ept_address:'eptAddressContext',
    ept_resp_reply:'eptRespReplyContext',ept_resp_witness:'eptRespWitnessContext',
    ept_resp_dep:'eptRespWitnessContext',ept_resp_doc:'eptRespDocContext',ept_resp_address:'eptRespAddressContext',
  };
  const makePrompt=(tabId:string)=>(ctx:string,aCase:any,{partyA,partyB}:{partyA:string;partyB:string})=>{
    const matter=aCase?.caseName??'';
    const intelBlock=buildIntelligenceBlock(aCase);
    if(intelBlock) ctx=`INTELLIGENCE ENGINE OUTPUT (vetted facts — do not contradict):\n${intelBlock}\n\nAdditional facts from counsel (supplemental):\n${ctx||'(none — relying on Intelligence Engine output above)'}`;
    const ps:Record<string,string>={
      ept_petition:`You are Nigerian election litigation counsel acting for ${partyA} (Petitioner) before the Election Petitions Tribunal.\n\nMatter: ${matter}\n\nInstructions:\n${ctx}\n\nDraft a complete Election Petition (Form TF 001) under the Electoral Act 2022 and the First Schedule (Election Tribunal and Court Practice Directions).\n\nSTRUCTURE:\n1. ELECTION PETITIONS TRIBUNAL — [State / Federal Constituency / Senatorial District] — EPT/[STATE]/[NO]/[YEAR]\n2. PARTIES: [${partyA}] — Petitioner; [${partyB}] — 1st Respondent; INEC — 2nd Respondent; Returning Officer — 3rd Respondent (as applicable)\n3. ELECTION PETITION\n4. Introduction: office contested, date of election, date of declaration of result\n5. Petitioner's qualification and interest (candidate / political party)\n6. GROUNDS OF PETITION (reserved for Grounds document — reference them here)\n7. PARTICULARS: detailed factual particulars supporting each ground\n8. RELIEFS SOUGHT:\n   (a) Declaration that the election is void / Petitioner was duly elected\n   (b) Cancellation of return of ${partyB}\n   (c) Issuance of certificate of return to Petitioner\n   (d) Costs\n9. Certificate of compliance (Practice Directions requirement)\n10. Signed: ${partyA} / Counsel\n\nFiling note: must be presented within 21 days of declaration of result (Electoral Act 2022 s.134). Flag [COUNSEL TO SUPPLY] where needed. Return complete Petition only.`,
      ept_grounds:`You are election litigation counsel for ${partyA} (Petitioner) before the Election Petitions Tribunal.\n\nMatter: ${matter}\n\nInstructions:\n${ctx}\n\nDraft detailed Grounds of Petition under the Electoral Act 2022.\n\nAnalyse and draft each applicable ground:\nGROUND 1 — NON-QUALIFICATION: ${partyB} was at the time of the election not qualified to contest (specify disqualification under s.137 CFRN / party constitution)\nGROUND 2 — CORRUPT PRACTICES: votes were procured by bribery, treating, undue influence (Electoral Act 2022 s.149; with specific acts, dates, locations, agents)\nGROUND 3 — NON-COMPLIANCE WITH ELECTORAL ACT: election was not conducted substantially in accordance with the Electoral Act 2022 (failure to use BVAS / IReV; unlawful exclusion; over-voting — with polling unit details)\nGROUND 4 — INVALID RETURN: return of ${partyB} was invalid as the majority of lawful votes were cast in favour of the Petitioner\n\nFor each applicable ground:\n(a) State the ground in clear terms\n(b) Provide detailed particulars (polling units, ward codes, figures, agents, dates, witnesses)\n(c) Reference the Electoral Act 2022 provision\n\nFlag [COUNSEL TO SUPPLY] where needed. Return Grounds document only.`,
      ept_witness_list:`You are election litigation counsel for ${partyA} (Petitioner).\n\nMatter: ${matter}\n\nWitness details:\n${ctx}\n\nDraft the formal List of Witnesses for the Election Petitions Tribunal.\n\nSTRUCTURE:\n1. Heading: ELECTION PETITIONS TRIBUNAL — Suit No / Parties\n2. PETITIONER'S LIST OF WITNESSES\n3. Numbered table:\n   No. | Witness Name | Address | Subject of Testimony (brief — polling unit, role, what observed)\n4. Note: Pre-trial witness depositions will be filed separately per the Practice Directions.\n5. Signed: Counsel for Petitioner / Date\n\nFlag [COUNSEL TO SUPPLY] where needed. Return List only.`,
      ept_depositions:`You are election litigation counsel for ${partyA} (Petitioner).\n\nMatter: ${matter}\n\nWitness details and facts to be deposed:\n${ctx}\n\nDraft Pre-trial Witness Depositions (sworn written statements) for the Election Petitions Tribunal, in compliance with the Election Tribunal Practice Directions.\n\nFor EACH witness, draft a complete deposition:\n1. DEPOSITION OF [WITNESS NAME] — WITNESS NO [X]\n2. \"I, [NAME], of [address], [occupation], make oath and state as follows:\"\n3. Numbered paragraphs:\n   (a) Identity and role on election day (agent / observer / party official / voter)\n   (b) Polling unit / ward / LGA / constituency\n   (c) Specific observations of irregularities, malpractice, or non-compliance (BVAS malfunction; ballot stuffing; unlawful exclusion; result alteration)\n   (d) Figures: votes cast, voided, announced, actual\n   (e) Exhibits referred to: Exhibit [P1], [P2]…\n4. JURAT: sworn before [Commissioner for Oaths / Magistrate] at [place] on [date]\n\nFlag [COUNSEL TO SUPPLY] for missing particulars. Return all depositions.`,
      ept_doc_schedule:`You are election litigation counsel for ${partyA} (Petitioner).\n\nMatter: ${matter}\n\nDocuments available:\n${ctx}\n\nDraft the Documentary Evidence Schedule for the Election Petitions Tribunal.\n\nSTRUCTURE:\n1. Heading: PETITIONER'S DOCUMENTARY EVIDENCE SCHEDULE — Suit No / Parties\n2. Table:\n   Exhibit No | Description | Date | Relevance to Ground(s)\n3. Standard election petition exhibits to include (as applicable):\n   P1 — Result Sheet (Form EC8A) for affected polling units\n   P2 — Collation Sheet (Form EC8B)\n   P3 — INEC Declaration of Result (Form EC8E / EC9)\n   P4 — Certificate of Return issued to ${partyB}\n   P5 — Party's nomination form / Certificate of Return (Petitioner)\n   P6 — BVAS machine printout / IReV screenshots\n   P7 — Voters' Register extract\n   P8 — Police / military deployment records\n   P9 — Photographs / video evidence\n   P10 — Witness statements not yet filed as depositions\n4. Signed: Counsel for Petitioner / Date\n\nFlag [COUNSEL TO SUPPLY] where needed. Return Schedule only.`,
      ept_address:`You are election litigation counsel for ${partyA} (Petitioner).\n\nMatter: ${matter}\n\nArguments and evidence summary:\n${ctx}\n\nDraft a comprehensive Written Address in support of the Election Petition.\n\nSTRUCTURE:\n1. Heading: WRITTEN ADDRESS IN SUPPORT OF ELECTION PETITION — Suit No / Parties\n2. INTRODUCTION: nature of petition and reliefs sought\n3. ISSUES FOR DETERMINATION: formulate 3–6 issues distilled from grounds\n4. ARGUMENTS on each issue:\n   (a) Legal framework: Electoral Act 2022 provisions; Supreme Court / Court of Appeal decisions on the issue\n   (b) Factual application: evidence from depositions and documents\n   (c) Effect of non-compliance: whether substantial non-compliance affected result\n5. CONCLUSION AND RELIEFS SOUGHT\n6. Signed: Counsel for Petitioner / Date\n\nIncorporate recent INEC v [Petitioner] / [Petitioner] v INEC authorities where relevant. Flag [COUNSEL TO SUPPLY] where needed. Return complete Written Address only.`,
      ept_resp_reply:`You are election litigation counsel for ${partyB} (Respondent) before the Election Petitions Tribunal.\n\nMatter: ${matter}\n\nRespondent's position:\n${ctx}\n\nDraft a complete Respondent's Reply to the Election Petition.\n\nSTRUCTURE:\n1. Heading: RESPONDENT'S REPLY TO ELECTION PETITION — Suit No / Parties\n2. PRELIMINARY OBJECTION (if any): challenge jurisdiction, competence, locus standi, or time-bar (21-day rule)\n3. REPLY TO PETITION:\n   For each paragraph of the Petition — admit, deny, or state Respondent has no knowledge\n4. AFFIRMATIVE DEFENCE:\n   (a) The election was free, fair, and conducted substantially in accordance with the Electoral Act 2022\n   (b) ${partyB} was duly qualified and validly returned\n   (c) BVAS and IReV results are presumed correct and were not challenged at primary source\n   (d) Petitioner lacks credible evidence of alleged non-compliance\n5. RELIEFS SOUGHT: Petition dismissed; Respondent's return confirmed; costs\n6. Signed: Counsel for Respondent / Date\n\nFlag [COUNSEL TO SUPPLY] where needed. Return complete Reply only.`,
      ept_resp_doc:`You are election litigation counsel for ${partyB} (Respondent).\n\nMatter: ${matter}\n\nRespondent's documents:\n${ctx}\n\nDraft the Respondent's Documentary Evidence Schedule for the Election Petitions Tribunal.\n\nSTRUCTURE:\n1. Heading: RESPONDENT'S DOCUMENTARY EVIDENCE SCHEDULE — Suit No / Parties\n2. Table:\n   Exhibit No | Description | Date | Relevance\n3. Standard respondent exhibits (as applicable):\n   R1 — Certificate of Return issued to Respondent\n   R2 — INEC Declaration of Result (Form EC8E / EC9)\n   R3 — Nomination / screening clearance documents\n   R4 — Certified True Copy of BVAS printout for affected units\n   R5 — Affidavit of non-manipulation from Returning Officer (if available)\n   R6 — Security forces deployment orders (no intimidation)\n   R7 — Voter accreditation records for disputed units\n4. Signed: Counsel for Respondent / Date\n\nFlag [COUNSEL TO SUPPLY] where needed. Return Schedule only.`,
      ept_resp_address:`You are election litigation counsel for ${partyB} (Respondent).\n\nMatter: ${matter}\n\nRespondent's arguments:\n${ctx}\n\nDraft a Written Address in Opposition to the Election Petition.\n\nSTRUCTURE:\n1. Heading: RESPONDENT'S WRITTEN ADDRESS IN OPPOSITION — Suit No / Parties\n2. INTRODUCTION\n3. PRELIMINARY OBJECTION ARGUMENT (if filed): jurisdiction / competence / time-bar / locus\n4. ISSUES FOR DETERMINATION: adopt Petitioner's issues or reformulate in Respondent's favour\n5. ARGUMENTS:\n   (a) Burden of proof in election petitions lies on the Petitioner — Buhari v INEC\n   (b) Standard: proof beyond balance of probabilities for corrupt practices; substantial compliance standard for procedural non-compliance\n   (c) BVAS/IReV data are presumed authentic unless specifically challenged at unit level\n   (d) Petitioner's witnesses unreliable / depositions defective\n   (e) No credible evidence of scores sufficient to alter result\n6. CONCLUSION: Petition lacks merit; dismiss with costs\n7. Signed: Counsel for Respondent / Date\n\nFlag [COUNSEL TO SUPPLY] where needed. Return complete Written Address only.`,
      ept_resp_witness:`You are election litigation counsel for ${partyB} (Respondent) before the Election Petitions Tribunal.\n\nMatter: ${matter}\n\nWitness details:\n${ctx}\n\nDraft the formal Respondent's List of Witnesses for the Election Petitions Tribunal.\n\nSTRUCTURE:\n1. Heading: ELECTION PETITIONS TRIBUNAL — Suit No / Parties\n2. RESPONDENT'S LIST OF WITNESSES\n3. Numbered table with four columns:\n   No. | Witness Name | Address | Subject of Testimony\n   Subject column should state the specific matter each witness will testify to — e.g.:\n   - Validity of the election and declaration of result in [Constituency]\n   - Conduct of INEC officials and accreditation process at [polling unit / ward]\n   - Integrity of BVAS deployment and result transmission via IReV\n   - Collation of results at ward / LGA / state level\n   - Respondent's qualification and eligibility to contest\n   - Absence of corrupt practices, inducement, or violence\n4. Practice Directions note: In accordance with the Election Tribunal and Court Practice Directions, pre-trial witness depositions for all listed witnesses will be filed and exchanged before the pre-trial conference. Oral evidence in chief shall not be led except by leave of the Tribunal.\n5. Signed: Counsel for Respondent / Date\n\nFlag [COUNSEL TO SUPPLY] where needed. Return Respondent's List of Witnesses only.`,
    };
    return ps[tabId]??`Draft ${tabId} for Election Petitions Tribunal matter: ${matter}. Instructions: ${ctx}`;
  };
  const forChecklist=[
    {label:'Election Petition (TF 001)',done:!!data.eptPetitionDraft},
    {label:'Grounds of Petition',done:!!data.eptGroundsDraft},
    {label:'List of Witnesses',done:!!data.eptWitnessListDraft},
    {label:'Pre-trial Depositions',done:!!data.eptDepositionsDraft},
    {label:'Doc Evidence Schedule',done:!!data.eptDocScheduleDraft},
    {label:'Written Address',done:!!data.eptAddressDraft},
  ];
  const againstChecklist=[
    {label:"Reply to Petition",done:!!data.eptRespReplyDraft},
    {label:'List of Witnesses',done:!!data.eptRespWitnessDraft},
    {label:'Doc Evidence Schedule',done:!!data.eptRespDocDraft},
    {label:'Written Address in Opposition',done:!!data.eptRespAddressDraft},
  ];
  return (
    <div style={{animation:'fadeUp .3s ease'}}>
      <div style={{marginBottom:24}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
          <span style={{fontSize:18,color:accent}}>🗳</span>
          <h3 style={{fontSize:18,color:T.text,fontFamily:"'Times New Roman', Times, serif",fontWeight:300,margin:0}}>Election Petitions Tribunal</h3>
          <span style={{fontSize:9,padding:'3px 8px',borderRadius:3,fontFamily:"'Times New Roman', Times, serif",fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',background:`${accent}15`,border:`1px solid ${accent}30`,color:accent}}>
            {isClaim?'Petitioner (For)':'Respondent (Against)'}
          </span>
        </div>
        <p style={{fontSize:13,color:T.mute,fontFamily:"'Times New Roman', Times, serif",margin:0}}>Election Petitions Tribunal — Electoral Act 2022. Governed by the Election Tribunal and Court Practice Directions. Pre-trial depositions replace live oral evidence in chief.</p>
        {isClaim&&<div style={{marginTop:12,background:`${accent}08`,border:`1px solid ${accent}20`,borderRadius:7,padding:'10px 14px'}}><p style={{fontSize:12,color:accent,fontFamily:"'Times New Roman', Times, serif",margin:0}}>⚠ <strong>Jurisdictional deadline:</strong> Election petition must be filed within 21 days of the declaration of result (Electoral Act 2022 s.134). This deadline is absolute and non-extendable.</p></div>}
      </div>
      <ChecklistBanner items={isClaim?forChecklist:againstChecklist} accent={accent}/>
      <SubTabBar tabs={tabs} active={activeTab} onSelect={setActiveTab} accent={accent}/>
      {tabs.map(t=>activeTab===t.id&&(
        <AIDrafter key={t.id} title={t.label}
          description={`Draft the ${t.label} for this Election Petition matter.`}
          contextLabel="Instructions & Facts" contextPlaceholder={`Provide details for the ${t.label}…`}
          draftKey={draftKeys[t.id]} contextKey={ctxKeys[t.id]}
          data={data} onSave={onSave} accent={accent} ai={ai} systemCtx={systemCtx}
          prompt={makePrompt(t.id)} maxTokens={2200}
        />
      ))}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 3D — TAX APPEAL TRIBUNAL ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

function TaxAppealEngine({activeCase,data,onSave,accent,ai,systemCtx}:{activeCase:Case;data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const isClaim=activeCase.counsel_role==='claimant_side';
  const sp={data,onSave,accent,ai,systemCtx};
  const forTabs=[
    {id:'tat_notice',label:'Notice of Appeal (TAT Form 1)'},
    {id:'tat_grounds',label:'Grounds of Appeal'},
    {id:'tat_stmt_facts',label:'Statement of Facts'},
    {id:'tat_doc_list',label:'List of Documents'},
    {id:'tat_submission',label:'Written Submission'},
  ];
  const againstTabs=[
    {id:'tat_resp_stmt',label:"Respondent's Statement of Facts"},
    {id:'tat_resp_doc',label:'List of Documents'},
    {id:'tat_resp_submission',label:'Written Submission in Opposition'},
  ];
  const tabs=isClaim?forTabs:againstTabs;
  const [activeTab,setActiveTab]=useState(isClaim?'tat_notice':'tat_resp_stmt');
  const draftKeys:Record<string,keyof SavedData>={
    tat_notice:'tatNoticeDraft',tat_grounds:'tatGroundsDraft',tat_stmt_facts:'tatStmtFactsDraft',
    tat_doc_list:'tatDocListDraft',tat_submission:'tatSubmissionDraft',
    tat_resp_stmt:'tatRespStmtDraft',tat_resp_doc:'tatRespDocDraft',tat_resp_submission:'tatRespSubmissionDraft',
  };
  const ctxKeys:Record<string,keyof SavedData>={
    tat_notice:'tatNoticeContext',tat_grounds:'tatGroundsContext',tat_stmt_facts:'tatStmtFactsContext',
    tat_doc_list:'tatDocListContext',tat_submission:'tatSubmissionContext',
    tat_resp_stmt:'tatRespStmtContext',tat_resp_doc:'tatRespDocContext',tat_resp_submission:'tatRespSubmissionContext',
  };
  const makePrompt=(tabId:string)=>(ctx:string,aCase:any,{partyA,partyB}:{partyA:string;partyB:string})=>{
    const matter=aCase?.caseName??'';
    const intelBlock=buildIntelligenceBlock(aCase);
    if(intelBlock) ctx=`INTELLIGENCE ENGINE OUTPUT (vetted facts — do not contradict):\n${intelBlock}\n\nAdditional facts from counsel (supplemental):\n${ctx||'(none — relying on Intelligence Engine output above)'}`;
    const ps:Record<string,string>={
      tat_notice:`You are Nigerian tax counsel acting for ${partyA} (Appellant/Taxpayer) before the Tax Appeal Tribunal (TAT).\n\nMatter: ${matter}\n\nInstructions:\n${ctx}\n\nDraft a complete Notice of Appeal (TAT Form 1) under the Federal Inland Revenue Service (Establishment) Act 2007 / Tax Appeal Tribunal (Procedure) Rules 2021.\n\nSTRUCTURE:\n1. TAX APPEAL TRIBUNAL — [Zone: Lagos / Abuja / Port Harcourt / etc.] — TAT/[ZONE]/[NO]/[YEAR]\n2. BETWEEN: [${partyA}] — Appellant AND [Tax Authority: FIRS / LIRS / State Board] — Respondent\n3. NOTICE OF APPEAL\n4. The Appellant being dissatisfied with the assessment / decision of the Respondent dated [date] gives notice of appeal to the Tax Appeal Tribunal on the grounds stated herein.\n5. PARTICULARS OF ASSESSMENT APPEALED:\n   (a) Tax type: [Companies Income Tax / VAT / Withholding Tax / Personal Income Tax / etc.]\n   (b) Assessment notice reference no: [no.]\n   (c) Tax year(s) of assessment: [year(s)]\n   (d) Amount assessed: ₦[amount]\n   (e) Amount admitted (if any): ₦[amount]\n   (f) Amount in dispute: ₦[amount]\n6. GROUNDS OF APPEAL: (summarised — full grounds in separate document)\n7. RELIEF SOUGHT: (a) Discharge of assessment; (b) Reduction of assessment to ₦[amount]; (c) Costs\n8. ADDRESS FOR SERVICE of Appellant's counsel\n9. Signed: Counsel / Date\n\nFiling note: must be filed within 30 days of receiving assessment notice (FIRS Act / relevant tax statute). Flag [COUNSEL TO SUPPLY] where needed. Return complete Notice of Appeal only.`,
      tat_grounds:`You are Nigerian tax counsel for ${partyA} (Appellant) before the Tax Appeal Tribunal.\n\nMatter: ${matter}\n\nAssessment details and available grounds:\n${ctx}\n\nDraft comprehensive Grounds of Appeal against the tax assessment.\n\nAnalyse and draft each applicable ground:\nGROUND 1 — JURISDICTIONAL / PROCEDURAL: assessment issued outside statutory time limit; notice not served correctly; failure to issue demand notice before assessment\nGROUND 2 — INCORRECT INCOME FIGURE: Respondent included non-taxable income / receipts; failure to deduct allowable expenses under CITA / PITA / VAT Act; turnover figure incorrect\nGROUND 3 — WRONG TAX RATE / COMPUTATION: erroneous application of tax rate; incorrect relief; failure to apply pioneer status / tax holiday / treaty benefit\nGROUND 4 — DOUBLE TAXATION: income already taxed at source (WHT); assessed in wrong jurisdiction; treaty protection applies\nGROUND 5 — PENALTIES / INTEREST EXCESSIVE: penalties computed on wrong base; interest rate exceeds statutory maximum; waiver conditions met\nGROUND 6 — DOCUMENTARY EVIDENCE IGNORED: Appellant's books, records, returns, audited accounts show different figure; Respondent failed to examine submitted documents\n\nFor each ground: (a) State ground clearly; (b) Identify the statutory provision infringed; (c) Specify the tax and amounts affected.\nFlag [COUNSEL TO SUPPLY] where needed. Return Grounds document only.`,
      tat_stmt_facts:`You are Nigerian tax counsel for ${partyA} (Appellant) before the Tax Appeal Tribunal.\n\nMatter: ${matter}\n\nFacts to be stated:\n${ctx}\n\nDraft a comprehensive Statement of Facts for the Tax Appeal Tribunal.\n\nSTRUCTURE:\n1. Heading: APPELLANT'S STATEMENT OF FACTS — TAT/[Zone]/[No]/[Year]\n2. BACKGROUND: nature of Appellant's business / employment / income source; tax registration details\n3. THE ASSESSMENT:\n   (a) Period(s) of assessment\n   (b) Assessment notice(s) issued by Respondent: reference, date, amount\n   (c) Objection filed by Appellant on [date] — grounds\n   (d) Respondent's determination on objection: [upheld / partially upheld / dismissed]\n4. THE DISPUTE: what the Appellant contends the correct tax position to be (with figures)\n5. RELEVANT FACTS IN SUPPORT OF GROUNDS:\n   For each ground of appeal — specific facts, records, transactions, dates, and amounts that support the Appellant's position\n6. DOCUMENTARY EVIDENCE: list of documents filed as exhibits\n7. CONCLUSION: correct tax liability is ₦[amount]; assessment should be discharged / reduced accordingly\n\nFlag [COUNSEL TO SUPPLY] where needed. Return Statement of Facts only.`,
      tat_doc_list:`You are Nigerian tax counsel for ${partyA} (Appellant).\n\nMatter: ${matter}\n\nAvailable documents:\n${ctx}\n\nDraft the Appellant's List of Documents for the Tax Appeal Tribunal.\n\nSTRUCTURE:\n1. Heading: APPELLANT'S LIST OF DOCUMENTS — TAT/[Zone]/[No]/[Year] — Parties\n2. Table:\n   Exhibit No | Description | Date | Relevance\n3. Standard TAT documents to include (as applicable):\n   A1 — Assessment Notice(s) from Respondent\n   A2 — Appellant's Notice of Objection\n   A3 — Respondent's Determination on Objection\n   A4 — Audited Financial Statements for the tax year(s)\n   A5 — Tax Returns filed (CIT / VAT / WHT / PAYE)\n   A6 — Books of account / general ledger extracts\n   A7 — Payment receipts / remittance schedules\n   A8 — WHT credit notes / certificates\n   A9 — Transfer pricing documentation (if applicable)\n   A10 — Any relevant tax treaty / pioneer certificate\n4. Signed: Counsel for Appellant / Date\n\nFlag [COUNSEL TO SUPPLY] where needed. Return List only.`,
      tat_submission:`You are Nigerian tax counsel for ${partyA} (Appellant) before the Tax Appeal Tribunal.\n\nMatter: ${matter}\n\nLegal arguments and evidence summary:\n${ctx}\n\nDraft a comprehensive Written Submission in support of the Tax Appeal.\n\nSTRUCTURE:\n1. Heading: APPELLANT'S WRITTEN SUBMISSION — TAT/[Zone]/[No]/[Year]\n2. INTRODUCTION: nature of appeal and relief sought\n3. ISSUES FOR DETERMINATION: formulate 3–6 issues distilled from grounds\n4. ARGUMENTS on each issue:\n   (a) Statutory framework: CITA 2004 (as amended) / VATA 2004 / FIRS Establishment Act / PITA / relevant regulations\n   (b) Decided tax authorities: FIRS v [Appellant] / [Appellant] v FIRS; Federal High Court tax decisions; Court of Appeal tax decisions\n   (c) Application of law to Appellant's specific facts\n   (d) Quantum: correct tax computation showing lesser liability\n5. COMPUTATION SCHEDULE: tabular reconciliation of assessed vs. correct figures\n6. CONCLUSION AND RELIEFS SOUGHT\n7. Signed: Counsel for Appellant / Date\n\nFlag [COUNSEL TO SUPPLY] where needed. Return complete Written Submission only.`,
      tat_resp_stmt:`You are Nigerian tax counsel for ${partyB} — the Revenue Authority (FIRS / LIRS / State Board) — as Respondent before the Tax Appeal Tribunal.\n\nMatter: ${matter}\n\nRespondent's position:\n${ctx}\n\nDraft the Respondent's Statement of Facts in opposition to the tax appeal.\n\nSTRUCTURE:\n1. Heading: RESPONDENT'S STATEMENT OF FACTS — TAT/[Zone]/[No]/[Year]\n2. BACKGROUND: statutory basis for assessment; Respondent's mandate under FIRS Act / relevant tax statute\n3. THE ASSESSMENT:\n   (a) Basis of assessment: audit findings / desk review / industry benchmark / best-of-judgement\n   (b) Taxpayer's failure to maintain adequate books / file accurate returns\n   (c) Objection was considered and rightly dismissed\n4. RESPONDENT'S FACTUAL POSITION:\n   (a) Computed figures are correct; income understated\n   (b) Claimed deductions are non-allowable under CITA / VATA / PITA\n   (c) Penalties and interest are validly imposed\n5. DOCUMENTARY EVIDENCE: Audit working papers; assessment notices; prior correspondence\n6. CONCLUSION: appeal is without merit; assessment should be affirmed\n\nFlag [COUNSEL TO SUPPLY] where needed. Return Statement of Facts only.`,
      tat_resp_doc:`You are Nigerian tax counsel for ${partyB} (Respondent / Revenue Authority).\n\nMatter: ${matter}\n\nRespondent's documents:\n${ctx}\n\nDraft the Respondent's List of Documents for the Tax Appeal Tribunal.\n\nSTRUCTURE:\n1. Heading: RESPONDENT'S LIST OF DOCUMENTS — TAT/[Zone]/[No]/[Year] — Parties\n2. Table: Exhibit No | Description | Date | Relevance\n3. Standard respondent documents:\n   R1 — Tax Audit Report / Desk Review Report\n   R2 — Assessment Notices (all years in dispute)\n   R3 — Record of taxpayer's objection and Respondent's determination\n   R4 — Industry benchmark / comparables relied upon (if best-of-judgement)\n   R5 — Taxpayer's prior returns on file\n   R6 — Demand notices / payment history\n   R7 — Any ruling or circular relied upon\n4. Signed: Counsel for Respondent / Date\n\nFlag [COUNSEL TO SUPPLY] where needed. Return List only.`,
      tat_resp_submission:`You are Nigerian tax counsel for ${partyB} (Respondent / Revenue Authority) before the Tax Appeal Tribunal.\n\nMatter: ${matter}\n\nArguments:\n${ctx}\n\nDraft a Written Submission in Opposition to the Tax Appeal.\n\nSTRUCTURE:\n1. Heading: RESPONDENT'S WRITTEN SUBMISSION IN OPPOSITION — TAT/[Zone]/[No]/[Year]\n2. INTRODUCTION\n3. PRELIMINARY OBJECTION (if any): competence; time-bar on filing; failure to deposit disputed tax (where applicable)\n4. ISSUES FOR DETERMINATION: adopt or reformulate issues\n5. ARGUMENTS:\n   (a) Statutory basis for assessment is sound\n   (b) Appellant bears burden of proof to displace the assessment — FBIR v Halliburton\n   (c) Claimed deductions are not allowable: statutory analysis\n   (d) Books of account are inadequate; best-of-judgement assessment is permissible — FIRS Act s.65\n   (e) Penalties and interest are correctly computed and are not excessive\n6. COMPUTATION: Respondent's correct tax computation table\n7. CONCLUSION: appeal dismissed; assessment affirmed in full; costs\n8. Signed: Counsel for Respondent / Date\n\nFlag [COUNSEL TO SUPPLY] where needed. Return complete Written Submission only.`,
    };
    return ps[tabId]??`Draft ${tabId} for Tax Appeal Tribunal matter: ${matter}. Instructions: ${ctx}`;
  };
  const forChecklist=[
    {label:'Notice of Appeal (TAT Form 1)',done:!!data.tatNoticeDraft},
    {label:'Grounds of Appeal',done:!!data.tatGroundsDraft},
    {label:'Statement of Facts',done:!!data.tatStmtFactsDraft},
    {label:'List of Documents',done:!!data.tatDocListDraft},
    {label:'Written Submission',done:!!data.tatSubmissionDraft},
  ];
  const againstChecklist=[
    {label:"Respondent's Statement of Facts",done:!!data.tatRespStmtDraft},
    {label:'List of Documents',done:!!data.tatRespDocDraft},
    {label:'Written Submission in Opposition',done:!!data.tatRespSubmissionDraft},
  ];
  return (
    <div style={{animation:'fadeUp .3s ease'}}>
      <div style={{marginBottom:24}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
          <span style={{fontSize:18,color:accent}}>🏛</span>
          <h3 style={{fontSize:18,color:T.text,fontFamily:"'Times New Roman', Times, serif",fontWeight:300,margin:0}}>Tax Appeal Tribunal</h3>
          <span style={{fontSize:9,padding:'3px 8px',borderRadius:3,fontFamily:"'Times New Roman', Times, serif",fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',background:`${accent}15`,border:`1px solid ${accent}30`,color:accent}}>
            {isClaim?'Appellant / Taxpayer (For)':'Respondent / Revenue Authority (Against)'}
          </span>
        </div>
        <p style={{fontSize:13,color:T.mute,fontFamily:"'Times New Roman', Times, serif",margin:0}}>Tax Appeal Tribunal — FIRS (Establishment) Act 2007 and TAT (Procedure) Rules 2021. Appeal lies against assessments by FIRS, LIRS, and State Revenue Authorities.</p>
        {isClaim&&<div style={{marginTop:12,background:`${accent}08`,border:`1px solid ${accent}20`,borderRadius:7,padding:'10px 14px'}}><p style={{fontSize:12,color:accent,fontFamily:"'Times New Roman', Times, serif",margin:0}}>⚠ <strong>Pre-filing:</strong> File notice of objection with the Revenue Authority first. After determination on objection, appeal to TAT must be filed within 30 days of the assessment notice or determination. Failure to file within time is fatal.</p></div>}
      </div>
      <ChecklistBanner items={isClaim?forChecklist:againstChecklist} accent={accent}/>
      <SubTabBar tabs={tabs} active={activeTab} onSelect={setActiveTab} accent={accent}/>
      {tabs.map(t=>activeTab===t.id&&(
        <AIDrafter key={t.id} title={t.label}
          description={`Draft the ${t.label} for this Tax Appeal Tribunal matter.`}
          contextLabel="Instructions & Facts" contextPlaceholder={`Provide details for the ${t.label}…`}
          draftKey={draftKeys[t.id]} contextKey={ctxKeys[t.id]}
          data={data} onSave={onSave} accent={accent} ai={ai} systemCtx={systemCtx}
          prompt={makePrompt(t.id)} maxTokens={2200}
        />
      ))}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 3D — INVESTMENTS & SECURITIES TRIBUNAL (IST) ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

function ISTEngine({activeCase,data,onSave,accent,ai,systemCtx}:{activeCase:Case;data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const isClaim=activeCase.counsel_role==='claimant_side';
  const sp={data,onSave,accent,ai,systemCtx};
  const forTabs=[
    {id:'ist_application',label:'Originating Application / Notice of Appeal'},
    {id:'ist_stmt_facts',label:'Statement of Facts & Grounds'},
    {id:'ist_witness_list',label:'List of Witnesses'},
    {id:'ist_witness_stmt',label:'Witness Statements'},
    {id:'ist_doc_schedule',label:'Documentary Evidence Schedule'},
    {id:'ist_address',label:'Written Address'},
  ];
  const againstTabs=[
    {id:'ist_resp_stmt',label:"Respondent's Statement of Defence / Reply"},
    {id:'ist_resp_witness',label:'List of Witnesses'},
    {id:'ist_resp_witness_stmt',label:'Witness Statements'},
    {id:'ist_resp_doc',label:'Documentary Evidence Schedule'},
    {id:'ist_resp_address',label:'Written Address in Opposition'},
  ];
  const tabs=isClaim?forTabs:againstTabs;
  const [activeTab,setActiveTab]=useState(isClaim?'ist_application':'ist_resp_stmt');
  const draftKeys:Record<string,keyof SavedData>={
    ist_application:'istApplicationDraft',ist_stmt_facts:'istStmtFactsDraft',ist_witness_list:'istWitnessListDraft',
    ist_witness_stmt:'istWitnessStmtDraft',ist_doc_schedule:'istDocScheduleDraft',ist_address:'istAddressDraft',
    ist_resp_stmt:'istRespStmtDraft',ist_resp_witness:'istRespWitnessDraft',
    ist_resp_witness_stmt:'istRespWitnessDraft',ist_resp_doc:'istRespDocDraft',ist_resp_address:'istRespAddressDraft',
  };
  const ctxKeys:Record<string,keyof SavedData>={
    ist_application:'istApplicationContext',ist_stmt_facts:'istStmtFactsContext',ist_witness_list:'istWitnessListContext',
    ist_witness_stmt:'istWitnessStmtContext',ist_doc_schedule:'istDocScheduleContext',ist_address:'istAddressContext',
    ist_resp_stmt:'istRespStmtContext',ist_resp_witness:'istRespWitnessContext',
    ist_resp_witness_stmt:'istRespWitnessContext',ist_resp_doc:'istRespDocContext',ist_resp_address:'istRespAddressContext',
  };
  const makePrompt=(tabId:string)=>(ctx:string,aCase:any,{partyA,partyB}:{partyA:string;partyB:string})=>{
    const matter=aCase?.caseName??'';
    const intelBlock=buildIntelligenceBlock(aCase);
    if(intelBlock) ctx=`INTELLIGENCE ENGINE OUTPUT (vetted facts — do not contradict):\n${intelBlock}\n\nAdditional facts from counsel (supplemental):\n${ctx||'(none — relying on Intelligence Engine output above)'}`;
    const ps:Record<string,string>={
      ist_application:`You are Nigerian capital markets counsel acting for ${partyA} (Applicant / Appellant) before the Investments and Securities Tribunal (IST).\n\nMatter: ${matter}\n\nStatutory framework: The IST has exclusive jurisdiction under ISA 2007 s.274 (as amended 2024) over capital market disputes and appeals from SEC, NSE, FMDQ, and other Exchange decisions. Jurisdiction attaches only after exhaustion of SEC administrative review under ISA 2007 s.304. The Tribunal sits as a three-member Panel.\n\nInstructions:\n${ctx}\n\nDraft a complete Originating Application or Notice of Appeal as appropriate, under the Investments and Securities Act 2007 (ISA 2007, as amended 2024) and the IST Rules 2014.\n\nSTRUCTURE:\n1. INVESTMENTS AND SECURITIES TRIBUNAL — IST/[NO]/[YEAR]\n2. BETWEEN: [${partyA}] — Applicant / Appellant AND [${partyB}] — Respondent (1st) AND [SEC / NSE / Exchange] — Respondent (2nd if applicable)\n3. ORIGINATING APPLICATION / NOTICE OF APPEAL\n4. TAKE NOTICE that the Applicant/Appellant being aggrieved by:\n   (a) [Decision / Ruling / Order / Assessment] of [SEC / NSE / FMDQ / Exchange / Registrar] dated [date]\n   (b) Brief description of the decision\n   applies to the Investments and Securities Tribunal for relief under [ISA 2007 s.274 / relevant provision]\n5. GROUNDS: (summarised)\n6. RELIEFS SOUGHT:\n   (a) Set aside / vary the decision\n   (b) Declaration as to rights\n   (c) Order of compensation / restitution: ₦[amount]\n   (d) Injunctive relief (if applicable)\n   (e) Costs\n7. Address for service\n8. Signed: Counsel for Applicant / Date\n\nFlag [COUNSEL TO SUPPLY] where needed. Return complete Application / Notice only.`,
      ist_stmt_facts:`You are capital markets counsel for ${partyA} (Applicant) before the IST.\n\nMatter: ${matter}\n\nStatutory framework: The Applicant bears the burden of proof under ISA 2007 s.304. The Statement of Facts must also demonstrate that SEC administrative review was exhausted before filing — this is a mandatory jurisdictional precondition. The IST sits as a three-member Panel under ISA 2007 s.264.\n\nFacts and grounds:\n${ctx}\n\nDraft the Statement of Facts and Grounds under the IST Rules 2014.\n\nSTRUCTURE:\n1. Heading: STATEMENT OF FACTS AND GROUNDS — IST/[No]/[Year]\n2. PARTIES: identity, registration, capacity (licensee, registrant, investor, issuer, intermediary)\n3. BACKGROUND:\n   (a) Nature of the investment / securities transaction in dispute\n   (b) Regulatory relationship with Respondent\n   (c) Chronology of events leading to dispute\n4. THE DECISION CHALLENGED:\n   (a) Full particulars of the SEC / Exchange / Registrar decision\n   (b) Why it is unlawful / unreasonable / contrary to ISA 2007\n5. GROUNDS IN DETAIL:\n   For each ground — specific facts + statutory / regulatory provision infringed (ISA 2007 / SEC Rules / NSE Rules / FMDQ Rules)\n6. IMPACT: financial loss, regulatory prejudice, investor harm\n7. CONCLUSION: relief sought and legal basis\n\nFlag [COUNSEL TO SUPPLY] where needed. Return Statement of Facts and Grounds only.`,
      ist_witness_list:`You are capital markets counsel for ${partyA} (Applicant) before the IST.\n\nMatter: ${matter}\n\nStatutory framework: The IST sits as a three-member Panel under ISA 2007 s.264. Written witness statements are filed and exchanged before the hearing; witnesses attend for cross-examination before the Panel. The Applicant bears the burden under ISA 2007 s.304.\n\nWitness details:\n${ctx}\n\nDraft the formal List of Witnesses for the IST.\n\nSTRUCTURE:\n1. Heading: APPLICANT'S LIST OF WITNESSES — IST/[No]/[Year]\n2. Table:\n   No. | Witness Name | Address / Designation | Subject of Testimony\n3. Typical IST witnesses:\n   — Company director / officer\n   — Broker / dealer representative\n   — Investment analyst\n   — Expert witness (capital markets, valuation)\n   — Aggrieved investor(s)\n4. Signed: Counsel for Applicant / Date\n\nFlag [COUNSEL TO SUPPLY] where needed. Return List only.`,
      ist_witness_stmt:`You are capital markets counsel for ${partyA} (Applicant) before the IST.\n\nMatter: ${matter}\n\nStatutory framework: The IST sits as a three-member Panel under ISA 2007 s.264. Evidence in chief is by written statement. The Applicant must prove its case under s.304 ISA 2007. Witnesses should address: the securities transaction or regulatory relationship; the specific ISA 2007 / SEC Rules provisions violated; and the loss or regulatory prejudice suffered. Capital market exhibit types include: share certificates, allotment letters, SEC correspondence, broker contract notes, board resolutions, SEC registration certificates, NSE/FMDQ trade confirmations.\n\nWitness facts:\n${ctx}\n\nDraft Witness Statements on Oath for the IST proceedings.\n\nFor EACH witness:\n1. WITNESS STATEMENT OF [NAME] — WIT NO [X]\n2. \"I, [NAME], of [address], [designation/capacity], make oath and state:\"\n3. Numbered paragraphs:\n   (a) Witness identity and role in the transaction\n   (b) Chronological account of events — specific dates, transactions, communications, instructions\n   (c) The impugned decision or conduct and how it affected the witness / client\n   (d) Exhibits referred to: Exhibit [IST-A1], [IST-A2]…\n   (e) Relief the witness supports\n4. JURAT: sworn before [Commissioner for Oaths] at [place] on [date]\n\nFlag [COUNSEL TO SUPPLY] where needed. Return all Witness Statements.`,
      ist_doc_schedule:`You are capital markets counsel for ${partyA} (Applicant) before the IST.\n\nMatter: ${matter}\n\nStatutory framework: Capital market document types relevant to IST proceedings under ISA 2007 include: share certificates; allotment letters; prospectuses and offer documents; SEC correspondence and administrative decisions; board resolutions; broker contract notes and trade confirmations; NSE / FMDQ / Exchange listings and rule books; SEC registration certificates and licences; and expert valuation reports.\n\nAvailable documents:\n${ctx}\n\nDraft the Applicant's Documentary Evidence Schedule for the IST.\n\nSTRUCTURE:\n1. Heading: APPLICANT'S DOCUMENTARY EVIDENCE SCHEDULE — IST/[No]/[Year]\n2. Table: Exhibit No | Description | Date | Relevance to Ground(s)\n3. Standard IST documents (as applicable):\n   IST-A1 — SEC / Exchange decision / ruling / order\n   IST-A2 — Applicant's application/objection to SEC/Exchange\n   IST-A3 — Transaction documents (prospectus, offer letters, subscription agreements)\n   IST-A4 — Share certificates / allotment letters / bond instruments\n   IST-A5 — Bank statements / payment confirmations\n   IST-A6 — Broker contract notes / trade confirmations\n   IST-A7 — Correspondence with Respondent\n   IST-A8 — Expert valuation / market data reports\n   IST-A9 — Regulatory licence / registration certificates\n   IST-A10 — Corporate / board resolutions\n4. Signed: Counsel for Applicant / Date\n\nFlag [COUNSEL TO SUPPLY] where needed. Return Schedule only.`,
      ist_address:`You are capital markets counsel for ${partyA} (Applicant) before the IST.\n\nMatter: ${matter}\n\nStatutory framework: The IST exercises exclusive jurisdiction under ISA 2007 s.274 (as amended 2024). The Applicant bears the burden of proof under s.304 ISA 2007. The Written Address is addressed to a three-member Panel of the Investments and Securities Tribunal. Issues must be distilled from ISA 2007 provisions, SEC Rules and Regulations 2013 (as amended 2024), and relevant Exchange Rules — not generic civil litigation framework.\n\nLegal arguments:\n${ctx}\n\nDraft a comprehensive Written Address for the IST proceedings.\n\nSTRUCTURE:\n1. Heading: APPLICANT'S WRITTEN ADDRESS — IST/[No]/[Year]\n2. INTRODUCTION: nature of application; investment / capital market context\n3. ISSUES FOR DETERMINATION: 3–6 issues distilled from grounds\n4. ARGUMENTS on each issue:\n   (a) Statutory framework: ISA 2007; SEC Rules and Regulations 2013 (as amended); NSE Rules / FMDQ Rules / CAMA 2020 (for corporate securities)\n   (b) IST decisions and Court of Appeal / Supreme Court authorities on capital markets\n   (c) Applicant's factual and documentary evidence in support\n   (d) Where SEC / Exchange decision was ultra vires, unreasonable, or procedurally flawed\n5. QUANTUM: computation of loss / relief if monetary claim\n6. CONCLUSION AND RELIEFS SOUGHT\n7. Signed: Counsel for Applicant / Date\n\nFlag [COUNSEL TO SUPPLY] where needed. Return complete Written Address only.`,
      ist_resp_stmt:`You are capital markets counsel for ${partyB} (Respondent) before the IST.\n\nMatter: ${matter}\n\nStatutory framework: The IST sits as a three-member Panel under ISA 2007 s.264. The Respondent's position is that: (i) jurisdiction attaches only after exhaustion of SEC administrative review under s.304 ISA 2007 — raise if not exhausted; (ii) the Respondent's decision was intra vires ISA 2007 and applicable SEC Rules and Regulations 2013 (as amended 2024); and (iii) the Applicant bears the burden of proof under s.304 ISA 2007.\n\nRespondent's position:\n${ctx}\n\nDraft the Respondent's Statement of Defence and Reply.\n\nSTRUCTURE:\n1. Heading: RESPONDENT'S STATEMENT OF DEFENCE AND REPLY — IST/[No]/[Year]\n2. PRELIMINARY OBJECTION (if any): jurisdiction; competence of application; limitation\n3. REPLY TO STATEMENT OF FACTS:\n   For each paragraph of Applicant's Statement — admit, deny, or no knowledge\n4. RESPONDENT'S CASE:\n   (a) Statutory mandate of Respondent (SEC / Exchange / Registrar) under ISA 2007\n   (b) Decision was intra vires, procedurally sound, and correct on the merits\n   (c) Applicant failed to comply with applicable rules / disclosure requirements\n   (d) No loss suffered; relief sought is not warranted\n5. RELIEFS SOUGHT: application dismissed; costs\n6. Signed: Counsel for Respondent / Date\n\nFlag [COUNSEL TO SUPPLY] where needed. Return complete Statement of Defence only.`,
      ist_resp_doc:`You are capital markets counsel for ${partyB} (Respondent) before the IST.\n\nMatter: ${matter}\n\nStatutory framework: IST proceedings under ISA 2007. Respondent (typically SEC, NSE, FMDQ, or a regulated operator) exhibits typically include: the SEC audit / examination report; show-cause letters and the Applicant's responses; the final regulatory decision; SEC Rules / circulars relied upon; trade data and market surveillance records; and the Applicant's prior filings and returns on record with Respondent.\n\nRespondent's documents:\n${ctx}\n\nDraft the Respondent's Documentary Evidence Schedule for the IST.\n\nSTRUCTURE:\n1. Heading: RESPONDENT'S DOCUMENTARY EVIDENCE SCHEDULE — IST/[No]/[Year]\n2. Table: Exhibit No | Description | Date | Relevance\n3. Standard respondent documents:\n   IST-R1 — Respondent's decision / directive / order appealed against\n   IST-R2 — Internal investigation / examination report\n   IST-R3 — Applicant's prior submissions to Respondent\n   IST-R4 — SEC Rules / Exchange Rules / circulars relied upon\n   IST-R5 — Regulatory examination findings / audit\n   IST-R6 — Correspondence / show-cause letters / replies\n   IST-R7 — Financial / transaction data on which decision was based\n4. Signed: Counsel for Respondent / Date\n\nFlag [COUNSEL TO SUPPLY] where needed. Return Schedule only.`,
      ist_resp_address:`You are capital markets counsel for ${partyB} (Respondent) before the IST.\n\nMatter: ${matter}\n\nRespondent's arguments:\n${ctx}\n\nDraft a Written Address in Opposition for the IST proceedings.\n\nSTATUTORY FRAMEWORK: The IST exercises exclusive jurisdiction under s.274 of the Investments and Securities Act 2007 (as amended 2024) over capital market disputes. The Respondent's decision is presumed valid unless the Applicant discharges the burden under s.304 ISA 2007. Administrative review must have been exhausted before IST jurisdiction attaches.\n\nSTRUCTURE:\n1. Heading: RESPONDENT'S WRITTEN ADDRESS IN OPPOSITION — IST/[No]/[Year] — [Parties]\n   Before: A Panel of Three Members of the Investments and Securities Tribunal\n2. INTRODUCTION\n3. PRELIMINARY OBJECTION ARGUMENTS (if applicable):\n   (a) Jurisdiction — whether s.274 ISA 2007 is properly engaged\n   (b) Competence — whether SEC administrative review was exhausted before filing (mandatory precondition)\n   (c) Limitation period under IST Rules 2014\n4. ISSUES FOR DETERMINATION: adopt Applicant's issues or reformulate in Respondent's favour\n5. ARGUMENTS on each issue:\n   (a) Respondent's decision is intra vires ISA 2007 / SEC Rules and Regulations 2013 (as amended 2024) / Exchange Rules\n   (b) Burden of proof: Applicant bears the burden under s.304 ISA 2007 — not discharged on the evidence\n   (c) Regulatory deference: the three-member IST Panel should not lightly interfere with the expert regulator's discretion on technical capital market matters\n   (d) Applicant's breach of disclosure / reporting / operational obligations was the proximate cause of the regulatory action\n   (e) No recoverable loss established; computation of alleged loss is speculative\n6. CONCLUSION: application dismissed; regulatory decision affirmed; costs awarded\n7. Signed: Counsel for Respondent / Date\n\nFlag [COUNSEL TO SUPPLY] where needed. Return complete Written Address only.`,
      ist_resp_witness:`You are capital markets counsel for ${partyB} (Respondent) before the Investments and Securities Tribunal (IST).\n\nMatter: ${matter}\n\nWitness details:\n${ctx}\n\nDraft the formal Respondent's List of Witnesses for the IST.\n\nSTATUTORY FRAMEWORK: The IST sits as a three-member Panel under ISA 2007 s.264. Witness evidence is filed by way of written witness statements; oral evidence may be led with leave of the Panel. The Respondent (typically a regulatory body or regulated operator) bears no primary burden — the Applicant carries the burden under s.304 ISA 2007 — but the Respondent's witnesses establish the factual and regulatory basis for the impugned decision.\n\nSTRUCTURE:\n1. Heading: RESPONDENT'S LIST OF WITNESSES — IST/[No]/[Year]\n   BETWEEN: [${partyA}] — Applicant AND [${partyB}] — Respondent\n2. RESPONDENT'S LIST OF WITNESSES\n3. Numbered table:\n   No. | Witness Name | Designation / Capacity | Subject of Testimony\n   Subject column should cover:\n   — Respondent's statutory mandate under ISA 2007 / SEC Rules / Exchange Rules\n   — The investigation, examination, or audit that preceded the challenged decision\n   — Factual basis for the decision: non-compliance, breach of disclosure obligations, market manipulation, insider dealing, or other violation found\n   — Respondent's regulatory procedure: show-cause letters, hearing, final determination\n   — Expert testimony on capital market practice, valuation, or industry standard (if applicable)\n4. Note: Written witness statements will be filed and exchanged per IST practice before the hearing. Witnesses will be available for cross-examination before the three-member Panel.\n5. Signed: Counsel for Respondent / Date\n\nFlag [COUNSEL TO SUPPLY] where needed. Return Respondent's List of Witnesses only.`,
      ist_resp_witness_stmt:`You are capital markets counsel for ${partyB} (Respondent) before the Investments and Securities Tribunal (IST).\n\nMatter: ${matter}\n\nWitness facts and regulatory record:\n${ctx}\n\nDraft Witness Statements on Oath for the Respondent in IST proceedings.\n\nSTATUTORY FRAMEWORK: The IST Panel (three members under ISA 2007 s.264) hears written statements as evidence in chief. Evidence must establish: (a) Respondent's vires under ISA 2007; (b) procedural regularity of the decision; (c) factual basis for the regulatory action; and (d) the Applicant's non-compliance. The Respondent need not disprove the Applicant's case — the burden of proof under s.304 ISA 2007 rests on the Applicant.\n\nFor EACH Respondent witness:\n1. WITNESS STATEMENT OF [NAME] — RESPONDENT'S WITNESS NO [X]\n2. \"I, [NAME], of [address], [designation/official capacity at ${partyB}], make oath and state:\"\n3. Numbered paragraphs:\n   (a) Witness identity, designation, and statutory authority\n   (b) Respondent's regulatory mandate over the Applicant / the transaction in question under ISA 2007 / SEC Rules 2013 (as amended 2024)\n   (c) The investigation or examination that preceded the decision: process, findings, documentary basis\n   (d) Correspondence and procedure: show-cause letters, the Applicant's response, hearing, final determination — compliance with IST Form references and SEC administrative review procedure\n   (e) The specific ISA 2007 provision / SEC Rule / Exchange Rule breached by the Applicant\n   (f) Why the decision was proportionate, procedurally sound, and intra vires\n   (g) Respondent exhibits: IST-R[No] — Audit report / examination findings; show-cause letters; Applicant's response; decision letter; relevant SEC correspondence\n4. JURAT: sworn before [Commissioner for Oaths] at [place] on [date]\n\nFlag [COUNSEL TO SUPPLY] where needed. Return all Respondent Witness Statements.`,
    };
    return ps[tabId]??`Draft ${tabId} for IST matter: ${matter}. Instructions: ${ctx}`;
  };
  const forChecklist=[
    {label:'Originating Application / Notice of Appeal',done:!!data.istApplicationDraft},
    {label:'Statement of Facts & Grounds',done:!!data.istStmtFactsDraft},
    {label:'List of Witnesses',done:!!data.istWitnessListDraft},
    {label:'Witness Statements',done:!!data.istWitnessStmtDraft},
    {label:'Documentary Evidence Schedule',done:!!data.istDocScheduleDraft},
    {label:'Written Address',done:!!data.istAddressDraft},
  ];
  const againstChecklist=[
    {label:"Statement of Defence / Reply",done:!!data.istRespStmtDraft},
    {label:'List of Witnesses',done:!!data.istRespWitnessDraft},
    {label:'Documentary Evidence Schedule',done:!!data.istRespDocDraft},
    {label:'Written Address in Opposition',done:!!data.istRespAddressDraft},
  ];
  return (
    <div style={{animation:'fadeUp .3s ease'}}>
      <div style={{marginBottom:24}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
          <span style={{fontSize:18,color:accent}}>📈</span>
          <h3 style={{fontSize:18,color:T.text,fontFamily:"'Times New Roman', Times, serif",fontWeight:300,margin:0}}>Investments & Securities Tribunal (IST)</h3>
          <span style={{fontSize:9,padding:'3px 8px',borderRadius:3,fontFamily:"'Times New Roman', Times, serif",fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',background:`${accent}15`,border:`1px solid ${accent}30`,color:accent}}>
            {isClaim?'Applicant / Appellant (For)':'Respondent (Against)'}
          </span>
        </div>
        <p style={{fontSize:13,color:T.mute,fontFamily:"'Times New Roman', Times, serif",margin:0}}>Investments and Securities Tribunal — ISA 2007 and IST Rules 2014. Jurisdiction over capital market disputes, appeals from SEC/Exchange decisions, and investor claims against operators.</p>
      </div>
      <ChecklistBanner items={isClaim?forChecklist:againstChecklist} accent={accent}/>
      <SubTabBar tabs={tabs} active={activeTab} onSelect={setActiveTab} accent={accent}/>
      {tabs.map(t=>activeTab===t.id&&(
        <AIDrafter key={t.id} title={t.label}
          description={`Draft the ${t.label} for this IST matter.`}
          contextLabel="Instructions & Facts" contextPlaceholder={`Provide details for the ${t.label}…`}
          draftKey={draftKeys[t.id]} contextKey={ctxKeys[t.id]}
          data={data} onSave={onSave} accent={accent} ai={ai} systemCtx={systemCtx}
          prompt={makePrompt(t.id)} maxTokens={2200}
        />
      ))}
    </div>
  );
}


// ─── PHASE 3E — ARBITRAL PANEL (AMA) ─────────────────────────────────────────

function ArbitralPanelEngine({activeCase,data,onSave,accent,ai,systemCtx}:{activeCase:Case;data:SavedData;onSave:(d:Partial<SavedData>)=>void;accent:string;ai:ReturnType<typeof useAI>;systemCtx:string}) {
  const isClaim=activeCase.counsel_role==='claimant_side';
  const {partyA,partyB}=getPartyLabels(activeCase);
  const [activeTab,setActiveTab]=useState('arb_notice');

  // Phase structure: pre-panel → pleadings → closing addresses
  // Claimant sees: Notice of Arbitration | Statement of Claim | Claimant's Written Address
  // Respondent sees: Notice of Arbitration | Statement of Defence | Respondent's Written Address
  const claimantTabs=[
    {id:'arb_notice',label:'Phase 1 — Notice of Arbitration'},
    {id:'arb_claim',label:'Phase 2 — Statement of Claim'},
    {id:'arb_claimant_address',label:'Phase 3 — Written Address'},
  ];
  const respondentTabs=[
    {id:'arb_notice',label:'Phase 1 — Notice of Arbitration'},
    {id:'arb_defence',label:'Phase 2 — Statement of Defence'},
    {id:'arb_respondent_address',label:'Phase 3 — Written Address'},
  ];
  const tabs=isClaim?claimantTabs:respondentTabs;

  const draftKeys:Record<string,keyof SavedData>={
    arb_notice:'arbNoticeDraft',
    arb_claim:'arbClaimDraft',
    arb_defence:'arbDefenceDraft',
    arb_claimant_address:'arbClaimantAddressDraft',
    arb_respondent_address:'arbRespondentAddressDraft',
  };
  const ctxKeys:Record<string,keyof SavedData>={
    arb_notice:'arbNoticeContext',
    arb_claim:'arbClaimContext',
    arb_defence:'arbDefenceContext',
    arb_claimant_address:'arbClaimantAddressContext',
    arb_respondent_address:'arbRespondentAddressContext',
  };

  const makePrompt=(tabId:string)=>(ctx:string,aCase:any,{partyA,partyB}:{partyA:string;partyB:string})=>{
    const matter=aCase?.caseName??'';
    const intelBlock=buildIntelligenceBlock(aCase);
    if(intelBlock) ctx=`INTELLIGENCE ENGINE OUTPUT (vetted facts — do not contradict):\n${intelBlock}\n\nAdditional facts from counsel (supplemental):\n${ctx||'(none — relying on Intelligence Engine output above)'}`;
    const ps:Record<string,string>={
      arb_notice:`You are Nigerian arbitration counsel acting for ${partyA} (Claimant) in an AMA arbitration.

Matter: ${matter}

Instructions:
${ctx}

Draft a complete Notice of Arbitration (Pre-Panel) compliant with the Arbitration and Mediation Act 2023 (AMA 2023) and, where applicable, the rules of the selected arbitral institution (ICC, LCIA, ICSID, NCIA, or ad hoc).

STRUCTURE:
1. NOTICE OF ARBITRATION
   Reference No.: [ARB/YEAR/NO]
   Date:
   To: [${partyB}] — Respondent
   From: [${partyA}] — Claimant
   c/o: [Claimant's Counsel and address]

2. PARTIES:
   (a) Claimant: full name, address, registration (if corporate), contact
   (b) Respondent: full name, address, registration, contact

3. ARBITRATION AGREEMENT:
   (a) Agreement/contract from which dispute arises — title, date, parties
   (b) Arbitration clause: clause no., verbatim text or accurate summary
   (c) Seat of arbitration
   (d) Governing law
   (e) Number of arbitrators and method of appointment

4. NATURE OF THE DISPUTE:
   (a) Background to the transaction/relationship
   (b) Claimant's performance
   (c) Respondent's default or breach
   (d) Chronology of events leading to dispute
   (e) Claimant's prior attempts at resolution (demand letters, negotiations, mediation if attempted)

5. CLAIMS AND RELIEF SOUGHT:
   (a) Principal sum claimed: ₦[amount] / USD [amount]
   (b) Interest: rate, period, basis (contractual or AMA 2023 s.55)
   (c) Specific performance / declaratory relief (if applicable)
   (d) Costs of arbitration
   (e) Any other relief

6. APPOINTMENT OF ARBITRATOR:
   (a) Claimant's nominated arbitrator (sole or party-appointed): [Name / Institution to appoint]
   (b) Request to Respondent to nominate its arbitrator within [period per agreement]
   (c) Fallback appointment mechanism (institution / court under AMA 2023 s.11)

7. COMMUNICATIONS:
   All future communications to: [Claimant's Counsel name and address]

8. CERTIFICATION:
   Signed by Claimant's Counsel with date

Flag [COUNSEL TO SUPPLY] for all blanks. Return complete Notice of Arbitration only.`,

      arb_claim:`You are Nigerian arbitration counsel for ${partyA} (Claimant) before an Arbitral Tribunal constituted under the AMA 2023.

Matter: ${matter}

Instructions and facts:
${ctx}

Draft a comprehensive Statement of Claim under the AMA 2023 and applicable institutional rules.

STRUCTURE:
1. HEADING
   IN THE MATTER OF AN ARBITRATION UNDER [AMA 2023 / ICC RULES / NCIA RULES / AD HOC]
   ARBITRATION REFERENCE NO: [ARB/YEAR/NO]
   BETWEEN: [${partyA}] — Claimant
   AND [${partyB}] — Respondent
   STATEMENT OF CLAIM

2. INTRODUCTION
   Brief summary: nature of dispute; relief sought; quantum.

3. PARTIES
   (a) Claimant: identity, incorporation, business, capacity
   (b) Respondent: identity, incorporation, business, capacity

4. ARBITRATION AGREEMENT AND JURISDICTION
   (a) Contract details and arbitration clause
   (b) Seat and governing law
   (c) Tribunal properly constituted

5. BACKGROUND AND FACTS
   Numbered paragraphs — chronological, precise, dates, amounts, communications:
   (a) Formation and terms of the agreement
   (b) Claimant's performance of obligations
   (c) Respondent's breach/failure with specific dates and particulars
   (d) Claimant's attempts to remedy/resolve
   (e) Loss suffered — direct, consequential, lost profits

6. LEGAL BASIS OF CLAIMS
   (a) Breach of contract — specific clauses breached
   (b) Statutory basis under AMA 2023 / applicable law
   (c) Quantum meruit (if applicable)
   (d) Any other causes of action

7. QUANTUM
   (a) Principal claim: ₦[amount] — schedule of loss attached
   (b) Interest: [rate]% per annum from [date] to award (AMA 2023 s.55 / contractual)
   (c) Currency of award (AMA 2023 s.54)
   (d) Exchange rate position (if foreign currency involved)

8. RELIEF SOUGHT
   (a) Declaration of breach
   (b) Award of ₦[amount] / USD [amount]
   (c) Pre-award interest
   (d) Post-award interest
   (e) Costs of arbitration including legal costs
   (f) Any other relief the Tribunal deems just

9. LIST OF DOCUMENTS RELIED UPON (by reference — full schedule to follow)

10. SIGNATURE: Claimant's Counsel / Date

Flag [COUNSEL TO SUPPLY] for all blanks. Return complete Statement of Claim only.`,

      arb_defence:`You are Nigerian arbitration counsel for ${partyB} (Respondent) before an Arbitral Tribunal constituted under the AMA 2023.

Matter: ${matter}

Instructions and facts:
${ctx}

Draft a comprehensive Statement of Defence (and Counterclaim if instructed) under the AMA 2023 and applicable institutional rules.

STRUCTURE:
1. HEADING
   IN THE MATTER OF AN ARBITRATION UNDER [AMA 2023 / ICC RULES / NCIA RULES / AD HOC]
   ARBITRATION REFERENCE NO: [ARB/YEAR/NO]
   BETWEEN: [${partyA}] — Claimant
   AND [${partyB}] — Respondent
   STATEMENT OF DEFENCE [AND COUNTERCLAIM]

2. INTRODUCTION
   Overview: Respondent denies liability; summarise Respondent's case.

3. PRELIMINARY OBJECTIONS (if any)
   (a) Jurisdiction / validity of arbitration agreement
   (b) Time bar / limitation
   (c) Failure to comply with conditions precedent (notice, negotiation, mediation)

4. RESPONSE TO STATEMENT OF CLAIM
   For each numbered paragraph of Claimant's Statement of Claim:
   — Admit / Deny / No knowledge — with brief reasons for each denial.

5. RESPONDENT'S CASE
   Numbered paragraphs — chronological:
   (a) Respondent's own account of the agreement and performance
   (b) Claimant's own breach / failure / contributory fault
   (c) Respondent's mitigation or cure attempts
   (d) Conditions precedent not met by Claimant
   (e) Force majeure / frustration / change of law (if applicable)

6. QUANTUM CHALLENGE
   (a) Dispute principal sum — reasons
   (b) Dispute interest claim — incorrect rate / date / basis
   (c) No or reduced loss — failure to mitigate
   (d) Any set-off

7. COUNTERCLAIM (if applicable)
   (a) Facts giving rise to counterclaim
   (b) Legal basis
   (c) Relief sought against Claimant

8. RELIEF SOUGHT
   (a) Claims dismissed in their entirety
   (b) Preliminary objections upheld (if advanced)
   (c) Counterclaim award (if applicable)
   (d) Costs

9. LIST OF DOCUMENTS RELIED UPON (by reference)

10. SIGNATURE: Respondent's Counsel / Date

Flag [COUNSEL TO SUPPLY] for all blanks. Return complete Statement of Defence only.`,

      arb_claimant_address:`You are Nigerian arbitration counsel for ${partyA} (Claimant) preparing for the final phase of AMA 2023 arbitration.

Matter: ${matter}

Legal arguments and evidence summary:
${ctx}

Draft a comprehensive Closing Written Address for the Claimant before the Arbitral Tribunal.

STRUCTURE:
1. HEADING
   IN THE MATTER OF AN ARBITRATION — REFERENCE NO: [ARB/YEAR/NO]
   CLAIMANT'S CLOSING WRITTEN ADDRESS

2. INTRODUCTION
   Procedural history; evidence adduced; purpose of address.

3. ISSUES FOR DETERMINATION
   Distil 3–6 clean issues from the pleadings and evidence for Tribunal's determination.

4. STATEMENT OF FACTS AS ESTABLISHED BY EVIDENCE
   Summarise oral and documentary evidence led, cross-referencing exhibits (Exh. C-1, C-2 …).

5. ARGUMENTS ON EACH ISSUE
   For each issue:
   (a) Legal principle — AMA 2023 provisions; Nigerian contract law; Supreme Court / Court of Appeal authorities; ICC/ICSID/LCIA precedents where relevant
   (b) Evidence establishing Claimant's position
   (c) Why Respondent's case fails on the evidence and law

6. QUANTUM AND INTEREST
   (a) Schedule of loss proved — principal and particulars
   (b) Interest: rate, period, basis (AMA 2023 s.55 / contractual / equitable)
   (c) Currency and exchange rate (AMA 2023 s.54)

7. COSTS SUBMISSION
   (a) Claimant is entitled to costs of arbitration
   (b) Basis: successful party principle / Respondent's unreasonable conduct
   (c) Schedule of costs (legal fees, arbitrator fees, admin fees, expenses)

8. CONCLUSION AND RELIEFS SOUGHT
   Reproduce full relief sought in final form; invite Tribunal to issue Final Award in favour of Claimant.

9. TABLE OF AUTHORITIES CITED

10. SIGNATURE: Claimant's Counsel / Date

Flag [COUNSEL TO SUPPLY] for all blanks. Return complete Written Address only.`,

      arb_respondent_address:`You are Nigerian arbitration counsel for ${partyB} (Respondent) preparing for the final phase of AMA 2023 arbitration.

Matter: ${matter}

Legal arguments and evidence summary:
${ctx}

Draft a comprehensive Closing Written Address for the Respondent before the Arbitral Tribunal.

STRUCTURE:
1. HEADING
   IN THE MATTER OF AN ARBITRATION — REFERENCE NO: [ARB/YEAR/NO]
   RESPONDENT'S CLOSING WRITTEN ADDRESS

2. INTRODUCTION
   Procedural history; Respondent's case in brief; why claims should be dismissed.

3. PRELIMINARY OBJECTION ARGUMENTS (if maintained)
   (a) Jurisdiction / limitation / conditions precedent — develop fully
   (b) Why Tribunal should decline to proceed or dismiss on threshold grounds

4. ISSUES FOR DETERMINATION
   Respondent's formulation of the issues (adopt or reformulate Claimant's).

5. STATEMENT OF FACTS AS ESTABLISHED BY EVIDENCE
   Summarise evidence from Respondent's perspective; challenge Claimant's witnesses and exhibits.

6. ARGUMENTS ON EACH ISSUE
   For each issue:
   (a) Legal principle — AMA 2023; Nigerian contract law; binding authorities
   (b) Evidence from Respondent's witnesses and documents
   (c) Why Claimant's case fails — legal and factual basis

7. RESPONSE TO QUANTUM
   (a) Principal claim not proved — what is the actual loss if any?
   (b) Interest: wrong rate, wrong start date, or no entitlement
   (c) Failure to mitigate — Claimant's contributory fault
   (d) Set-off (if raised)

8. COUNTERCLAIM ARGUMENTS (if applicable)
   (a) Facts proved for counterclaim
   (b) Legal entitlement
   (c) Quantum of counterclaim

9. COSTS SUBMISSION
   (a) Claims dismissed — Claimant should bear all costs
   (b) Claimant's conduct in the arbitration warranted increased costs
   (c) Schedule of Respondent's costs

10. CONCLUSION
    Invite Tribunal to dismiss claims; grant counterclaim if advanced; award costs to Respondent.

11. TABLE OF AUTHORITIES CITED

12. SIGNATURE: Respondent's Counsel / Date

Flag [COUNSEL TO SUPPLY] for all blanks. Return complete Written Address only.`,
    };
    return ps[tabId]??`Draft ${tabId} for arbitration matter: ${matter}. Instructions: ${ctx}`;
  };

  const forChecklist=[
    {label:'Notice of Arbitration',done:!!data.arbNoticeDraft},
    {label:'Statement of Claim',done:!!data.arbClaimDraft},
    {label:"Claimant's Written Address",done:!!data.arbClaimantAddressDraft},
  ];
  const againstChecklist=[
    {label:'Notice of Arbitration (awareness)',done:!!data.arbNoticeDraft},
    {label:'Statement of Defence',done:!!data.arbDefenceDraft},
    {label:"Respondent's Written Address",done:!!data.arbRespondentAddressDraft},
  ];

  return (
    <div style={{animation:'fadeUp .3s ease'}}>
      <div style={{marginBottom:24}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
          <span style={{fontSize:18,color:accent}}>⚖</span>
          <h3 style={{fontSize:18,color:T.text,fontFamily:"'Times New Roman', Times, serif",fontWeight:300,margin:0}}>Arbitral Panel</h3>
          <span style={{fontSize:9,padding:'3px 8px',borderRadius:3,fontFamily:"'Times New Roman', Times, serif",fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',background:`${accent}15`,border:`1px solid ${accent}30`,color:accent}}>
            {isClaim?'Claimant (For)':'Respondent (Against)'}
          </span>
        </div>
        <p style={{fontSize:13,color:T.mute,fontFamily:"'Times New Roman', Times, serif",margin:0}}>Arbitration and Mediation Act 2023 (AMA 2023). Three-phase structure: Pre-Panel Notice → Pleadings → Closing Written Addresses leading to Final Award.</p>
      </div>
      <div style={{background:'#08080e',border:`1px solid ${accent}20`,borderRadius:6,padding:'10px 16px',marginBottom:20,fontSize:12,color:T.mute,fontFamily:"'Times New Roman', Times, serif"}}>
        <strong style={{color:accent}}>Phase 1</strong> — Notice of Arbitration &nbsp;→&nbsp;
        <strong style={{color:accent}}>Phase 2</strong> — Pleadings (Claim / Defence) &nbsp;→&nbsp;
        <strong style={{color:accent}}>Phase 3</strong> — Closing Written Addresses → Final Award
      </div>
      <ChecklistBanner items={isClaim?forChecklist:againstChecklist} accent={accent}/>
      <SubTabBar tabs={tabs} active={activeTab} onSelect={setActiveTab} accent={accent}/>
      {tabs.map(t=>activeTab===t.id&&(
        <AIDrafter key={t.id} title={t.label}
          description={`Draft the ${t.label} for this arbitration matter.`}
          contextLabel="Instructions & Facts" contextPlaceholder={`Provide facts, instructions, and relevant details for the ${t.label}…`}
          draftKey={draftKeys[t.id]} contextKey={ctxKeys[t.id]}
          data={data} onSave={onSave} accent={accent} ai={ai} systemCtx={systemCtx}
          prompt={makePrompt(t.id)} maxTokens={2200}
        />
      ))}
    </div>
  );
}


// ─── MAIN ENGINE — COURT ROUTER ──────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4A — MATRIMONIAL PETITION ENGINE
// Routes on counsel_role: petitioner_side → 6 petitioner tabs
//                         respondent_side → 5 respondent tabs (cross-petition conditional)
// All tabs pre-populated from matrimonial_data via loadMatrimonialData() on mount.
// MCA = Matrimonial Causes Act, Cap M7 LFN 2004 | MCR = Matrimonial Causes Rules 1983
// ─────────────────────────────────────────────────────────────────────────────

type MatSubTab =
  | 'mat_petition' | 'mat_compliance' | 'mat_verifying_aff'
  | 'mat_non_collusion' | 'mat_s30_motion' | 'mat_co_resp'
  | 'mat_form10' | 'mat_answer' | 'mat_condonation'
  | 'mat_s30_obj' | 'mat_cross_petition';

function MatrimonialPetitionEngine({
  activeCase, data, onSave, accent, ai, systemCtx,
}: {
  activeCase: Case;
  data: SavedData;
  onSave: (d: Partial<SavedData>) => void;
  accent: string;
  ai: ReturnType<typeof useAI>;
  systemCtx: string;
}) {
  const SERIF = "'Times New Roman', Times, serif";
  const isPetitioner = activeCase.counsel_role === 'petitioner_side';

  const [mData, setMData] = useState<MatrimonialCaseData | null>(null);
  const [activeTab, setActiveTab] = useState<MatSubTab>(
    isPetitioner ? 'mat_petition' : 'mat_form10'
  );
  // Manual override flags — active only when Intelligence Engine has not yet run
  const [overrideAdultery, setOverrideAdultery] = useState(false);
  const [overrideTwoYear, setOverrideTwoYear] = useState(false);
  const [overrideCondonation, setOverrideCondonation] = useState(false);

  useEffect(() => {
    loadMatrimonialData(activeCase.id)
      .then(setMData)
      .catch(() => setMData(null));
  }, [activeCase.id]);

  // Derived conditional flags — from mData when available; from manual overrides when !mData
  const twoYearBar     = mData ? (mData.two_year_bar_applies === true && !mData.leave_granted) : overrideTwoYear;
  const adulteryAlleged = mData ? (mData?.intelligence_extraction?.dissolution_facts
    ?.some((f: { fact_code: string }) => f.fact_code === 'adultery') ?? false) : overrideAdultery;
  const condonationRisk = mData ? (mData.condonation_risk === true ||
    mData?.intelligence_extraction?.condonation_risk?.risk === true) : overrideCondonation;
  const crossPetitionFiled = mData?.cross_petition_filed === true;
  const leaveGranted   = mData?.leave_granted === true;

  // Pre-populated context block from matrimonial_data for prompts
  const mcaCtx = mData ? [
    mData.marriage_date      ? `Marriage date: ${mData.marriage_date}` : '',
    mData.separation_date    ? `Separation date: ${mData.separation_date}` : '',
    mData.relief_type        ? `Relief sought: ${mData.relief_type}` : '',
    mData.petitioner_name    ? `Petitioner: ${mData.petitioner_name}` : '',
    mData.respondent_name    ? `Respondent: ${mData.respondent_name}` : '',
    mData.children_count != null ? `Children: ${mData.children_count}` : '',
  ].filter(Boolean).join(' | ') : '';

  // ── Petitioner tabs ───────────────────────────────────────────────────────
  const petitionerTabs: { id: MatSubTab; label: string; show: boolean }[] = [
    { id: 'mat_petition',      label: 'Petition (MCR Form 1/6)',         show: true },
    { id: 'mat_compliance',    label: 'Certificate of Compliance (F3)',  show: true },
    { id: 'mat_verifying_aff', label: 'Verifying Affidavit',            show: true },
    { id: 'mat_non_collusion', label: 'Non-Collusion Affidavit',        show: true },
    { id: 'mat_s30_motion',    label: 's.30 Leave Motion',              show: twoYearBar },
    { id: 'mat_co_resp',       label: 'Co-Respondent Notice',           show: adulteryAlleged },
  ];

  // ── Respondent tabs ───────────────────────────────────────────────────────
  const respondentTabs: { id: MatSubTab; label: string; show: boolean }[] = [
    { id: 'mat_form10',        label: 'Form 10 — Notice of Appearance', show: true },
    { id: 'mat_answer',        label: 'Form 11 Pt A — Answer',          show: true },
    { id: 'mat_condonation',   label: 'Condonation Plea',               show: condonationRisk },
    { id: 'mat_s30_obj',       label: 's.30 Bar Preliminary Objection', show: twoYearBar && !leaveGranted },
    { id: 'mat_cross_petition',label: 'Form 11 Pt B — Cross-Petition',  show: crossPetitionFiled },
  ];

  const tabs = (isPetitioner ? petitionerTabs : respondentTabs).filter(t => t.show);

  // Ensure active tab is always valid after flags change
  useEffect(() => {
    if (!tabs.find(t => t.id === activeTab)) {
      setActiveTab(tabs[0]?.id ?? (isPetitioner ? 'mat_petition' : 'mat_form10'));
    }
  }, [tabs.map(t => t.id).join(',')]);

  // ── Panel renderer ────────────────────────────────────────────────────────
  function renderPanel() {
    const sp = { data, onSave, accent, ai, systemCtx };

    const petitionerName = mData?.petitioner_name ?? activeCase.parties?.find(
      (p: { role?: string; type?: string }) => p.role === 'petitioner_side' || p.type === 'petitioner'
    )?.name ?? '[Petitioner]';

    const respondentName = mData?.respondent_name ?? activeCase.parties?.find(
      (p: { role?: string; type?: string }) => p.role === 'respondent_side' || p.type === 'respondent'
    )?.name ?? '[Respondent]';

    const suitNo = activeCase.suitNo ?? '[Suit No]';
    const court  = activeCase.court  ?? 'High Court';

    switch (activeTab) {

      // ── PETITIONER: Petition (MCR Form 1 / Form 6) ─────────────────────
      case 'mat_petition':
        return (
          <AIDrafter
            title="Matrimonial Petition — MCR Form 1 / Form 6"
            description={`Draft the ${mData?.relief_type ?? 'dissolution'} petition under the Matrimonial Causes Act. The petition must: plead the ground(s) under s.15(2) MCA with full particulars; identify co-respondent if adultery is alleged; include the s.30 two-year bar status; recite the jurisdictional basis (domicile / habitual residence); contain the required prayers including ancillary relief, costs, and children welfare where applicable.`}
            contextLabel="Matrimonial facts, grounds, and particulars"
            contextPlaceholder={`Add any additional particulars beyond what MCA intelligence already captured. Pre-loaded: ${mcaCtx || 'run Intelligence Engine first for auto-population'}`}
            draftKey="matPetitionDraft"
            contextKey="matPetitionContext"
            prompt={(context) => `Draft a complete Matrimonial Petition (MCR Form 1 / Form 6 for dissolution) for filing in the ${court}.

Case: ${petitionerName} v ${respondentName} — ${suitNo}
Relief: ${mData?.relief_type ?? 'dissolution of marriage'}
MCA Intelligence: ${mcaCtx}
Additional facts: ${context}

Requirements:
1. Full recitation of jurisdictional basis — domicile or habitual residence under s.7 MCA
2. Date, place and particulars of marriage
3. Ground(s) under s.15(2) MCA with numbered particulars — cruelty, adultery, desertion, two-year separation, etc.
4. Where adultery alleged: name co-respondent and plead with sufficient particulars
5. Two-year bar status — if s.30 leave required, recite leave application or order
6. Children of the marriage — ages, custody proposal
7. Previous proceedings — recite or confirm none
8. Prayers: dissolution decree nisi → absolute; ancillary relief; custody/maintenance; costs
9. Verification clause
10. Format as properly numbered paragraphs per MCR Form 1 style`}
            maxTokens={3000}
            {...sp}
          />
        );

      // ── PETITIONER: Certificate of Compliance (MCR Form 3) ─────────────
      case 'mat_compliance':
        return (
          <AIDrafter
            title="Certificate of Compliance — MCR Form 3"
            description="Reconciliation compliance certificate confirming prescribed reconciliation steps were taken before filing — required under s.11 MCA and Rule 5 MCR. Certifies that the petitioner has been informed of reconciliation facilities available and has considered them."
            contextLabel="Reconciliation steps taken / counsellor details"
            contextPlaceholder="Name and address of reconciliation counsellor, dates of consultations, outcome"
            draftKey="matComplianceCertDraft"
            contextKey="matComplianceCertContext"
            prompt={(context) => `Draft a Certificate of Compliance (MCR Form 3) for:
${petitionerName} v ${respondentName} — ${suitNo}

Details: ${context}

The certificate must:
1. Identify the petitioner and their solicitor
2. Certify compliance with s.11 MCA — that the petitioner was informed of and considered reconciliation
3. Name the reconciliation counsellor or body consulted
4. State the date(s) of consultation
5. Confirm the marriage has broken down irretrievably and reconciliation is not feasible
6. Be signed by the petitioner's counsel
7. Follow MCR Form 3 format precisely`}
            maxTokens={1500}
            {...sp}
          />
        );

      // ── PETITIONER: Verifying Affidavit ────────────────────────────────
      case 'mat_verifying_aff':
        return (
          <AIDrafter
            title="Verifying Affidavit"
            description="Affidavit verifying the contents of the petition — deposed by the petitioner. Confirms all facts in the petition are true to the best of the petitioner's knowledge and belief. Required to be filed with the petition under MCR."
            contextLabel="Any facts requiring specific verification"
            contextPlaceholder="Leave blank to use petition facts automatically"
            draftKey="matVerifyingAffDraft"
            contextKey="matVerifyingAffContext"
            prompt={(context) => `Draft a Verifying Affidavit for the matrimonial petition in:
${petitionerName} v ${respondentName} — ${suitNo}

Deponent: ${petitionerName} (Petitioner)
Additional context: ${context}

The affidavit must:
1. Correctly introduce the deponent — name, address, capacity as Petitioner
2. Exhibit or refer to the Petition by exhibit mark (Exhibit 'A')
3. Verify all facts in the Petition as true to the best of the deponent's knowledge and belief
4. Identify facts known from personal knowledge vs. information and belief
5. Contain the standard MCR jurat clause
6. Be properly formatted for filing in the ${court}`}
            maxTokens={1500}
            {...sp}
          />
        );

      // ── PETITIONER: Affidavit of Non-Collusion / Non-Condonation ───────
      case 'mat_non_collusion':
        return (
          <AIDrafter
            title="Affidavit of Non-Collusion / Non-Condonation"
            description="Affidavit required under MCR confirming: (1) there is no collusion between the parties regarding the petition; (2) the petitioner has not condoned the conduct complained of. Both limbs are required in a single affidavit or separate affidavits as directed by the court."
            contextLabel="Any relevant facts on collusion / condonation history"
            contextPlaceholder="Leave blank unless there are facts to distinguish or address"
            draftKey="matNonCollusionDraft"
            contextKey="matNonCollusionContext"
            prompt={(context) => `Draft an Affidavit of Non-Collusion and Non-Condonation for:
${petitionerName} v ${respondentName} — ${suitNo}

Deponent: ${petitionerName}
Additional context: ${context}

The affidavit must:
1. Introduce the deponent as Petitioner
2. NON-COLLUSION LIMB: Depose that there is no agreement, understanding or collusion between the Petitioner and Respondent regarding the bringing of these proceedings or the relief sought
3. NON-CONDONATION LIMB: Depose that the Petitioner has not condoned the conduct particularised in the Petition — and has not, after knowledge of the conduct, voluntarily resumed or continued cohabitation with the Respondent
4. Where adultery is alleged: confirm Petitioner did not connive at or participate in the adultery
5. Jurat and attestation
6. Format for ${court}`}
            maxTokens={1500}
            {...sp}
          />
        );

      // ── PETITIONER: s.30 Leave Motion (conditional — two-year bar) ─────
      case 'mat_s30_motion':
        return (
          <AIDrafter
            title="s.30 Leave Motion — Application to Present Petition"
            description="Motion for leave to present a petition where the marriage has not subsisted for two years — required under s.30 MCA. Must plead the exceptional ground (wilful refusal to consummate, adultery, rape/sodomy/bestiality, or exceptional hardship / depravity) and exhibit supporting affidavit evidence."
            contextLabel="Grounds for leave and supporting facts"
            contextPlaceholder="Specify which s.30 exception applies and the supporting facts"
            draftKey="matS30MotionDraft"
            contextKey="matS30MotionContext"
            prompt={(context) => `Draft a Motion for Leave to Present Matrimonial Petition under s.30 MCA for:
${petitionerName} v ${respondentName} — ${suitNo}
Two-year bar exception: ${mData?.two_year_bar_exception ?? 'to be specified'}

Facts: ${context}

The Motion must:
1. Cite s.30 MCA and O.4 rr.1–2 MCR as authority
2. Identify which statutory exception is invoked — wilful refusal to consummate; adultery; rape, sodomy or bestiality on the respondent; or exceptional hardship or depravity
3. Narrate the facts establishing the exception with sufficient particulars
4. Address why it would be unjust to require the petitioner to wait the two-year period
5. Include a supporting affidavit (or direct that one is exhibited)
6. State the relief sought: leave to present the petition; costs
7. Identify the applicable court and judge
8. Format as a formal motion with preamble, grounds, and prayer`}
            maxTokens={2000}
            {...sp}
          />
        );

      // ── PETITIONER: Co-Respondent Joinder Notice (conditional — adultery)
      case 'mat_co_resp':
        return (
          <AIDrafter
            title="Co-Respondent Joinder Notice"
            description="Notice of joinder of co-respondent in adultery proceedings — required where adultery is alleged and the co-respondent is named. Filed under MCR to give the co-respondent an opportunity to be heard."
            contextLabel="Co-respondent name, address, and particulars of adultery"
            contextPlaceholder="Full name and address of co-respondent, dates and places of adultery alleged"
            draftKey="matCoRespNoticeDraft"
            contextKey="matCoRespNoticeContext"
            prompt={(context) => `Draft a Notice of Joinder of Co-Respondent for:
${petitionerName} v ${respondentName} — ${suitNo}
Co-respondent: ${mData?.co_respondent_name ?? '[Co-Respondent Name]'}

Particulars: ${context}

The Notice must:
1. Identify the suit and parties
2. Name the co-respondent in full and give their last known address
3. Recite the adultery allegation from the petition with sufficient particulars (dates, places)
4. State that the co-respondent is joined as a party to these proceedings
5. Inform the co-respondent of the right to enter appearance and file a response
6. State the time limit for filing a response under MCR
7. Bear the court stamp / reference and be signed by petitioner's counsel
8. Include proof of service endorsement space`}
            maxTokens={1500}
            {...sp}
          />
        );

      // ── RESPONDENT: Form 10 — Notice of Appearance ─────────────────────
      case 'mat_form10': {
        const serviceDate = mData?.service_date;
        const deadline28  = serviceDate
          ? new Date(new Date(serviceDate).getTime() + 28 * 864e5).toLocaleDateString('en-GB')
          : '28 days from service';
        return (
          <div>
            {serviceDate && (
              <div style={{
                background: '#fff8e1', border: '1px solid #f0c040', borderRadius: 6,
                padding: '10px 16px', marginBottom: 16, fontFamily: SERIF, fontSize: 12,
              }}>
                <strong style={{ color: '#8a5a00' }}>⏱ 28-Day Deadline:</strong>
                {' '}Notice of Appearance must be filed by <strong>{deadline28}</strong> (MCR O.6 r.1).
              </div>
            )}
            <AIDrafter
              title="Form 10 — Notice of Appearance (MCR O.6 r.1)"
              description="Notice of Appearance by the Respondent — must be filed within 28 days of service of the Petition. Signals the Respondent intends to defend. Failure to file within the period may result in the case proceeding in default."
              contextLabel="Service date and respondent's solicitor details"
              contextPlaceholder={`Service date: ${serviceDate ?? 'enter date'}. Respondent's solicitor name, firm, and address`}
              draftKey="matForm10Draft"
              contextKey="matForm10Context"
              prompt={(context) => `Draft a Notice of Appearance (MCR Form 10) for the Respondent in:
${petitionerName} v ${respondentName} — ${suitNo}
Court: ${court}
Service date: ${serviceDate ?? '[date of service]'}
Appearance deadline: ${deadline28}

Details: ${context}

The Notice must:
1. Follow MCR Form 10 format exactly
2. Identify the suit number, court, Petitioner and Respondent
3. State the Respondent's full name and address for service
4. Name the Respondent's solicitor and their address
5. Indicate whether the Respondent intends to contest the petition in whole or in part
6. Be signed by the Respondent's solicitor
7. State the date of filing
8. Include the filing endorsement space`}
              maxTokens={1500}
              {...sp}
            />
          </div>
        );
      }

      // ── RESPONDENT: Form 11 Part A — Answer to Petition ────────────────
      case 'mat_answer':
        return (
          <AIDrafter
            title="Form 11 Part A — Answer to Petition (MCR)"
            description="The Respondent's Answer to the Petition — filed after the Notice of Appearance. Responds paragraph by paragraph to the Petition: admitting, denying, or not admitting each allegation. May raise affirmative defences including condonation, connivance, collusion, or the s.30 two-year bar. This is Part A of Form 11 — Part B (Cross-Petition) is activated separately."
            contextLabel="Respondent's instructions and defence particulars"
            contextPlaceholder="Which allegations are admitted, which denied, what defences are raised, and on what facts"
            draftKey="matAnswerDraft"
            contextKey="matAnswerContext"
            prompt={(context) => `Draft Form 11 Part A — Answer to Matrimonial Petition for the Respondent in:
${petitionerName} v ${respondentName} — ${suitNo}
Court: ${court}

MCA Intelligence: ${mcaCtx}
Respondent's instructions: ${context}

The Answer must:
1. Follow MCR Form 11 Part A format
2. Respond to each numbered paragraph of the Petition — admit, deny, or not admit
3. Where denying, give brief particulars of the denial
4. Raise any affirmative defences with full particulars:
   - Condonation: petitioner resumed cohabitation after the conduct
   - Connivance: petitioner facilitated or acquiesced in the conduct
   - Collusion: the proceedings are collusive
   - Delay / Laches where applicable
5. Address the relief sought — oppose or qualify as instructed
6. State any relief the Respondent seeks in Part A (excluding cross-petition relief — that goes in Part B)
7. Be properly verified
8. Format as numbered paragraphs corresponding to the Petition`}
            maxTokens={2500}
            {...sp}
          />
        );

      // ── RESPONDENT: Condonation Plea (conditional) ──────────────────────
      case 'mat_condonation':
        return (
          <AIDrafter
            title="Condonation Plea"
            description="Affidavit and plea of condonation — raised where the petitioner resumed cohabitation with the respondent after knowledge of the conduct complained of, thereby condoning it. If established, condonation defeats the petition on that ground unless the conduct was repeated."
            contextLabel="Facts supporting condonation — dates of resumed cohabitation, petitioner's knowledge"
            contextPlaceholder="When did petitioner resume cohabitation? What conduct did they have knowledge of? Were there further acts after resumption?"
            draftKey="matCondPleaDraft"
            contextKey="matCondPleasContext"
            prompt={(context) => `Draft a Condonation Plea (affidavit and pleading) for the Respondent in:
${petitionerName} v ${respondentName} — ${suitNo}

Facts: ${context}

The plea must:
1. Identify the ground in the Petition being condoned
2. Plead the specific facts: when and how the Petitioner resumed cohabitation, the Petitioner's knowledge of the conduct at that time
3. Where resumption was temporary or qualified, address that
4. Cite the legal principle: condonation requires both resumption of cohabitation AND forgiveness with knowledge
5. Address whether any subsequent acts revived the condoned conduct
6. Link to the Answer (Part A) — reference the paragraph where condonation is raised
7. Supporting affidavit: depose to the resumption facts in the first person
8. Prayer: dismiss the petition on the condoned ground or reduce weight of evidence`}
            maxTokens={2000}
            {...sp}
          />
        );

      // ── RESPONDENT: s.30 Bar Preliminary Objection (conditional) ───────
      case 'mat_s30_obj':
        return (
          <AIDrafter
            title="s.30 Bar — Preliminary Objection"
            description="Preliminary objection challenging the court's jurisdiction to hear the petition where the marriage has not subsisted for two years and no leave was granted under s.30 MCA. This is a threshold objection — if upheld, it dismisses the petition in limine without hearing the merits."
            contextLabel="Date of marriage, date of petition, and leave application details"
            contextPlaceholder="Marriage date, petition filing date, confirmation that no s.30 leave was obtained or is invalid"
            draftKey="matS30ObjDraft"
            contextKey="matS30ObjContext"
            prompt={(context) => `Draft a Preliminary Objection on the s.30 MCA Two-Year Bar for the Respondent in:
${petitionerName} v ${respondentName} — ${suitNo}
Marriage date: ${mData?.marriage_date ?? '[date]'}
Leave status: ${leaveGranted ? 'Leave granted — objection should be reviewed' : 'No leave obtained'}

Facts: ${context}

The Preliminary Objection must:
1. Open with the formal notice: "Take notice that at the hearing of this petition the Respondent will raise the following preliminary objection…"
2. State the objection precisely: the marriage has not subsisted for the two-year minimum period required by s.30 MCA before a petition for dissolution may be presented
3. Compute the duration from date of marriage to date of filing the petition
4. Confirm no leave was obtained under s.30 MCA (or that purported leave is invalid)
5. State the consequence: the court lacks jurisdiction to entertain the petition and it should be struck out / dismissed in limine
6. Cite: s.30 MCA; O.4 MCR; and relevant authorities on the two-year bar
7. Prayer: dismiss the petition with costs`}
            maxTokens={2000}
            {...sp}
          />
        );

      // ── RESPONDENT: Form 11 Part B — Cross-Petition (conditional) ──────
      case 'mat_cross_petition':
        return (
          <AIDrafter
            title="Form 11 Part B — Cross-Petition (MCR)"
            description="The Respondent's Cross-Petition — Part B of Form 11. Filed where the Respondent has independent grounds for a matrimonial order. The cross-petition is a substantive pleading in its own right: it must plead the ground(s) under s.15(2) MCA with full particulars, and seek the relief the Respondent desires independently of the main petition."
            contextLabel="Cross-petition grounds and particulars"
            contextPlaceholder="Ground(s) for cross-petition (e.g. cruelty, adultery, desertion), particulars, and relief sought"
            draftKey="matCrossPetitionDraft"
            contextKey="matCrossPetitionContext"
            prompt={(context) => `Draft Form 11 Part B — Cross-Petition for the Respondent in:
${petitionerName} v ${respondentName} — ${suitNo}
Court: ${court}

MCA Intelligence: ${mcaCtx}
Cross-petition facts and grounds: ${context}

The Cross-Petition must:
1. Follow MCR Form 11 Part B format
2. Identify the Respondent / Cross-Petitioner by full name
3. Plead the ground(s) under s.15(2) MCA with numbered particulars — mirroring the Petition structure but on the Respondent's independent facts
4. Include timeline — date of marriage, when conduct began, date of separation
5. Where adultery is cross-alleged: name co-respondent if known
6. Children: address custody and maintenance position from cross-petitioner's standpoint
7. Prior condemnation: confirm no condonation, collusion or connivance by the cross-petitioner
8. Prayers: dissolution decree nisi; ancillary relief; custody; maintenance; costs
9. Verification clause
10. Format as stand-alone pleading that can be read independently of Part A`}
            maxTokens={2500}
            {...sp}
          />
        );

      default:
        return null;
    }
  }

  return (
    <div style={{ fontFamily: SERIF }}>
      {/* MCA track header */}
      <div style={{
        background: '#f9f5ff', border: '1px solid #ccb8e8', borderRadius: '6px 6px 0 0',
        padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 11, color: '#4a1a7a', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }}>
          Matrimonial Causes Act · MCR 1983
        </span>
        <span style={{ fontSize: 10, color: '#7a5a9a', letterSpacing: '.05em' }}>
          {isPetitioner ? 'Petitioner Side' : 'Respondent Side'}
        </span>
        {mData?.relief_type && (
          <span style={{
            fontSize: 10, background: '#f0e8ff', color: '#4a1a7a',
            border: '1px solid #ccb8e8', borderRadius: 3, padding: '1px 8px',
          }}>
            {mData.relief_type.replace(/_/g, ' ').replace(/\w/g, c => c.toUpperCase())}
          </span>
        )}
        {twoYearBar && (
          <span style={{
            fontSize: 10, background: '#fff8e1', color: '#8a5a00',
            border: '1px solid #f0c040', borderRadius: 3, padding: '1px 8px',
          }}>
            ⚠ s.30 Two-Year Bar
          </span>
        )}
        {crossPetitionFiled && (
          <span style={{
            fontSize: 10, background: '#f0f8ff', color: '#1a3a7a',
            border: '1px solid #90b8e8', borderRadius: 3, padding: '1px 8px',
          }}>
            ⚖ Cross-Petition Active
          </span>
        )}
        {!mData && (
          <span style={{ fontSize: 10, color: '#999', fontStyle: 'italic' }}>
            Run Intelligence Engine to auto-populate
          </span>
        )}
      </div>

      {/* Sub-tab bar */}
      <SubTabBar
        tabs={tabs}
        active={activeTab}
        onSelect={id => setActiveTab(id as MatSubTab)}
        accent={accent}
      />

      {/* Manual override panel — shown only when Intelligence Engine has not yet run */}
      {!mData && (
        <div style={{
          margin: '0 0 20px',
          background: '#0e0e1a',
          border: '1px solid #5a3a9030',
          borderRadius: 8,
          padding: '14px 18px',
        }}>
          <div style={{ fontSize: 10, color: '#9a7aba', fontFamily: "'Times New Roman', Times, serif", letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 10 }}>
            Manual Tab Override — Intelligence Engine not yet run
          </div>
          <p style={{ fontSize: 12, color: '#7a6a9a', fontFamily: "'Times New Roman', Times, serif", margin: '0 0 12px', lineHeight: 1.6 }}>
            Enable the toggles below to unlock conditional tabs. Once the Intelligence Engine runs, these settings are replaced by its output automatically.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { label: 'Adultery alleged — unlock Co-Respondent Notice tab', checked: overrideAdultery, onChange: setOverrideAdultery },
              { label: 'Marriage under two years — s.30 bar applies (unlock s.30 Leave Motion / s.30 Bar Objection tabs)', checked: overrideTwoYear, onChange: setOverrideTwoYear },
              { label: 'Condonation risk — unlock Condonation Plea tab', checked: overrideCondonation, onChange: setOverrideCondonation },
            ].map(({ label, checked, onChange }) => (
              <label key={label} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={e => onChange(e.target.checked)}
                  style={{ width: 15, height: 15, marginTop: 2, cursor: 'pointer', accentColor: accent }}
                />
                <span style={{ fontSize: 12, color: '#c0b0d8', fontFamily: "'Times New Roman', Times, serif", lineHeight: 1.5 }}>{label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Active panel */}
      <div style={{ padding: '24px 0 0' }}>
        {renderPanel()}
      </div>
    </div>
  );
}

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

  // op declared here — before any gate that references it, so every branch below
  // has it in scope without entering the temporal dead zone.
  const op=activeCase.originating_process;
  const sp={data,onSave,accent,ai,systemCtx};

  // ── TRACK: Matrimonial Petition (Phase 4A) ────────────────────────────────
  // Fires before the FREP gate and before the claimant/defendant role check —
  // matrimonial matters use petitioner_side / respondent_side roles which would
  // otherwise be blocked by the civil-track gate below.
  if(activeCase.originating_process==='petition_matrimonial'||(activeCase.matter_track==='matrimonial'&&(activeCase.counsel_role==='petitioner_side'||activeCase.counsel_role==='respondent_side'))) {
    return <MatrimonialPetitionEngine activeCase={activeCase} data={data} onSave={onSave} accent={accent} ai={ai} systemCtx={systemCtx}/>;
  }

  // ── Phase 3F: FREP gate — redirect to Applications Engine ────────────────
  // Catches both role-based (frep_applicant / frep_respondent) and originating_process-based
  // (op === 'frep') entries, including the edge-case of a record with a civil role but a
  // FREP originating process, which would otherwise fall through to the writ track.
  if(activeCase.counsel_role==='frep_applicant'||activeCase.counsel_role==='frep_respondent'||op==='frep') {
    return (
      <div style={{padding:'32px 28px',background:'#06100a',border:'1px solid #1a401a',borderRadius:8,fontFamily:"'Times New Roman', Times, serif"}}>
        <p style={{fontSize:11,color:'#406040',letterSpacing:'.14em',textTransform:'uppercase',marginBottom:8}}>FREP Matter — Wrong Engine</p>
        <p style={{fontSize:16,color:'#70c080',fontWeight:700,marginBottom:10}}>Fundamental Rights Enforcement Proceedings</p>
        <p style={{fontSize:13,color:'#507060',lineHeight:1.75,marginBottom:0}}>
          FREP originating documents are drafted via the <strong style={{color:'#90c0a0'}}>Applications Engine</strong> — not the Pleadings Engine.
          Open the Applications Engine and select the <strong style={{color:'#90c0a0'}}>FREP</strong> filter to access:
          Originating Motion, Originating Summons, Ex Parte/Interim Relief, Opposition (Factual or Law Only), Reply, and Preliminary Objection packages.
        </p>
      </div>
    );
  }

  if(activeCase.counsel_role!=='claimant_side'&&activeCase.counsel_role!=='defendant_side') {
    return <div style={{padding:32,background:'#08080e',border:'1px solid #cccccc',borderRadius:8}}><p style={{fontSize:13,color:T.mute,fontFamily:"'Times New Roman', Times, serif"}}>The Pleadings Engine is only available on civil matters. This matter is on the criminal track.</p></div>;
  }


  // ── TRACK: Winding-Up Petition (3B) ──────────────────────────────────────
  if(op==='winding_up_petition') {
    return <WindingUpEngine activeCase={activeCase} {...sp}/>;
  }

  // ── TRACK: NICN — Complaint Form 1 (3B) ──────────────────────────────────
  if(op==='nicn_complaint') {
    return <NICNComplaintEngine activeCase={activeCase} {...sp}/>;
  }

  // ── TRACK: NICN — Originating Summons Form 2 (3B) ────────────────────────
  if(op==='nicn_originating_summons') {
    return <NICNOSEngine activeCase={activeCase} {...sp}/>;
  }

  // ── TRACK: NICN — Judicial Review (3B) ───────────────────────────────────
  if(op==='nicn_judicial_review') {
    return <NICNJREngine activeCase={activeCase} {...sp}/>;
  }

  // ── TRACK: NICN — Notice of Appeal (3B) ──────────────────────────────────
  if(op==='nicn_appeal') {
    return <NICNAppealEngine activeCase={activeCase} {...sp}/>;
  }

  // ── TRACK: Customary Court (3C) ───────────────────────────────────────────
  if(op==='customary_summons') {
    return <CustomaryCourtEngine activeCase={activeCase} {...sp}/>;
  }

  // ── TRACK: Magistrate Court — Ordinary Summons / Track A (3C) ────────────
  if(op==='magistrate_plaint') {
    return <MagistrateTrackAEngine activeCase={activeCase} {...sp}/>;
  }

  // ── TRACK: Magistrate Court — Default Summons / Track B (3C) ─────────────
  if(op==='magistrate_default') {
    return <MagistrateTrackBEngine activeCase={activeCase} {...sp}/>;
  }

  // ── TRACK: Small Claims Court (3C) ────────────────────────────────────────
  if(op==='small_claims') {
    return <SmallClaimsEngine activeCase={activeCase} {...sp}/>;
  }

  // ── TRACK: Election Petitions Tribunal (3D) ───────────────────────────────
  if(op==='election_petition') {
    return <ElectionPetitionEngine activeCase={activeCase} {...sp}/>;
  }

  // ── TRACK: Tax Appeal Tribunal (3D) ──────────────────────────────────────
  if(op==='tax_appeal') {
    return <TaxAppealEngine activeCase={activeCase} {...sp}/>;
  }

  // ── TRACK: Investments & Securities Tribunal (3D) ────────────────────────
  if(op==='ist_application') {
    return <ISTEngine activeCase={activeCase} {...sp}/>;
  }

  // ── TRACK: Arbitral Panel / AMA (3E) ─────────────────────────────────────
  if(op==='arbitration_notice') {
    return <ArbitralPanelEngine activeCase={activeCase} {...sp}/>;
  }

  // ── TRACK 2: Originating Summons / Originating Application ───────────────
  // Phase 9 — paper-trial originating processes (no pleadings, decided on affidavit
  // evidence + written address) now route to the Applications Engine, which already
  // has the Mover/Respondent affidavit + written address architecture they need.
  // See APP_TYPES: 'civil_originating_summons' / 'civil_originating_application'.
  if(op==='originating_summons'||op==='originating_application') {
    return (
      <div style={{padding:'32px 24px',textAlign:'center'}}>
        <p style={{fontSize:14,color:T.sub,fontFamily:"'Times New Roman', Times, serif",lineHeight:1.7}}>
          Originating Summons and Originating Application matters are paper-trial processes — drafted in the <strong>Applications Engine</strong>, not here. Select "Originating Summons" or "Originating Application" as the application type there.
        </p>
      </div>
    );
  }

  // ── TRACK 1: Writ of Summons (3A default civil track) ────────────────────
  if(!op||op==='writ_of_summons') {
    const claimTabs=[
      {id:'originating_process',label:'Originating Process'},
      {id:'soc_drafter',label:'SoC Drafter'},
      {id:'witness_statement',label:'Witness Statement'},
      {id:'sod_monitor',label:'SoD Monitor'},
      {id:'counterclaim_response',label:'Counterclaim Response'},
      {id:'default_flag',label:'Default Flag'},
      {id:'reply_to_sod',label:'Reply to SoD'},
    ];
    const defTabs=[
      {id:'sod_drafter',label:'SoD Drafter'},
      {id:'counterclaim_builder',label:ccIntel?.flag?'Counterclaim Builder ⚖':'Counterclaim Builder'},
      {id:'preliminary_objection',label:'Preliminary Objection'},
      {id:'reply_monitor',label:'Reply Monitor'},
    ];
    return <WritSubTabs isClaim={isClaim} claimTabs={claimTabs} defTabs={defTabs} accent={accent} sharedProps={sp} ccIntel={ccIntel}/>;
  }

  // ── FALLTHROUGH ──────────────────────────────────────────────────────────
  const processLabel=op.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  return (
    <div style={{padding:'32px 28px',background:'#fafaf8',border:'1px solid #cccccc',borderRadius:6,fontFamily:"'Times New Roman', Times, serif"}}>
      <p style={{fontSize:11,color:'#888888',letterSpacing:'.14em',textTransform:'uppercase',marginBottom:8}}>Engine Unavailable</p>
      <p style={{fontSize:16,color:'#111111',fontWeight:700,marginBottom:10}}>{processLabel}</p>
      <p style={{fontSize:13,color:'#555555',lineHeight:1.7,marginBottom:0}}>
        No specialist engine is configured for <strong>{processLabel}</strong>. The case record, Intelligence Package, and all other tabs remain fully functional.
      </p>
    </div>
  );
}

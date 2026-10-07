"use client";
import { useActionState } from "react";
import Link from "next/link";
import { companyReviewAction, demandReviewAction, promoteVerifiedDemandAction, type DiscoveryReviewActionState } from "../../server/discovery-review/actions";
import type { DiscoveryReviewCase } from "../../server/discovery-review/discovery-review-workflow";

const IDLE:DiscoveryReviewActionState={status:"IDLE",error:null};
function Result({state}:{state:DiscoveryReviewActionState}){return state.error?<p className="review-r1-error" role="alert">{state.error}</p>:state.status==="SAVED"?<p className="review-r1-ok" role="status">Decision saved. The review state is current.</p>:null;}

export function DiscoveryReviewWorkbench({review}:{readonly review:DiscoveryReviewCase}){
  const [companyState,companyAction,companyPending]=useActionState(companyReviewAction,IDLE);
  const [demandState,demandAction,demandPending]=useActionState(demandReviewAction,IDLE);
  const [promotionState,promotionAction,promotionPending]=useActionState(promoteVerifiedDemandAction,IDLE);
  const resolved=Boolean(review.companyDecision?.companyId);
  const verified=review.demandDecision?.decision==="VERIFY";
  return <section className="review-r1-shell" aria-labelledby="review-r1-title">
    <header className="review-r1-header"><div><p className="po-eyebrow">Controlled human review</p><h2 id="review-r1-title">Company → demand → promotion</h2></div><span className="review-r1-state">{verified?"DEMAND VERIFIED":resolved?"DEMAND REVIEW REQUIRED":"COMPANY REVIEW REQUIRED"}</span></header>
    <div className="review-r1-evidence">
      <div><span>Observed identity</span><strong>{review.observedCompany??"Identity not established"}</strong></div><div><span>Source</span><strong>{review.source}</strong></div>
      <div><span>Profession / level</span><strong>{review.profession??"Unknown"} · {review.level}</strong></div><div><span>Location</span><strong>{review.location??"Unknown"}</strong></div>
      <div><span>Quantity</span><strong>{review.quantity.value??"Unknown"} · {review.quantity.type.replaceAll("_"," ")}</strong></div><div><span>Employer headcount</span><strong>{review.quantity.type==="EXPLICIT_EMPLOYER_HEADCOUNT"?"Requires demand verification":"UNKNOWN"}</strong></div>
    </div>
    {review.quantity.type==="AGGREGATE_MARKET_COUNT"?<p className="review-r1-warning">Aggregate source count — not confirmed employer headcount.</p>:null}
    <blockquote className="review-r1-excerpt">{review.description??review.title}</blockquote>
    <a className="button button-secondary" href={review.url} target="_blank" rel="noreferrer noopener">Open source evidence ↗</a>

    <div className="review-r1-steps">
      <form action={companyAction} className="review-r1-card">
        <span className="review-r1-number">01</span><h3>Review company identity</h3><p>Choose the supported outcome. Nothing is linked merely by opening this page.</p>
        <input type="hidden" name="candidateId" value={review.candidateId}/>
        <label><span>Decision</span><select name="outcome" required defaultValue=""><option value="" disabled>Select an outcome</option><option value="LINK">Link existing company</option><option value="CREATE">Create canonical company</option><option value="REJECT_MATCH">Reject possible match</option><option value="DEFER">Defer decision</option><option value="UNSUPPORTED">Identity unsupported</option><option value="KEEP_UNRESOLVED">Keep unresolved</option><option value="NOT_ACTIONABLE">Not actionable</option></select></label>
        <label><span>Existing canonical company</span><select name="companyId" defaultValue=""><option value="">No company selected</option>{review.companies.map(company=><option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
        <label><span>New company name (only for Create)</span><input name="companyName" maxLength={200} defaultValue={review.observedCompany??""}/></label>
        <label><span>Reason / supporting evidence</span><textarea name="reason" required maxLength={2000} rows={3}/></label>
        <label className="review-r1-confirm"><input type="checkbox" required/> I confirm this is my human company-resolution decision.</label>
        <Result state={companyState}/><button className="button button-primary" disabled={companyPending}>{companyPending?"Saving…":"Confirm company decision"}</button>
        {review.companyDecision?<p className="review-r1-current"><b>Current:</b> {review.companyDecision.outcome.replaceAll("_"," ")}{review.companyDecision.companyName?` · ${review.companyDecision.companyName}`:""}</p>:null}
      </form>

      <form action={demandAction} className={`review-r1-card ${!resolved?"is-locked":""}`}>
        <span className="review-r1-number">02</span><h3>Review canonical demand</h3><p>Company resolution and demand verification are separate decisions. Unknown optional facts remain unknown.</p>
        <input type="hidden" name="candidateId" value={review.candidateId}/>
        <label><span>Decision</span><select name="outcome" required defaultValue=""><option value="" disabled>Select an outcome</option><option value="VERIFY">Verify demand</option><option value="REJECT">Reject / not supported</option><option value="DEFER">Defer decision</option></select></label>
        <label><span>Reason / evidence reviewed</span><textarea name="reason" required maxLength={2000} rows={3}/></label>
        <label className="review-r1-confirm"><input type="checkbox" required/> I confirm the source supports this demand decision.</label>
        {!resolved?<p className="review-r1-gate">Resolve a canonical company first.</p>:null}<Result state={demandState}/><button className="button button-primary" disabled={!resolved||demandPending}>{demandPending?"Saving…":"Confirm demand decision"}</button>
        {review.demandDecision?<p className="review-r1-current"><b>Current:</b> {review.demandDecision.decision} · Headcount {review.quantity.type==="EXPLICIT_EMPLOYER_HEADCOUNT"&&verified?review.quantity.value:"UNKNOWN"}</p>:null}
      </form>

      <form action={promotionAction} className={`review-r1-card ${!verified?"is-locked":""}`}>
        <span className="review-r1-number">03</span><h3>Promotion boundary</h3><p>Verified demand is not an opportunity until you deliberately promote it.</p><input type="hidden" name="candidateId" value={review.candidateId}/>
        {review.demandDecision?.opportunityId?<Link className="button button-primary" href={`/opportunities/${review.demandDecision.opportunityId}`}>Open existing opportunity</Link>:<><label className="review-r1-confirm"><input type="checkbox" required/> I confirm promotion into the opportunity pipeline.</label><Result state={promotionState}/><button className="button button-primary" disabled={!verified||promotionPending}>{promotionPending?"Promoting…":"Promote to opportunity"}</button></>}
        {!verified?<p className="review-r1-gate">Demand verification is required before promotion.</p>:null}
      </form>
    </div>
    <footer className="review-r1-handoff"><div><span>Contact Intelligence</span><strong>{review.contactIntelligenceAvailable?"AVAILABLE":"NOT YET AVAILABLE"}</strong></div><Link href="/contacts">Open contacts →</Link></footer>
  </section>;
}

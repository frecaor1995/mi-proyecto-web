import { Icon } from "./icon";
import type { Locale } from "../../i18n/locale";
import { DEFAULT_LOCALE } from "../../i18n/locale";
import { t } from "../../i18n/translate";
export const TRUST_STATES={VERIFIED:["Verified","check"],UNVERIFIED:["Not verified","info"],CANDIDATE:["Candidate evidence","radar"],INFERENCE:["Inference","relation"],STALE:["Stale","clock"],CONFLICT:["Conflicting evidence","warning"],MISSING_EVIDENCE:["Missing evidence","evidence"],HUMAN_VERIFICATION_REQUIRED:["Human verification required","verify"],BLOCKED:["Blocked","minus"],NOT_APPLICABLE:["Not applicable","minus"]}as const;
export const CURRENTNESS_STATES={CURRENT:"Current",AGING:"Aging",STALE:"Stale",UNKNOWN:"Currentness unknown"}as const;
export const SCOPE_STATES={COMPANY:"Company scope",DIVISION:"Division scope",PROJECT:"Project scope",TRADE:"Trade scope",UNKNOWN:"Scope unknown — not global"}as const;
/**
 * TRUST_STATES/CURRENTNESS_STATES/SCOPE_STATES keep their original English-
 * labeled shape unchanged (I18N-1 must not touch parked UI-2, which asserts
 * Object.keys() equality against these exact objects). The `[0]` label slot
 * is now presentational fallback data only -- the actual rendered text comes
 * from the i18n dictionary via `locale`, keyed by the same state name, so
 * en-US output stays byte-identical to before while es-US renders Spanish.
 */
export function TrustState({state,locale=DEFAULT_LOCALE}:{state:keyof typeof TRUST_STATES;locale?:Locale}){const icon=TRUST_STATES[state][1];const label=t(locale,`trust.${state}`);return <span className={`state-chip state-${state.toLowerCase()}`} aria-label={`${t(locale,"a11yStatus.trustPrefix")} ${label}`}><Icon name={icon}/>{label}</span>}
export function CurrentnessBadge({state,locale=DEFAULT_LOCALE}:{state:keyof typeof CURRENTNESS_STATES;locale?:Locale}){const label=t(locale,`currentness.${state}`);return <span className={`currentness currentness-${state.toLowerCase()}`} aria-label={`${t(locale,"a11yStatus.currentnessPrefix")} ${label}`}><Icon name="clock"/>{label}</span>}
export function ScopeBadge({scope,locale=DEFAULT_LOCALE}:{scope:keyof typeof SCOPE_STATES;locale?:Locale}){const label=t(locale,`scope.${scope}`);return <span className={`scope-badge scope-${scope.toLowerCase()}`} aria-label={`${t(locale,"a11yStatus.scopePrefix")} ${label}`}><Icon name={scope==="UNKNOWN"?"warning":"project"}/>{label}</span>}

"use client";
export function PrintCandidateSlateButton({label,className}:{readonly label:string;readonly className:string}){return <button className={className} type="button" onClick={()=>window.print()}>{label}</button>}

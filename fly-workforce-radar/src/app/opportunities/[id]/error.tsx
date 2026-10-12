"use client";
import Link from "next/link";
import { ErrorState } from "../../../components/ui/foundation";
export default function Error(){return <div className="page-stack detail-state"><Link className="detail-back" href="/opportunities">← Opportunity Radar</Link><ErrorState/></div>}

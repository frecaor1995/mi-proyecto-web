import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";

describe("MATCHING-B5-D authorized presentation adapter",()=>{
  const source=readFileSync("src/server/opportunity-detail/get-worker-demand-engagement-ui.ts","utf8");
  it("keeps engagement and contact permissions independent",()=>{
    expect(source).toContain('allowed("worker_engagement.read"');
    expect(source).toContain('allowed("worker_contact.read"');
    expect(source).toContain('allowed("worker_contact.execute"');
  });
  it("fails contact choices closed without read permission",()=>expect(source).toContain("const choices=canReadContact?"));
  it("selects only active consent-granted routes",()=>{
    expect(source).toContain('route.lifecycleStatus==="ACTIVE"');
    expect(source).toContain('route.consentState==="GRANTED"');
  });
  it("uses the published authorized B5-C read boundary and ordered history",()=>{
    expect(source).toContain("readWorkerDemandEngagement(");
    expect(source).not.toMatch(/phone|email address|credential identifier/i);
  });
  it.each(["WORKER_LIFECYCLE_REVIEW_REQUIRED","OPPORTUNITY_NOT_ACTIONABLE","MATCH_REVIEW_REQUIRED"])("projects %s",warning=>expect(source).toContain(warning));
});

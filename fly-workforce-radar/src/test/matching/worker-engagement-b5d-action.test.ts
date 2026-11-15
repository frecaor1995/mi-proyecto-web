import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe,expect,it } from "vitest";

describe("MATCHING-B5-D thin command mapping",()=>{
  const source=readFileSync("src/server/opportunity-detail/worker-engagement-actions.ts","utf8");
  const allowed=["CREATE","SET_SELECTION","RECORD_CONTACT","RECORD_RESPONSE","SET_AVAILABILITY","SET_RESOLUTIONS","ESTABLISH_CANDIDATE","RECONCILE_SAFEGUARDS"];
  it.each(allowed)("maps %s",command=>expect(source).toContain(command));
  it.each(["START_REVIEW","PLAN_CONTACT","CLOSE","REOPEN"])("does not expose deferred %s",command=>expect(source).not.toContain(`case\"${command}\"`));
  it("preserves linkage, versions, idempotency and revalidation",()=>{
    expect(source).toContain("opportunity_demand_signals");expect(source).toContain("expectedVersion");expect(source).toContain("idempotencyKey");expect(source).toContain("revalidatePath");
  });
  it("delegates every mutation to B5-C",()=>expect(source).toContain("executeWorkerDemandEngagementCommand(command"));
  it("exports only async functions at runtime from the use-server module",()=>{
    const file=ts.createSourceFile("worker-engagement-actions.ts",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
    const runtimeExports=file.statements.filter(statement=>{
      const modifiers=ts.canHaveModifiers(statement)?ts.getModifiers(statement):undefined;
      return modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.ExportKeyword)&&!ts.isInterfaceDeclaration(statement)&&!ts.isTypeAliasDeclaration(statement);
    });
    expect(runtimeExports.length).toBeGreaterThan(0);
    for(const statement of runtimeExports){
      expect(ts.isFunctionDeclaration(statement)).toBe(true);
      if(ts.isFunctionDeclaration(statement))expect(ts.getModifiers(statement)?.some(modifier=>modifier.kind===ts.SyntaxKind.AsyncKeyword)).toBe(true);
    }
  });
});

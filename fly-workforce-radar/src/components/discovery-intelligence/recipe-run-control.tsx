"use client";

import { useActionState } from "react";
import { runDiscoveryRecipesAction, type RecipeActionState } from "../../server/discovery-intelligence/actions";

const initial: RecipeActionState = { ok: false, message: "", summary: null };

export function RecipeRunControl() {
  const [state, action, pending] = useActionState(runDiscoveryRecipesAction, initial);
  return <div>
    <form action={action}>
      <button type="submit" disabled={pending}>{pending ? "Running bounded recipes…" : "Run due recipes"}</button>
      <button type="submit" name="mode" value="refresh" disabled={pending}>Explicit second check</button>
    </form>
    {state.message ? <p role="status" data-ok={state.ok}>{state.message}</p> : null}
  </div>;
}

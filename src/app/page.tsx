import { engine } from "@/lib/demo/engine";
import { AuditTimeline } from "./console/AuditTimeline";
import { ContextDiff } from "./console/ContextDiff";
import { FlowStepper } from "./console/FlowStepper";
import { GovernControls } from "./console/GovernControls";
import { GroundRules } from "./console/GroundRules";
import { Hero } from "./console/Hero";
import { PhaseBanner } from "./console/PhaseBanner";
import { PolicyCard } from "./console/PolicyCard";
import { ProposeForms } from "./console/ProposeForms";
import { SafetyStage } from "./console/SafetyStage";
import { TopBar } from "./topbar";

export const dynamic = "force-dynamic";

export default async function Page() {
  await engine.hydrate();
  const [s, estate] = [engine.state, await engine.estate()];

  return (
    <div>
      <TopBar />
      <div className="wrap" id="top">
        <Hero />
        <GroundRules />
        <FlowStepper phase={s.phase} />
        <div id="console">
          <PhaseBanner s={s} />
          <SafetyStage s={s} />
        </div>

        <div className="console-grid">
          <div className="console-col">
            <ProposeForms
              estate={estate}
              targetUrn={s.targetUrn}
              actionType={s.actionType}
              agentExplanation={s.agentExplanation}
            />
            <GovernControls s={s} />
          </div>
          <div className="console-col">
            <ContextDiff s={s} />
            <PolicyCard />
            <AuditTimeline events={s.events} />
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';
import { useSim } from './useSim';
import { SignupForm } from './SignupForm';
import { OrganicResult } from './OrganicResult';
import { AttributedResult } from './AttributedResult';

export function Sim() {
  const sim = useSim();

  if (sim.result && sim.result.attributed === false) return <OrganicResult result={sim.result} />;

  if (sim.result)
    return <AttributedResult result={sim.result} busy={sim.busy} err={sim.err} onConfirm={sim.confirm} />;

  return (
    <SignupForm
      code={sim.code}
      email={sim.email}
      setEmail={sim.setEmail}
      referrer={sim.referrer}
      setReferrer={sim.setReferrer}
      apiKey={sim.apiKey}
      setApiKey={sim.setApiKey}
      verified={sim.verified}
      setVerified={sim.setVerified}
      busy={sim.busy}
      err={sim.err}
      onSubmit={sim.signup}
    />
  );
}

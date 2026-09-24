import { Suspense } from 'react';
import { Sim } from './Sim';

export default function Page() {
  return (
    <Suspense>
      <Sim />
    </Suspense>
  );
}

import { useState, type ReactNode } from 'react';

/** Keep the established scene available if the new painting cannot load. */
export function VividScene({ fallback, label }: { fallback: ReactNode; label: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    fallback
  ) : (
    <img
      className="vivid-scene"
      src="/art/progression/cultivation-vivid-v1.webp"
      alt={label}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

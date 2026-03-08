'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AgentState, Orb } from '@/components/ui/orb';
import styles from './page.module.css';

const ORB_PALETTES: [string, string][] = [
  ['#CADCFC', '#A0B9D1'],
  ['#21A6BD', '#4BC984'],
  ['#E05E00', '#68125E'],
  ['#E5E7EB', '#9CA3AF'],
];

export default function OrbTestPage() {
  const router = useRouter();
  const [agent, setAgent] = useState<AgentState>(null);
  const [small, setSmall] = useState(false);

  const palettes = useMemo(() => (small ? [ORB_PALETTES[0]] : ORB_PALETTES), [small]);

  return (
    <main className={styles.main}>
      <section className={styles.panel}>
        <div className={styles.header}>
          <h1>Orb Test</h1>
          <p>Interactive orb visualization with agent states.</p>
        </div>

        <div className={styles.orbRow}>
          {palettes.map((colors, index) => (
            <div
              key={`${colors[0]}-${index}`}
              className={`${styles.orbWrap} ${
                colors[0] === '#21A6BD' && colors[1] === '#4BC984' ? styles.brandOrbWrap : ''
              }`}
              data-agent={agent === null ? 'idle' : agent}
            >
              {colors[0] === '#21A6BD' && colors[1] === '#4BC984' ? (
                <>
                  <div className={styles.stormLayerA} aria-hidden="true" />
                  <div className={styles.stormLayerB} aria-hidden="true" />
                </>
              ) : null}
              <div className={styles.orbOuter}>
                <div className={styles.orbInner}>
                  <Orb colors={colors} seed={(index + 1) * 1000} agentState={agent} />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className={styles.controls}>
          <button type="button" className="lk-button" onClick={() => setAgent(null)} aria-pressed={agent === null}>
            Idle
          </button>
          <button
            type="button"
            className="lk-button"
            onClick={() => setAgent('listening')}
            aria-pressed={agent === 'listening'}
          >
            Listening
          </button>
          <button
            type="button"
            className="lk-button"
            onClick={() => setAgent('talking')}
            aria-pressed={agent === 'talking'}
          >
            Talking
          </button>
          <button
            type="button"
            className="lk-button"
            onClick={() => setSmall((prev) => !prev)}
            aria-pressed={small}
          >
            {small ? 'Show 3 Orbs' : 'Show 1 Orb'}
          </button>
          <button type="button" className="lk-button" onClick={() => router.push('/orb-voice-test')}>
            Voice Orb Test
          </button>
          <button type="button" className="lk-button" onClick={() => router.push('/?tab=dashboard')}>
            Back to Dashboard
          </button>
        </div>
      </section>
    </main>
  );
}

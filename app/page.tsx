'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { encodePassphrase, generateRoomId, randomString } from '@/lib/client-utils';
import styles from '../styles/Home.module.css';

function Tabs(props: React.PropsWithChildren<{}>) {
  const [tabIndex, setTabIndex] = useState(0);

  const router = useRouter();

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setTabIndex(q.get('tab') === 'custom' ? 1 : 0);
  }, []);

  function onTabSelected(index: number) {
    const tab = index === 1 ? 'custom' : 'demo';
    router.push(`/?tab=${tab}`);
  }

  let tabs = React.Children.map(props.children, (child, index) => {
    return (
      <button
        className="lk-button"
        onClick={() => {
          if (onTabSelected) {
            onTabSelected(index);
          }
        }}
        aria-pressed={tabIndex === index}
      >
        {/* @ts-ignore */}
        {child?.props.label}
      </button>
    );
  });

  return (
    <div className={styles.tabContainer}>
      <div className={styles.tabSelect}>{tabs}</div>
      {/* @ts-ignore */}
      {props.children[tabIndex]}
    </div>
  );
}

function DemoMeetingTab(props: { label: string }) {
  const router = useRouter();
  const [e2ee, setE2ee] = useState(false);
  const [sharedPassphrase, setSharedPassphrase] = useState(randomString(64));
  const [roomName, setRoomName] = useState('agent-test-room');
  const startMeeting = () => {
    const targetRoom = roomName.trim() || generateRoomId();
    if (e2ee) {
      router.push(`/rooms/${encodeURIComponent(targetRoom)}#${encodePassphrase(sharedPassphrase)}`);
    } else {
      router.push(`/rooms/${encodeURIComponent(targetRoom)}`);
    }
  };
  return (
    <div className={styles.tabContent}>
      <p style={{ margin: 0 }}>
        Start a technical interview room with real-time audio/video for interviewer-candidate
        screening.
      </p>
      <input
        id="roomName"
        type="text"
        value={roomName}
        onChange={(ev) => setRoomName(ev.target.value)}
        placeholder="Room name (e.g. agent-test-room)"
      />
      <button style={{ marginTop: '1rem' }} className="lk-button" onClick={startMeeting}>
        Start Interview
      </button>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', flexDirection: 'row', gap: '1rem' }}>
          <input
            id="use-e2ee"
            type="checkbox"
            checked={e2ee}
            onChange={(ev) => setE2ee(ev.target.checked)}
          ></input>
          <label htmlFor="use-e2ee">Enable end-to-end encryption</label>
        </div>
        {e2ee && (
          <div style={{ display: 'flex', flexDirection: 'row', gap: '1rem' }}>
            <label htmlFor="passphrase">Passphrase</label>
            <input
              id="passphrase"
              type="password"
              value={sharedPassphrase}
              onChange={(ev) => setSharedPassphrase(ev.target.value)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function CustomConnectionTab(props: { label: string }) {
  const router = useRouter();

  const [e2ee, setE2ee] = useState(false);
  const [sharedPassphrase, setSharedPassphrase] = useState(randomString(64));

  const onSubmit: React.FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const formData = new FormData(event.target as HTMLFormElement);
    const serverUrl = formData.get('serverUrl');
    const token = formData.get('token');
    if (e2ee) {
      router.push(
        `/custom/?liveKitUrl=${serverUrl}&token=${token}#${encodePassphrase(sharedPassphrase)}`,
      );
    } else {
      router.push(`/custom/?liveKitUrl=${serverUrl}&token=${token}`);
    }
  };
  return (
    <form className={styles.tabContent} onSubmit={onSubmit}>
      <p style={{ marginTop: 0 }}>
        Connect to your own signaling/media backend using a server URL and an access token.
      </p>
      <input
        id="serverUrl"
        name="serverUrl"
        type="url"
        placeholder="Server URL: ws://localhost:7880 or wss://your-domain"
        required
      />
      <textarea
        id="token"
        name="token"
        placeholder="Token"
        required
        rows={5}
        style={{ padding: '1px 2px', fontSize: 'inherit', lineHeight: 'inherit' }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', flexDirection: 'row', gap: '1rem' }}>
          <input
            id="use-e2ee"
            type="checkbox"
            checked={e2ee}
            onChange={(ev) => setE2ee(ev.target.checked)}
          ></input>
          <label htmlFor="use-e2ee">Enable end-to-end encryption</label>
        </div>
        {e2ee && (
          <div style={{ display: 'flex', flexDirection: 'row', gap: '1rem' }}>
            <label htmlFor="passphrase">Passphrase</label>
            <input
              id="passphrase"
              type="password"
              value={sharedPassphrase}
              onChange={(ev) => setSharedPassphrase(ev.target.value)}
            />
          </div>
        )}
      </div>

      <hr
        style={{ width: '100%', borderColor: 'rgba(30, 65, 90, 0.2)', marginBlock: '1rem' }}
      />
      <button
        style={{ paddingInline: '1.25rem', width: '100%' }}
        className="lk-button"
        type="submit"
      >
        Connect Session
      </button>
    </form>
  );
}

export default function Page() {
  return (
    <>
      <main className={styles.main} data-lk-theme="default">
        <div className={styles.heroCard}>
          <section className={styles.heroContent}>
            <img src="/images/bristlecone-logo.png" alt="Bristlecone" className={styles.brandLogo} />
            <h1 className={styles.heroTitle}>Bristlecone Technical Interaction</h1>
            <h2 className={styles.heroSubtitle}>
              A focused platform for technical evaluation and screening of job applicants through
              structured live interaction.
            </h2>
          </section>
          <aside className={styles.heroVisual} aria-hidden="true">
            <div className={styles.heroRingOuter}>
              <div className={styles.heroRingInner}>
                <div className={styles.heroOrb} />
              </div>
            </div>
          </aside>
        </div>
        <Tabs>
          <DemoMeetingTab label="Interview Room" />
          <CustomConnectionTab label="Manual Connect" />
        </Tabs>
      </main>
      <footer data-lk-theme="default">
        Bristlecone Technical Interaction helps hiring teams run consistent, high-signal technical
        screening interviews.
      </footer>
    </>
  );
}

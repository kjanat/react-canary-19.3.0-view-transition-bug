import {
  addTransitionType,
  startTransition,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  ViewTransition,
} from 'react';

type Mode = 'broken' | 'workaround';

const UPDATE_CONFIG = {
  default: 'none',
  'camera-modal': 'camera-hero-morph',
};

// ── Module-level VT warning suppression ─────────────────────────────
// Must intercept before React's first commit — useEffect is too late
// because trackNamedViewTransition fires during layout effects.
const ORIGINAL_CONSOLE_ERROR = console.error;
let vtDuplicateWarnings = 0;
const vtWarningListeners = new Set<() => void>();

console.error = (...args: unknown[]) => {
  if (
    args.some(
      (a) =>
        typeof a === 'string'
        && (a.includes('same name mounted at the same time')
          || a.includes('duplicate has this stack trace')
          || a.includes('ViewTransition name=')),
    )
  ) {
    vtDuplicateWarnings++;
    for (const listener of vtWarningListeners) listener();
    return;
  }
  ORIGINAL_CONSOLE_ERROR.apply(console, args);
};

// ── Debug stats hook ────────────────────────────────────────────────

function useAnimationDebugStats() {
  const duplicateNameWarnings = useSyncExternalStore(
    (cb) => {
      vtWarningListeners.add(cb);
      return () => {
        vtWarningListeners.delete(cb);
      };
    },
    () => vtDuplicateWarnings,
  );

  const [startCalls, setStartCalls] = useState(0);

  useEffect(() => {
    const originalStart = document.startViewTransition;
    if (originalStart) {
      document.startViewTransition = function(...args) {
        setStartCalls((c) => c + 1);
        return originalStart.apply(this, args);
      };
    }
    return () => {
      if (originalStart) {
        document.startViewTransition = originalStart;
      }
    };
  }, []);

  return { startCalls, duplicateNameWarnings };
}

// ── Component ───────────────────────────────────────────────────────

export function ReproApp() {
  const [mode, setMode] = useState<Mode>('broken');
  const [heroOwner, setHeroOwner] = useState<'button' | 'dialog'>('button');
  const [openClicks, setOpenClicks] = useState(0);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const stats = useAnimationDebugStats();
  const isWorkaround = mode === 'workaround';

  // Both modes: dialog is always mounted, imperatively showModal/close.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (heroOwner === 'dialog' && !dialog.open) {
      dialog.show();
    } else if (heroOwner === 'button' && dialog.open) {
      dialog.close();
    }
  }, [heroOwner]);

  function handleOpenModal() {
    if (heroOwner === 'dialog') return;
    setOpenClicks((count) => count + 1);
    startTransition(() => {
      addTransitionType('camera-modal');
      setHeroOwner('dialog');
    });
  }

  function handleCloseModal() {
    startTransition(() => {
      addTransitionType('camera-modal');
      setHeroOwner('button');
    });
  }

  function handleSetMode(next: Mode) {
    if (next === mode) return;
    setHeroOwner('button');
    setMode(next);
  }

  const modalContent = (
    <>
      <div className='camera-modal-header'>
        <strong>Live camera</strong>
        <button type='button' className='camera-btn' onClick={handleCloseModal}>
          Sluiten
        </button>
      </div>
      <div className='camera-preview'>Camera preview placeholder</div>
    </>
  );

  return (
    <main data-mode={mode}>
      <header className='page-header'>
        <h1>ViewTransition camera hero repro</h1>
        <p className='hint'>
          {isWorkaround
            ? 'Workaround mode: smooth opening morph.'
            : 'Broken mode: opens instantly (no smooth morph).'}
        </p>
        <nav className='page-nav' aria-label='Mode selection'>
          <button
            type='button'
            className='nav-link'
            aria-pressed={!isWorkaround}
            onClick={() => handleSetMode('broken')}
          >
            Broken
          </button>
          <button
            type='button'
            className='nav-link'
            aria-pressed={isWorkaround}
            onClick={() => handleSetMode('workaround')}
          >
            Workaround
          </button>
        </nav>
      </header>

      <div className='card'>
        {
          /* ── Both modes: identical two-boundary structure ────────
				    Only difference: workaround adds `update` prop + data-hero-owner
				    mutation hack to tickle the Update flag. */
        }
        <ViewTransition
          name={heroOwner === 'button' ? 'camera-hero' : undefined}
          share='camera-hero-morph'
          default='none'
          {...(isWorkaround ? { update: UPDATE_CONFIG } : {})}
        >
          <button
            type='button'
            className='camera-btn camera-btn--primary'
            onClick={handleOpenModal}
            style={heroOwner === 'dialog' ? { visibility: 'hidden' } : undefined}
            {...(isWorkaround ? { 'data-hero-owner': heroOwner } : {})}
          >
            Gebruik live camera
          </button>
        </ViewTransition>
        <ViewTransition
          name={heroOwner === 'dialog' ? 'camera-hero' : undefined}
          share='camera-hero-morph'
          default='none'
          {...(isWorkaround ? { update: UPDATE_CONFIG } : {})}
        >
          <dialog
            ref={dialogRef}
            className='camera-modal'
            {...(isWorkaround ? { 'data-hero-owner': heroOwner } : {})}
          >
            {modalContent}
          </dialog>
        </ViewTransition>

        {heroOwner === 'dialog' && <div className='modal-backdrop' aria-hidden='true' />}

        <div className='debug'>
          <p>
            open clicks: <b>{openClicks}</b>
          </p>
          <p>
            startViewTransition calls: <b>{stats.startCalls}</b>
          </p>
          <p>
            duplicate-name warnings: <b>{stats.duplicateNameWarnings}</b>
          </p>
        </div>
      </div>
    </main>
  );
}

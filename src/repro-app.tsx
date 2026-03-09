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

	useLayoutEffect(() => {
		const dialog = dialogRef.current;
		if (heroOwner === 'dialog' && dialog !== null && !dialog.open) {
			// non-modal: both modes use show() to keep the dialog in normal
			// stacking context. The ONLY variable between modes is the
			// `update` config on <ViewTransition> — broken omits it, so
			// no hero morph fires.
			dialog.show();
		}
	}, [heroOwner]);

	function handleOpenModal() {
		const dialog = dialogRef.current;
		if (dialog === null || dialog.open) {
			return;
		}

		setOpenClicks((count) => count + 1);
		startTransition(() => {
			addTransitionType('camera-modal');
			setHeroOwner('dialog');
		});
	}

	function handleCloseModal() {
		const dialog = dialogRef.current;
		if (dialog !== null && dialog.open) {
			dialog.close();
		}
		setHeroOwner('button');
	}

	function handleSetMode(next: Mode) {
		if (next === mode) return;
		handleCloseModal();
		setMode(next);
	}

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
				<ViewTransition
					name={heroOwner === 'button' ? 'camera-hero' : undefined}
					share='camera-hero-morph'
					default='none'
					update={isWorkaround ? UPDATE_CONFIG : undefined}
				>
					<button
						type='button'
						className='camera-btn camera-btn--primary'
						data-hero-owner={isWorkaround ? heroOwner : undefined}
						onClick={handleOpenModal}
					>
						Gebruik live camera
					</button>
				</ViewTransition>

				<ViewTransition
					name={heroOwner === 'dialog' ? 'camera-hero' : undefined}
					share='camera-hero-morph'
					default='none'
					update={isWorkaround ? UPDATE_CONFIG : undefined}
				>
					<dialog
						ref={dialogRef}
						className='camera-modal'
						data-hero-owner={isWorkaround ? heroOwner : undefined}
					>
						<div className='camera-modal-header'>
							<strong>Live camera</strong>
							<button
								type='button'
								className='camera-btn'
								onClick={handleCloseModal}
							>
								Sluiten
							</button>
						</div>
						<div className='camera-preview'>Camera preview placeholder</div>
					</dialog>
				</ViewTransition>

				{heroOwner === 'dialog' && isWorkaround && <div className='modal-backdrop' aria-hidden='true' />}

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

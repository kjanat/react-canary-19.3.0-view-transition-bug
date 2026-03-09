import {
	addTransitionType,
	startTransition,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	ViewTransition,
} from 'react';

type Mode = 'broken' | 'workaround';

const UPDATE_CONFIG = {
	default: 'none',
	'camera-modal': 'camera-hero-morph',
};

function useAnimationDebugStats() {
	const [stats, setStats] = useState({
		startCalls: 0,
		duplicateNameWarnings: 0,
	});

	useEffect(() => {
		const originalStart = document.startViewTransition;
		const originalConsoleError = console.error;

		if (originalStart) {
			document.startViewTransition = function(...args) {
				setStats((s) => ({ ...s, startCalls: s.startCalls + 1 }));
				return originalStart.apply(this, args);
			};
		}

		console.error = (...args) => {
			const message = args.map((arg) => String(arg)).join(' ');
			if (
				message.includes('same name mounted at the same time')
				|| message.includes('There are two <ViewTransition name=%s> components')
				|| message.includes('duplicate has this stack trace')
			) {
				setStats((s) => ({
					...s,
					duplicateNameWarnings: s.duplicateNameWarnings + 1,
				}));
				return; // suppress — don't forward to Parcel's overlay
			}
			originalConsoleError(...args);
		};

		return () => {
			if (originalStart) {
				document.startViewTransition = originalStart;
			}
			console.error = originalConsoleError;
		};
	}, []);

	return stats;
}

export function ReproApp() {
	const [mode, setMode] = useState<Mode>('broken');
	const [heroOwner, setHeroOwner] = useState<'button' | 'dialog'>('button');
	const [openClicks, setOpenClicks] = useState(0);
	const dialogRef = useRef<HTMLDialogElement | null>(null);
	const openingRef = useRef(false);
	const stats = useAnimationDebugStats();
	const isWorkaround = mode === 'workaround';

	useLayoutEffect(() => {
		const dialog = dialogRef.current;
		if (heroOwner === 'dialog' && dialog !== null && !dialog.open) {
			dialog.showModal();
			openingRef.current = false;
		}
	}, [heroOwner]);

	function handleOpenModal() {
		const dialog = dialogRef.current;
		if (dialog === null || dialog.open || openingRef.current) {
			return;
		}

		openingRef.current = true;
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
		openingRef.current = false;
	}

	function handleSetMode(next: Mode) {
		if (next === mode) return;
		// Close modal when switching modes to avoid stale state
		handleCloseModal();
		setMode(next);
	}

	return (
		<main>
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

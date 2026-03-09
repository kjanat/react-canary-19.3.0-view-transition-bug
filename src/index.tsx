import { createRoot } from 'react-dom/client';
import { ReproApp } from './Repro.tsx';

const root = document.getElementById('root');

if (root !== null) {
	createRoot(root).render(<ReproApp />);
}

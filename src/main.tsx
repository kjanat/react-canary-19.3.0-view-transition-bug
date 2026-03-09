import { createRoot } from 'react-dom/client';
import { ReproApp } from './repro-app.tsx';

const root = document.getElementById('root');

if (root !== null) {
	createRoot(root).render(<ReproApp />);
}

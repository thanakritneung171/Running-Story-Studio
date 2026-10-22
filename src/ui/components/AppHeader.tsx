import { Link, NavLink } from 'react-router-dom';

export function Logo({ className = '' }: { className?: string }) {
  return (
    <Link to="/" className={`flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#FF5A1F" />
        <path d="M8 22c3-8 6 2 9-6s5-6 7-8" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>
        Running Story <span className="text-brand">Studio</span>
      </span>
    </Link>
  );
}

export function AppHeader() {
  const link = ({ isActive }: { isActive: boolean }) => `rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-ink-800 text-white' : 'text-ink-300 hover:text-white'}`;
  return (
    <header className="sticky top-0 z-20 border-b border-ink-800 bg-ink-950/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Logo />
        <nav className="flex items-center gap-1">
          <NavLink to="/projects" className={link}>
            Projects
          </NavLink>
          <Link to="/new" className="btn btn-primary ml-2 py-1.5">
            New story
          </Link>
        </nav>
      </div>
    </header>
  );
}
